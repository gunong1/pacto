/*
 * 반복 금액 변경 이력 — "현재 조건이 바뀌어도 과거가 자동으로 다시 쓰이지 않는다" (모든 값은 가짜)
 */
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';

import { detectAmountEdits, effectiveDateError, pastOccurrencesAffected, resolveAmountEdits } from '../amountEdits';
import { coreInfo } from '../coreInfo';
import { amountAt, amountVersions } from '../paymentAmount';
import { expandPayment, scheduleForRange } from '../schedule';
import { contractMonthlyPayments, monthSpending } from '../spending';
import type { ContractRecord, PaymentAmountChange } from '../types';

const TODAY = '2026-10-15';

const payment = (over: Partial<PaymentDraft>): PaymentDraft => ({
  kind: 'loan_repayment',
  direction: 'expense',
  label: '월 상환금',
  amount: 500_000,
  frequency: 'monthly',
  dayOfMonth: 12,
  monthOfYear: null,
  startsOn: '2026-01-12',
  endsOn: null,
  installmentCount: null,
  isVariable: false,
  components: [],
  businessDayRule: 'none',
  obligation: 'confirmed',
  conditionNote: null,
  ...over,
});

function record(draft: Partial<ContractDraft>, changes: Omit<PaymentAmountChange, 'paymentId' | 'createdAt' | 'changeReason' | 'sourceDocumentId'>[] = []): ContractRecord {
  const r = draftToRecord({ ...EMPTY_DRAFT, title: '테스트 계약', ...draft }, 'c1', TODAY);
  const p = r.payments[0];
  p.amountChanges = changes.map((c) => ({ ...c, paymentId: p.id, changeReason: null, sourceDocumentId: null, createdAt: '2026-10-01T00:00:00Z' }));
  return r;
}

const loan = (changes: Parameters<typeof record>[1] = []) =>
  record({ category: 'finance', contractType: 'loan', startDate: '2026-01-12', endDate: '2036-01-11', payments: [payment({})] }, changes);
const monthTotal = (r: ContractRecord, year: number, month: number) => monthSpending([r], { year, month }).total;
const monthIncome = (r: ContractRecord, year: number, month: number) => monthSpending([r], { year, month }).incomeTotal;

describe('amountAt — 그 날짜 이전(포함) 가장 최근 변경, 없으면 최초 금액', () => {
  const r = loan([
    { id: 'ch1', effectiveFrom: '2026-11-01', amount: 550_000 },
    { id: 'ch2', effectiveFrom: '2027-03-01', amount: 580_000 },
  ]);
  const p = r.payments[0];
  test.each([
    ['2026-10-31', 500_000],
    ['2026-11-01', 550_000],
    ['2027-02-28', 550_000],
    ['2027-03-01', 580_000],
  ])('%s → %d', (date, amount) => expect(amountAt(p, date)).toBe(amount));

  test('기간 목록 (effective_to = 다음 변경 전날, 저장하지 않고 계산)', () => {
    expect(amountVersions(p).map((v) => [v.from, v.to, v.amount])).toEqual([
      ['2026-01-12', '2026-10-31', 500_000],
      ['2026-11-01', '2027-02-28', 550_000],
      ['2027-03-01', null, 580_000],
    ]);
  });

  test('변경 이력 순서가 섞여 있어도 적용일 순으로', () => {
    const shuffled = { ...p, amountChanges: [...(p.amountChanges ?? [])].reverse() };
    expect(amountAt(shuffled, '2027-01-01')).toBe(550_000);
  });
});

describe('대출 상환금 500,000 → 2026-11-01부터 550,000', () => {
  const r = loan([{ id: 'ch1', effectiveFrom: '2026-11-01', amount: 550_000 }]);
  test('9·10월은 그대로 500,000 / 11·12월은 550,000 (캘린더·지출 같은 기준)', () => {
    expect([9, 10, 11, 12].map((m) => monthTotal(r, 2026, m))).toEqual([500_000, 500_000, 550_000, 550_000]);
    const items = scheduleForRange([r], { start: '2026-09-01', end: '2026-12-31' }, TODAY).filter((i) => i.type === 'payment');
    expect(items.map((i) => [i.date, i.amount])).toEqual([
      ['2026-09-12', 500_000],
      ['2026-10-12', 500_000],
      ['2026-11-12', 550_000],
      ['2026-12-12', 550_000],
    ]);
  });
  test('변경 이력이 없으면 지금과 똑같다 (기존 계약 영향 없음)', () => {
    expect([9, 10, 11].map((m) => monthTotal(loan(), 2026, m))).toEqual([500_000, 500_000, 500_000]);
  });
  test('상세·목록의 현재 금액 = 오늘 적용 중인 금액', () => {
    expect(contractMonthlyPayments(r, '2026-10-15')).toBe(500_000);
    expect(contractMonthlyPayments(r, '2026-11-01')).toBe(550_000);
    expect(coreInfo(r, '2026-11-20').find((x) => x.key.startsWith('pay:'))?.value).toContain('550,000');
  });
});

