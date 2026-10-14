/**
 * 대출 상환 계획 (loanPlan.ts) + 일정·월 합계 연동. 모든 값은 가짜 (계약서 기준값을 검증값으로만 사용 — 계산은 규칙으로)
 * 기준 사례: 원금 30,000,000 · 연 6% 고정 · 실제 일수 ÷ 365 · 매월 1일~말일, 다음 달 10일 납부 · 만기일시 · 원 미만 반올림
 *           실행 2026-10-20 · 만기 2027-10-19
 */
import { draftToRecord, EMPTY_DRAFT, fixLoanDisbursement, mergeLoanInterest, recordToDraft } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';

import { withConfirmedRole } from '../cashflow';
import { interestExamples, loanLegacyIssues, loanPlan } from '../loanPlan';
import { scheduleForRange } from '../schedule';
import { monthSpending } from '../spending';
import type { ContractRecord } from '../types';

const TODAY = '2026-10-14';
const pay = (o: Partial<PaymentDraft>): PaymentDraft => ({
  kind: 'interest', direction: 'expense', label: '대출 이자', amount: 147_945, frequency: 'monthly', dayOfMonth: 10, monthOfYear: null, startsOn: '2026-11-10', endsOn: '2027-10-19',
  installmentCount: null, isVariable: true, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null, moneyNature: 'ordinary', ...o,
});
const DETAILS = { principal: 30_000_000, interestRate: 6, rateType: 'fixed', repaymentMethod: 'bullet', interestDayCount: 'actual_365', interestPeriod: 'calendar_month', interestRounding: 'round_1' };
export const loan = (o: { details?: Record<string, unknown>; payments?: PaymentDraft[]; id?: string } = {}): ContractRecord => {
  const draft: ContractDraft = {
    ...EMPTY_DRAFT,
    title: '가계 대출거래약정서',
    category: 'finance',
    contractType: 'loan',
    contractKind: 'loan',
    startDate: '2026-10-20',
    endDate: '2027-10-19',
    details: { ...DETAILS, ...o.details } as unknown as ContractDraft['details'],
    parties: [
      { role: 'lender', name: '가상은행' },
      { role: 'borrower', name: '홍길동' },
    ],
    payments: o.payments ?? [pay({}), pay({ kind: 'loan_repayment', label: '대출 원금 상환', amount: 30_000_000, frequency: 'one_time', dayOfMonth: null, startsOn: '2027-10-19', endsOn: null, isVariable: false })],
  };
  return draftToRecord(withConfirmedRole(draft, 'borrower'), o.id ?? 'loan', TODAY);
};
const pays = (r: ContractRecord, start: string, end: string) => scheduleForRange([r], { start, end }, TODAY).filter((i) => i.type === 'payment');

describe('이자 규칙 1개 → 회차별 이자', () => {
  test('기간·일수·금액: 첫 이자 12일 59,178 · 11월분 30일 147,945 · 12월분 31일 152,877 · 만기 최종 19일 93,699', () => {
    const plan = loanPlan(loan());
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    const [first, nov, dec] = plan.interest;
    expect([first.from, first.to, first.days, first.payDate, first.amount]).toEqual(['2026-10-20', '2026-10-31', 12, '2026-11-10', 59_178]);
    expect([nov.days, nov.payDate, nov.amount]).toEqual([30, '2026-12-10', 147_945]);
    expect([dec.days, dec.payDate, dec.amount]).toEqual([31, '2027-01-10', 152_877]);
    const last = plan.interest[plan.interest.length - 1];
    expect([last.kind, last.from, last.to, last.days, last.payDate, last.amount]).toEqual(['final', '2027-10-01', '2027-10-19', 19, '2027-10-19', 93_699]);
    expect(plan.interest).toHaveLength(13);
    expect(plan.principal).toEqual({ date: '2027-10-19', amount: 30_000_000 });
    expect(plan.estimated).toBe(false);
  });
});

