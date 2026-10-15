// 계약서 민감정보 보호 — 원본 PDF(읽기 전용) → 탐지 → 실제 제거 → 보호 표시본 → 독립 검증
// 신뢰성 확인: 원본을 pdf.js(별도 구현)로도 읽어, 우리 추출기가 얻은 글자 위치·내용과 맞는지 본다 (안 맞으면 보호하지 않음)
// 검증(보호본): 지워야 했던 글자가 같은 위치에 남았는지(위치 기반, 두 추출기 모두), 가린 값 전체가 텍스트에 남았는지,
//       놓친 Level 1 정보가 보이는지 확인한다. 하나라도 걸리면 보호본을 쓰지 않고 "보호됨"으로 표시하지 않는다.
// 원문 값은 이 함수 안에서만 다루고 반환·저장·로그에 쓰지 않는다 (반환하는 것은 위치·종류·가린 표시값뿐).
import { PDFDocument } from '../vendor/pdf-lib.js';
import { extractText, getDocumentProxy } from '../vendor/unpdf.js';
import { PDFJS_OPTIONS } from './cmap.ts';
import { PDFName } from '../vendor/pdf-lib.js';
import { buildProtectedView, extractPage, removeGlyphs, type Box, type Glyph, type PageText, type StreamEntry } from './pdfEngine.ts';
import { normalizeRotate, pageBoxToUpright, uprightBoxToPage } from './scanGeometry.ts';
import { assembleProtectedPdf, classifyPage, rawImageBytes } from './scanPdf.ts';
import type { ScanJob, ScanPageOutcome } from './scanWorker.ts';
import { keptPages, subsetPdf } from './pageSelection.ts';
import { countPreMasked, defaultRegionState, detectSensitive, MASK_LEVEL, shouldMaskSensitive, type DetectionConfidence, type SensitiveType } from './sensitive.ts';

export type ProtectionStatus = 'protected' | 'no_sensitive_data' | 'unreadable' | 'needs_review' | 'unsupported_scan' | 'failed';
export type RegionState = 'masked' | 'unmasked' | 'candidate';

export interface ProtectedRegion {
  /** 같은 문서를 다시 처리해도 같은 영역을 가리키는 키 (사용자 선택 유지) */
  key: string;
  page: number;
  type: SensitiveType;
  level: 1 | 2;
  confidence: DetectionConfidence;
  state: RegionState;
  maskedPreview: string;
  contextLabel: string | null;
  /** 페이지 대비 0~1, 왼쪽 위 기준 */
  bbox: { x: number; y: number; w: number; h: number }[];
}

export interface ProtectResult {
  status: ProtectionStatus;
  /** 실패·미지원 사유 코드 (원문 없음) */
  detail: string | null;
  /** 텍스트 페이지 안에 이미지가 있어, 이미지 속 내용은 확인하지 못함 */
  imagesUnchecked: boolean;
  regions: ProtectedRegion[];
  /** status = protected일 때만 */
  protectedPdf: Uint8Array | null;
  pageCount: number;
  /** 단계별 진단 (개수·형식만 — 원문·글꼴 이름·좌표 없음). 로그와 응답에 쓴다 */
  diagnostics: ProtectDiagnostics;
  /** 페이지별 종류·상태 (DB protection_pages — 원문 없음) */
  pages: PageOutcome[];
  /** 스캔 페이지별 처리 시간·OCR 호출 수 (성능 측정용 — 원문·좌표 없음) */
  scanMetrics: ScanPageMetrics[];
}

/** skipped: 다른 페이지가 실패·미지원이라 처리하지 않음 / excluded: 사용자가 분석에서 뺀 페이지 (읽지도 보호본에 넣지도 않음) */
export type PageStatus = ProtectionStatus | 'skipped' | 'excluded';

export interface PageOutcome {
  /** 1부터 */
  page: number;
  /** excluded: 사용자가 뺀 페이지 — 읽지 않으므로 종류를 모른다 */
  kind: 'text' | 'scan' | 'unsupported' | 'excluded';
  status: PageStatus;
  detail: string | null;
  /** 실패한 페이지의 실패 단계 (진단용 — 원문 없음) */
  stage?: ProtectStage;
  /** 원본에서 이미 가려져 있던 값(예: 900101-1******) 개수 — 복원·추정하지 않고 개수만 센다 */
  preMasked?: number;
  /** 스캔 페이지 글자 인식 품질 (진단용 숫자만 — 원문 없음) */
  quality?: OcrQuality;
}

/** 글자 인식 품질 — 글자 수 · 평균 신뢰도 · 낮은 신뢰도 글자 비율 (숫자만) */
export interface OcrQuality {
  chars: number;
  meanConfidence: number | null;
  lowConfidenceRatio: number | null;
  /** 읽지 못함으로 본 기준 (too_few_chars · low_mean_confidence · many_low_confidence) — 읽었으면 null */
  reason: string | null;
}

export interface ScanPageMetrics {
  page: number;
  status: ProtectionStatus;
  detail: string | null;
  workerMs: number;
  ocrCalls: number;
  directOcrInput: boolean;
  sourceBytes: number;
  imageBytes: number;
  width: number;
  height: number;
  viewWidth: number;
  viewHeight: number;
  detectedSensitiveCount: number;
  verification: string;
  timings: Record<string, number> | null;
}

/** 스캔 페이지 1장 처리기 — 배포: protect-scan-page worker 호출 / 테스트: 같은 코드를 직접 실행 */
export type ScanRunner = (job: ScanJob, raw: Uint8Array) => Promise<ScanPageOutcome>;

export interface ProtectPdfOptions {
  scan?: ScanRunner | null;
  /** 가림만 바꾼 경우: 저장된 스캔 페이지 영역(페이지 좌표, 바뀐 상태 반영)으로 다시 그린다 — OCR 안 함 */
  redrawScanRegions?: ProtectedRegion[] | null;
}

export type ProtectStage = 'load' | 'extract' | 'classify' | 'detect' | 'redact' | 'verify';

