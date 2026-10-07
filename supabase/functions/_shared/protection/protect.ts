// 계약서 민감정보 보호 — 원본 PDF(읽기 전용) → 탐지 → 실제 제거 → 보호 표시본 → 독립 검증
// 검증: 보호본을 pdf.js(별도 구현)로 다시 읽어, 가린 값의 원문이 추출되거나 놓친 Level 1 정보가 보이면 실패 처리한다.
//       실패하면 보호본을 쓰지 않고 "보호됨"으로 표시하지 않는다.
// 원문 값은 이 함수 안에서만 다루고 반환·저장·로그에 쓰지 않는다 (반환하는 것은 위치·종류·가린 표시값뿐).
import { PDFDocument } from '../vendor/pdf-lib.js';
import { extractText, getDocumentProxy } from '../vendor/unpdf.js';
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
}

export const MAX_PAGES = 60;
/** 해석할 수 없는 글자가 이 비율을 넘으면 보호를 보장할 수 없다 */
const MAX_UNDECODABLE_RATIO = 0.02;

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

const norm = (s: string) => s.replace(/\s+/g, '');
const digitsOf = (s: string) => s.replace(/\D/g, '');

/**
 * @param prevStates 이전 처리에서 사용자가 정한 가림 상태 (region key → state)
 */
export async function protectPdf(bytes: Uint8Array, prevStates: ReadonlyMap<string, RegionState> = new Map()): Promise<ProtectResult> {
  const fail = (detail: string, pageCount = 0): ProtectResult => ({ status: 'failed', detail, imagesUnchecked: false, regions: [], protectedPdf: null, pageCount });
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    return fail(e instanceof Error && /encrypt/i.test(e.message) ? 'encrypted' : 'unreadable');
  }
  const pageCount = doc.getPageCount();
  if (pageCount === 0) return fail('unreadable');
  if (pageCount > MAX_PAGES) return fail('too_many_pages', pageCount);

  const streams = new Map<string, StreamEntry>();
  let pages: PageText[];
  try {
    pages = Array.from({ length: pageCount }, (_, i) => extractPage(doc, i, streams));
  } catch {
    return fail('unreadable', pageCount);
  }

  // 사진·스캔본: 글자가 이미지 안에 있다 (투명 OCR 글자층만 있는 경우 포함) → 문서 전체를 미지원으로
  const isScan = (p: PageText) => p.glyphs.filter((g) => !g.invisible).length < 10 && (p.images > 0 || p.glyphs.length === 0);
  if (pages.some(isScan)) return { status: 'unsupported_scan', detail: pages.every((p) => p.glyphs.length === 0 && p.images === 0) ? 'no_text' : 'scanned_pages', imagesUnchecked: false, regions: [], protectedPdf: null, pageCount };
  if (pages.some((p) => p.widgets > 0)) return fail('form_fields', pageCount);
  const totalGlyphs = pages.reduce((n, p) => n + p.glyphs.length, 0);
  const undecodable = pages.reduce((n, p) => n + p.undecodable, 0);
  if (totalGlyphs === 0 || undecodable / Math.max(1, totalGlyphs) > MAX_UNDECODABLE_RATIO) return fail('undecodable_font', pageCount);
  const imagesUnchecked = pages.some((p) => p.images > 0);

  // 탐지 (원문 값은 secret 배열에만, 이 함수 밖으로 나가지 않는다)
  const regions: ProtectedRegion[] = [];
  const secret: { value: string; hidden: string[]; masked: boolean; hideGlyphs: Glyph[] }[] = [];
  const toRemove: Glyph[] = [];
  const boxes = new Map<number, Box[]>();
  for (const page of pages) {
    const { width, height, x: ox, y: oy } = page.box;
    const ordinal = new Map<string, number>();
    for (const line of buildLines(page)) {
      for (const d of detectSensitive(line.text)) {
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
        secret.push({ value: line.text.slice(d.start, d.end), hidden: d.hide.map(([a, b]) => line.text.slice(Math.max(d.start, a - 1), b)), masked: state === 'masked', hideGlyphs });
        if (state === 'masked') {
          toRemove.push(...hideGlyphs);
          // 가릴 조각마다 상자 하나
          for (const [a, b] of d.hide) {
            const gs = line.glyphs.slice(a, b).filter((g): g is Glyph => !!g && !g.invisible);
            if (gs.length) boxes.set(page.pageIndex, [...(boxes.get(page.pageIndex) ?? []), unionBox(gs)]);
          }
        }
      }
    }
  }
  if (regions.length === 0) return { status: 'no_sensitive_data', detail: null, imagesUnchecked, regions: [], protectedPdf: null, pageCount };

  let out: Uint8Array;
  try {
    removeGlyphs(doc, streams, toRemove);
    out = await buildProtectedView(doc, streams, boxes);
  } catch {
    return fail('redaction_failed', pageCount);
  }

  // 독립 검증 — pdf.js로 보호본을 다시 읽는다
  let extracted: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(out));
    const { text } = await extractText(pdf, { mergePages: false });
    extracted = (Array.isArray(text) ? text : [text]).join('\n');
  } catch {
    return fail('verification_failed', pageCount);
  }
  const flat = norm(extracted);
  for (const s of secret.filter((x) => x.masked)) {
    if (flat.includes(norm(s.value)) || s.hidden.some((h) => digitsOf(h).length >= 4 && flat.includes(norm(h)))) return fail('verification_failed', pageCount);
  }
  // 놓친 Level 1 정보가 보호본에 남아 있으면 실패 (사용자가 가리기 해제했거나 후보로 둔 값은 제외)
  const allowed = new Set(secret.filter((x) => !x.masked).map((x) => digitsOf(x.value)));
  for (const line of extracted.split('\n')) {
    for (const d of detectSensitive(line)) {
      if (d.level === 1 && d.confidence !== 'low' && !allowed.has(digitsOf(line.slice(d.start, d.end)))) return fail('verification_failed', pageCount);
    }
  }
  return { status: 'protected', detail: null, imagesUnchecked, regions, protectedPdf: out, pageCount };
}