describe('일정·월 합계 (홈·캘린더 공통 monthSpending)', () => {
  test('1·2. 대출 실행일(10/20)에는 입출금 없음 — 원금이 출금·수입에 들어가지 않음', () => {
    const r = loan();
    expect(pays(r, '2026-10-01', '2026-10-31')).toEqual([]);
    const oct = monthSpending([r], { year: 2026, month: 10 }, TODAY);
    expect([oct.total, oct.incomeTotal]).toEqual([0, 0]);
  });

  test('3·4. 이자 규칙 1개로 매월 일정 · 실제 일수만큼 이자 (11/10 59,178 · 12/10 147,945 · 1/10 152,877)', () => {
    const r = loan();
    expect(r.payments.filter((p) => p.kind === 'interest')).toHaveLength(1);
    const list = pays(r, '2026-11-01', '2027-01-31');
    expect(list.map((p) => [p.date, p.amount, p.title])).toEqual([
      ['2026-11-10', 59_178, '첫 이자 · 10월 20일~31일 (12일)'],
      ['2026-12-10', 147_945, '이자 · 11월 1일~30일 (30일)'],
      ['2027-01-10', 152_877, '이자 · 12월 1일~31일 (31일)'],
    ]);
    expect(list[0].detail).toBe('원금 3,000만원 · 연 6% · 12일 ÷ 365');
  });

  test('6. 만기일 2027-10-19: 원금 상환 3,000만원과 최종 이자 93,699 따로 · 원금은 일반 지출과 구분 · 중복 없음', () => {
    const r = loan();
    const day = pays(r, '2027-10-19', '2027-10-19');
    expect(day.map((p) => [p.title, p.amount]).sort()).toEqual([
      ['대출 원금 상환', 30_000_000],
      ['만기 최종 이자 · 10월 1일~19일 (19일)', 93_699],
    ]);
    const m = monthSpending([r], { year: 2027, month: 10 }, TODAY);
    // 10/10 9월분 이자(30일) + 10/19 최종 이자 + 원금
    expect([m.total, m.principalOut, m.ordinaryExpense]).toEqual([147_945 + 93_699 + 30_000_000, 30_000_000, 147_945 + 93_699]);
    expect(m.outflow.groups.map((g) => [g.label, g.amount])).toEqual([
      ['일반 지출', 147_945 + 93_699],
      ['대출 원금 상환', 30_000_000],
    ]);
    // 만기 뒤에는 이자 없음
    expect(pays(r, '2027-10-20', '2027-12-31')).toEqual([]);
  });

  test('7. 중도상환수수료처럼 조건부 비용은 예정 지출에서 제외', () => {
    const fee = pay({ kind: 'other', label: '중도상환수수료', amount: 300_000, frequency: 'one_time', dayOfMonth: null, startsOn: '2027-03-01', endsOn: null, obligation: 'conditional', isVariable: false });
    const r = loan({ payments: [pay({}), fee] });
    // 3월: 2월분 이자(28일) 138,082만 — 수수료 300,000은 넣지 않음
    expect(monthSpending([r], { year: 2027, month: 3 }, TODAY).total).toBe(138_082);
  });

  test('8. 계약 수정(금리 6% → 5%, 만기 연장) → 이자 일정이 다시 계산됨 (결제 id 그대로)', () => {
    const before = loan();
    const d = recordToDraft(before);
    const after = draftToRecord({ ...d, details: { ...d.details, interestRate: 5 } as ContractDraft['details'], endDate: '2027-12-19' }, 'loan', TODAY);
    expect(after.payments.map((p) => p.id)).toEqual(before.payments.map((p) => p.id));
    expect(pays(after, '2026-11-01', '2026-11-30')[0].amount).toBe(49_315);
    // 만기 12/19: 12월 1일~19일 19일분 78,082 (연 5%)
    expect(pays(after, '2027-12-19', '2027-12-19').map((p) => p.amount)).toContain(78_082);
  });
});

describe('계산 조건이 부족하면 확정 금액을 만들지 않음', () => {
  test('변동금리 → 지금 금리 기준 "예상" 이자', () => {
    const [first] = pays(loan({ details: { rateType: 'variable' } }), '2026-11-01', '2026-11-30');
    expect([first.amount, first.estimated]).toEqual([59_178, true]);
  });
  test('원리금균등·원금균등 → 계획 없음(확인 필요) · 저장된 금액은 예상으로만 · "이자 계산 조건 확인 필요"', () => {
    const r = loan({ details: { repaymentMethod: 'equal_payment' } });
    const plan = loanPlan(r);
    expect(plan.status).toBe('needs_check');
    const [x] = pays(r, '2026-11-01', '2026-11-30');
    expect([x.estimated, x.title.includes('이자 계산 조건 확인 필요')]).toEqual([true, true]);
  });
  test('계산 방식(일수 기준)을 모르면 확인 필요 항목으로 알려줌', () => {
    const plan = loanPlan(loan({ details: { interestDayCount: null } }));
    expect(plan.status === 'needs_check' && plan.missing).toEqual(['dayCount']);
  });
  test('AI가 추정만 한 금리는 계산에 쓰지 않음', () => {
    const r = loan();
    const plan = loanPlan({ ...r, contract: { ...r.contract, valueSources: { 'details.interestRate': 'inferred' } } });
    expect(plan.status === 'needs_check' && plan.missing).toContain('ratePct');
  });
});

