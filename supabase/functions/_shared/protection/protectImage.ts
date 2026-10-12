// 사진 계약서 민감정보 보호 — 원본 이미지(읽기 전용) → OCR → 탐지(sensitive.ts, PDF와 같은 탐지기) → 실제 픽셀을 덮은 보호본 → 검증
// "보호됨"은 OCR 성공 · 모든 가림 영역 칠함 · 보호본 생성 · 보호본 해석 성공 · 검증 통과가 모두 맞을 때만.
// "탐지한 값을 모두 가렸다"만으로 보호 완료가 아니다 — 필드명(휴대전화·주민등록번호·계좌·카드)은 있는데 값을 탐지하지 못한 칸이 있으면:
//   D. 그 칸만 잘라 보정·확대 후 다시 읽기 (전체 OCR 반복 없음, 페이지당 MAX_REREAD_FIELDS칸)
//   C. 그래도 못 읽으면 값 영역이 확실할 때만 그 영역을 가림 (필드명과 구분되면 값만, 한 줄·작은 상자일 때만)
//   그 밖 → needs_review(보호 확인 필요): 넓은 영역을 임의로 가려 보호 완료로 처리하지 않는다. AI 분석은 막힌다.
// 재검증(E): 보호본 재-OCR에서 가린 값이 다시 읽히는지 + 가린 영역 밖에서 새로 탐지되는 값·미확인 칸이 없는지.
// 검증: 민감정보를 찾은 사진만 보호본을 다시 OCR해 가린 값 전체가 다시 읽히는지(값 기준) · 가린 상자 안에서 숫자가 읽히는지(위치 기준) 확인.
//       숫자 조각(예: 1111)이 문서 다른 곳에 있다는 이유로는 실패시키지 않는다.
// 사용자가 가림을 바꿀 때(redrawImage)는 OCR을 다시 하지 않고 저장된 위치로 다시 그린 뒤 해석·덮임만 확인한다.
// 원문 값·OCR 텍스트는 이 함수 안에서만 다루고 반환·저장·로그에 쓰지 않는다 (반환: 위치·종류·가린 표시값·개수·시간).
import { checkCoverage, cropForReread, decodeImage, readImageInfo, renderProtectedView, type ImageFormat, type ImageInfo, type RenderedView, type RgbImage } from './imageRedact.ts';
import { OcrError, type OcrProvider } from './ocrProvider.ts';
import { defaultRegionState, MASK_LEVEL, type SensitiveType, type UnresolvedField } from './sensitive.ts';
import { analyzeTokens, buildText, readQuality, unionBox, type Box, type MappedText, type OcrDetection, type OcrPage, type OcrToken } from './ocrText.ts';
import type { ProtectedRegion, ProtectionStatus, RegionState } from './protect.ts';

/** 이 정도도 읽지 못하면 "민감정보 없음"이 아니라 "읽지 못함" */
export const UNREADABLE_MIN_CHARS = 40;
export const UNREADABLE_MIN_MEAN_CONFIDENCE = 0.6;
export const UNREADABLE_MAX_LOW_CONFIDENCE_RATIO = 0.5;
/** 의심 칸 다시 읽기 — 페이지당 최대 칸 수 (OCR 비용 상한) */
export const MAX_REREAD_FIELDS = 3;
/** 값 영역 가리기(C)를 허용하는 크기 — 줄 높이의 이 배수 이하 · 페이지 너비의 이 비율 이하 */
const FIELD_MAX_HEIGHT_LINES = 2;
const FIELD_MAX_WIDTH = 0.6;

