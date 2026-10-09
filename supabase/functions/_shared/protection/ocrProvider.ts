// OCR 공급자 — 사진 계약서 보호(향후 스캔 PDF 페이지 이미지 포함)에서 쓴다.
// 공급자 응답 구조는 여기(어댑터)에서 끝내고, 바깥에는 공통 형식(OcrPage)만 내보낸다 → 공급자를 바꿔도 탐지·가리기 코드는 그대로.
// 원문 텍스트·원본 응답은 메모리에서만 다루고 저장·로그에 쓰지 않는다. 오류도 사유 코드만 (응답 본문을 남기지 않음).
import { fromClova, type OcrPage } from './ocrText.ts';

export type OcrErrorCode = 'ocr_not_configured' | 'ocr_auth' | 'ocr_rate_limited' | 'ocr_timeout' | 'ocr_server' | 'ocr_bad_request' | 'ocr_invalid_response' | 'ocr_network';

// (Node 테스트의 타입 제거 실행과 같이 쓰도록 생성자 매개변수 속성 문법은 쓰지 않는다)
export class OcrError extends Error {
  readonly code: OcrErrorCode;
  /** 잠시 후 다시 시도하면 될 수 있는 오류 */
  readonly retryable: boolean;
  constructor(code: OcrErrorCode, retryable: boolean) {
    super(code);
    this.name = 'OcrError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface OcrImage {
  bytes: Uint8Array;
  format: 'jpg' | 'png';
  /** 실제 OCR 대상 이미지의 픽셀 크기 — 좌표를 0~1로 바꾸는 기준 */
  width: number;
  height: number;
}

export interface OcrProvider {
  readonly name: string;
  recognize(image: OcrImage): Promise<OcrPage>;
}

const TIMEOUT_MS = 20_000;
/** 일시적 오류(시간 초과·한도·서버 오류)만 1번 더 — 무한 재시도 없음 */
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 800;

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** CLOVA OCR General (V2). 비밀값은 Edge Function 환경변수에서만 (앱에 넣지 않는다) */
export class ClovaOcr implements OcrProvider {
  readonly name = 'clova';
  private readonly url: string;
  private readonly secret: string;
  private readonly fetchImpl: typeof fetch;
  constructor(url: string, secret: string, fetchImpl: typeof fetch = fetch) {
    this.url = url;
    this.secret = secret;
    this.fetchImpl = fetchImpl;
  }

  static fromEnv(env: { get(name: string): string | undefined }): ClovaOcr | null {
    const url = env.get('CLOVA_OCR_URL');
    const secret = env.get('CLOVA_OCR_SECRET');
    return url && secret ? new ClovaOcr(url, secret) : null;
  }

  async recognize(image: OcrImage): Promise<OcrPage> {
    let last: OcrError | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.once(image);
      } catch (e) {
        last = e instanceof OcrError ? e : new OcrError('ocr_network', true);
        if (!last.retryable || attempt === MAX_ATTEMPTS) throw last;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
    throw last ?? new OcrError('ocr_network', true);
  }

  private async once(image: OcrImage): Promise<OcrPage> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-OCR-SECRET': this.secret },
        body: JSON.stringify({
          version: 'V2',
          requestId: crypto.randomUUID(),
          timestamp: Date.now(),
          lang: 'ko',
          images: [{ format: image.format, name: 'page', data: base64(image.bytes) }],
        }),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new OcrError(e instanceof DOMException && e.name === 'AbortError' ? 'ocr_timeout' : 'ocr_network', true);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new OcrError('ocr_auth', false);
    if (res.status === 429) throw new OcrError('ocr_rate_limited', true);
    if (res.status >= 500) throw new OcrError('ocr_server', true);
    if (!res.ok) throw new OcrError('ocr_bad_request', false);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new OcrError('ocr_invalid_response', false);
    }
    const img = (body as { images?: { inferResult?: string; fields?: unknown }[] })?.images?.[0];
    if (!img || !Array.isArray(img.fields)) throw new OcrError('ocr_invalid_response', false);
    // inferResult = FAILURE/ERROR: 이미지를 읽지 못함 (형식·크기) — 빈 결과로 보고 unreadable 판단에 맡긴다
    return fromClova(body, image.width, image.height);
  }
}
