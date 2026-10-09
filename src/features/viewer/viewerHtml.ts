import { VIEWER_SCRIPT } from './viewerScript.generated.js';

/**
 * pdf: 앱에 포함된 pdf.js로 PDF (Signed URL 또는 진단용 내장 PDF)
 * image: 사진(JPG·PNG) — pdf.js 없이 <img> 한 장 (화면 폭 맞춤·비율 유지·확대)
 * init·blank: 진단 단계 (pdf.js 초기화만 / 빈 HTML)
 */
export type ViewerKind = 'pdf' | 'image' | 'init' | 'blank';

export interface ViewerConfig {
  kind: ViewerKind;
  /** 비공개 저장소 Signed URL (짧은 유효시간) — 기록·로그에 남기지 않는다 */
  url?: string | null;
  /** 진단 4단계: 앱에 포함된 작은 PDF (base64, 네트워크 없음) */
  data?: string | null;
  /** PDF에서 처음 보여줄 쪽 (근거 위치) */
  page?: number | null;
}

/** WebView가 불러오는 가상 주소 — 실제로 요청하지 않는다 (이 주소 외 이동은 막는다) */
export const VIEWER_BASE_URL = 'https://viewer.pacto.invalid/';

/** HTML 안에 넣는 JSON — </script 등으로 문서가 깨지지 않게 */
const safeJson = (v: unknown) => JSON.stringify(v).split('<').join('\\u003c');
const attr = (s: string) => s.split('&').join('&amp;').split('"').join('&quot;').split('<').join('&lt;').split('>').join('&gt;');

/** Signed URL로 쓸 수 있는 주소인지 (https만, 비어 있지 않음) */
export function isUsableDocumentUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url.startsWith('https://')) return false;
  try {
    return new URL(url).host.length > 0;
  } catch {
    return false;
  }
}

function originOf(url: string | null | undefined): string | null {
  if (!isUsableDocumentUrl(url)) return null;
  return new URL(url).origin;
}

function csp(origin: string | null, withScript: boolean): string {
  return [
    "default-src 'none'",
    withScript ? "script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:" : "script-src 'unsafe-inline'",
    withScript ? 'worker-src blob:' : null,
    `connect-src ${origin ?? "'none'"}`,
    `img-src ${origin ? `${origin} ` : ''}blob: data:`,
    "style-src 'unsafe-inline'",
    'font-src data: blob:',
    "base-uri 'none'",
    "form-action 'none'",
  ]
    .filter(Boolean)
    .join('; ');
}

const head = (policy: string) => `<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes">
<meta name="referrer" content="no-referrer">`;

/** 앱으로 보내는 신호 (단계 이름·상태 코드만) */
const POST = 'function __post(m){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m))}catch(e){}}';

/**
 * PDF 뷰어 HTML — pdf.js는 앱에 포함된 스크립트, 네트워크는 문서 주소의 출처 한 곳만 (CSP)
 * 화면 폭에 맞춤 · 두 손가락 확대(최대 5배) · 여러 쪽 세로 연속
 */
export function buildViewerHtml(cfg: ViewerConfig): string {
  const origin = cfg.kind === 'pdf' && !cfg.data ? originOf(cfg.url) : null;
  const config = { url: cfg.data ? null : (cfg.url ?? null), data: cfg.data ?? null, kind: cfg.kind, page: cfg.page ?? null };
  return `<!doctype html>
<html lang="ko"><head>
${head(csp(origin, true))}
<style>
html,body{margin:0;padding:0;background:#e9ecf1;-webkit-text-size-adjust:100%}
#pages{width:100%;}
.page{position:relative;width:100%;background:#fff;margin:0 0 8px 0;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.page canvas{position:absolute;inset:0;display:block;width:100%;height:100%}
</style>
</head><body>
<div id="pages"></div>
<script>window.__PACTO_VIEWER__=${safeJson(config)};</script>
<script>${VIEWER_SCRIPT}</script>
</body></html>`;
}

/** 사진 뷰어 HTML — pdf.js 없이 이미지 한 장 (화면 폭 맞춤, 비율 유지, 두 손가락 확대) */
export function buildImageHtml(url: string): string {
  const origin = originOf(url);
  return `<!doctype html>
<html lang="ko"><head>
${head(csp(origin, false))}
<style>html,body{margin:0;padding:0;background:#e9ecf1}img{display:block;width:100%;height:auto;background:#fff}</style>
</head><body>
<script>${POST}</script>
<img id="img" class="image" alt="" src="${origin ? attr(url) : ''}" onload="__post({type:'step',step:'image_loaded'});__post({type:'loaded',kind:'image',pages:1,fit:this.getBoundingClientRect().width<=window.innerWidth+1})" onerror="__post({type:'error',code:'image_load'})">
</body></html>`;
}

/** 진단 2단계: 아주 작은 HTML (WebView 자체가 열리는지) */
export function buildBlankHtml(): string {
  return `<!doctype html>
<html lang="ko"><head>
${head(csp(null, false))}
<style>body{margin:0;padding:24px;font-family:sans-serif;background:#fff}</style>
</head><body>
<p>WebView OK</p>
<script>${POST};__post({type:'loaded',kind:'blank',pages:0,fit:true})</script>
</body></html>`;
}

/** 종류에 맞는 HTML */
export function htmlFor(cfg: ViewerConfig): string {
  if (cfg.kind === 'blank') return buildBlankHtml();
  if (cfg.kind === 'image') return buildImageHtml(cfg.url ?? '');
  return buildViewerHtml(cfg);
}

/** 이 주소로의 이동만 허용 (처음 불러오기). 그 밖의 링크·리디렉션·새 창은 막는다 */
export function isAllowedViewerNavigation(url: string): boolean {
  return url === VIEWER_BASE_URL || url === 'about:blank' || url.startsWith('about:srcdoc');
}
