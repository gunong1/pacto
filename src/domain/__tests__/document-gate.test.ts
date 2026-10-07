/**
 * 문서 확인 게이트 — 파일을 올린 것과 계약서로 인정하는 것은 별개 (시나리오 A~L)
 * mock 공급자와 같은 모델 출력(mockDocumentOutput)을 서버와 같은 코드(firstPass · finalize)로 확인한다.
 */
import { finalize, firstPass } from '../../../supabase/functions/_shared/analysis';
import { mockDocumentOutput, rentalOutput } from '../../../supabase/functions/_shared/ai/mockFixtures';
import { decide, filterOutputByPages, parseDocumentCheck, type FileKind } from '../../../supabase/functions/_shared/documentGate';

const kinds = (names: string[]): FileKind[] => names.map((n, i) => ({ file: i + 1, pdf: n.endsWith('.pdf') }));
const run = (names: string[]) => {
  const raw = mockDocumentOutput(names);
  return { raw, files: kinds(names), ...firstPass(raw, kinds(names), 'mock') };
};
const amounts = (r: { payments: { amount: number }[] } | null) => (r ? r.payments.map((p) => p.amount) : []);

describe('문서 역할 판정 → 진행 여부', () => {
  test('A. 정상 계약 PDF → contract · 분석 결과로 진행', () => {
    const r = run(['렌탈계약서.pdf']);
    expect(r.validation).toMatchObject({ role: 'contract', decision: 'proceed' });
    expect(r.result?.payments.length).toBeGreaterThan(0);
  });

  test('B. 정상 계약 사진 → contract · 진행', () => {
    const r = run(['렌탈계약서_1.jpg', '렌탈계약서_2.jpg']);
    expect(r.validation).toMatchObject({ role: 'contract', decision: 'proceed', suspiciousPages: [] });
    expect(r.result).not.toBeNull();
  });

  test.each([
    ['C. 음식 사진', ['음식.jpg']],
    ['D. 반려동물 사진', ['강아지.jpg']],
    ['H. 영수증 단독', ['영수증.jpg']],
    ['I. 신분증 단독 (개인정보가 있다고 계약이 아님)', ['신분증.jpg']],
  ])('%s → non_contract · 분석 중단 · 결과 없음', (_n, names) => {
    const r = run(names);
    expect(r.validation).toMatchObject({ role: 'non_contract', decision: 'stop_non_contract' });
    expect(r.result).toBeNull();
  });

  test('E. 흐릿한 계약 사진 → unreadable · 다시 촬영 · 결과 없음', () => {
    const r = run(['계약서_흐림.jpg']);
    expect(r.validation).toMatchObject({ role: 'unreadable', decision: 'stop_unreadable' });
    expect(r.result).toBeNull();
  });

  test('G. 특약서만 → addendum · non_contract로 버리지 않음', () => {
    const r = run(['특약서.jpg']);
    expect(r.validation.role).toBe('addendum');
    expect(r.validation.decision).not.toMatch(/^stop_/);
  });

  test('J. 계약서 + 특약서 → contract · 정상 진행', () => {
    const r = run(['렌탈계약서.jpg', '특약서.jpg']);
    expect(r.validation).toMatchObject({ role: 'contract', decision: 'proceed' });
  });

  test('L. 계약 신호 부족 → 억지로 "기타 계약"을 만들지 않음 (정보 부족)', () => {
    const r = run(['정보부족.jpg']);
    expect(r.validation.decision).toBe('stop_insufficient');
    expect(r.result).toBeNull();
  });

  test('관련 자료(견적서)만 → 새 계약 자동 생성 없이 사용자 확인', () => {
    const r = run(['견적서.jpg']);
    expect(r.validation).toMatchObject({ role: 'supporting', decision: 'confirm_role' });
    expect(r.result).toBeNull();
  });
});

