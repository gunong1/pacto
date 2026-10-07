// 계약서 민감정보 보호 — 원본 PDF(읽기 전용) → 탐지 → 실제 제거 → 보호 표시본 → 독립 검증
// 신뢰성 확인: 원본을 pdf.js(별도 구현)로도 읽어, 우리 추출기가 얻은 글자 위치·내용과 맞는지 본다 (안 맞으면 보호하지 않음)
// 검증(보호본): 지워야 했던 글자가 같은 위치에 남았는지(위치 기반, 두 추출기 모두), 가린 값 전체가 텍스트에 남았는지,
//       놓친 Level 1 정보가 보이는지 확인한다. 하나라도 걸리면 보호본을 쓰지 않고 "보호됨"으로 표시하지 않는다.
// 원문 값은 이 함수 안에서만 다루고 반환·저장·로그에 쓰지 않는다 (반환하는 것은 위치·종류·가린 표시값뿐).
import { PDFDocument } from '../vendor/pdf-lib.js';
import { extractText, getDocumentProxy } from '../vendor/unpdf.js';
import { PDFJS_OPTIONS } from './cmap.ts';
import { buildProtectedView, extractPage, removeGlyphs, type Box, type Glyph, type PageText, type StreamEntry } from './pdfEngine.ts';
import { detectSensitive, MASK_LEVEL, type DetectionConfidence, type SensitiveType } from './sensitive.ts';

export type ProtectionStatus = 'protected' | 'no_sensitive_data' | 'unsupported_scan' | 'failed';
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
    unsupportedFontTextCount: 0, imageCount: 0, widgetCount: 0, scanPageCount: 0, fonts: [], extractedTextLength: 0, lineCount: 0, bboxCount: 0,
    detected: {}, detectedSensitiveCount: 0, maskedCount: 0, removedGlyphCount: 0, boxCount: 0, derivativeBytes: 0, alignItemCount: 0,
    alignMatchedCount: 0, alignMissedCount: 0, verifyTextLength: 0, verifyPositionLeakOwn: 0, verifyPositionLeakPdfjs: 0, verifyValueLeakCount: 0,
    verifyLeakCount: 0, verifyLeakTypes: [], verifyMissedCount: 0, verifyMissedTypes: [],
  };
}

export const MAX_PAGES = 60;
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
export function buildLines(page: PageText): Line[] {
  const gs = [...page.glyphs].sort((a, b) => b.y0 - a.y0 || a.x0 - b.x0);
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
}

/**
 * @param prevStates 이전 처리에서 사용자가 정한 가림 상태 (region key → state)
 */