export interface ProtectDiagnostics {
  failureStage: ProtectStage | null;
  errorCode: string | null;
  pageCount: number;
  /** 글자(텍스트 아이템) 수 — 보이는 글자 / 투명 글자 */
  textItemCount: number;
  visibleGlyphCount: number;
  invisibleGlyphCount: number;
  /** 글자 코드를 문자로 바꾸지 못한 수 */
  undecodableCount: number;
  /** 해석할 수 없는 글꼴로 그린 글자 바이트 수 */
  unsupportedFontTextCount: number;
  imageCount: number;
  widgetCount: number;
  scanPageCount: number;
  textPageCount: number;
  blankPageCount: number;
  unsupportedPageCount: number;
  /** 스캔 페이지 OCR 호출 수 합계 (첫 OCR + 재-OCR 검증) */
  scanOcrCalls: number;
  /** 최종 보호본의 스캔 페이지에서 읽힌 글자 조각 수 (0이어야 함) */
  verifyScanTextCount: number;
  /** 글꼴 형식별 개수 (예: Type0/Identity-H/toUnicode) */
  fonts: { subtype: string; encoding: string; toUnicode: boolean; supported: boolean; count: number }[];
  /** 줄로 묶은 텍스트 길이·줄 수 */
  extractedTextLength: number;
  lineCount: number;
  /** 위치(bbox)가 유효한 글자 수 */
  bboxCount: number;
  detected: Record<string, number>;
  detectedSensitiveCount: number;
  maskedCount: number;
  removedGlyphCount: number;
  boxCount: number;
  derivativeBytes: number;
  /** 원본 신뢰성: pdf.js 텍스트 조각 중 우리 추출 글자와 위치·내용이 맞는 비율 */
  alignItemCount: number;
  alignMatchedCount: number;
  /** pdf.js로 읽은 원본에서만 보인 Level 1 정보 수 */
  alignMissedCount: number;
  /** 보호본 재추출(pdf.js) 텍스트 길이, 남은 원문 수, 놓친 Level 1 수와 종류 */
  verifyTextLength: number;
  /** 지워야 했던 글자가 보호본의 같은 위치에서 다시 읽힌 수 (우리 추출기 / pdf.js) */
  verifyPositionLeakOwn: number;
  verifyPositionLeakPdfjs: number;
  /** 가린 값 전체(숫자만 비교)가 보호본 텍스트에 남은 수 */
  verifyValueLeakCount: number;
  /** 위 둘 중 하나라도 걸린 가린 값 수 */
  verifyLeakCount: number;
  /** 가렸는데 보호본에서 다시 추출된 값의 종류 */
  verifyLeakTypes: string[];
  verifyMissedCount: number;
  verifyMissedTypes: string[];
}

/** 오류 이름·짧은 메시지만 (숫자·따옴표 안 내용 제거 — 원문이 섞이지 않도록) */
export function safeErrorCode(e: unknown): string {
  if (!(e instanceof Error)) return 'unknown';
  const msg = e.message.replace(/["'`][^"'`]*["'`]/g, '').replace(/[^A-Za-z _-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${e.name}${msg ? `: ${msg}` : ''}`;
}

function emptyDiagnostics(): ProtectDiagnostics {
  return {
    failureStage: null, errorCode: null, pageCount: 0, textItemCount: 0, visibleGlyphCount: 0, invisibleGlyphCount: 0, undecodableCount: 0,
    unsupportedFontTextCount: 0, imageCount: 0, widgetCount: 0, scanPageCount: 0, textPageCount: 0, blankPageCount: 0, unsupportedPageCount: 0,
    scanOcrCalls: 0, verifyScanTextCount: 0, fonts: [], extractedTextLength: 0, lineCount: 0, bboxCount: 0,
    detected: {}, detectedSensitiveCount: 0, maskedCount: 0, removedGlyphCount: 0, boxCount: 0, derivativeBytes: 0, alignItemCount: 0,
    alignMatchedCount: 0, alignMissedCount: 0, verifyTextLength: 0, verifyPositionLeakOwn: 0, verifyPositionLeakPdfjs: 0, verifyValueLeakCount: 0,
    verifyLeakCount: 0, verifyLeakTypes: [], verifyMissedCount: 0, verifyMissedTypes: [],
  };
}

export const MAX_PAGES = 60;
/** 한 문서에서 처리하는 스캔 페이지 최대 수 — 실제 배포 측정 후 조정 (넘으면 unsupported_scan / too_many_scan_pages) */
export const MAX_SCAN_PAGES = 20;
/** 스캔 페이지 동시 처리 수 (worker 호출) */
export const SCAN_CONCURRENCY = 2;
/** 해석할 수 없는 글자가 이 비율을 넘으면 보호를 보장할 수 없다 */
const MAX_UNDECODABLE_RATIO = 0.02;
/** pdf.js가 읽은 텍스트 조각 중 이 비율 이상이 우리 추출 결과와 위치·내용이 맞아야 신뢰한다 */
const MIN_ALIGN_RATIO = 0.95;

interface Line {
  page: number;
  text: string;
  /** text의 각 문자에 대응하는 글자 (사이에 넣은 공백은 null) */
  glyphs: (Glyph | null)[];
}

/** 글자를 줄로 묶는다 (기준선이 비슷한 글자끼리, 왼쪽부터). 떨어진 글자 사이에는 공백을 넣는다 */
/** 가로쓰기로 보는 기준선 기울기(도) — 이 안의 글자는 예전과 같은 방식으로 줄을 만든다 */
const HORIZONTAL_TOLERANCE_DEG = 2;
/** 같은 방향으로 묶는 기울기 차이(도) */
const DIRECTION_TOLERANCE_DEG = 2;

/**
 * 글자를 줄로 묶는다 — 기준선 방향이 같은 글자끼리만.
 * 대각선 워터마크("TEST DOCUMENT" 등)·세로쓰기 글자가 가로 줄 사이에 끼어들면 "010-0000-S4826T"처럼 값이 깨져
 * 탐지를 놓친다 (2026-10 보험계약서 사례). 방향이 다른 글자는 따로 줄을 만들고, 가로 줄 뒤에 붙인다.
 * 가로 글자(|기울기| ≤ 2°)는 예전과 같은 규칙·순서 — 영역 키(p1:phone:0 …)가 바뀌지 않는다.
 */
export function buildLines(page: PageText): Line[] {
  const horizontal: Glyph[] = [];
  const rotated: { angle: number; glyphs: Glyph[] }[] = [];
  for (const g of page.glyphs) {
    const angle = g.angle ?? 0;
    if (Math.abs(angle) <= HORIZONTAL_TOLERANCE_DEG) {
      horizontal.push(g);
      continue;
    }
    const group = rotated.find((r) => Math.abs(angleDiff(r.angle, angle)) <= DIRECTION_TOLERANCE_DEG);
    if (group) group.glyphs.push(g);
    else rotated.push({ angle, glyphs: [g] });
  }
  return [...horizontalLines(page, horizontal), ...rotated.flatMap((r) => rotatedLines(page, r.angle, r.glyphs))];
}

const angleDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

/** 가로쓰기 줄 (예전 buildLines 그대로) */
function horizontalLines(page: PageText, glyphs: Glyph[]): Line[] {
  const gs = [...glyphs].sort((a, b) => b.y0 - a.y0 || a.x0 - b.x0);
  const rows: Glyph[][] = [];
  for (const g of gs) {
    const h = Math.max(1, g.y1 - g.y0);
    const row = rows.find((r) => Math.abs(r[0].y0 - g.y0) < h * 0.35);
    if (row) row.push(g);
    else rows.push([g]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x0 - b.x0);
    let text = '';
    const map: (Glyph | null)[] = [];
    row.forEach((g, k) => {
      if (k > 0 && g.x0 - row[k - 1].x1 > (g.y1 - g.y0) * 0.25) {
        text += ' ';
        map.push(null);
      }
      for (const ch of g.ch) {
        text += ch;
        map.push(g);
      }
    });
    return { page: page.pageIndex + 1, text, glyphs: map };
  });
}

/**
 * 기울어진 글자의 줄 — 글자 원점을 그 방향의 좌표(along: 기준선 방향, across: 수직 방향)로 돌려서 묶는다.
 * 글자 폭은 정확히 알 수 없으므로, 원점 간격이 글자 크기의 1.25배를 넘으면 띄어쓰기로 본다.
 */
function rotatedLines(page: PageText, angle: number, glyphs: Glyph[]): Line[] {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const pts = glyphs.map((g) => ({ g, along: g.ox * cos + g.oy * sin, across: -g.ox * sin + g.oy * cos, size: Math.max(1, g.size || g.y1 - g.y0) }));
  pts.sort((a, b) => b.across - a.across || a.along - b.along);
  const rows: (typeof pts)[] = [];
  for (const p of pts) {
    const row = rows.find((r) => Math.abs(r[0].across - p.across) < p.size * 0.35);
    if (row) row.push(p);
    else rows.push([p]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.along - b.along);
    let text = '';
    const map: (Glyph | null)[] = [];
    row.forEach((p, k) => {
      if (k > 0 && p.along - row[k - 1].along > p.size * 1.25) {
        text += ' ';
        map.push(null);
      }
      for (const ch of p.g.ch) {
        text += ch;
        map.push(p.g);
      }
    });
    return { page: page.pageIndex + 1, text, glyphs: map };
  });
}

