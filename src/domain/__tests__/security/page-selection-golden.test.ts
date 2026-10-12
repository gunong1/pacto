/**
 * 분석 대상 페이지 선택 Golden (분석 단계 규칙) — 모든 값은 가짜다.
 * 보호 단계(실제 PDF·OCR)는 tests/protection/page-selection.test.ts.
 *
 * 1 정상 1쪽 + 읽기 어려운 2쪽 → 선택 없으면 분석 차단
 * 2 2쪽을 빼면 → 보호가 검증된 1쪽만으로 분석 (보호본 페이지가 지금 선택과 같을 때만)
 * 3 2쪽을 빼지 않으면 → 차단 (사용자가 "확인"만 누르는 우회 없음)
 * 4 뺀 페이지는 AI 요청에 들어가지 않음 (AI에 보내는 파일·페이지 목록)
 * 5 정상 페이지까지 빼면 → 분석할 페이지 0개 → 차단
 * 6 원본 페이지 번호와 AI 근거 연결 (AI가 본 1쪽 = 원본 2쪽)
 * 7 분석 대상이 바뀌면 예전 보호본·분석 결과를 재사용하지 않음
 */
import { aiInputPlan } from '../../../../supabase/functions/_shared/protection/aiGate.ts';
import {
  normalizeExcluded,
  planSelection,
  remapPages,
  remapResult,
  selectionChanged,
  selectionRecord,
  toAiFiles,
  toOriginal,
  type SelectionDoc,
} from '../../../../supabase/functions/_shared/protection/pageSelection.ts';

const PAGES_UNREADABLE_2 = [
  { page: 1, status: 'protected' },
  { page: 2, status: 'unreadable' },
];
const pdfDoc = (excludedPages: number[], id = 'doc-1'): SelectionDoc => ({ id, pdf: true, excludedPages, pageCount: 2 });
const gate = (o: { status: string; pages: number[] | null; viewPages: number[] | null; pageStatuses?: { page: number; status: string }[]; encrypted?: boolean; hasView?: boolean }) =>
  aiInputPlan({ protectionStatus: o.status, encrypted: !!o.encrypted, hasProtectedView: o.hasView ?? !!o.viewPages, selection: { pages: o.pages, viewPages: o.viewPages, pageStatuses: o.pageStatuses ?? PAGES_UNREADABLE_2 } });

