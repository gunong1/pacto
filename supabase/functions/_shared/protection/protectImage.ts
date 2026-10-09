// 사진 계약서 민감정보 보호 — 원본 이미지(읽기 전용) → OCR → 탐지(sensitive.ts, PDF와 같은 탐지기) → 실제 픽셀을 덮은 보호본 → 검증
// "보호됨"은 OCR 성공 · 모든 가림 영역 칠함 · 보호본 생성 · 보호본 해석 성공 · 검증 통과가 모두 맞을 때만.
// 검증: 민감정보를 찾은 사진만 보호본을 다시 OCR해 가린 값 전체가 다시 읽히는지(값 기준) · 가린 상자 안에서 숫자가 읽히는지(위치 기준) 확인.
//       숫자 조각(예: 1111)이 문서 다른 곳에 있다는 이유로는 실패시키지 않는다.
// 사용자가 가림을 바꿀 때(redrawImage)는 OCR을 다시 하지 않고 저장된 위치로 다시 그린 뒤 해석·덮임만 확인한다.
// 원문 값·OCR 텍스트는 이 함수 안에서만 다루고 반환·저장·로그에 쓰지 않는다 (반환: 위치·종류·가린 표시값·개수·시간).
import { checkCoverage, decodeImage, readImageInfo, renderProtectedView, type ImageFormat, type ImageInfo, type RenderedView, type RgbImage } from './imageRedact.ts';
import { OcrError, type OcrProvider } from './ocrProvider.ts';
import { buildText, detectOnTokens, readQuality, type Box, type OcrPage } from './ocrText.ts';
import type { ProtectedRegion, ProtectionStatus, RegionState } from './protect.ts';

/** 이 정도도 읽지 못하면 "민감정보 없음"이 아니라 "읽지 못함" */
export const UNREADABLE_MIN_CHARS = 40;
export const UNREADABLE_MIN_MEAN_CONFIDENCE = 0.6;
export const UNREADABLE_MAX_LOW_CONFIDENCE_RATIO = 0.5;

export interface ImageTimings {
  ocrMs: number;
  decodeMs: number;
  renderMs: number;
  checkMs: number;
  verifyOcrMs: number;
  totalMs: number;
}

export interface ImageProtectDiagnostics {
  stage: 'info' | 'ocr' | 'quality' | 'detect' | 'decode' | 'render' | 'check' | 'verify' | 'done';
  errorCode: string | null;
  width: number;
  height: number;
  viewWidth: number;
  viewHeight: number;
  ocrFieldCount: number;
  ocrCharCount: number;
  meanConfidence: number | null;
  detectedSensitiveCount: number;
  maskedCount: number;
  redactedRegionCount: number;
  ocrCalls: number;
  verification: 'passed' | 'failed' | 'skipped' | 'coverage_only';
  verifyValueLeakCount: number;
  verifyPositionLeakCount: number;
  timings: ImageTimings;
}

export interface ImageProtectResult {
  status: ProtectionStatus;
  detail: string | null;
  regions: ProtectedRegion[];
  /** status = protected일 때만 — JPEG */
  protectedImage: Uint8Array | null;
  diagnostics: ImageProtectDiagnostics;
}

const now = () => performance.now();
const digitsOf = (s: string) => s.replace(/\D/g, '');

function emptyDiag(): ImageProtectDiagnostics {
  return {
    stage: 'info', errorCode: null, width: 0, height: 0, viewWidth: 0, viewHeight: 0, ocrFieldCount: 0, ocrCharCount: 0, meanConfidence: null,
    detectedSensitiveCount: 0, maskedCount: 0, redactedRegionCount: 0, ocrCalls: 0, verification: 'skipped', verifyValueLeakCount: 0, verifyPositionLeakCount: 0,
    timings: { ocrMs: 0, decodeMs: 0, renderMs: 0, checkMs: 0, verifyOcrMs: 0, totalMs: 0 },
  };
}