function unionBox(gs: Glyph[]): Box {
  return { x0: Math.min(...gs.map((g) => g.x0)), y0: Math.min(...gs.map((g) => g.y0)), x1: Math.max(...gs.map((g) => g.x1)), y1: Math.max(...gs.map((g) => g.y1)) };
}

const digitsOf = (s: string) => s.replace(/\D/g, '');
const sameChar = (a: string, b: string) => a.trim() !== '' && a.trim().toLowerCase() === b.trim().toLowerCase();

/** pdf.js 텍스트 조각 (페이지 사용자 좌표) */
interface PjItem {
  str: string;
  transform: number[];
  width: number;
}
interface PjPage {
  items: PjItem[];
  /** pdf.js가 줄로 나눈 텍스트 */
  lines: string[];
}

/** pdf.js(우리 추출기와 별개 구현)로 PDF를 읽는다 — 한글 CMap은 내장 데이터 사용 */
async function readWithPdfjs(bytes: Uint8Array): Promise<PjPage[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes), PDFJS_OPTIONS as never);
  try {
    const { text } = await extractText(pdf, { mergePages: false });
    const pageTexts = Array.isArray(text) ? text : [text];
    const pages: PjPage[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const items = (tc.items as unknown[]).filter((it): it is PjItem => typeof (it as PjItem).str === 'string' && Array.isArray((it as PjItem).transform));
      pages.push({ items, lines: String(pageTexts[i - 1] ?? '').split('\n') });
    }
    return pages;
  } finally {
    await (pdf as unknown as { loadingTask: { destroy: () => Promise<void> } }).loadingTask.destroy();
  }
}

/** 조각 안 글자별 대략 너비 비율 (pdf.js는 조각 단위 위치만 주므로 글자 위치는 비율로 추정) */
const charWeight = (ch: string) =>
  /\s/.test(ch) ? 0.3 : /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3\u3000-\u9fff\uf900-\ufaff\uff01-\uff60]/.test(ch) ? 1 : /[0-9]/.test(ch) ? 0.55 : 0.5;

/** pdf.js 조각 → 글자별 추정 중심점 (사용자 좌표) */
function itemChars(it: PjItem): { ch: string; x: number; y: number }[] {
  const [a, b, c, d, e, f] = it.transform;
  const len = Math.hypot(a, b), size = Math.hypot(c, d);
  if (!(len > 0) || !(size > 0) || !(it.width > 0)) return [];
  const ux = a / len, uy = b / len, nx = c / size, ny = d / size;
  const chars = Array.from(it.str);
  const total = chars.reduce((n, ch) => n + charWeight(ch), 0);
  let acc = 0;
  return chars.map((ch) => {
    const w = charWeight(ch);
    const mid = ((acc + w / 2) / total) * it.width;
    acc += w;
    return { ch, x: e + ux * mid + nx * size * 0.3, y: f + uy * mid + ny * size * 0.3 };
  });
}

/** 점이 글자 상자 안쪽(가장자리 20%를 뺀 범위)에 있는지 — 이웃 글자와 헷갈리지 않도록 여유를 둔다 */
function insideCore(g: Box, x: number, y: number): boolean {
  const mx = (g.x1 - g.x0) * 0.2, my = (g.y1 - g.y0) * 0.2;
  return x >= g.x0 + mx && x <= g.x1 - mx && y >= g.y0 + my && y <= g.y1 - my;
}

/**
 * 신뢰성 확인: pdf.js가 읽은 각 텍스트 조각의 시작 글자와 끝 글자가 같은 위치에 우리 추출 글자로도 있는지
 * (글꼴 너비·인코딩 해석이 틀리면 조각 안에서 위치가 밀리므로 끝 글자에서 걸린다)
 */
function alignment(pages: PageText[], pj: PjPage[]): { items: number; matched: number } {
  let items = 0, matched = 0;
  pages.forEach((p, i) => {
    for (const it of pj[i]?.items ?? []) {
      const chars = Array.from(it.str);
      const k = chars.findIndex((ch) => ch.trim() !== '');
      if (k < 0) continue;
      items++;
      const [a, b, c, d, e, f] = it.transform;
      const size = Math.hypot(c, d);
      const est = itemChars(it);
      const near = (g: Glyph, x: number, y: number, tol: number) => Math.hypot(g.ox - x, g.oy - y) <= tol;
      // 시작: 첫 글자가 조각 시작점이면 원점끼리, 아니면 추정 위치로
      const startOk = p.glyphs.some((g) => sameChar(g.ch, chars[k]) && (k === 0 ? near(g, e, f, size * 0.35) : !!est[k] && insideCore(g, est[k].x, est[k].y)));
      // 끝: 가로쓰기 조각이고 마지막이 글자일 때 — 끝 글자의 오른쪽 끝이 조각 너비 끝과 맞는지
      const last = chars.length - 1;
      const horizontal = a > 0 && Math.abs(b) < 1e-6 * a && Math.abs(c) < 1e-6 * size;
      const endOk =
        !horizontal || chars[last].trim() === '' ||
        p.glyphs.some((g) => sameChar(g.ch, chars[last]) && Math.abs(g.x1 - (e + it.width)) <= size * 0.35 && Math.abs(g.oy - f) <= size * 0.35);
      if (startOk && endOk) matched++;
    }
  });
  return { items, matched };
}

/** 가린 값 비교용: 숫자형은 숫자만, 이메일은 공백 없이 소문자 */
const NUMERIC_TYPES = new Set(['resident_registration_number', 'foreigner_registration_number', 'credit_card', 'bank_account', 'phone']);
const valueKey = (type: string, v: string) => (NUMERIC_TYPES.has(type) ? digitsOf(v) : v.replace(/\s+/g, '').toLowerCase());
/** 한 줄 텍스트를 같은 방식으로 정리 — 숫자형은 공백·하이픈·점만 빼서 '4111-1111-…'과 '4111 1111 …'을 같게 본다 */
const lineKey = (type: string, line: string) => (NUMERIC_TYPES.has(type) ? line.replace(/[\s\-.]/g, '') : line.replace(/\s+/g, '').toLowerCase());