export async function protectPdf(bytes: Uint8Array, prevStates: ReadonlyMap<string, RegionState> = new Map(), testHooks: ProtectTestHooks = {}): Promise<ProtectResult> {
  const diag = emptyDiagnostics();
  const fail = (detail: string, stage: ProtectStage, e?: unknown): ProtectResult => {
    diag.failureStage = stage;
    if (e !== undefined) diag.errorCode = safeErrorCode(e);
    return { status: 'failed', detail, imagesUnchecked: false, regions: [], protectedPdf: null, pageCount: diag.pageCount, diagnostics: diag };
  };
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    return fail(e instanceof Error && /encrypt/i.test(e.message) ? 'encrypted' : 'unreadable', 'load', e);
  }
  const pageCount = doc.getPageCount();
  diag.pageCount = pageCount;
  if (pageCount === 0) return fail('unreadable', 'load');
  if (pageCount > MAX_PAGES) return fail('too_many_pages', 'load');

  const streams = new Map<string, StreamEntry>();
  let pages: PageText[];
  try {
    pages = Array.from({ length: pageCount }, (_, i) => extractPage(doc, i, streams));
  } catch (e) {
    return fail('unreadable', 'extract', e);
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

  // 사진·스캔본: 글자가 이미지 안에 있다 (투명 OCR 글자층만 있는 경우 포함) → 문서 전체를 미지원으로
  // 해석할 수 없는 글꼴로 그린 보이는 글자가 있으면 스캔본이 아니다 (→ 글꼴 미지원으로 실패 처리)
  const isScan = (p: PageText) => p.unsupportedVisibleText === 0 && p.glyphs.filter((g) => !g.invisible).length < 10 && (p.images > 0 || p.glyphs.length === 0);
  diag.scanPageCount = pages.filter(isScan).length;
  if (pages.some(isScan)) {
    diag.failureStage = 'classify';
    return { status: 'unsupported_scan', detail: pages.every((p) => p.glyphs.length === 0 && p.images === 0) ? 'no_text' : 'scanned_pages', imagesUnchecked: false, regions: [], protectedPdf: null, pageCount, diagnostics: diag };
  }
  if (pages.some((p) => p.widgets > 0)) return fail('form_fields', 'classify');
  if (diag.unsupportedFontTextCount > 0) return fail('unsupported_font', 'classify');
  const totalGlyphs = diag.textItemCount;
  const undecodable = diag.undecodableCount;
  if (totalGlyphs === 0 || undecodable / Math.max(1, totalGlyphs) > MAX_UNDECODABLE_RATIO) return fail('undecodable_font', 'classify');
  const imagesUnchecked = pages.some((p) => p.images > 0);

  // 신뢰성 확인 — 원본을 pdf.js로도 읽어 위치·내용이 맞는지
  let pjOriginal: PjPage[];
  try {
    pjOriginal = await readWithPdfjs(bytes);
  } catch (e) {
    return fail('unreadable', 'classify', e);
  }
  const al = alignment(pages, pjOriginal);
  diag.alignItemCount = al.items;
  diag.alignMatchedCount = al.matched;
  if (al.items > 0 && al.matched / al.items < MIN_ALIGN_RATIO) return fail('text_mismatch', 'classify');

  // 탐지 (원문 값은 secret 배열에만, 이 함수 밖으로 나가지 않는다)
  const regions: ProtectedRegion[] = [];
  const secret: { type: SensitiveType; value: string; masked: boolean; hideGlyphs: Glyph[]; page: number }[] = [];
  const toRemove: Glyph[] = [];
  const boxes = new Map<number, Box[]>();
  for (const page of pages) {
    const { width, height, x: ox, y: oy } = page.box;
    const ordinal = new Map<string, number>();
    for (const line of buildLines(page)) {
      diag.lineCount++;
      diag.extractedTextLength += line.text.length;
      for (const d of detectSensitive(line.text)) {
        diag.detected[d.type] = (diag.detected[d.type] ?? 0) + 1;
        const n = ordinal.get(d.type) ?? 0;
        ordinal.set(d.type, n + 1);
        const key = `p${line.page}:${d.type}:${n}`;
        const defaultState: RegionState = d.confidence === 'low' ? 'candidate' : 'masked';
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
  const foundKeys = new Set(secret.map((x) => valueKey(x.type, x.value)));
  const missedLevel1 = (pj: PjPage[], allowed: Set<string>) => {
    const out: string[] = [];
    for (const p of pj) {
      for (const line of p.lines) {
        for (const d of detectSensitive(line)) {
          if (d.level === 1 && d.confidence !== 'low' && !allowed.has(valueKey(d.type, line.slice(d.start, d.end)))) out.push(d.type);
        }
      }
    }
    return out;
  };
  diag.alignMissedCount = missedLevel1(pjOriginal, foundKeys).length;
  if (diag.alignMissedCount > 0) return fail('text_mismatch', 'detect');
  if (regions.length === 0) return { status: 'no_sensitive_data', detail: null, imagesUnchecked, regions: [], protectedPdf: null, pageCount, diagnostics: diag };

  let out: Uint8Array;
  try {
    removeGlyphs(doc, streams, toRemove);
    out = await buildProtectedView(doc, streams, boxes);
    diag.derivativeBytes = out.byteLength;
  } catch (e) {
    return fail('redaction_failed', 'redact', e);
  }

  // 독립 검증 — 보호본을 우리 추출기와 pdf.js로 각각 다시 읽는다
  let pjOut: PjPage[];
  let ownOut: PageText[];
  try {
    pjOut = await readWithPdfjs(out);
    const outDoc = await PDFDocument.load(out, { updateMetadata: false });
    const outStreams = new Map<string, StreamEntry>();
    ownOut = Array.from({ length: outDoc.getPageCount() }, (_, i) => extractPage(outDoc, i, outStreams));
  } catch (e) {
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
  const shown = new Set(secret.filter((x) => !x.masked).map((x) => valueKey(x.type, x.value)));
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
  const missed = missedLevel1(pjOut, shown);
  diag.verifyMissedCount = missed.length;
  diag.verifyMissedTypes = [...new Set(missed)];
  if (diag.verifyLeakCount > 0 || missed.length > 0) return fail('verification_failed', 'verify');
  return { status: 'protected', detail: null, imagesUnchecked, regions, protectedPdf: out, pageCount, diagnostics: diag };
}