describe('최소 계약 신호 (보수적으로 — 실제 계약을 너무 쉽게 버리지도 않는다)', () => {
  const files = kinds(['a.jpg']);
  const with_ = (role: string, confidence: string, signals: Record<string, boolean>) =>
    parseDocumentCheck({ document_check: { role, confidence, reasons: [], signals, pages: [] } }, files);
  const all = (on: string[]) => Object.fromEntries(['parties', 'dates', 'amounts', 'obligations', 'purpose', 'termination_renewal', 'signature', 'contract_language'].map((k) => [k, on.includes(k)]));

  test('신호 3개 이상 + 날짜/금액 → 진행', () => {
    const c = with_('contract', 'high', all(['parties', 'amounts', 'obligations']));
    expect(decide(c, c.signals, files).decision).toBe('proceed');
  });
  test('날짜·금액 없이 당사자 + 의무/약정 + 계약형 문장 → 버리지 않고 사용자 확인', () => {
    const c = with_('contract', 'high', all(['parties', 'obligations', 'contract_language']));
    expect(decide(c, c.signals, files).decision).toBe('confirm_role');
  });
  test('신호 2개 → 사용자 확인 / 0~1개 → 정보 부족', () => {
    const two = with_('contract', 'high', all(['parties', 'dates']));
    expect(decide(two, two.signals, files).decision).toBe('confirm_role');
    const one = with_('contract', 'high', all(['contract_language']));
    expect(decide(one, one.signals, files).decision).toBe('stop_insufficient');
  });
  test('신뢰도 low면 신호가 많아도 자동 확정하지 않음', () => {
    const c = with_('contract', 'low', all(['parties', 'dates', 'amounts', 'obligations']));
    expect(decide(c, c.signals, files).decision).toBe('confirm_role');
  });
  test('document_check가 없으면 uncertain(low) — 계약으로 확정하지 않음', () => {
    const r = firstPass(rentalOutput('렌탈'), files, 'mock');
    expect(r.validation.role).toBe('uncertain');
    expect(r.result).toBeNull();
  });
});

describe('F. 계약서 4장 + 엉뚱한 사진 1장 — 제외한 쪽의 값은 결과에 남지 않는다', () => {
  const names = ['계약서_1.jpg', '계약서_2.jpg', '책상.jpg', '계약서_3.jpg', '계약서_4.jpg'];

  test('계약 전체를 실패시키지 않고 3번째 사진을 의심 쪽으로, 결과는 쪽 선택 전까지 보내지 않음', () => {
    const r = run(names);
    expect(r.validation.role).toBe('contract');
    expect(r.validation.decision).toBe('choose_pages');
    expect(r.validation.suspiciousPages.map((p) => [p.file, p.role, p.pdf])).toEqual([[3, 'non_contract', false]]);
    expect(r.result).toBeNull();
  });

  test('3번째 사진 제외 → 그 사진에서 읽은 3,000,000원 월 납입액·2027-03-15 종료일이 결과에 없음', () => {
    const r = run(names);
    const out = finalize(r.raw, r.validation, r.files, { confirmRole: false, includeFiles: [], excludeFiles: [3] }, 'mock');
    expect(out.kind).toBe('done');
    if (out.kind !== 'done') return;
    expect(amounts(out.result)).not.toContain(3_000_000);
    expect(out.result!.dates.map((d) => d.date)).not.toContain('2027-03-15');
    expect(amounts(out.result)).toContain(29_900);
    expect(out.removedValues).toBe(2);
    expect(out.excluded).toEqual([{ file: 3, page: null }]);
  });

  test('선택하지 않아도 계약과 무관한 쪽의 값은 기본으로 빠진다', () => {
    const r = run(names);
    const out = finalize(r.raw, r.validation, r.files, { confirmRole: false, includeFiles: [], excludeFiles: [] }, 'mock');
    expect(out.kind === 'done' && amounts(out.result)).not.toContain(3_000_000);
  });

  test('사용자가 "그대로 포함"을 고르면 그 쪽 값도 유지 (사용자 판단)', () => {
    const r = run(names);
    const out = finalize(r.raw, r.validation, r.files, { confirmRole: false, includeFiles: [3], excludeFiles: [] }, 'mock');
    expect(out.kind === 'done' && amounts(out.result)).toContain(3_000_000);
  });

  test('근거 위치를 모르는 값이 있으면 제외 후 그대로 쓰지 않고 다시 분석 (제외한 사진 빼고)', () => {
    const n2 = ['계약서_1.jpg', '책상.jpg', '계약서_출처불명.jpg'];
    const r = run(n2);
    const out = finalize(r.raw, r.validation, r.files, { confirmRole: false, includeFiles: [], excludeFiles: [2] }, 'mock');
    expect(out).toMatchObject({ kind: 'reanalyze', keepFiles: [1, 3] });
  });

  test('모든 사진을 제외하면 정보 부족', () => {
    const r = run(['계약서.jpg', '책상.jpg']);
    const out = finalize(r.raw, r.validation, r.files, { confirmRole: false, includeFiles: [], excludeFiles: [1, 2] }, 'mock');
    expect(out.kind === 'done' && out.validation.decision).toBe('stop_insufficient');
  });
});