/** 테스트 전용: 실제 제거를 빼먹은 경우(상자만 덮음)를 흉내 내 검증이 잡는지 확인 */
export interface ProtectTestHooks {
  skipRemovalFor?: (type: SensitiveType) => boolean;
  /** 테스트 전용: 우리 추출기가 값 하나를 놓친 상황 (페이지 1부터 · 그 페이지에서 그 종류의 몇 번째인지 0부터) */
  missDetection?: (type: SensitiveType, page: number, ordinal: number) => boolean;
}

/**
 * @param prevStates 이전 처리에서 사용자가 정한 가림 상태 (region key → state)
 */
export async function protectPdf(
  bytes: Uint8Array,
  prevStates: ReadonlyMap<string, RegionState> = new Map(),
  testHooks: ProtectTestHooks = {},
  options: ProtectPdfOptions = {},
): Promise<ProtectResult> {
  const diag = emptyDiagnostics();
  const loadFail = (detail: string, stage: ProtectStage, e?: unknown): ProtectResult => {
    diag.failureStage = stage;
    if (e !== undefined) diag.errorCode = safeErrorCode(e);
    return { status: 'failed', detail, imagesUnchecked: false, regions: [], protectedPdf: null, pageCount: diag.pageCount, diagnostics: diag, pages: [], scanMetrics: [] };
  };
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    return loadFail(e instanceof Error && /encrypt/i.test(e.message) ? 'encrypted' : 'unreadable', 'load', e);
  }
  const pageCount = doc.getPageCount();
  diag.pageCount = pageCount;
  if (pageCount === 0) return loadFail('unreadable', 'load');
  if (pageCount > MAX_PAGES) return loadFail('too_many_pages', 'load');
  const originalRotation = Array.from({ length: pageCount }, (_, i) => doc.getPage(i).getRotation().angle);

  const streams = new Map<string, StreamEntry>();
  let pages: PageText[];
  try {
    pages = Array.from({ length: pageCount }, (_, i) => extractPage(doc, i, streams));
  } catch (e) {
    return loadFail('unreadable', 'extract', e);
  }
  // 진단: 글자·이미지·양식·글꼴 형식
  const fontCounts = new Map<string, ProtectDiagnostics['fonts'][number]>();
  for (const p of pages) {
    diag.textItemCount += p.glyphs.length;
    diag.invisibleGlyphCount += p.glyphs.filter((g) => g.invisible).length;
    diag.undecodableCount += p.undecodable;
    diag.unsupportedFontTextCount += p.unsupportedText;
    diag.imageCount += p.images;
    diag.widgetCount += p.widgets;
    diag.bboxCount += p.glyphs.filter((g) => Number.isFinite(g.x0 + g.x1 + g.y0 + g.y1) && g.x1 > g.x0 && g.y1 > g.y0).length;
    for (const f of p.fonts) {
      const k = `${f.subtype}|${f.encoding}|${f.toUnicode}|${f.supported}`;
      const cur = fontCounts.get(k);
      if (cur) cur.count++;
      else fontCounts.set(k, { ...f, count: 1 });
    }
  }
  diag.visibleGlyphCount = diag.textItemCount - diag.invisibleGlyphCount;
  diag.fonts = [...fontCounts.values()];

  // 페이지 분류: 텍스트 · 스캔(페이지 대부분을 덮는 이미지 한 장) · 빈 페이지 · 지원 안 함
  const classes = pages.map((p) => classifyPage(doc, p));
  const isText = (i: number) => classes[i].kind === 'text' || classes[i].kind === 'blank';
  const scanIdx = classes.flatMap((c, i) => (c.kind === 'scan' ? [i] : []));
  diag.scanPageCount = scanIdx.length;
  diag.textPageCount = classes.filter((c) => c.kind === 'text').length;
  diag.blankPageCount = classes.filter((c) => c.kind === 'blank').length;
  diag.unsupportedPageCount = classes.filter((c) => c.kind === 'unsupported').length;
  const pageOut: PageOutcome[] = classes.map((c, i) => ({ page: i + 1, kind: c.kind === 'unsupported' ? 'unsupported' : c.kind === 'scan' ? 'scan' : 'text', status: 'skipped', detail: null }));
  const base = { pages: pageOut, scanMetrics: [] as ScanPageMetrics[] };
  const fail = (detail: string, stage: ProtectStage, e?: unknown): ProtectResult => {
    diag.failureStage = stage;
    if (e !== undefined) diag.errorCode = safeErrorCode(e);
    return { status: 'failed', detail, imagesUnchecked: false, regions: [], protectedPdf: null, pageCount, diagnostics: diag, ...base };
  };
  const unsupported = (detail: string): ProtectResult => {
    diag.failureStage = 'classify';
    return { status: 'unsupported_scan', detail, imagesUnchecked: false, regions: [], protectedPdf: null, pageCount, diagnostics: diag, ...base };
  };
  // 특수한 스캔 페이지(지원하지 않는 이미지 형식·여러 이미지·작은 이미지·기울어짐·윤곽선 글자)가 하나라도 있으면 OCR 없이 중단
  const firstUnsupported = classes.findIndex((c) => c.kind === 'unsupported');
  if (firstUnsupported >= 0) {
    classes.forEach((c, i) => {
      if (c.kind === 'unsupported') Object.assign(pageOut[i], { status: 'unsupported_scan', detail: c.detail });
    });
    return unsupported(classes[firstUnsupported].detail ?? 'scan_layout');
  }
  if (classes.every((c) => c.kind === 'blank')) return unsupported('no_text');
  if (scanIdx.length > MAX_SCAN_PAGES) return unsupported('too_many_scan_pages');
  if (pages.some((p) => p.widgets > 0)) return fail('form_fields', 'classify');

  // ── 텍스트 페이지: 기존 방식 (글자 제거 + 독립 검증). 스캔 페이지의 숨은 OCR 글자층은 여기서 다루지 않는다 (페이지를 새로 만들므로) ──
  const textPages = pages.filter((_, i) => isText(i));
  const tp = pages.map((p, i) => (isText(i) ? p : { ...p, glyphs: [] as Glyph[] }));
  const textGlyphs = textPages.reduce((n, p) => n + p.glyphs.length, 0);
  const textUndecodable = textPages.reduce((n, p) => n + p.undecodable, 0);
  if (textPages.some((p) => p.unsupportedText > 0)) return fail('unsupported_font', 'classify');
  if (diag.textPageCount > 0 && (textGlyphs === 0 || textUndecodable / Math.max(1, textGlyphs) > MAX_UNDECODABLE_RATIO)) return fail('undecodable_font', 'classify');
  const imagesUnchecked = pages.some((p, i) => isText(i) && p.images > 0);
  const emptyPj = (n: number): PjPage[] => Array.from({ length: n }, () => ({ items: [], lines: [] }));
  const onlyText = (pj: PjPage[]) => pj.map((p, i) => (isText(i) ? p : { items: [], lines: [] }));

  // 신뢰성 확인 — 원본을 pdf.js로도 읽어 위치·내용이 맞는지 (텍스트 페이지가 있을 때)
  let pjOriginal: PjPage[] = emptyPj(pageCount);
  if (diag.textPageCount > 0) {
    try {
      pjOriginal = onlyText(await readWithPdfjs(bytes));
    } catch (e) {
      return fail('unreadable', 'classify', e);
    }
  }
  const al = alignment(tp, pjOriginal);
  diag.alignItemCount = al.items;
  diag.alignMatchedCount = al.matched;
  if (al.items > 0 && al.matched / al.items < MIN_ALIGN_RATIO) return fail('text_mismatch', 'classify');

  // 탐지 (원문 값은 secret 배열에만, 이 함수 밖으로 나가지 않는다)
  const regions: ProtectedRegion[] = [];
  const secret: { type: SensitiveType; value: string; masked: boolean; hideGlyphs: Glyph[]; page: number }[] = [];
  const toRemove: Glyph[] = [];
  const boxes = new Map<number, Box[]>();
  /** 페이지(0부터)별 이미 가려진 값 개수 */
  const preMasked = new Map<number, number>();
  /**
   * 일부 페이지만 실패했을 때 — 실패한 페이지(0부터)만 failed, 나머지 텍스트 페이지는 others 상태로.
   * others: 'verified' = 검증을 통과한 실제 결과(보호 완료·민감정보 없음) / 'skipped' = 앞 단계에서 멈춰 처리하지 않음.
   * 문서 전체 상태는 여전히 실패이므로 AI 분석은 진행되지 않는다 (페이지를 빼고 다시 보호해야 한다).
   */
  function markPagesFailed(failed: Set<number>, detail: string, stage: ProtectStage, others: 'verified' | 'skipped') {
    const withRegions = new Set(regions.map((r) => r.page - 1));
    classes.forEach((c, i) => {
      if (!isText(i)) return;
      if (failed.has(i)) Object.assign(pageOut[i], { status: 'failed', detail, stage });
      else if (others === 'verified') Object.assign(pageOut[i], { status: withRegions.has(i) ? 'protected' : 'no_sensitive_data', detail: null });
      else Object.assign(pageOut[i], { status: 'skipped', detail: null });
      if (preMasked.get(i)) pageOut[i].preMasked = preMasked.get(i);
    });
  }
  for (const page of tp) {
    const { width, height, x: ox, y: oy } = page.box;
    const ordinal = new Map<string, number>();
    for (const line of buildLines(page)) {
      diag.lineCount++;
      diag.extractedTextLength += line.text.length;
      const pm = countPreMasked(line.text);
      if (pm > 0) preMasked.set(page.pageIndex, (preMasked.get(page.pageIndex) ?? 0) + pm);
      for (const d of detectSensitive(line.text)) {
        diag.detected[d.type] = (diag.detected[d.type] ?? 0) + 1;
        const n = ordinal.get(d.type) ?? 0;
        ordinal.set(d.type, n + 1);
        if (testHooks.missDetection?.(d.type, line.page, n)) continue;
        const key = `p${line.page}:${d.type}:${n}`;
        const defaultState: RegionState = defaultRegionState(d); // 공통 가림 정책 (shouldMaskSensitive)
        const state = prevStates.get(key) ?? defaultState;
        const valueGlyphs = line.glyphs.slice(d.start, d.end).filter((g): g is Glyph => !!g);
        const hideGlyphs = [...new Set(d.hide.flatMap(([a, b]) => line.glyphs.slice(a, b)).filter((g): g is Glyph => !!g))];
        if (valueGlyphs.length === 0) continue;
        const vb = unionBox(valueGlyphs);
        regions.push({
          key,
          page: line.page,
          type: d.type,
          level: MASK_LEVEL[d.type],
          confidence: d.confidence,
          state,
          maskedPreview: d.maskedPreview,
          contextLabel: d.contextLabel,
          bbox: [{ x: (vb.x0 - ox) / width, y: (oy + height - vb.y1) / height, w: (vb.x1 - vb.x0) / width, h: (vb.y1 - vb.y0) / height }],
        });
        secret.push({ type: d.type, value: line.text.slice(d.start, d.end), masked: state === 'masked', hideGlyphs, page: page.pageIndex });
        if (state === 'masked') {
          if (!testHooks.skipRemovalFor?.(d.type)) toRemove.push(...hideGlyphs);
          // 가릴 조각마다 상자 하나
          for (const [a, b] of d.hide) {
            const gs = line.glyphs.slice(a, b).filter((g): g is Glyph => !!g && !g.invisible);
            if (gs.length) boxes.set(page.pageIndex, [...(boxes.get(page.pageIndex) ?? []), unionBox(gs)]);
          }
        }
      }
    }
  }
  diag.detectedSensitiveCount = regions.length;
  diag.maskedCount = regions.filter((r) => r.state === 'masked').length;
  diag.removedGlyphCount = toRemove.length;
  diag.boxCount = [...boxes.values()].reduce((n, b) => n + b.length, 0);

  // 우리 추출기가 놓친 Level 1 정보가 pdf.js로 읽은 원본에 보이면 신뢰할 수 없다 (잘못된 "감지되지 않음" 방지)
  /**
   * pdf.js로 읽은 페이지별 "기본으로 가리는 값" (값은 이 함수 안에서만).
   * 가림 정책(shouldMaskSensitive)과 같은 기준 — Level 1 전부와 신뢰도가 낮지 않은 Level 2(전화·이메일).
   * 예전에는 Level 1만 대조해, 우리 추출기가 전화번호를 놓치면 원문이 남은 채 protected가 될 수 있었다 (2026-10 보험계약서 조사 중 발견).
   * 신뢰도 낮은 후보는 원래 가리지 않을 수 있으므로 대조하지 않는다.
   */
  const maskableOf = (pj: PjPage[]) =>
    pj.map((p) =>
      p.lines.flatMap((line) =>
        detectSensitive(line)
          .filter((d) => d.confidence !== 'low' && shouldMaskSensitive(d))
          .map((d) => ({ type: d.type, key: valueKey(d.type, line.slice(d.start, d.end)) })),
      ),
    );
  /** 보호본 검증용: 사용자가 표시하기로 한 값이 아닌, 기본으로 가리는 값이 보이면 놓친 것 */
  const missedMaskable = (pj: PjPage[], allowed: Set<string>) =>
    maskableOf(pj).flatMap((ds, page) => ds.filter((d) => !allowed.has(d.key)).map((d) => ({ page, type: d.type })));
  // 원본 대조: 같은 페이지에서 pdf.js가 읽은 같은 값의 개수가 우리가 찾은 개수보다 많으면 놓친 것이 있다
  // (같은 값이 표의 여러 칸에 반복될 때 한 칸만 놓쳐도 찾는다 — 값 종류만 비교하면 다른 칸 때문에 가려진다)
  const missedOriginal = maskableOf(pjOriginal).flatMap((ds, page) => {
    const found = new Map<string, number>();
    for (const x of secret) if (x.page === page) found.set(valueKey(x.type, x.value), (found.get(valueKey(x.type, x.value)) ?? 0) + 1);
    const seen = new Map<string, number>();
    const out: { page: number; type: SensitiveType }[] = [];
    for (const d of ds) {
      const n = (seen.get(d.key) ?? 0) + 1;
      seen.set(d.key, n);
      if (n > (found.get(d.key) ?? 0)) out.push({ page, type: d.type });
    }
    return out;
  });
  diag.alignMissedCount = missedOriginal.length;
  if (missedOriginal.length > 0) {
    markPagesFailed(new Set(missedOriginal.map((m) => m.page)), 'text_mismatch', 'detect', 'skipped');
    return fail('text_mismatch', 'detect');
  }
  const shown = new Set(secret.filter((x) => !x.masked).map((x) => valueKey(x.type, x.value)));
  const regionPages = new Set(regions.map((r) => r.page));
  const markTextPages = (status: PageStatus, detail: string | null = null, stage?: ProtectStage) =>
    classes.forEach((c, i) => {
      if (!isText(i)) return;
      Object.assign(pageOut[i], { status: status === 'protected' && !regionPages.has(i + 1) ? 'no_sensitive_data' : status, detail });
      if (status === 'failed' && stage) pageOut[i].stage = stage;
      if (preMasked.get(i)) pageOut[i].preMasked = preMasked.get(i);
    });

  if (scanIdx.length === 0 && regions.length === 0) {
    markTextPages('no_sensitive_data');
    return { status: 'no_sensitive_data', detail: null, imagesUnchecked, regions: [], protectedPdf: null, pageCount, diagnostics: diag, ...base };
  }

  // 스캔 페이지는 텍스트 보호본에서 비워 둔다 (나중에 가린 이미지로 새 페이지를 만든다 — 원본 이미지·숨은 글자를 복사하지 않음)
  // 숨은 OCR 글자층에서 찾은 Level 1 위치는 OCR 결과와 맞춰 보는 데 쓴다 (값은 쓰지 않고 위치만)
  const hiddenLevel1 = new Map<number, { x: number; y: number }[]>();
  for (const i of scanIdx) {
    const p = pages[i];
    const pts: { x: number; y: number }[] = [];
    for (const line of buildLines(p)) {
      for (const d of detectSensitive(line.text)) {
        if (d.level !== 1 || d.confidence === 'low') continue;
        const gs = line.glyphs.slice(d.start, d.end).filter((g): g is Glyph => !!g);
        if (!gs.length) continue;
        const b = unionBox(gs);
        pts.push({ x: ((b.x0 + b.x1) / 2 - p.box.x) / p.box.width, y: (p.box.y + p.box.height - (b.y0 + b.y1) / 2) / p.box.height });
      }
    }
    if (pts.length) hiddenLevel1.set(i, pts);
    streams.delete(`page:${i}`);
    const node = doc.getPage(i).node;
    node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(new Uint8Array(0))));
    node.set(PDFName.of('Resources'), doc.context.obj({}));
  }

  let out: Uint8Array;
  try {
    if (toRemove.length) removeGlyphs(doc, streams, toRemove);
    out = await buildProtectedView(doc, streams, boxes);
    diag.derivativeBytes = out.byteLength;
  } catch (e) {
    markTextPages('failed', 'redaction_failed', 'redact');
    return fail('redaction_failed', 'redact', e);
  }

  // 독립 검증 — 보호본을 우리 추출기와 pdf.js로 각각 다시 읽는다
  if (regions.length > 0) {
    let pjOut: PjPage[];
    let ownOut: PageText[];
    try {
      pjOut = onlyText(await readWithPdfjs(out));
      const outDoc = await PDFDocument.load(out, { updateMetadata: false });
      const outStreams = new Map<string, StreamEntry>();
      ownOut = Array.from({ length: outDoc.getPageCount() }, (_, i) => extractPage(outDoc, i, outStreams));
    } catch (e) {
      markTextPages('failed', 'verification_failed', 'verify');
      return fail('verification_failed', 'verify', e);
    }
    diag.verifyTextLength = pjOut.reduce((n, p) => n + p.lines.join('\n').length, 0);
    const masked = secret.filter((x) => x.masked);
    const leaked = new Set<number>();
    // 1) 위치 기반: 지워야 했던 글자(원문 문자)가 보호본의 같은 자리에서 다시 읽히는가
    masked.forEach((sc, i) => {
      const own = ownOut[sc.page]?.glyphs ?? [];
      const pjChars = (pjOut[sc.page]?.items ?? []).flatMap(itemChars);
      for (const h of sc.hideGlyphs) {
        if (h.ch.trim() === '') continue;
        if (own.some((g) => sameChar(g.ch, h.ch) && insideCore(h, (g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2))) {
          diag.verifyPositionLeakOwn++;
          leaked.add(i);
        }
        if (pjChars.some((c) => sameChar(c.ch, h.ch) && insideCore(h, c.x, c.y))) {
          diag.verifyPositionLeakPdfjs++;
          leaked.add(i);
        }
      }
    });
    // 2) 값 전체: 가린 값이 (구분 기호만 다르게라도) 같은 페이지 어느 줄에 그대로 남았는가 — 사용자가 표시하기로 한 같은 값은 제외
    masked.forEach((sc, i) => {
      const v = valueKey(sc.type, sc.value);
      if (v.length < 6 || shown.has(v)) return;
      if ((pjOut[sc.page]?.lines ?? []).some((line) => lineKey(sc.type, line).includes(v))) {
        diag.verifyValueLeakCount++;
        leaked.add(i);
      }
    });
    diag.verifyLeakCount = leaked.size;
    diag.verifyLeakTypes = [...new Set([...leaked].map((i) => masked[i].type))];
    // 3) 놓친 Level 1 정보가 보호본에 보이는가 (사용자가 가리기 해제했거나 후보로 둔 값은 제외)
    const missed = missedMaskable(pjOut, shown);
    diag.verifyMissedCount = missed.length;
    diag.verifyMissedTypes = [...new Set(missed.map((m) => m.type))];
    if (diag.verifyLeakCount > 0 || missed.length > 0) {
      // 원문이 다시 읽힌 페이지만 실패 — 나머지 페이지는 검증을 통과한 실제 결과를 남긴다
      markPagesFailed(new Set([...[...leaked].map((i) => masked[i].page), ...missed.map((m) => m.page)]), 'verification_failed', 'verify', 'verified');
      return fail('verification_failed', 'verify');
    }
  }
  markTextPages('protected');
  if (scanIdx.length === 0) return { status: 'protected', detail: null, imagesUnchecked, regions, protectedPdf: out, pageCount, diagnostics: diag, ...base };

  // ── 스캔 페이지: worker(protect-scan-page)에 한 장씩 (동시 SCAN_CONCURRENCY장). 실패·확인 필요·미지원이면 남은 페이지는 처리하지 않는다 ──
  // 읽지 못함(unreadable)은 멈추지 않는다 — 어느 페이지를 읽지 못했는지 모두 알아야 그 페이지만 자동 제외할 수 있다 (autoExcludablePages)
  if (!options.scan) {
    scanIdx.forEach((i) => Object.assign(pageOut[i], { status: 'failed', detail: 'ocr_not_configured' }));
    return fail('ocr_not_configured', 'classify');
  }
  const runner = options.scan;
  const results: (ScanPageOutcome | undefined)[] = new Array(scanIdx.length);
  let stop = false;
  let next = 0;
  const work = async () => {
    while (!stop && next < scanIdx.length) {
      const k = next++;
      const i = scanIdx[k];
      const src = classes[i].scan!;
      const prefix = `p${i + 1}:`;
      const job: ScanJob = {
        page: i + 1,
        meta: src.meta,
        orientation: src.orientation,
        prevStates: [...prevStates.entries()].filter(([key]) => key.startsWith(prefix)),
        redraw: options.redrawScanRegions
          ? options.redrawScanRegions.filter((r) => r.page === i + 1).map((r) => ({ ...r, bbox: r.bbox.map((b) => pageBoxToUpright(src.ctm, src.orientation, src.frame, b)) }))
          : null,
      };
      const t = Date.now();
      let r: ScanPageOutcome;
      try {
        r = await runner(job, rawImageBytes(doc, src.ref));
      } catch (e) {
        r = { status: 'failed', detail: e instanceof Error && /^[a-z_0-9]+$/.test(e.message) ? e.message : 'scan_worker_error', regions: [], image: null, width: 0, height: 0, diagnostics: undefined as never };
      }
      results[k] = r;
      const d = r.diagnostics;
      base.scanMetrics.push({
        page: i + 1, status: r.status, detail: r.detail, workerMs: Date.now() - t, ocrCalls: d?.ocrCalls ?? 0, directOcrInput: d?.directOcrInput ?? false,
        sourceBytes: d?.sourceBytes ?? 0, imageBytes: r.image?.byteLength ?? 0, width: d?.width ?? 0, height: d?.height ?? 0, viewWidth: r.width, viewHeight: r.height,
        detectedSensitiveCount: d?.detectedSensitiveCount ?? 0, verification: d?.verification ?? 'skipped', timings: d ? { prepareMs: d.prepareMs, ...d.timings } : null,
      });
      if (r.status !== 'protected' && r.status !== 'no_sensitive_data' && r.status !== 'unreadable') stop = true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, scanIdx.length) }, work));
  base.scanMetrics.sort((a, b) => a.page - b.page);
  diag.scanOcrCalls = base.scanMetrics.reduce((n, m) => n + m.ocrCalls, 0);

  const scanRegions: ProtectedRegion[] = [];
  scanIdx.forEach((i, k) => {
    const r = results[k];
    if (!r) return;
    const src = classes[i].scan!;
    const rs = r.regions.map((x) => ({ ...x, page: i + 1, bbox: x.bbox.map((b) => uprightBoxToPage(src.ctm, src.orientation, src.frame, b)) }));
    let status: PageStatus = r.status;
    let detail = r.detail;
    // 숨은 OCR 글자층에 있던 Level 1 정보가 OCR 영역과 맞지 않으면 (OCR이 놓쳤을 수 있음) 보호됨으로 표시하지 않는다
    const hidden = hiddenLevel1.get(i) ?? [];
    const near = (pt: { x: number; y: number }) => rs.some((x) => x.bbox.some((b) => pt.x >= b.x - 0.01 && pt.x <= b.x + b.w + 0.01 && pt.y >= b.y - 0.01 && pt.y <= b.y + b.h + 0.01));
    if ((status === 'protected' || status === 'no_sensitive_data') && !options.redrawScanRegions && hidden.some((pt) => !near(pt))) {
      status = 'failed';
      detail = 'ocr_layer_mismatch';
    }
    // 글자 인식 품질 (진단용 숫자만 — 실패 원인을 다시 확인할 수 있도록 페이지별로 남긴다)
    const d = r.diagnostics;
    const quality: OcrQuality | undefined = d && d.ocrCalls > 0 ? { chars: d.ocrCharCount, meanConfidence: d.meanConfidence, lowConfidenceRatio: d.lowConfidenceRatio ?? null, reason: d.unreadableReason ?? null } : undefined;
    Object.assign(pageOut[i], { status, detail, ...(quality ? { quality } : {}) });
    scanRegions.push(...rs);
  });
  const statuses = pageOut.map((p) => p.status);
  const all = [...regions, ...scanRegions];
  const pick = (s: PageStatus) => pageOut.find((p) => p.status === s);
  for (const s of ['failed', 'unsupported_scan', 'unreadable', 'needs_review'] as const) {
    const p = pick(s);
    if (p) {
      diag.failureStage = s === 'failed' ? 'redact' : 'classify';
      return { status: s, detail: p.detail, imagesUnchecked, regions: [], protectedPdf: null, pageCount, diagnostics: diag, ...base };
    }
  }
  if (statuses.some((s) => s === 'skipped')) return fail('scan_incomplete', 'redact');
  if (all.length === 0) return { status: 'no_sensitive_data', detail: null, imagesUnchecked, regions: [], protectedPdf: null, pageCount, diagnostics: diag, ...base };

  // ── 재조합: 텍스트 페이지는 보호된 텍스트 문서에서 복사, 스캔 페이지는 가린 이미지 한 장으로 새로 ──
  let final: Uint8Array;
  try {
    const textDoc = await PDFDocument.load(out, { updateMetadata: false });
    final = await assembleProtectedPdf(textDoc, classes.map((c, i) => {
      if (c.kind !== 'scan') return { kind: 'copy', from: i };
      return { kind: 'image', jpeg: results[scanIdx.indexOf(i)]!.image!, source: c.scan! };
    }));
  } catch (e) {
    return fail('redaction_failed', 'redact', e);
  }
  // 최종 검증: 페이지 수·크기·회전이 원본과 같고, 스캔 페이지에서 글자가 하나도 읽히지 않으며, 텍스트 페이지에 놓친 가림 대상 값이 없다
  try {
    const fdoc = await PDFDocument.load(final, { updateMetadata: false });
    if (fdoc.getPageCount() !== pageCount) return fail('verification_failed', 'verify');
    for (let i = 0; i < pageCount; i++) {
      const a = fdoc.getPage(i).getMediaBox(), b = pages[i].box;
      if (Math.abs(a.x - b.x) > 0.01 || Math.abs(a.y - b.y) > 0.01 || Math.abs(a.width - b.width) > 0.01 || Math.abs(a.height - b.height) > 0.01) return fail('verification_failed', 'verify');
      if (normalizeRotate(fdoc.getPage(i).getRotation().angle) !== normalizeRotate(originalRotation[i])) return fail('verification_failed', 'verify');
    }
    const pjFinal = await readWithPdfjs(final);
    const scanText = scanIdx.reduce((n, i) => n + (pjFinal[i]?.items ?? []).filter((it) => it.str.trim() !== '').length, 0);
    diag.verifyScanTextCount = scanText;
    const missed = missedMaskable(onlyText(pjFinal), shown);
    if (scanText > 0 || missed.length > 0) {
      diag.verifyMissedCount = missed.length;
      return fail('verification_failed', 'verify');
    }
  } catch (e) {
    return fail('verification_failed', 'verify', e);
  }
  diag.derivativeBytes = final.byteLength;
  return { status: 'protected', detail: null, imagesUnchecked, regions: all, protectedPdf: final, pageCount, diagnostics: diag, ...base };
}