describe('9. 예전 저장 데이터 — 자동으로 바꾸지 않고, 사용자가 확인하면 안전하게 정리', () => {
  const one = (o: Partial<PaymentDraft>) => pay({ frequency: 'one_time', dayOfMonth: null, endsOn: null, isVariable: false, ...o });
  const legacy = () =>
    loan({
      id: 'old',
      details: { principal: null },
      payments: [
        one({ kind: 'other', label: '대출 원금', amount: 30_000_000, startsOn: '2026-10-20' }),
        one({ label: '첫 이자', amount: 59_178, startsOn: '2026-11-10' }),
        one({ label: '11월분 이자', amount: 147_945, startsOn: '2026-12-10' }),
        one({ label: '12월분 이자', amount: 152_877, startsOn: '2027-01-10' }),
        one({ label: '만기 최종 이자', amount: 93_699, startsOn: '2027-10-19' }),
        one({ kind: 'loan_repayment', label: '원금 상환', amount: 30_000_000, startsOn: '2027-10-19' }),
      ],
    });

  test('점검: 실행금 1건 · 회차별 이자 4건을 찾음 (만기 원금 상환은 대상 아님) · 저장값은 그대로 두고 합계·일정에서만 뺌', () => {
    const r = legacy();
    const issues = loanLegacyIssues(r);
    expect(issues.disbursements.map((p) => p.label)).toEqual(['대출 원금']);
    expect(issues.interestRows.map((p) => p.amount)).toEqual([59_178, 147_945, 152_877, 93_699]);
    // 정리 전에도 실행금은 출금·입금 합계와 캘린더에 넣지 않음 (저장된 항목은 그대로 6건)
    expect(r.payments).toHaveLength(6);
    expect(monthSpending([r], { year: 2026, month: 10 }, TODAY).total).toBe(0);
    expect(pays(r, '2026-10-20', '2026-10-20')).toEqual([]);
  });

  test('입금으로 저장된 실행금도 같은 정책: 수입·입금 예정에 넣지 않음 · 정리 대상', () => {
    const r = loan({ payments: [one({ kind: 'other', label: '대출금 입금', amount: 30_000_000, startsOn: '2026-10-20', direction: 'income' }), pay({})] });
    expect(loanLegacyIssues(r).disbursements.map((p) => p.direction)).toEqual(['income']);
    expect(monthSpending([r], { year: 2026, month: 10 }, TODAY).incomeTotal).toBe(0);
  });

  test('실행일이 아닌 날의 같은 금액(예: 만기 원금 상환)은 실행금으로 보지 않음', () => {
    const r = loan();
    expect(loanLegacyIssues(r).disbursements).toEqual([]);
  });

  test('실행금 정리 → 그 결제만 지움 · 원금 정보 채움 · 금액은 참고로 보관 · 다른 결제 id 유지', () => {
    const r = legacy();
    const target = r.payments.find((p) => p.label === '대출 원금')!;
    const after = draftToRecord(fixLoanDisbursement(r, target.id), 'old', TODAY);
    expect(after.payments.map((p) => p.id)).toEqual(r.payments.filter((p) => p.id !== target.id).map((p) => p.id));
    expect((after.contract.details as Record<string, unknown>).principal).toBe(30_000_000);
    expect(after.contract.referenceAmounts).toContainEqual({ label: '대출 원금', amount: 30_000_000, role: 'reference' });
    expect(monthSpending([after], { year: 2026, month: 10 }, TODAY).total).toBe(0);
  });

  test('이자 합치기 → 이자 규칙 1건(첫 결제 id 유지 · 매월 10일 · 만기까지) · 원래 금액은 계약서 예시로 남아 계산과 모두 일치', () => {
    const r0 = legacy();
    const r = draftToRecord(fixLoanDisbursement(r0, r0.payments[0].id), 'old', TODAY);
    const rows = loanLegacyIssues(r).interestRows;
    const after = draftToRecord(mergeLoanInterest(r, rows.map((p) => p.id)), 'old', TODAY);
    const interest = after.payments.filter((p) => p.kind === 'interest');
    expect(interest).toHaveLength(1);
    expect(interest[0]).toMatchObject({ id: rows[0].id, frequency: 'monthly', dayOfMonth: 10, startsOn: '2026-11-10', endsOn: '2027-10-19' });
    expect(after.payments.filter((p) => p.kind === 'loan_repayment')).toHaveLength(1);
    const plan = loanPlan(after);
    expect(interestExamples(after, plan).map((e) => e.matched)).toEqual([true, true, true, true]);
    // 정리 후 같은 이자가 두 번 집계되지 않음
    expect(monthSpending([after], { year: 2026, month: 12 }, TODAY).total).toBe(147_945);
  });
});

describe('10. 다른 계약 종류에는 영향 없음', () => {
  test('대출이 아닌 계약의 "이자"·원금 이름 결제는 대출 규칙을 타지 않음', () => {
    const r = loan();
    const other = { ...r, contract: { ...r.contract, contractType: 'installment' as const } };
    expect(loanPlan(other).status).toBe('not_loan');
    expect(loanLegacyIssues(other)).toEqual({ disbursements: [], interestRows: [] });
  });
});