export interface ImageTimings {
  ocrMs: number;
  decodeMs: number;
  renderMs: number;
  checkMs: number;
  verifyOcrMs: number;
  rereadMs: number;
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
  /** 낮은 신뢰도 글자 비율 · 읽지 못함으로 본 기준 (진단용 숫자·코드만) */
  lowConfidenceRatio: number | null;
  unreadableReason: UnreadableReason | null;
  detectedSensitiveCount: number;
  maskedCount: number;
  redactedRegionCount: number;
  ocrCalls: number;
  verification: 'passed' | 'failed' | 'skipped' | 'coverage_only';
  verifyValueLeakCount: number;
  verifyPositionLeakCount: number;
  /** 필드명은 있는데 값을 탐지하지 못한 칸 수 (처음 OCR) */
  unresolvedFieldCount: number;
  /** 의심 칸 다시 읽기 횟수 · 그중 값을 찾은 수 */
  rereadCount: number;
  rereadResolvedCount: number;
  /** 값 영역 가리기(C)로 처리한 칸 수 · 위치를 확정하지 못한 칸 수 */
  fieldFallbackCount: number;
  uncertainFieldCount: number;
  /** 재검증에서 가린 영역 밖에 남은 값·칸 수 */
  verifyMissedCount: number;
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

/** 진단 기본값 (사진·스캔 작업자 공통) */
export function emptyImageDiag(): ImageProtectDiagnostics {
  return {
    stage: 'info', errorCode: null, width: 0, height: 0, viewWidth: 0, viewHeight: 0, ocrFieldCount: 0, ocrCharCount: 0, meanConfidence: null, lowConfidenceRatio: null, unreadableReason: null,
    detectedSensitiveCount: 0, maskedCount: 0, redactedRegionCount: 0, ocrCalls: 0, verification: 'skipped', verifyValueLeakCount: 0, verifyPositionLeakCount: 0,
    unresolvedFieldCount: 0, rereadCount: 0, rereadResolvedCount: 0, fieldFallbackCount: 0, uncertainFieldCount: 0, verifyMissedCount: 0,
    timings: { ocrMs: 0, decodeMs: 0, renderMs: 0, checkMs: 0, verifyOcrMs: 0, rereadMs: 0, totalMs: 0 },
  };
}

/** 읽지 못함으로 본 기준 (실패 사유 코드) */
export type UnreadableReason = 'too_few_chars' | 'low_mean_confidence' | 'many_low_confidence';

/** 읽기 품질 — 글자가 거의 없거나 신뢰도가 낮으면 읽지 못한 것으로 본다. 걸린 첫 기준을 돌려준다 (없으면 null) */
export function unreadableReason(page: OcrPage): UnreadableReason | null {
  const q = readQuality(page.tokens);
  if (q.chars < UNREADABLE_MIN_CHARS) return 'too_few_chars';
  if (q.meanConfidence != null && q.meanConfidence < UNREADABLE_MIN_MEAN_CONFIDENCE) return 'low_mean_confidence';
  if (q.lowConfidenceRatio != null && q.lowConfidenceRatio > UNREADABLE_MAX_LOW_CONFIDENCE_RATIO) return 'many_low_confidence';
  return null;
}
export const isUnreadable = (page: OcrPage): boolean => unreadableReason(page) !== null;

function center(b: Box) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}
const inside = (p: { x: number; y: number }, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/** 미확인 칸의 위치 — 필드명·값 조각(OCR 토큰)과 다시 읽을 영역, 값 영역을 확실히 정할 수 있는지 */
export interface FieldLocation {
  /** 값 조각 상자 (한 줄이면 1개) */
  valueBoxes: Box[];
  /** 값 영역이 확실함: 값의 모든 글자가 조각에 대응 · 한 줄 · 작은 상자 */
  certain: boolean;
  /** 다시 읽을 영역 (필드명 + 값 + 여유) */
  region: Box | null;
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const sameLine = (a: Box, b: Box) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > Math.min(a.h, b.h) * 0.5;
const clampBox = (b: Box): Box => {
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  return { x, y, w: Math.max(0, Math.min(1, b.x + b.w) - x), h: Math.max(0, Math.min(1, b.y + b.h) - y) };
};

export function fieldLocation(tokens: readonly OcrToken[], { text, owner }: MappedText, u: UnresolvedField): FieldLocation {
  const set = (a: number, b: number) => {
    const out = new Set<number>();
    for (let i = a; i < b; i++) if (owner[i] >= 0) out.add(owner[i]);
    return out;
  };
  const labelTok = set(u.labelStart, u.labelEnd);
  const valueTok = set(u.valueStart, u.valueEnd);
  let allOwned = true;
  for (let i = u.valueStart; i < u.valueEnd; i++) if (owner[i] < 0 && !/\s/.test(text[i])) allOwned = false;
  const vBoxes = [...valueTok].map((i) => tokens[i].box);
  const lBoxes = [...labelTok].map((i) => tokens[i].box);
  const all = [...lBoxes, ...vBoxes];
  if (!all.length) return { valueBoxes: [], certain: false, region: null };
  const lineH = median(all.map((b) => b.h));
  const vUnion = unionBox(vBoxes);
  // 필드명과 같은 조각에 붙은 값(휴대전화010…)은 그 조각 하나가 값 영역 (필드명과 나눌 수 없지만 영역은 작고 확실)
  const certain =
    !!vUnion && allOwned && vBoxes.every((b) => sameLine(b, vBoxes[0])) && vUnion.h <= lineH * FIELD_MAX_HEIGHT_LINES && vUnion.w <= FIELD_MAX_WIDTH;
  const u0 = unionBox(all)!;
  const region = clampBox({ x: u0.x - lineH * 0.5, y: u0.y - lineH * 0.8, w: u0.w + lineH * 4, h: u0.h + lineH * 1.6 });
  return { valueBoxes: vUnion ? [vUnion] : [], certain, region };
}

/** 잘라낸 이미지의 0~1 좌표 → 원래 페이지의 0~1 좌표 */
const fromCrop = (b: Box, r: Box): Box => ({ x: r.x + b.x * r.w, y: r.y + b.y * r.h, w: b.w * r.w, h: b.h * r.h });
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 보호본 재-OCR에서 가린(또는 사용자가 표시로 둔) 영역 밖에 남은 값·미확인 칸 수 */
export function findMissed(re: OcrPage, known: readonly Box[]): number {
  const a = analyzeTokens(re.tokens);
  const outside = (boxes: readonly Box[]) => boxes.length > 0 && !boxes.some((b) => known.some((k) => inside(center(b), k)));
  let n = a.found.filter((f) => outside(f.boxes)).length;
  for (const u of a.unresolved) if (outside(fieldLocation(re.tokens, a.mapped, u).valueBoxes)) n++;
  return n;
}

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
    const diag = emptyImageDiag();
    diag.width = p.info?.width ?? 0;
    diag.height = p.info?.height ?? 0;
    return { status: 'failed', detail: p.failed, regions: [], protectedImage: null, diagnostics: diag };
  }
  return await protectImageInput(p.input, opts);
}