/**
 * 사용자가 뺀 페이지를 제외하고 보호 — 남은 페이지만 담은 PDF(메모리)로 같은 보호·검증을 하고, 번호를 원본 기준으로 돌려준다.
 * 제외한 페이지는 읽지 않고 보호본에도 넣지 않는다. 보호본(protectedPdf)은 남은 페이지만 (viewPages 순서).
 * 선택이 없으면 protectPdf와 같다 (viewPages = null).
 */
export async function protectPdfSelected(
  bytes: Uint8Array,
  excluded: readonly number[],
  prevStates: ReadonlyMap<string, RegionState> = new Map(),
  testHooks: ProtectTestHooks = {},
  options: ProtectPdfOptions = {},
): Promise<ProtectResult & { viewPages: number[] | null }> {
  if (excluded.length === 0) return { ...(await protectPdf(bytes, prevStates, testHooks, options)), viewPages: null };
  let count: number;
  try {
    count = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
  } catch {
    return { ...(await protectPdf(bytes, prevStates, testHooks, options)), viewPages: null };
  }
  const stop = (detail: string): ProtectResult & { viewPages: null } => ({
    status: 'failed', detail, imagesUnchecked: false, regions: [], protectedPdf: null, pageCount: count, diagnostics: emptyDiagnostics(), pages: [], scanMetrics: [], viewPages: null,
  });
  if (excluded.some((p) => p > count)) return stop('selection_invalid');
  const keep = keptPages(count, excluded);
  if (keep.length === 0) return stop('no_pages_selected');
  const sub = await subsetPdf(bytes, keep);
  const toSub = (orig: number) => keep.indexOf(orig) + 1;
  const toOrig = (subPage: number) => keep[subPage - 1];
  const rekey = (key: string, map: (n: number) => number) => key.replace(/^p(\d+):/, (_, n) => `p${map(Number(n))}:`);
  const pageOfKey = (key: string) => Number(/^p(\d+):/.exec(key)?.[1] ?? 0);
  const prevSub = new Map([...prevStates].filter(([k]) => keep.includes(pageOfKey(k))).map(([k, v]) => [rekey(k, toSub), v] as const));
  const redraw = options.redrawScanRegions?.filter((r) => keep.includes(r.page)).map((r) => ({ ...r, page: toSub(r.page), key: rekey(r.key, toSub) })) ?? null;
  const r = await protectPdf(sub, prevSub, testHooks, { ...options, redrawScanRegions: redraw });
  const pages: PageOutcome[] = [
    ...r.pages.map((p) => ({ ...p, page: toOrig(p.page) })),
    ...excluded.map((page): PageOutcome => ({ page, kind: 'excluded', status: 'excluded', detail: null })),
  ].sort((a, b) => a.page - b.page);
  return {
    ...r,
    pageCount: count,
    pages,
    regions: r.regions.map((x) => ({ ...x, page: toOrig(x.page), key: rekey(x.key, toOrig) })),
    scanMetrics: r.scanMetrics.map((m) => ({ ...m, page: toOrig(m.page) })),
    viewPages: r.protectedPdf ? keep : null,
  };
}

