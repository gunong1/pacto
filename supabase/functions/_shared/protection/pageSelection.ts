// 분석 대상 페이지 선택 — 사진 여러 장 · 스캔 PDF · 텍스트+이미지 혼합 PDF 공통 규칙 (한 곳)
//
// - 제외할 페이지는 사용자가 직접 고른다 (AI가 정하지 않음). 원본 파일은 바꾸거나 지우지 않는다
// - 제외한 페이지는 보호본·AI 요청에 넣지 않는다: 보호본은 남은 페이지로만 만들고(protectPdfSelected), 분석은 그 보호본만 쓴다
// - 남은 페이지 중 하나라도 보호 검증을 통과하지 못했으면 분석하지 않는다 (aiGate) / 남은 페이지가 0개면 분석할 수 없다
// - AI가 본 문서의 파일·쪽 번호 ↔ 사용자가 올린 원본의 파일 순서·페이지 번호 (근거 연결은 원본 기준)
// 원문 값은 다루지 않는다 (번호만).
// 테스트: src/domain/__tests__/security/page-selection-golden.test.ts
import { PDFDocument } from '../vendor/pdf-lib.js';

export const MAX_SELECTABLE_PAGES = 60;

/** 요청 값 → 제외할 원본 페이지 번호 (정수 1..pageCount, 중복 없음, 정렬). 형식이 틀리면 null */
export function normalizeExcluded(raw: unknown, pageCount: number | null): number[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_SELECTABLE_PAGES) return null;
  const out = new Set<number>();
  for (const v of raw) {
    if (!Number.isInteger(v) || v < 1 || v > (pageCount ?? MAX_SELECTABLE_PAGES)) return null;
    out.add(v as number);
  }
  return [...out].sort((a, b) => a - b);
}

/** 남은(분석할) 페이지 — 원본 번호 */
export const keptPages = (pageCount: number, excluded: readonly number[]): number[] =>
  Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => !excluded.includes(p));

/** 원본 PDF에서 남은 페이지만 담은 새 PDF (메모리에서만 — 원본은 그대로) */
export async function subsetPdf(bytes: Uint8Array, keep: readonly number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { updateMetadata: false });
  const out = await PDFDocument.create({ updateMetadata: false });
  const pages = await out.copyPages(src, keep.map((p) => p - 1));
  for (const p of pages) out.addPage(p);
  return await out.save({ useObjectStreams: false });
}

// ───────── 분석 계획 ─────────

export interface SelectionDoc {
  id: string;
  /** PDF 여부 (사진은 1쪽) */
  pdf: boolean;
  excludedPages: readonly number[];
  /** PDF 페이지 수 (보호 처리에서 센 값). 모르면 null */
  pageCount: number | null;
}

export interface PlannedFile {
  /** 요청한 문서 순서 (1부터) — 앱의 문서 목록과 같은 번호 */
  requestFile: number;
  documentId: string;
  /** 분석에 쓰는 원본 페이지 (보호본 순서). null = 모든 페이지 (선택 없음) */
  pages: number[] | null;
}

export type SelectionPlan = { kind: 'ok'; files: PlannedFile[] } | { kind: 'error'; code: 'no_pages_selected' | 'selection_invalid' };

/** 문서별 선택 → AI에 보낼 파일 목록 (AI 파일 순서 = 배열 순서). 모든 페이지를 뺀 문서는 보내지 않는다 */
export function planSelection(docs: readonly SelectionDoc[]): SelectionPlan {
  const files: PlannedFile[] = [];
  for (const [i, d] of docs.entries()) {
    if (d.excludedPages.length === 0) {
      files.push({ requestFile: i + 1, documentId: d.id, pages: null });
      continue;
    }
    const count = d.pdf ? d.pageCount : 1;
    if (count == null || d.excludedPages.some((p) => p > count)) return { kind: 'error', code: 'selection_invalid' };
    const keep = keptPages(count, d.excludedPages);
    if (keep.length > 0) files.push({ requestFile: i + 1, documentId: d.id, pages: keep });
  }
  return files.length === 0 ? { kind: 'error', code: 'no_pages_selected' } : { kind: 'ok', files };
}