describe('Golden 1~5: 분석 허용·차단', () => {
  test('1·3. 정상 1쪽 + 읽기 어려운 2쪽, 제외 없음 → 차단 (문서 unreadable · 보호본 없음)', () => {
    const plan = planSelection([pdfDoc([])]);
    expect(plan).toEqual({ kind: 'ok', files: [{ requestFile: 1, documentId: 'doc-1', pages: null }] });
    expect(gate({ status: 'unreadable', pages: null, viewPages: null, hasView: false })).toEqual({ kind: 'blocked', code: 'protection_required' });
  });

  test('2. 2쪽을 빼면 → 1쪽만 분석, 1쪽으로 만든 보호본만 AI에', () => {
    const plan = planSelection([pdfDoc([2])]);
    expect(plan).toEqual({ kind: 'ok', files: [{ requestFile: 1, documentId: 'doc-1', pages: [1] }] });
    const pageStatuses = [{ page: 1, status: 'protected' }, { page: 2, status: 'excluded' }];
    expect(gate({ status: 'protected', pages: [1], viewPages: [1], pageStatuses })).toEqual({ kind: 'protected_view' });
  });

  test('3. 남은 페이지 중 하나라도 보호 검증을 통과하지 못했으면 차단 (상태가 protected여도)', () => {
    const pageStatuses = [{ page: 1, status: 'protected' }, { page: 2, status: 'unreadable' }, { page: 3, status: 'excluded' }];
    expect(gate({ status: 'protected', pages: [1, 2], viewPages: [1, 2], pageStatuses })).toEqual({ kind: 'blocked', code: 'protection_required' });
    // 처리하지 않은 페이지(skipped)도 검증되지 않은 것
    expect(gate({ status: 'protected', pages: [1, 2], viewPages: [1, 2], pageStatuses: [{ page: 1, status: 'protected' }, { page: 2, status: 'skipped' }] })).toEqual({ kind: 'blocked', code: 'protection_required' });
  });

  test('4. 뺀 페이지는 AI 요청에 들어가지 않음 — 민감정보 없음 문서도 원본 전체가 아니라 남은 페이지만 (메모리에서 잘라)', () => {
    const pageStatuses = [{ page: 1, status: 'no_sensitive_data' }, { page: 2, status: 'excluded' }, { page: 3, status: 'no_sensitive_data' }];
    expect(gate({ status: 'no_sensitive_data', pages: [1, 3], viewPages: null, pageStatuses })).toEqual({ kind: 'original_subset', pages: [1, 3] });
    expect(gate({ status: 'no_sensitive_data', pages: [1, 3], viewPages: null, pageStatuses, encrypted: true })).toEqual({ kind: 'decrypted_subset', pages: [1, 3] });
    // 사진 여러 장: 뺀 사진은 AI 파일 목록에서 빠지고, 남은 사진의 원래 순서를 기억
    const photos: SelectionDoc[] = [
      { id: 'p1', pdf: false, excludedPages: [], pageCount: null },
      { id: 'p2', pdf: false, excludedPages: [1], pageCount: null },
      { id: 'p3', pdf: false, excludedPages: [], pageCount: null },
    ];
    const plan = planSelection(photos);
    expect(plan).toEqual({ kind: 'ok', files: [{ requestFile: 1, documentId: 'p1', pages: null }, { requestFile: 3, documentId: 'p3', pages: null }] });
  });

  test('5. 정상 페이지까지 빼면 → 분석할 페이지 0개 → no_pages_selected', () => {
    expect(planSelection([pdfDoc([1, 2])])).toEqual({ kind: 'error', code: 'no_pages_selected' });
    expect(planSelection([{ id: 'p', pdf: false, excludedPages: [1], pageCount: null }])).toEqual({ kind: 'error', code: 'no_pages_selected' });
    // 빈 선택 목록 → 분석 대상 없음 (보호본 페이지 0개는 허용하지 않음)
    expect(gate({ status: 'protected', pages: [], viewPages: [], pageStatuses: [] })).toEqual({ kind: 'blocked', code: 'protection_required' });
    // 페이지 수를 모르는 PDF에 선택이 있으면 분석하지 않음 · 없는 페이지 번호 거절
    expect(planSelection([{ id: 'x', pdf: true, excludedPages: [2], pageCount: null }])).toEqual({ kind: 'error', code: 'selection_invalid' });
    expect(normalizeExcluded([3, 1, 1], 2)).toBeNull();
    expect(normalizeExcluded([2, 1, 2], 2)).toEqual([1, 2]);
    expect(normalizeExcluded(['2'], 2)).toBeNull();
  });
});