/** 읽기 품질 — 글자가 거의 없거나 신뢰도가 낮으면 읽지 못한 것으로 본다 */
export function isUnreadable(page: OcrPage): boolean {
  const q = readQuality(page.tokens);
  if (q.chars < UNREADABLE_MIN_CHARS) return true;
  if (q.meanConfidence != null && q.meanConfidence < UNREADABLE_MIN_MEAN_CONFIDENCE) return true;
  if (q.lowConfidenceRatio != null && q.lowConfidenceRatio > UNREADABLE_MAX_LOW_CONFIDENCE_RATIO) return true;
  return false;
}

function center(b: Box) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}
const inside = (p: { x: number; y: number }, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/**
 * 보호본 재-OCR 결과에서 가린 값이 다시 보이는지.
 * 값 기준: 가린 값 전체(숫자만, 이메일은 글자)가 한 덩어리 안에 그대로 읽힘. 위치 기준: 칠한 상자 안에서 숫자 3개 이상인 조각이 읽힘.
 */
export function findLeaks(secrets: readonly { value: string; email: boolean }[], painted: readonly Box[], re: OcrPage): { value: number; position: number } {
  const { text } = buildText(re.tokens);
  const runs = (text.match(/\d[\d\s.-]*\d/g) ?? []).map(digitsOf);
  const lower = text.toLowerCase();
  let value = 0;
  for (const s of secrets) {
    if (s.email ? lower.includes(s.value.toLowerCase()) : runs.some((r) => r.includes(digitsOf(s.value)))) value++;
  }
  let position = 0;
  for (const t of re.tokens) {
    if (digitsOf(t.text).length >= 3 && painted.some((b) => inside(center(t.box), b))) position++;
  }
  return { value, position };
}

export interface ProtectImageOptions {
  ocr: OcrProvider;
  prevStates?: ReadonlyMap<string, RegionState>;
  /** 민감정보가 없어도 보호본(줄인 이미지)을 만든다 — PDF 스캔 페이지는 이 이미지로 새 페이지를 구성하므로 */
  alwaysRender?: boolean;
}

/** 보호할 이미지 한 장 — 사진 파일 또는 PDF 스캔 페이지(바로 세운 이미지). OCR 입력과 픽셀은 같은 0~1 좌표를 쓴다 */
export interface ImageInput {
  /** 1부터 — 영역 키(p{page}:종류:순번)와 영역 page */
  page: number;
  /** OCR로 보낼 이미지 */
  ocr: { bytes: Uint8Array; format: ImageFormat; width: number; height: number };
  /** 보호본을 그릴 픽셀 (실패 시 ScanImageError 등 — code 문자열을 상세 사유로) */
  decode: () => Promise<RgbImage>;
  width: number;
  height: number;
}

/** 사진 파일 → 입력 (EXIF 회전이 남은 JPEG는 실패) */
function photoInput(bytes: Uint8Array): { input: ImageInput } | { failed: string; info: ImageInfo | null } {
  const info = readImageInfo(bytes);
  if (!info) return { failed: 'image_format', info };
  // EXIF 회전이 남은 JPEG는 OCR 좌표와 픽셀 좌표가 어긋날 수 있다 — 보호됨으로 표시하지 않는다 (prepareFile이 회전을 반영해 다시 저장)
  if (info.orientation !== 1) return { failed: 'image_orientation', info };
  return {
    input: {
      page: 1,
      ocr: { bytes, format: info.format, width: info.width, height: info.height },
      width: info.width,
      height: info.height,
      decode: async () => {
        let src: RgbImage;
        try {
          src = await decodeImage(bytes, info.format);
        } catch {
          throw new Error('image_decode');
        }
        if (src.width !== info.width || src.height !== info.height) throw new Error('image_size_mismatch');
        return src;
      },
    },
  };
}

/** 처음 보호 (또는 사용자 선택이 없을 때 다시): OCR부터 */
export async function protectImage(bytes: Uint8Array, opts: ProtectImageOptions): Promise<ImageProtectResult> {
  const p = photoInput(bytes);
  if ('failed' in p) {
    const diag = emptyDiag();
    diag.width = p.info?.width ?? 0;
    diag.height = p.info?.height ?? 0;
    return { status: 'failed', detail: p.failed, regions: [], protectedImage: null, diagnostics: diag };
  }
  return await protectImageInput(p.input, opts);
}

/** 이미지 한 장 보호: OCR → 품질 → 탐지 → 실제 픽셀 덮기 → 덮임 확인 → (가린 것이 있으면) 재-OCR 검증 */
export async function protectImageInput(input: ImageInput, opts: ProtectImageOptions): Promise<ImageProtectResult> {
  const t0 = now();
  const diag = emptyDiag();
  const done = (status: ProtectionStatus, detail: string | null, regions: ProtectedRegion[] = [], protectedImage: Uint8Array | null = null): ImageProtectResult => {
    diag.timings.totalMs = Math.round(now() - t0);
    if (status === 'protected') diag.stage = 'done';
    return { status, detail, regions, protectedImage, diagnostics: diag };
  };
  diag.width = input.width;
  diag.height = input.height;

  diag.stage = 'ocr';
  let page: OcrPage;
  try {
    const t = now();
    diag.ocrCalls++;
    page = await opts.ocr.recognize(input.ocr);
    diag.timings.ocrMs = Math.round(now() - t);
  } catch (e) {
    diag.errorCode = e instanceof OcrError ? e.code : 'ocr_unknown';
    return done('failed', diag.errorCode);
  }
  const q = readQuality(page.tokens);
  diag.ocrFieldCount = page.tokens.length;
  diag.ocrCharCount = q.chars;
  diag.meanConfidence = q.meanConfidence == null ? null : Math.round(q.meanConfidence * 1000) / 1000;

  diag.stage = 'quality';
  if (isUnreadable(page)) return done('unreadable', 'low_ocr_quality');

  diag.stage = 'detect';
  const found = detectOnTokens(page.tokens);
  diag.detectedSensitiveCount = found.length;
  if (found.length === 0 && !opts.alwaysRender) return done('no_sensitive_data', null);
  // 위치를 잃은 글자가 있으면 덮을 수 없다
  if (found.some((f) => !f.complete || f.boxes.length === 0)) return done('failed', 'location_lost');

  const { text } = buildText(page.tokens);
  const counters = new Map<string, number>();
  const regions: ProtectedRegion[] = [];
  const secrets: { value: string; email: boolean }[] = [];
  for (const f of found) {
    const d = f.detection;
    const n = (counters.get(d.type) ?? 0) + 1;
    counters.set(d.type, n);
    const key = `p${input.page}:${d.type}:${n}`;
    const state = opts.prevStates?.get(key) ?? (d.confidence === 'low' ? 'candidate' : 'masked');
    regions.push({ key, page: input.page, type: d.type, level: d.level, confidence: d.confidence, state, maskedPreview: d.maskedPreview, contextLabel: d.contextLabel, bbox: f.boxes });
    if (state === 'masked') secrets.push({ value: text.slice(d.start, d.end), email: d.type === 'email' });
  }
  diag.maskedCount = regions.filter((r) => r.state === 'masked').length;

  const rendered = await renderAndCheck(input.decode, regions, diag);
  if ('failed' in rendered) return done('failed', rendered.failed, regions);

  // 재-OCR 검증 — 민감정보를 찾은 사진만 (가린 것이 하나도 없으면 다시 읽을 것도 없다)
  if (secrets.length > 0) {
    diag.stage = 'verify';
    try {
      const t = now();
      diag.ocrCalls++;
      const re = await opts.ocr.recognize({ bytes: rendered.view.bytes, format: 'jpg', width: rendered.view.width, height: rendered.view.height });
      diag.timings.verifyOcrMs = Math.round(now() - t);
      const leaks = findLeaks(secrets, rendered.view.painted, re);
      diag.verifyValueLeakCount = leaks.value;
      diag.verifyPositionLeakCount = leaks.position;
      if (leaks.value > 0 || leaks.position > 0) {
        diag.verification = 'failed';
        return done('failed', 'verification_failed', regions);
      }
      diag.verification = 'passed';
    } catch (e) {
      diag.errorCode = e instanceof OcrError ? e.code : 'ocr_unknown';
      diag.verification = 'failed';
      return done('failed', 'verification_unavailable', regions);
    }
  }
  if (regions.length === 0) return done('no_sensitive_data', null, [], rendered.view.bytes);
  return done('protected', null, regions, rendered.view.bytes);
}

/**
 * 사용자가 가림을 바꿨을 때: OCR 없이 저장된 위치로 다시 그린다 → 해석·덮임 확인.
 * (처음 보호에서 이미 재-OCR 검증을 통과한 위치를 그대로 쓰므로, 같은 위치를 다시 칠한 결과는 덮임 확인으로 충분하다)
 */
export async function redrawImage(bytes: Uint8Array, regions: ProtectedRegion[]): Promise<ImageProtectResult> {
  const p = photoInput(bytes);
  if ('failed' in p) {
    const diag = emptyDiag();
    diag.verification = 'coverage_only';
    return { status: 'failed', detail: 'image_format', regions, protectedImage: null, diagnostics: diag };
  }
  return await redrawImageInput(p.input, regions);
}

export async function redrawImageInput(input: ImageInput, regions: ProtectedRegion[]): Promise<ImageProtectResult> {
  const t0 = now();
  const diag = emptyDiag();
  diag.verification = 'coverage_only';
  const result = (status: ProtectionStatus, detail: string | null, img: Uint8Array | null = null): ImageProtectResult => {
    diag.timings.totalMs = Math.round(now() - t0);
    return { status, detail, regions, protectedImage: img, diagnostics: diag };
  };
  diag.width = input.width;
  diag.height = input.height;
  diag.detectedSensitiveCount = regions.length;
  diag.maskedCount = regions.filter((r) => r.state === 'masked').length;
  const rendered = await renderAndCheck(input.decode, regions, diag);
  if ('failed' in rendered) return result('failed', rendered.failed);
  return result(regions.length === 0 ? 'no_sensitive_data' : 'protected', null, rendered.view.bytes);
}

const CODE = /^[a-z_0-9]+$/;

async function renderAndCheck(decode: () => Promise<RgbImage>, regions: readonly ProtectedRegion[], diag: ImageProtectDiagnostics): Promise<{ failed: string } | { view: RenderedView }> {
  const boxes = regions.filter((r) => r.state === 'masked').flatMap((r) => r.bbox);
  diag.stage = 'decode';
  let t = now();
  let src: RgbImage;
  try {
    src = await decode();
  } catch (e) {
    return { failed: e instanceof Error && CODE.test(e.message) ? e.message : 'image_decode' };
  }
  diag.timings.decodeMs = Math.round(now() - t);

  diag.stage = 'render';
  t = now();
  const view = renderProtectedView(src, boxes);
  diag.timings.renderMs = Math.round(now() - t);
  diag.viewWidth = view.width;
  diag.viewHeight = view.height;
  diag.redactedRegionCount = regions.filter((r) => r.state === 'masked').length;

  diag.stage = 'check';
  t = now();
  const cov = await checkCoverage(view.bytes, view.painted);
  diag.timings.checkMs = Math.round(now() - t);
  if (!cov.decodable) return { failed: 'derivative_decode' };
  if (cov.uncovered > 0) return { failed: 'coverage' };
  return { view };
}