describe('K. 같은 쪽 중복', () => {
  test('중복 쪽을 의심 쪽으로 표시, 같은 금액이 두 번 생기지 않음', () => {
    const r = run(['렌탈계약서_1.jpg', '렌탈계약서_1_중복.jpg']);
    expect(r.validation.suspiciousPages).toEqual([expect.objectContaining({ file: 2, duplicateOf: { file: 1, page: 1 } })]);
    const out = finalize(r.raw, r.validation, r.files, { confirmRole: false, includeFiles: [2], excludeFiles: [] }, 'mock');
    if (out.kind !== 'done') throw new Error('expected done');
    const rent = out.result!.payments.filter((p) => p.label === '월 렌탈료');
    expect(rent).toHaveLength(1);
  });
});

describe('사용자 확인 (uncertain → "계약 관련 문서가 맞아요")', () => {
  test('확인 없이 마무리하면 거부, 확인하면 진행하고 userConfirmedRole 기록', () => {
    const r = run(['견적서.jpg']);
    expect(() => finalize(r.raw, r.validation, r.files, { confirmRole: false, includeFiles: [], excludeFiles: [] }, 'mock')).toThrow('confirmation_required');
    const out = finalize(r.raw, r.validation, r.files, { confirmRole: true, includeFiles: [], excludeFiles: [] }, 'mock');
    expect(out).toMatchObject({ kind: 'done', validation: { decision: 'proceed', userConfirmedRole: true } });
  });

  test('중단 판정(non_contract)은 마무리로 우회할 수 없음', () => {
    const r = run(['음식.jpg']);
    expect(() => finalize(r.raw, r.validation, r.files, { confirmRole: true, includeFiles: [1], excludeFiles: [] }, 'mock')).toThrow('not_allowed');
  });
});

describe('PDF 의심 쪽 — 안내만, 그 쪽의 값은 빼고 위치 모르는 값은 확인 필요로', () => {
  test('PDF 2쪽이 계약과 무관 → 진행(사진 쪽 선택 없음), 2쪽 근거 값 제거', () => {
    const raw = {
      ...mockDocumentOutput(['렌탈계약서.pdf']),
      document_check: { role: 'contract', confidence: 'high', reasons: ['mixed_pages'], signals: { parties: true, dates: true, amounts: true, obligations: true, purpose: true, termination_renewal: true, signature: true, contract_language: true }, pages: [{ file: 1, page: 1, role: 'contract', duplicate_of_file: null, duplicate_of_page: null }, { file: 1, page: 2, role: 'non_contract', duplicate_of_file: null, duplicate_of_page: null }] },
    } as Record<string, unknown>;
    (raw.payments as unknown[]).push({ ...(raw.payments as Record<string, unknown>[])[0], label: '광고 금액', amount: 990_000, evidence_file: 1, evidence_page: 2 });
    const r = firstPass(raw, kinds(['렌탈계약서.pdf']), 'mock');
    expect(r.validation.decision).toBe('proceed');
    expect(r.validation.suspiciousPages).toEqual([expect.objectContaining({ file: 1, page: 2, pdf: true })]);
    expect(amounts(r.result)).not.toContain(990_000);
  });

  test('필터 단위: 제외 쪽이 없으면 그대로, 근거 위치 없는 값은 센다', () => {
    const raw = { fields: { title: { value: 'x', evidence_file: null } }, payments: [{ amount: 1, evidence_file: 2, evidence_page: 1 }, { amount: 2 }] };
    expect(filterOutputByPages(raw, []).unknownOrigin).toBe(0);
    const f = filterOutputByPages(raw, [{ file: 2, page: null }]);
    expect(f).toMatchObject({ removed: 1, unknownOrigin: 2 });
  });
});