/**
 * 자동 제외할 페이지 — 글자를 거의 읽지 못한(unreadable) 페이지만.
 * 다른 문제(확인 필요·실패·미지원·처리 안 함)가 하나라도 있거나, 보호 검증을 통과한 페이지가 하나도 없으면 자동 제외하지 않는다
 * (그때는 지금처럼 분석을 멈추고 사용자에게 보여준다).
 */
export function autoExcludablePages(pages: readonly PageOutcome[]): number[] {
  const unreadable = pages.filter((p) => p.status === 'unreadable').map((p) => p.page);
  const blocked = pages.some((p) => p.status === 'needs_review' || p.status === 'failed' || p.status === 'unsupported_scan' || p.status === 'skipped');
  const verified = pages.some((p) => p.status === 'protected' || p.status === 'no_sensitive_data');
  return blocked || !verified ? [] : unreadable;
}

/**
 * 공통 페이지 정책으로 보호: 사용자가 뺀 페이지 + 읽지 못한 페이지 자동 제외.
 * 1) 사용자 제외(+ 이전에 자동 제외한 페이지)를 빼고 보호 → 2) 읽지 못한 페이지만 있으면 그 페이지를 자동 제외하고 다시 보호
 * 자동 제외한 페이지는 보호본·AI 요청에 들어가지 않는다. 남는 페이지가 없으면 자동 제외하지 않는다 (문서 unreadable 그대로)
 */
