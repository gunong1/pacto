import { VIEWER_SCRIPT } from './viewerScript.generated.js';

export type ViewerKind = 'pdf' | 'image';

export interface ViewerConfig {
  /** 비공개 저장소 Signed URL (짧은 유효시간) — 기록·로그에 남기지 않는다 */
  url: string;
  kind: ViewerKind;
  /** PDF에서 처음 보여줄 쪽 (근거 위치) */
  page?: number | null;
}

/** WebView가 불러오는 가상 주소 — 실제로 요청하지 않는다 (이 주소 외 이동은 막는다) */
export const VIEWER_BASE_URL = 'https://viewer.pacto.invalid/';

/** HTML 안에 넣는 JSON — </script 등으로 문서가 깨지지 않게 */
const safeJson = (v: unknown) => JSON.stringify(v).split('<').join('\\u003c');

/**
 * 계약서 뷰어 HTML — pdf.js는 앱에 포함된 스크립트, 네트워크는 문서 주소의 출처 한 곳만 (CSP)
 * 화면 폭에 맞춤 · 두 손가락 확대(최대 5배) · 여러 쪽 세로 연속
 */
export function buildViewerHtml(cfg: ViewerConfig): string {
  const origin = new URL(cfg.url).origin;
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:",
    'worker-src blob:',
    `connect-src ${origin}`,
    `img-src ${origin} blob: data:`,
    "style-src 'unsafe-inline'",
    'font-src data: blob:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes">
<meta name="referrer" content="no-referrer">
<style>
html,body{margin:0;padding:0;background:#e9ecf1;-webkit-text-size-adjust:100%}
#pages{width:100%;}
.page{position:relative;width:100%;background:#fff;margin:0 0 8px 0;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.page canvas{position:absolute;inset:0;display:block;width:100%;height:100%}
.image{display:block;width:100%;height:auto;background:#fff}
</style>
</head><body>
<div id="pages"></div>
<script>window.__PACTO_VIEWER__=${safeJson({ url: cfg.url, kind: cfg.kind, page: cfg.page ?? null })};</script>
<script>${VIEWER_SCRIPT}</script>
</body></html>`;
}

/** 이 주소로의 이동만 허용 (처음 불러오기). 그 밖의 링크·리디렉션·새 창은 막는다 */
export function isAllowedViewerNavigation(url: string): boolean {
  return url === VIEWER_BASE_URL || url === 'about:blank' || url.startsWith('about:srcdoc');
}
