// 스캔 페이지 1장 처리 (protect-scan-page worker 본체) — 이미지 해석 → 바로 세움 → CLOVA OCR → 민감정보 탐지 → 실제 픽셀 덮기 → 검증
// DB·저장소에 접근하지 않는다: 받은 이미지 스트림만 처리해 보호 이미지(JPEG)와 영역(바로 선 이미지 0~1 좌표)을 돌려준다.
// 원문 값·OCR 텍스트는 이 함수 안에서만 다루고 반환·로그에 쓰지 않는다.
import type { OcrProvider } from './ocrProvider.ts';
import type { ProtectedRegion, ProtectionStatus, RegionState } from './protect.ts';
import { protectImageInput, redrawImageInput, type ImageInput, type ImageProtectDiagnostics } from './protectImage.ts';
import type { Orientation } from './scanGeometry.ts';
import { prepareScan, ScanImageError, type PreparedScan, type ScanImageMeta } from './scanImage.ts';

export interface ScanJob {
  /** 1부터 */
  page: number;
  meta: ScanImageMeta;
  orientation: Orientation;
  /** 이 페이지 영역 키 → 사용자가 정한 가림 상태 */
  prevStates: [string, RegionState][];
  /** 가림만 바꾼 경우: 저장된 영역(바로 선 이미지 0~1 좌표)으로 다시 그린다 — OCR 안 함 */
  redraw: ProtectedRegion[] | null;
}

export interface ScanPageDiagnostics extends ImageProtectDiagnostics {
  /** 원본 JPEG를 그대로 OCR에 보냈는지 (아니면 바로 세워 다시 저장) */
  directOcrInput: boolean;
  prepareMs: number;
  sourceBytes: number;
}

export interface ScanPageOutcome {
  status: ProtectionStatus;
  detail: string | null;
  /** 바로 선 이미지 0~1 좌표 */
  regions: ProtectedRegion[];
  /** 보호 이미지 (JPEG, 바로 선 방향) — protected·no_sensitive_data일 때 */
  image: Uint8Array | null;
  width: number;
  height: number;
  diagnostics: ScanPageDiagnostics;
}

const SCAN_UNSUPPORTED = new Set(['scan_format', 'scan_too_large']);

export async function protectScanPage(raw: Uint8Array, job: ScanJob, ocr: OcrProvider | null): Promise<ScanPageOutcome> {
  const t0 = performance.now();
  const base = { directOcrInput: false, prepareMs: 0, sourceBytes: raw.byteLength };
  let prepared: PreparedScan;
  try {
    prepared = await prepareScan(raw, job.meta, job.orientation);
  } catch (e) {
    const code = e instanceof ScanImageError ? e.code : 'scan_image_decode';
    return {
      status: SCAN_UNSUPPORTED.has(code) ? 'unsupported_scan' : 'failed',
      detail: code,
      regions: [],
      image: null,
      width: 0,
      height: 0,
      diagnostics: { ...emptyImageDiag(), ...base, prepareMs: Math.round(performance.now() - t0) },
    };
  }
  const prepareMs = Math.round(performance.now() - t0);
  const input: ImageInput = {
    page: job.page,
    ocr: prepared.ocr,
    width: prepared.upright.width,
    height: prepared.upright.height,
    decode: () => Promise.resolve(prepared.upright),
  };
  let r;
  if (job.redraw) r = await redrawImageInput(input, job.redraw);
  else if (!ocr) return { status: 'failed', detail: 'ocr_not_configured', regions: [], image: null, width: 0, height: 0, diagnostics: { ...emptyImageDiag(), ...base, prepareMs } };
  else r = await protectImageInput(input, { ocr, prevStates: new Map(job.prevStates), alwaysRender: true });
  const ok = r.status === 'protected' || r.status === 'no_sensitive_data';
  return {
    status: r.status,
    detail: r.detail,
    regions: r.regions,
    image: ok ? r.protectedImage : null,
    width: r.diagnostics.viewWidth,
    height: r.diagnostics.viewHeight,
    diagnostics: { ...r.diagnostics, ...base, directOcrInput: prepared.direct, prepareMs },
  };
}

function emptyImageDiag(): ImageProtectDiagnostics {
  return {
    stage: 'info', errorCode: null, width: 0, height: 0, viewWidth: 0, viewHeight: 0, ocrFieldCount: 0, ocrCharCount: 0, meanConfidence: null,
    detectedSensitiveCount: 0, maskedCount: 0, redactedRegionCount: 0, ocrCalls: 0, verification: 'skipped', verifyValueLeakCount: 0, verifyPositionLeakCount: 0,
    timings: { ocrMs: 0, decodeMs: 0, renderMs: 0, checkMs: 0, verifyOcrMs: 0, totalMs: 0 },
  };
}

// ── worker 요청·응답 형식 ──
// 요청 본문: [4바이트 JSON 길이(big-endian)][JSON(ScanJob)][이미지 스트림 바이트]
// 응답: JSON { ...ScanPageOutcome, image: base64 | null }

export function encodeScanRequest(job: ScanJob, raw: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(job));
  const out = new Uint8Array(4 + head.length + raw.length);
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  out.set(raw, 4 + head.length);
  return out;
}

export function decodeScanRequest(body: Uint8Array): { job: ScanJob; raw: Uint8Array } {
  if (body.length < 4) throw new Error('bad_request');
  const n = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0);
  if (n > 256 * 1024 || 4 + n > body.length) throw new Error('bad_request');
  const job = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + n))) as ScanJob;
  const m = job?.meta;
  const okMeta =
    m && (m.filter === 'jpeg' || m.filter === 'flate') && (m.channels === 1 || m.channels === 3) && Number.isInteger(m.width) && Number.isInteger(m.height) && m.width > 0 && m.height > 0 && Number.isInteger(m.predictor) && (m.ascii == null || m.ascii === 'a85' || m.ascii === 'hex');
  const o = job?.orientation;
  if (!okMeta || !Number.isInteger(job.page) || job.page < 1 || !o || typeof o.swap !== 'boolean' || typeof o.flipX !== 'boolean' || typeof o.flipY !== 'boolean' || !Array.isArray(job.prevStates)) {
    throw new Error('bad_request');
  }
  return { job, raw: body.subarray(4 + n) };
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function encodeScanResponse(o: ScanPageOutcome): string {
  return JSON.stringify({ ...o, image: o.image ? b64(o.image) : null });
}

export function decodeScanResponse(text: string): ScanPageOutcome {
  const o = JSON.parse(text);
  return { ...o, image: typeof o.image === 'string' ? unb64(o.image) : null };
}