export async function protectPdfWithPolicy(
  bytes: Uint8Array,
  sel: { userExcluded: readonly number[]; autoExcluded?: readonly number[] },
  prevStates: ReadonlyMap<string, RegionState> = new Map(),
  testHooks: ProtectTestHooks = {},
  options: ProtectPdfOptions = {},
): Promise<ProtectResult & { viewPages: number[] | null; autoExcluded: number[] }> {
  const user = [...new Set(sel.userExcluded)].sort((a, b) => a - b);
  let auto = [...new Set((sel.autoExcluded ?? []).filter((p) => !user.includes(p)))].sort((a, b) => a - b);
  const run = (a: number[]) => protectPdfSelected(bytes, [...new Set([...user, ...a])].sort((x, y) => x - y), prevStates, testHooks, options);
  let r = await run(auto);
  // 이전 자동 제외 페이지까지 빼니 남는 페이지가 없음 → 자동 제외를 풀고 원래대로 (모든 페이지를 읽지 못한 문서)
  if (auto.length && (r.detail === 'no_pages_selected' || r.detail === 'selection_invalid')) {
    auto = [];
    r = await run(auto);
  }
  const first = r;
  const more = autoExcludablePages(r.pages);
  if (more.length) {
    auto = [...new Set([...auto, ...more])].sort((a, b) => a - b);
    r = await run(auto);
  }
  const autoExcluded = auto.filter((p) => r.pages.some((x) => x.page === p && x.status === 'excluded'));
  // 뺀 페이지 표시: 자동(읽지 못함) / 사용자 — 자동 제외 페이지는 처음 처리에서 잰 글자 인식 품질(숫자)을 남긴다
  const pages = r.pages.map((p): PageOutcome => {
    if (p.status !== 'excluded') return p;
    if (!autoExcluded.includes(p.page)) return { ...p, detail: 'user' };
    const q = first.pages.find((x) => x.page === p.page)?.quality;
    return { ...p, detail: 'auto_unreadable', ...(q ? { quality: q } : {}) };
  });
  return { ...r, pages, autoExcluded };
}