/** 분석 기록에 남기는 선택 (문서별 제외 페이지 · 실제로 분석에 쓴 원본 페이지) */
export interface SelectionRecord {
  documentId: string;
  excludedPages: number[];
  /** null = 모든 페이지 / [] = 이 문서는 분석에 쓰지 않음 */
  analyzedPages: number[] | null;
}
export function selectionRecord(docs: readonly SelectionDoc[], plan: readonly PlannedFile[]): SelectionRecord[] {
  return docs.map((d) => {
    const f = plan.find((x) => x.documentId === d.id);
    return { documentId: d.id, excludedPages: [...d.excludedPages], analyzedPages: f ? (f.pages ? [...f.pages] : null) : [] };
  });
}
/** 분석 뒤 선택이 바뀌었는지 — 바뀌었으면 예전 분석 결과를 이어 쓰지 않는다 */
export function selectionChanged(prev: readonly SelectionRecord[] | undefined, docs: readonly { id: string; excludedPages: readonly number[] }[]): boolean {
  const key = (ps: readonly number[]) => [...ps].sort((a, b) => a - b).join(',');
  return docs.some((d) => key(prev?.find((x) => x.documentId === d.id)?.excludedPages ?? []) !== key(d.excludedPages));
}

// ───────── 번호 변환: AI가 본 문서 → 원본 ─────────

/** AI 파일 번호(1부터) → 원본 파일 번호, AI 쪽 → 원본 쪽 (보호본 쪽이 원본과 같으면 그대로) */
export function toOriginal(plan: readonly PlannedFile[], aiFile: number | null | undefined, aiPage: number | null | undefined): { file: number | null; page: number | null } {
  // 파일 번호가 없으면 파일이 하나일 때만 그 파일로 본다
  const f = aiFile != null ? plan[aiFile - 1] : plan.length === 1 ? plan[0] : undefined;
  if (!f) return { file: null, page: null };
  if (aiPage == null) return { file: f.requestFile, page: null };
  if (!f.pages) return { file: f.requestFile, page: aiPage };
  return { file: f.requestFile, page: f.pages[aiPage - 1] ?? null };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 앱 형식 결과의 모든 근거 위치를 원본 기준으로 (evidence[].file·page, 계약 체크 evidenceFileIndex·evidencePage)
 * 위치를 원본으로 옮길 수 없으면 쪽을 비운다 (엉뚱한 쪽으로 연결하지 않음)
 */
export function remapResult<T>(result: T, plan: readonly PlannedFile[]): T {
  const identity = plan.every((f, i) => f.requestFile === i + 1 && f.pages === null);
  if (identity) return result;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!isObj(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === 'evidence' && Array.isArray(x)) {
        out[k] = x.map((e) => {
          if (!isObj(e)) return e;
          const o = toOriginal(plan, typeof e.file === 'number' ? e.file : null, typeof e.page === 'number' ? e.page : null);
          const { file: _f, ...rest } = e;
          return { ...rest, page: o.page, ...(o.file != null ? { file: o.file } : {}) };
        });
      } else out[k] = walk(x);
    }
    // 계약 체크: 파일 번호는 0부터
    if ('evidenceFileIndex' in v || 'evidencePage' in v) {
      const fi = typeof v.evidenceFileIndex === 'number' ? v.evidenceFileIndex + 1 : null;
      const o = toOriginal(plan, fi, typeof v.evidencePage === 'number' ? v.evidencePage : null);
      out.evidenceFileIndex = o.file != null ? o.file - 1 : null;
      out.evidencePage = o.page;
    }
    return out;
  };
  return walk(result) as T;
}

/** 판정의 의심 쪽·제외 목록 → 원본 번호 (앱이 보여주고 고르는 번호) */
export function remapPages<P extends { file: number; page: number | null }>(pages: readonly P[], plan: readonly PlannedFile[]): P[] {
  return pages.flatMap((p) => {
    const o = toOriginal(plan, p.file, p.page);
    return o.file == null ? [] : [{ ...p, file: o.file, page: p.page == null ? null : o.page }];
  });
}

/** 앱이 고른 원본 파일 번호 → AI 파일 번호 (분석에 쓰지 않은 파일은 뺀다) */
export const toAiFiles = (requestFiles: readonly number[], plan: readonly PlannedFile[]): number[] =>
  requestFiles.flatMap((f) => {
    const i = plan.findIndex((x) => x.requestFile === f);
    return i < 0 ? [] : [i + 1];
  });