describe('근로소득 3,000,000 → 2027-01-01부터 3,300,000 (수입도 같은 구조)', () => {
  const salary = (changes: Parameters<typeof record>[1], details: ContractDraft['details'] = {}) =>
    record(
      {
        category: 'employment',
        contractType: 'employment',
        startDate: '2026-03-01',
        details,
        payments: [payment({ kind: 'salary', direction: 'income', label: '월 급여', amount: 3_000_000, dayOfMonth: 25, startsOn: '2026-03-01' })],
      },
      changes,
    );
  test('과거 수입 일정은 3,000,000 유지, 적용일 이후만 3,300,000', () => {
    const r = salary([{ id: 's1', effectiveFrom: '2027-01-01', amount: 3_300_000 }]);
    expect(monthIncome(r, 2026, 12)).toBe(3_000_000);
    expect(monthIncome(r, 2027, 1)).toBe(3_300_000);
    expect(monthIncome(r, 2027, 6)).toBe(3_300_000);
  });
  test('수습 90%: 먼저 amountAt으로 기준 급여, 그다음 90% (3,300,000 → 2,970,000)', () => {
    // 수습기간 2026-03-01 ~ 2026-05-31, 2026-04-01부터 기준 급여 3,300,000
    const r = salary([{ id: 's1', effectiveFrom: '2026-04-01', amount: 3_300_000 }], { probationMonths: 3, probationPayRate: 90 });
    expect(monthIncome(r, 2026, 3)).toBe(2_700_000);
    expect(monthIncome(r, 2026, 4)).toBe(2_970_000);
    expect(monthIncome(r, 2026, 6)).toBe(3_300_000);
  });
});

