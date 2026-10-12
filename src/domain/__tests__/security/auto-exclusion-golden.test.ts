/**
 * 읽지 못한 페이지 자동 제외 Golden (공통 페이지 정책) — 모든 값은 가짜다.
 * 실제 PDF·OCR 처리는 tests/protection/page-selection.test.ts (7~9), 서버 연결은 통합 step27, 화면은 E2E page-selection.
 *
 * - 정상 페이지 + unreadable 페이지 → unreadable 페이지만 자동 제외하고 부분 분석
 * - 자동 제외된 페이지는 AI 요청에 없음 (분석 계획에 그 페이지가 없다)
 * - needs_review · failed · unsupported_scan은 자동 제외하지 않음 (지금처럼 멈춤)
 * - 모든 페이지가 unreadable이면 자동 제외하지 않음 → 분석 중단
 * - 결과 화면: "전체 2쪽 중 1쪽만 분석했어요." + 페이지별 사유 (자동/직접 구분)
 * - 저장 전 확인 · 저장 후에도 문서 기록에서 같은 안내 · 보호 완료로 보이지 않음
 */
import type { DocumentProtection } from '@/domain/types';
import { overallProtectionCopy, partialAnalysis, protectionCopy } from '@/features/documents/protectionCopy';

import { autoExcludablePages, type PageOutcome } from '../../../../supabase/functions/_shared/protection/protect.ts';
import { aiInputPlan } from '../../../../supabase/functions/_shared/protection/aiGate.ts';
import { planSelection, selectionRecord } from '../../../../supabase/functions/_shared/protection/pageSelection.ts';

const page = (n: number, status: PageOutcome['status'], kind: PageOutcome['kind'] = 'scan'): PageOutcome => ({ page: n, kind, status, detail: null });
const prot = (o: Partial<DocumentProtection>): DocumentProtection => ({
  status: 'protected',
  detail: null,
  imagesUnchecked: false,
  protectedViewPath: 'u/d.protected_view.pdf',
  regions: [],
  pages: [],
  ...o,
});
/** 실제 사례: 1쪽 계약서 보호 완료 · 2쪽 메모 자동 제외 */
const AUTO_2 = prot({
  pages: [
    { page: 1, kind: 'scan', status: 'protected', detail: null },
    { page: 2, kind: 'excluded', status: 'excluded', detail: 'auto_unreadable' },
  ],
  excludedPages: [2],
  autoExcludedPages: [2],
  viewPages: [1],
});

describe('자동 제외 조건 (unreadable만)', () => {
  test('정상 페이지 + unreadable 페이지 → unreadable 페이지만', () => {
    expect(autoExcludablePages([page(1, 'protected'), page(2, 'unreadable')])).toEqual([2]);
    expect(autoExcludablePages([page(1, 'protected', 'text'), page(2, 'unreadable'), page(3, 'no_sensitive_data'), page(4, 'unreadable')])).toEqual([2, 4]);
  });
  test('needs_review는 자동 제외하지 않음 (다른 페이지가 읽지 못함이어도 문서 전체를 멈춤)', () => {
    expect(autoExcludablePages([page(1, 'protected'), page(2, 'needs_review')])).toEqual([]);
    expect(autoExcludablePages([page(1, 'protected'), page(2, 'needs_review'), page(3, 'unreadable')])).toEqual([]);
  });
  test('failed · unsupported_scan · 처리하지 않은 페이지가 있으면 자동 제외하지 않음', () => {
    expect(autoExcludablePages([page(1, 'protected'), page(2, 'failed'), page(3, 'unreadable')])).toEqual([]);
    expect(autoExcludablePages([page(1, 'protected'), page(2, 'unsupported_scan', 'unsupported'), page(3, 'unreadable')])).toEqual([]);
    expect(autoExcludablePages([page(1, 'protected'), page(2, 'skipped'), page(3, 'unreadable')])).toEqual([]);
  });
  test('모든 페이지가 unreadable이면 자동 제외하지 않음 → 분석 중단', () => {
    expect(autoExcludablePages([page(1, 'unreadable'), page(2, 'unreadable')])).toEqual([]);
    // 사진만 여러 장이고 모두 읽지 못해 자동 제외됐으면 분석할 페이지 0개
    expect(planSelection([{ id: 'a', pdf: false, excludedPages: [1], autoExcludedPages: [1], pageCount: null }])).toEqual({ kind: 'error', code: 'no_pages_selected' });
  });
});