describe('Golden 6: 원본 페이지 번호와 AI 근거 연결', () => {
  // 원본: 문서1(사진) · 문서2(사진, 제외) · 문서3(PDF 3쪽 중 1쪽 제외) → AI는 파일 2개 (사진1, PDF의 2·3쪽)
  const plan = [
    { requestFile: 1, documentId: 'a', pages: null },
    { requestFile: 3, documentId: 'c', pages: [2, 3] },
  ];
  test('AI 파일·쪽 → 원본 파일·쪽', () => {
    expect(toOriginal(plan, 1, 1)).toEqual({ file: 1, page: 1 });
    expect(toOriginal(plan, 2, 1)).toEqual({ file: 3, page: 2 });
    expect(toOriginal(plan, 2, 2)).toEqual({ file: 3, page: 3 });
    // AI가 없는 쪽을 말하면 쪽을 비움 (엉뚱한 쪽으로 연결하지 않음)
    expect(toOriginal(plan, 2, 5)).toEqual({ file: 3, page: null });
    expect(toOriginal(plan, 9, 1)).toEqual({ file: null, page: null });
  });
  test('결과 전체(값 근거 · 계약 체크 근거)를 원본 기준으로', () => {
    const result = {
      fields: { title: { value: '임대차계약서', confidence: 'high', evidence: [{ page: 1, quote: '임대차계약서', file: 2 }] } },
      payments: [{ label: '월세', evidence: [{ page: 2, quote: '월세 850,000원', file: 2 }] }],
      checks: [{ title: '원상복구', evidenceQuote: '원상복구', evidencePage: 2, evidenceFileIndex: 1 }],
      classification: { evidence: [{ page: 1, quote: '제1조', file: 1 }] },
    };
    const out = remapResult(result, plan);
    expect(out.fields.title.evidence).toEqual([{ page: 2, quote: '임대차계약서', file: 3 }]);
    expect(out.payments[0].evidence).toEqual([{ page: 3, quote: '월세 850,000원', file: 3 }]);
    expect(out.checks[0]).toMatchObject({ evidencePage: 3, evidenceFileIndex: 2 });
    expect(out.classification.evidence).toEqual([{ page: 1, quote: '제1조', file: 1 }]);
  });
  test('파일이 하나인 문서 — 근거에 파일 번호가 없어도 그 문서의 원본 쪽으로', () => {
    const one = [{ requestFile: 1, documentId: 'd', pages: [2] }];
    expect(remapResult({ x: { evidence: [{ page: 1, quote: 'q' }] } }, one).x.evidence).toEqual([{ page: 2, quote: 'q', file: 1 }]);
  });
  test('선택이 없으면 결과를 그대로 (예전 동작과 같음)', () => {
    const same = [{ requestFile: 1, documentId: 'a', pages: null }];
    const r = { checks: [{ evidencePage: 4, evidenceFileIndex: 0 }] };
    expect(remapResult(r, same)).toBe(r);
  });
  test('판정의 의심 쪽 · 앱이 고른 파일 번호도 같은 변환 (앱 화면 번호 = 원본)', () => {
    expect(remapPages([{ file: 2, page: 1, role: 'non_contract' }, { file: 1, page: null, role: 'uncertain' }], plan)).toEqual([
      { file: 3, page: 2, role: 'non_contract' },
      { file: 1, page: null, role: 'uncertain' },
    ]);
    expect(toAiFiles([1, 2, 3], plan)).toEqual([1, 2]);
  });
});

describe('Golden 7: 분석 대상이 바뀌면 재사용하지 않음', () => {
  test('보호본이 담은 페이지가 지금 선택과 다르면 보호본을 쓰지 않음', () => {
    const pageStatuses = [{ page: 1, status: 'protected' }, { page: 2, status: 'protected' }, { page: 3, status: 'excluded' }];
    // 예전 선택(3쪽 제외 → 보호본 [1,2])인데 지금은 2·3쪽 제외
    expect(gate({ status: 'protected', pages: [1], viewPages: [1, 2], pageStatuses })).toEqual({ kind: 'blocked', code: 'protection_required' });
    // 선택을 모두 풀었는데 보호본은 일부 페이지만 → 쓰지 않음
    expect(aiInputPlan({ protectionStatus: 'protected', encrypted: false, hasProtectedView: true, selection: { pages: null, viewPages: [1], pageStatuses } })).toEqual({ kind: 'blocked', code: 'protection_required' });
  });
  test('분석 기록에 문서별 제외 페이지·분석한 원본 페이지 · 이후 선택이 바뀌면 이어 쓰지 않음', () => {
    const docs = [pdfDoc([2]), { id: 'p', pdf: false, excludedPages: [1], pageCount: null }];
    const plan = planSelection(docs);
    if (plan.kind !== 'ok') throw new Error('plan');
    const rec = selectionRecord(docs, plan.files);
    expect(rec).toEqual([
      { documentId: 'doc-1', excludedPages: [2], autoExcludedPages: [], analyzedPages: [1] },
      { documentId: 'p', excludedPages: [1], autoExcludedPages: [], analyzedPages: [] },
    ]);
    expect(selectionChanged(rec, [{ id: 'doc-1', excludedPages: [2] }, { id: 'p', excludedPages: [1] }])).toBe(false);
    expect(selectionChanged(rec, [{ id: 'doc-1', excludedPages: [] }, { id: 'p', excludedPages: [1] }])).toBe(true);
    // 선택 기록이 없는 예전 분석 → 지금 선택이 있으면 바뀐 것
    expect(selectionChanged(undefined, [{ id: 'doc-1', excludedPages: [2] }])).toBe(true);
    expect(selectionChanged(undefined, [{ id: 'doc-1', excludedPages: [] }])).toBe(false);
  });
});