/** 이미지 한 장 보호: OCR → 품질 → 탐지 → 실제 픽셀 덮기 → 덮임 확인 → (가린 것이 있으면) 재-OCR 검증 */
export async function protectImageInput(input: ImageInput, opts: ProtectImageOptions): Promise<ImageProtectResult> {
  const t0 = now();
  const diag = emptyImageDiag();
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
  diag.lowConfidenceRatio = q.lowConfidenceRatio == null ? null : Math.round(q.lowConfidenceRatio * 1000) / 1000;
  diag.unreadableReason = unreadableReason(page);

  diag.stage = 'quality';
  if (diag.unreadableReason) return done('unreadable', 'low_ocr_quality');

  diag.stage = 'detect';
  const first = analyzeTokens(page.tokens);
  const found: OcrDetection[] = [...first.found];
  diag.unresolvedFieldCount = first.unresolved.length;
  // 원본 픽셀은 한 번만 해석 (다시 읽기·보호본 그리기에 함께)
  let src: RgbImage | null = null;
  const decodeOnce = async () => (src ??= await input.decode());
  const fallbacks: { type: SensitiveType; label: string; boxes: Box[]; value: string }[] = [];
  for (const [k, u] of first.unresolved.entries()) {
    const loc = fieldLocation(page.tokens, first.mapped, u);
    // D. 의심 칸만 다시 읽기
    if (k < MAX_REREAD_FIELDS && loc.region && loc.region.w > 0 && loc.region.h > 0) {
      let img: RgbImage;
      try {
        img = await decodeOnce();
      } catch (e) {
        return done('failed', e instanceof Error && CODE.test(e.message) ? e.message : 'image_decode');
      }
      const crop = cropForReread(img, loc.region);
      const t = now();
      diag.ocrCalls++;
      diag.rereadCount++;
      try {
        const rp = await opts.ocr.recognize({ bytes: crop.bytes, format: 'jpg', width: crop.width, height: crop.height, region: loc.region });
        const mapped = rp.tokens.map((x) => ({ ...x, box: fromCrop(x.box, loc.region!), chars: undefined }));
        const known = found.flatMap((f) => f.boxes);
        const again = analyzeTokens(mapped).found.filter((f) => f.complete && f.boxes.length > 0 && !f.boxes.some((b) => known.some((kb) => overlaps(b, kb))));
        diag.timings.rereadMs += Math.round(now() - t);
        if (again.length > 0) {
          found.push(...again);
          diag.rereadResolvedCount++;
          continue;
        }
      } catch {
        // 다시 읽기 실패는 아래 C·확인 필요로 (원본으로 넘어가는 경로 없음)
        diag.timings.rereadMs += Math.round(now() - t);
      }
    }
    // C. 값 영역이 확실하면 그 영역만 가린다
    if (loc.certain) {
      fallbacks.push({ type: u.type, label: first.mapped.text.slice(u.labelStart, u.labelEnd).replace(/\s+/g, ''), boxes: loc.valueBoxes, value: first.mapped.text.slice(u.valueStart, u.valueEnd) });
      diag.fieldFallbackCount++;
      continue;
    }
    diag.uncertainFieldCount++;
  }
  diag.detectedSensitiveCount = found.length + fallbacks.length;
  // 위치를 확정하지 못한 칸이 있으면 보호 완료로 처리하지 않는다 (넓은 영역을 임의로 가리지 않음)
  if (diag.uncertainFieldCount > 0) return done('needs_review', 'field_uncertain');
  if (found.length === 0 && fallbacks.length === 0 && !opts.alwaysRender) return done('no_sensitive_data', null);
  // 위치를 잃은 글자가 있으면 덮을 수 없다
  if (found.some((f) => !f.complete || f.boxes.length === 0)) return done('failed', 'location_lost');

  const { text } = first.mapped;
  const counters = new Map<string, number>();
  const regions: ProtectedRegion[] = [];
  const secrets: { value: string; email: boolean }[] = [];
  const keyOf = (type: string) => {
    const n = (counters.get(type) ?? 0) + 1;
    counters.set(type, n);
    return `p${input.page}:${type}:${n}`;
  };
  for (const f of found) {
    const d = f.detection;
    const key = keyOf(d.type);
    const state = opts.prevStates?.get(key) ?? defaultRegionState(d);
    regions.push({ key, page: input.page, type: d.type, level: d.level, confidence: d.confidence, state, maskedPreview: d.maskedPreview, contextLabel: d.contextLabel, bbox: f.boxes });
    // 다시 읽기로 찾은 값은 처음 OCR 문자열에 없으므로 위치 검증(칠한 상자 안 숫자)만으로 확인한다
    if (state === 'masked' && first.found.includes(f)) secrets.push({ value: text.slice(d.start, d.end), email: d.type === 'email' });
  }
  for (const fb of fallbacks) {
    const key = keyOf(fb.type);
    // 값 모양을 확정하지 못한 칸 — 기본으로 가린다 (값 글자는 표시값에 남기지 않음)
    const state = opts.prevStates?.get(key) ?? 'masked';
    regions.push({ key, page: input.page, type: fb.type, level: MASK_LEVEL[fb.type], confidence: 'medium', state, maskedPreview: fb.value.replace(/[0-9A-Za-z|]/g, '*').replace(/\s+/g, ' ').slice(0, 40), contextLabel: fb.label || null, bbox: fb.boxes });
    if (state === 'masked') secrets.push({ value: fb.value, email: false });
  }
  diag.maskedCount = regions.filter((r) => r.state === 'masked').length;

  const rendered = await renderAndCheck(decodeOnce, regions, diag);
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
      // E. 가린 영역(사용자가 표시로 둔 영역 포함) 밖에서 새로 탐지되는 값·미확인 칸이 있으면 놓친 것이 있다
      const known = regions.flatMap((r) => r.bbox).map((b) => ({ x: b.x - b.h, y: b.y - b.h * 0.5, w: b.w + b.h * 2, h: b.h * 2 }));
      diag.verifyMissedCount = findMissed(re, known);
      if (diag.verifyMissedCount > 0) {
        diag.verification = 'failed';
        return done('failed', 'verification_missed', regions);
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
    const diag = emptyImageDiag();
    diag.verification = 'coverage_only';
    return { status: 'failed', detail: 'image_format', regions, protectedImage: null, diagnostics: diag };
  }
  return await redrawImageInput(p.input, regions);
}

export async function redrawImageInput(input: ImageInput, regions: ProtectedRegion[]): Promise<ImageProtectResult> {
  const t0 = now();
  const diag = emptyImageDiag();
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