describe('부분 분석 진행 · AI 요청', () => {
  test('자동 제외된 페이지는 AI 요청(분석 계획)에 없음 · 기록은 자동/직접 구분', () => {
    const docs = [{ id: 'd', pdf: true, excludedPages: [2], autoExcludedPages: [2], pageCount: 2 }];
    const plan = planSelection(docs);
    expect(plan).toEqual({ kind: 'ok', files: [{ requestFile: 1, documentId: 'd', pages: [1] }] });
    if (plan.kind !== 'ok') throw new Error('plan');
    expect(selectionRecord(docs, plan.files)).toEqual([{ documentId: 'd', excludedPages: [2], autoExcludedPages: [2], analyzedPages: [1] }]);
    // AI에는 1쪽만 담은 보호본
    const pageStatuses = AUTO_2.pages.map((p) => ({ page: p.page, status: p.status }));
    expect(aiInputPlan({ protectionStatus: 'protected', encrypted: false, hasProtectedView: true, selection: { pages: [1], viewPages: [1], pageStatuses } })).toEqual({ kind: 'protected_view' });
  });
});

describe('결과 화면 · 저장 전 확인 · 저장 후', () => {
  const docs = [{ fileName: '임대차계약서.pdf', isPdf: true, protection: AUTO_2 }];
  test('자동 제외 사실 표시: "전체 2쪽 중 1쪽만 분석했어요." + 사유', () => {
    const p = partialAnalysis(docs)!;
    expect(p.title).toBe('전체 2쪽 중 1쪽만 분석했어요.');
    expect(p.items).toEqual([
      { docIndex: 0, page: 2, label: '2쪽', auto: true, message: '2쪽은 글자를 정확하게 읽지 못해 분석에서 제외했어요. 중요한 계약 내용이 빠졌을 수 있습니다.' },
    ]);
  });
  test('직접 뺀 페이지는 다른 사유', () => {
    const user = prot({ ...AUTO_2, autoExcludedPages: [], pages: [AUTO_2.pages[0], { page: 2, kind: 'excluded', status: 'excluded', detail: 'user' }] });
    expect(partialAnalysis([{ fileName: 'a.pdf', isPdf: true, protection: user }])!.items[0].message).toBe('2쪽은 직접 제외해 분석에 사용하지 않았어요. 중요한 계약 내용이 빠졌을 수 있습니다.');
  });
  test('최종 저장 전 누락 페이지 확인 문구 (뺀 페이지가 없으면 확인 없음)', () => {
    expect(partialAnalysis(docs)!.confirmBody).toContain('2쪽은 분석에 사용하지 않았어요');
    expect(partialAnalysis([{ fileName: 'a.pdf', isPdf: true, protection: prot({ pages: [{ page: 1, kind: 'scan', status: 'protected' }] }) }])).toBeNull();
  });
  test('여러 파일 · 사진: 전체 쪽 수 합계, 사진은 "사진 N"', () => {
    const photoOk = prot({ status: 'no_sensitive_data', protectedViewPath: null });
    const photoAuto = prot({ status: 'unreadable', protectedViewPath: null, excludedPages: [1], autoExcludedPages: [1] });
    const p = partialAnalysis([
      { fileName: '1.jpg', isPdf: false, protection: photoOk },
      { fileName: '2.jpg', isPdf: false, protection: photoAuto },
      { fileName: '계약서.pdf', isPdf: true, protection: AUTO_2 },
    ])!;
    expect(p.title).toBe('전체 4쪽 중 2쪽만 분석했어요.');
    expect(p.items.map((x) => x.label)).toEqual(['사진 2', '계약서.pdf 2쪽']);
  });
  test('자동 제외가 있는 문서는 "보호 완료"로 보이지 않음 (카드 · 전체 상태)', () => {
    const c = protectionCopy(AUTO_2)!;
    expect(c.title).toBe('일부 페이지만 보호했어요');
    expect(c.tone).toBe('warning');
    expect(c.body).toContain('2쪽은 분석에서 제외해 민감정보 보호를 하지 않았어요');
    expect(overallProtectionCopy([AUTO_2])!.title).toBe('일부 페이지만 보호했어요');
    expect(overallProtectionCopy([prot({}), AUTO_2])!.title).toBe('일부 페이지만 보호했어요');
  });
  test('저장 후에도 부분 분석 이력 유지 — 계약 상세는 저장된 문서 기록(제외·자동 제외 페이지)으로 같은 안내', () => {
    // 저장된 계약의 문서 = 같은 보호 기록 (DB analysis_excluded_pages · analysis_auto_excluded_pages · protection_pages)
    const saved = { fileName: '임대차계약서.pdf', isPdf: true, protection: { ...AUTO_2 } };
    expect(partialAnalysis([saved])!.title).toBe('전체 2쪽 중 1쪽만 분석했어요.');
  });
});