describe('주기·회차는 금액 변경과 무관하게 유지', () => {
  test('연납 보험료: 기준 월 그대로, 변경 후 회차만 새 금액', () => {
    const r = record({ category: 'insurance', contractType: 'insurance', startDate: '2025-06-22', payments: [payment({ kind: 'premium', label: '연간 보험료', amount: 1_000_000, frequency: 'yearly', dayOfMonth: 22, startsOn: '2025-06-22' })] }, [
      { id: 'y1', effectiveFrom: '2026-07-01', amount: 1_084_630 },
    ]);
    expect(monthTotal(r, 2026, 6)).toBe(1_000_000);
    expect(monthTotal(r, 2027, 6)).toBe(1_084_630);
    expect(monthTotal(r, 2027, 7)).toBe(0);
  });
  test('회차 대출: 회차 번호와 마지막 회차가 그대로', () => {
    const r = record({ category: 'finance', contractType: 'loan', startDate: '2026-01-12', payments: [payment({ installmentCount: 12 })] }, [{ id: 'l1', effectiveFrom: '2026-07-01', amount: 550_000 }]);
    const occ = expandPayment(r.payments[0], r.contract, { start: '2026-01-01', end: '2027-12-31' });
    expect(occ).toHaveLength(12);
    expect(occ.map((o) => o.installment?.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(occ.map((o) => o.amount)).toEqual([...Array(6).fill(500_000), ...Array(6).fill(550_000)]);
  });
});

describe('수정 화면: 언제부터 바뀌는지 받는다', () => {
  const r = loan();
  const id = r.payments[0].id;
  const edited = (amount: number) => [{ id, amount, frequency: 'monthly' as const }];

  test('금액을 바꾸면 확인 대상 (다음 결제일 = 2026-11-12)', () => {
    const [e] = detectAmountEdits(r, edited(550_000), TODAY);
    expect(e).toMatchObject({ paymentId: id, from: 500_000, to: 550_000, nextDate: '2026-11-12', current: null });
  });
  test('금액 그대로면 확인 없음', () => {
    expect(detectAmountEdits(r, edited(500_000), TODAY)).toEqual([]);
  });
  test('다음 결제일부터 → 최초 금액 유지 + 변경 이력 추가 (과거 보존)', () => {
    const { payments, ops } = resolveAmountEdits(r, edited(550_000), TODAY, { [id]: { kind: 'next' } });
    expect(payments[0].amount).toBe(500_000);
    expect(ops).toEqual([{ op: 'add', paymentId: id, effectiveFrom: '2026-11-12', amount: 550_000 }]);
  });
  test('적용 날짜 직접 선택 (미래)', () => {
    const { ops } = resolveAmountEdits(r, edited(550_000), TODAY, { [id]: { kind: 'date', date: '2026-11-01' } });
    expect(ops).toEqual([{ op: 'add', paymentId: id, effectiveFrom: '2026-11-01', amount: 550_000 }]);
    expect(pastOccurrencesAffected(r, id, '2026-11-01', TODAY)).toBe(0);
  });
  test('과거 적용일 → 바뀌는 지난 일정 수 (2026-09-01부터면 9/12·10/12 2건)', () => {
    expect(pastOccurrencesAffected(r, id, '2026-09-01', TODAY)).toBe(2);
  });
  test('결제 시작일 이전·당일은 적용일로 쓸 수 없다', () => {
    const [e] = detectAmountEdits(r, edited(550_000), TODAY);
    expect(effectiveDateError(e, '2026-01-12')).not.toBeNull();
    expect(effectiveDateError(e, '2026-01-13')).toBeNull();
  });
  test('처음부터 이 금액이었어요 → 이력 없이 최초 금액 자체를 정정', () => {
    const { payments, ops } = resolveAmountEdits(r, edited(5_000_000), TODAY, { [id]: { kind: 'correct' } });
    expect(payments[0].amount).toBe(5_000_000);
    expect(ops).toEqual([]);
  });
  test('적용 중인 변경이 있으면 정정은 그 변경의 금액만 고친다 (최초 금액·다른 이력 보존)', () => {
    const r2 = loan([
      { id: 'ch1', effectiveFrom: '2026-09-01', amount: 550_000 },
      { id: 'ch2', effectiveFrom: '2027-03-01', amount: 580_000 },
    ]);
    const [e] = detectAmountEdits(r2, edited(555_000), TODAY);
    expect(e).toMatchObject({ from: 550_000, current: { id: 'ch1' }, upcoming: [{ id: 'ch2' }] });
    const { payments, ops } = resolveAmountEdits(r2, edited(555_000), TODAY, { [id]: { kind: 'correct' } });
    expect(payments[0].amount).toBe(500_000);
    expect(ops).toEqual([{ op: 'correct', changeId: 'ch1', amount: 555_000 }]);
  });
  test('수정 화면은 현재 금액을 보여줌 → 금액을 그대로 두고 다른 항목만 고치면 최초 금액으로 저장 (과거 불변)', () => {
    const r2 = loan([{ id: 'ch1', effectiveFrom: '2026-09-01', amount: 550_000 }]);
    expect(detectAmountEdits(r2, edited(550_000), TODAY)).toEqual([]);
    const { payments, ops } = resolveAmountEdits(r2, edited(550_000), TODAY, {});
    expect(payments[0].amount).toBe(500_000);
    expect(ops).toEqual([]);
  });
  test('아직 결제가 한 번도 없는 결제는 확인 없이 최초 금액을 고친다 (바뀔 과거가 없음)', () => {
    const fresh = record({ startDate: '2026-11-01', payments: [payment({ startsOn: '2026-11-12' })] });
    const fid = fresh.payments[0].id;
    expect(detectAmountEdits(fresh, [{ id: fid, amount: 550_000, frequency: 'monthly' }], TODAY)).toEqual([]);
    expect(resolveAmountEdits(fresh, [{ id: fid, amount: 550_000, frequency: 'monthly' }], TODAY, {}).payments[0].amount).toBe(550_000);
  });
  test('일시불·새 결제는 대상 아님', () => {
    const one = record({ payments: [payment({ frequency: 'one_time', startsOn: '2026-01-12' })] });
    expect(detectAmountEdits(one, [{ id: one.payments[0].id, amount: 1, frequency: 'one_time' }], TODAY)).toEqual([]);
    expect(detectAmountEdits(r, [{ id: null, amount: 1, frequency: 'monthly' }], TODAY)).toEqual([]);
  });
});
