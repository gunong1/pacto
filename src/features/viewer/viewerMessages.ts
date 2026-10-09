/** WebView(뷰어 HTML)에서 앱으로 오는 신호 — 단계 이름·상태 코드만 */
export type ViewerEvent =
  | { type: 'loaded'; kind: string; pages: number; fit: boolean }
  | { type: 'error'; code: string }
  | { type: 'step'; step: string; code?: string };

const CODE = /^[a-z0-9_]{1,40}$/;

/** WebView에서 온 신호만 형식 확인 후 통과 (그 밖은 무시) */
export function parseViewerMessage(data: string): ViewerEvent | null {
  try {
    const m = JSON.parse(data) as Record<string, unknown>;
    if (m.type === 'loaded')
      return {
        type: 'loaded',
        kind: String(m.kind ?? ""),
        pages: Number(m.pages) || 0,
        fit: m.fit === true,
      };
    if (m.type === 'error')
      return {
        type: 'error',
        code:
          typeof m.code === "string" && CODE.test(m.code) ? m.code : "unknown",
      };
    if (m.type === 'step' && typeof m.step === "string" && CODE.test(m.step))
      return {
        type: 'step',
        step: m.step,
        ...(typeof m.code === "string" && CODE.test(m.code)
          ? { code: m.code }
          : {}),
      };
  } catch {
    /* 무시 */
  }
  return null;
}
