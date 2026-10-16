/**
 * 근로계약 급여 구성·확정 급여 검증·첫/마지막 급여 일할 계산 (payroll.ts + schedule·spending 연동). 모든 값은 가짜
 * 지급 유형 분류는 지급 예측·현금흐름용 — 통상임금·과세 판정이 아니다.
 */
import { confirmComponentPay, draftToRecord, EMPTY_DRAFT, recordToDraft, setComponentStatus } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';
import { draftToForm, paymentFromForm } from '@/features/contracts/form';

import { adjustToBusinessDay } from '../businessDays';
import { withConfirmedRole } from '../cashflow';
import { prorationPlan, roundWon, salaryBreakdown, variableAmount } from '../payroll';
import { FIRST_PAYMENT_CHECK, scheduleForRange } from '../schedule';
import { monthSpending } from '../spending';
import type { ContractRecord, PaymentComponent, SourceType } from '../types';

const TODAY = '2026-10-13';
const fixed = (label: string, amount: number, o: Partial<PaymentComponent> = {}): PaymentComponent => ({ label, amount, pay: 'fixed', amountKind: 'exact', ...o });
const bonusMax = (o: Partial<PaymentComponent> = {}): PaymentComponent => ({ label: '성과급', amount: 1_000_000, pay: 'conditional', amountKind: 'max', condition: '분기 목표 달성 시', status: 'pending', ...o });

const salary = (o: Partial<PaymentDraft> = {}): PaymentDraft => ({
  kind: 'salary',
  direction: 'neutral',
  label: '월 급여',
  amount: 3_200_000,
  frequency: 'monthly',
  dayOfMonth: 10,
  monthOfYear: null,
  startsOn: '2026-10-25',
  endsOn: null,
  installmentCount: null,
  isVariable: false,
  components: [],
  businessDayRule: 'none',
  obligation: 'confirmed',
  conditionNote: null,
  moneyNature: 'ordinary',
  ...o,
});
const RULES = { payPeriodStartDay: 1, payTiming: 'next_month', prorationBasis: 'calendar_days' };
const job = (o: { payment?: Partial<PaymentDraft>; details?: Record<string, unknown>; sources?: Record<string, SourceType>; end?: string | null; role?: boolean } = {}): ContractRecord => {
  const draft: ContractDraft = {
    ...EMPTY_DRAFT,
    title: '근로계약서',
    category: 'employment',
    contractType: 'employment',
    contractKind: 'employment',
    startDate: '2026-10-25',
    endDate: o.end === undefined ? null : o.end,
    details: (o.details ?? {}) as ContractDraft['details'],
    valueSources: o.sources ?? {},
    parties: [
      { role: 'employer', name: '가상회사' },
      { role: 'employee', name: '홍길동' },
    ],
    payments: [salary(o.payment)],
  };
  return draftToRecord(o.role === false ? draft : withConfirmedRole(draft, 'employee'), 'job', TODAY);
};
const income = (r: ContractRecord, month: number, year = 2026) => monthSpending([r], { year, month }, TODAY);
const pays = (r: ContractRecord, start: string, end: string) => scheduleForRange([r], { start, end }, TODAY).filter((i) => i.type === 'payment');

describe('급여 구성항목과 확정 급여 검증', () => {
  test('1. 기본급만: 확정 급여 = 기본급, 정상', () => {
    const b = salaryBreakdown({ amount: 3_200_000, components: [fixed('기본급', 3_200_000)] });
    expect([b.check, b.fixedTotal, b.extra.length, b.maxWithConditional]).toEqual(['match', 3_200_000, 0, null]);
  });

  test('2. 기본급 + 고정 직무수당: 확정 급여 3,200,000 정상', () => {
    const b = salaryBreakdown({ amount: 3_200_000, components: [fixed('기본급', 2_800_000), fixed('고정 직무수당', 400_000)] });
    expect([b.check, b.fixedTotal]).toEqual(['match', 3_200_000]);
  });

  test('3. 기본급 280만 + 고정수당 40만 + 조건부 성과급 최대 100만: 경고 없음 · 확정 320만 · 성과급 전액 시 예시 420만 · 확정 수입은 320만', () => {
    const comps = [fixed('기본급', 2_800_000), fixed('고정 직무수당', 400_000), bonusMax()];
    const b = salaryBreakdown({ amount: 3_200_000, components: comps });
    expect([b.check, b.fixedTotal, b.extra.map((c) => c.label), b.maxWithConditional]).toEqual(['match', 3_200_000, ['성과급'], 4_200_000]);
    const r = job({ payment: { components: comps, startsOn: '2026-10-01' } });
    expect(income(r, 11).incomeTotal).toBe(3_200_000);
  });

  test('3-1. 같은 사례의 예전 데이터(유형 없음): 합계 420만 ≠ 320만이어도 "불일치"로 단정하지 않고 유형 확인 요청', () => {
    const b = salaryBreakdown({ amount: 3_200_000, components: [{ label: '기본급', amount: 2_800_000 }, { label: '직무수당', amount: 400_000 }, { label: '성과급', amount: 1_000_000 }] });
    expect(b.check).toBe('needs_classification');
  });

  test('확정 항목 합계 자체가 다르면 불일치 (조건부 항목과 무관)', () => {
    expect(salaryBreakdown({ amount: 3_200_000, components: [fixed('기본급', 2_700_000), fixed('직무수당', 400_000), bonusMax()] }).check).toBe('mismatch');
  });

  test('범위·상한 금액은 고정 항목이어도 확정 금액으로 쓰지 않음', () => {
    const b = salaryBreakdown({ amount: 2_800_000, components: [fixed('기본급', 2_800_000), fixed('식대', 200_000, { amountKind: 'max' })] });
    expect([b.check, b.fixedTotal, b.extra.map((c) => c.label)]).toEqual(['match', 2_800_000, ['식대']]);
  });

  test('4. 조건부 성과급 지급 확정: 입력한 실제 금액으로 그날 1회 수입 · 같은 항목 두 번 확정 불가', () => {
    const r = job({ payment: { components: [fixed('기본급', 2_800_000), fixed('고정 직무수당', 400_000), bonusMax()], startsOn: '2026-10-01' } });
    const d = confirmComponentPay(r, r.payments[0].id, 2, { date: '2026-12-31', amount: 800_000 });
    const after = draftToRecord(d, 'job', TODAY);
    expect(after.payments[0].components[2].status).toBe('confirmed');
    expect(after.payments.filter((p) => p.kind === 'bonus').map((p) => [p.amount, p.startsOn, p.direction])).toEqual([[800_000, '2026-12-31', 'income']]);
    expect(income(after, 12).incomeTotal).toBe(3_200_000 + 800_000);
    expect(() => confirmComponentPay(after, after.payments[0].id, 2, { date: '2026-12-31', amount: 800_000 })).toThrow('이미 지급 확정');
  });

  test('5. 조건부 성과급 지급 제외: 예시 금액에서도 빠지고 수입 변화 없음', () => {
    const r = job({ payment: { components: [fixed('기본급', 2_800_000), fixed('고정 직무수당', 400_000), bonusMax()], startsOn: '2026-10-01' } });
    const after = draftToRecord(setComponentStatus(r, r.payments[0].id, 2, 'excluded'), 'job', TODAY);
    expect(salaryBreakdown(after.payments[0]).maxWithConditional).toBeNull();
    expect(income(after, 11).incomeTotal).toBe(3_200_000);
  });

  test('6. 월 급여가 성과급 포함 총액인지 불명확 (확정 합계 280만 + 조건부 40만 = 계약 금액 320만) → 사용자 확인 요청', () => {
    const b = salaryBreakdown({ amount: 3_200_000, components: [fixed('기본급', 2_800_000), { label: '성과급', amount: 400_000, pay: 'conditional', amountKind: 'exact', status: 'needs_check' }] });
    expect(b.check).toBe('includes_conditional');
  });

  test('7. 연장근로수당이 있으나 실제 근무시간이 없음 → 금액을 계산하지 않음 (확정 급여에도 넣지 않음)', () => {
    const ot: PaymentComponent = { label: '연장근로수당', amount: 0, pay: 'variable', calc: { unitAmount: 15_000, quantity: null, ratePct: 150 } };
    expect(variableAmount(ot)).toBeNull();
    const b = salaryBreakdown({ amount: 3_200_000, components: [fixed('기본급', 3_200_000), ot] });
    expect([b.check, b.fixedTotal, b.extra.map((c) => c.label)]).toEqual(['match', 3_200_000, ['연장근로수당']]);
  });

  test('8. 변동수당 자료가 모두 있으면 계산: 15,000 × 10.5시간 × 150% = 236,250 (정수 연산)', () => {
    expect(variableAmount({ calc: { unitAmount: 15_000, quantity: 10.5, ratePct: 150 } })).toBe(236_250);
    expect(variableAmount({ calc: { unitAmount: 9_860, quantity: 3, ratePct: 50 } })).toBe(14_790);
  });
});

describe('중도 입사 첫 급여 (확인된 규정으로만)', () => {
  test('9. 10/25 입사 · 1일~말일 · 다음 달 10일 · 달력 일수 → 11/10 첫 급여 722,581원 (3,200,000 × 7/31) · 10월 지급 없음', () => {
    const r = job({ details: RULES });
    const plan = prorationPlan(r, r.payments[0]);
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    expect(plan.first).toMatchObject({ period: { from: '2026-10-01', to: '2026-10-31' }, days: 7, periodDays: 31, payDate: '2026-11-10', total: 722_581, roundingAssumed: true });
    // 원 단위 처리는 고르지 않음 — 공통 반올림 (안내 문구 없음)
    expect(plan.notes.join(' ')).not.toContain('원 단위');
    expect(pays(r, '2026-10-01', '2026-12-31').map((i) => [i.date, i.amount])).toEqual([
      ['2026-11-10', 722_581],
      ['2026-12-10', 3_200_000],
    ]);
    expect(pays(r, '2026-11-01', '2026-11-30')[0].title).toBe('첫 급여 · 10월 25일~31일 근무분');
    // 급여 발생월(10월)이 아니라 지급월(11월) 수입
    expect([income(r, 10).incomeTotal, income(r, 11).incomeTotal, income(r, 12).incomeTotal]).toEqual([0, 722_581, 3_200_000]);
  });

  test('원 단위 처리 옵션 제거: 예전에 저장된 버림 규정이 있어도 공통 반올림 722,581 (저장값은 그대로)', () => {
    expect(roundWon(3_200_000 * 7, 31, 'floor_1')).toBe(722_580);
    expect(roundWon(3_200_000 * 7, 31, null)).toBe(722_581);
    const r = job({ details: { ...RULES, payRounding: 'floor_1' } });
    expect(pays(r, '2026-11-01', '2026-11-30')[0].amount).toBe(722_581);
    expect(r.contract.details.payRounding).toBe('floor_1');
  });

  test('10. 항목별 규정이 다름: 기본급 일할 + 고정수당 첫 달 전액 → 632,258 + 400,000 = 1,032,258', () => {
    const r = job({ details: RULES, payment: { components: [fixed('기본급', 2_800_000), fixed('고정 직무수당', 400_000, { prorate: 'full' }), bonusMax()] } });
    const plan = prorationPlan(r, r.payments[0]);
    if (plan.status !== 'ready') throw new Error(plan.status);
    expect(plan.first!.lines.map((l) => [l.label, l.method, l.amount])).toEqual([
      ['기본급', 'daily', 632_258],
      ['고정 직무수당', 'full', 400_000],
    ]);
    expect(plan.first!.total).toBe(1_032_258);
  });

  test('일할 계산 기준이 다름: 전액 지급 규정 → 첫 급여 전액 · 소정근로일수 → 자동 계산하지 않음', () => {
    expect(pays(job({ details: { ...RULES, prorationBasis: 'none' } }), '2026-11-01', '2026-11-30')[0].amount).toBe(3_200_000);
    const wd = job({ details: { ...RULES, prorationBasis: 'scheduled_workdays' } });
    expect(prorationPlan(wd, wd.payments[0])).toMatchObject({ status: 'needs_rules', reason: expect.stringContaining('소정근로일수') });
  });

  test('산정기간이 21일~다음 달 20일 · 지급은 같은 달 25일: 10/25 입사 → 산정기간 10/21~11/20 · 27/31일 · 11/25 지급', () => {
    const r = job({ details: { payPeriodStartDay: 21, payTiming: 'same_month', prorationBasis: 'calendar_days', payRounding: 'floor_1' }, payment: { dayOfMonth: 25 } });
    const plan = prorationPlan(r, r.payments[0]);
    if (plan.status !== 'ready') throw new Error(plan.status);
    expect(plan.first).toMatchObject({ period: { from: '2026-10-21', to: '2026-11-20' }, days: 27, periodDays: 31, payDate: '2026-11-25', total: 2_787_097 });
  });

  test('중도 퇴사: 종료일 2027-01-15 → 마지막 급여 2/10에 15/31일 · 그 뒤 지급 없음', () => {
    const r = job({ details: RULES, end: '2027-01-15' });
    expect(pays(r, '2027-01-01', '2027-03-31').map((i) => [i.date, i.amount])).toEqual([
      ['2027-01-10', 3_200_000],
      ['2027-02-10', 1_548_387],
    ]);
  });

  test('11. 지급일이 휴일: 직전 영업일 규정이면 실제 지급일을 앞당김 (금액은 그대로)', () => {
    const r = job({ details: RULES, payment: { dayOfMonth: 15, businessDayRule: 'previous' } });
    const nov = pays(r, '2026-11-01', '2026-11-30');
    expect(nov.map((i) => [i.date, i.amount])).toEqual([[adjustToBusinessDay('2026-11-15', 'previous'), 722_581]]);
    expect(nov[0].date).not.toBe('2026-11-15'); // 2026-11-15는 일요일
  });

  test('12. 급여 산정기간이 없음 → 매월 1일~말일(기본)로 계산 + 안내 · 지급 시기가 없으면 확인 필요', () => {
    const r = job({ details: { payTiming: 'next_month', prorationBasis: 'calendar_days' } });
    const plan = prorationPlan(r, r.payments[0]);
    expect(plan).toMatchObject({ status: 'ready', notes: expect.arrayContaining(['급여 산정기간을 정하지 않아 매월 1일~말일로 계산했어요']) });
    const first = pays(r, '2026-10-01', '2026-11-30')[0];
    expect([first.date, first.amount]).toEqual(['2026-11-10', 722_581]);
    const noTiming = job({ details: { prorationBasis: 'calendar_days' } });
    expect(prorationPlan(noTiming, noTiming.payments[0])).toMatchObject({ status: 'needs_rules', missing: ['timing'] });
    const f2 = pays(noTiming, '2026-10-01', '2026-11-30')[0];
    expect([f2.date, f2.amount]).toEqual(['2026-11-10', 3_200_000]);
    expect(f2.title).toContain(FIRST_PAYMENT_CHECK);
  });

  test('AI가 추정만 한 규정(inferred)은 쓰지 않음 → 사용자가 확인(user_confirmed)하면 적용', () => {
    const src = (s: SourceType) => ({ 'details.payPeriodStartDay': s, 'details.payTiming': s, 'details.prorationBasis': s });
    const guessed = job({ details: RULES, sources: src('inferred') });
    expect(prorationPlan(guessed, guessed.payments[0])).toMatchObject({ status: 'needs_rules', missing: ['timing', 'basis'] });
    const confirmed = job({ details: RULES, sources: src('user_confirmed') });
    expect(prorationPlan(confirmed, confirmed.payments[0]).status).toBe('ready');
  });

  test('13. 근로자·사용자 역할 미확정: 첫 급여도 방향 확인 필요 — 수입 합계에 넣지 않음', () => {
    const r = job({ details: RULES, role: false });
    const nov = income(r, 11);
    expect([nov.incomeTotal, nov.undeterminedTotal]).toEqual([0, 722_581]);
  });
});

describe('저장·중복·호환', () => {
  test('14. 사용자가 정한 구성항목 값(유형·상태·일할)은 수정 화면을 거쳐 다시 저장해도 그대로', () => {
    const comps = [fixed('기본급', 2_800_000), fixed('고정 직무수당', 400_000, { prorate: 'full' }), bonusMax({ status: 'excluded' })];
    const r = job({ details: RULES, payment: { components: comps } });
    const resaved = draftToForm(recordToDraft(r)).payments.map((p) => paymentFromForm(p));
    expect(resaved[0].components).toEqual(comps);
  });

  test('15. 중복 없음: 구성항목·일할 계산으로 급여 일정이 늘지 않음 (월 1회) · 성과급 확정도 1건만', () => {
    const r = job({ details: RULES, payment: { components: [fixed('기본급', 2_800_000), fixed('고정 직무수당', 400_000), bonusMax()] } });
    for (const m of ['11', '12']) expect(pays(r, `2026-${m}-01`, `2026-${m}-${m === '11' ? 30 : 31}`)).toHaveLength(1);
    expect(income(r, 12).incomeTotal).toBe(3_200_000); // 구성항목을 따로 더하지 않음 (280만 + 40만 + 320만 아님)
  });

  test('16. 세전 금액 그대로 — 공제액을 모르면 실수령액을 추정하지 않음 (수입 = 계약상 세전 금액)', () => {
    const r = job({ details: RULES });
    expect(income(r, 12).incomeItems.map((i) => i.amount)).toEqual([3_200_000]);
  });

  test('17. 예전 근로계약(규정·유형 없음): 일정·금액이 이전과 같음 (월 급여 그대로 + 첫 지급일 확인 필요)', () => {
    const r = job({ payment: { components: [{ label: '기본급', amount: 2_800_000 }, { label: '직무수당', amount: 400_000 }] } });
    expect(salaryBreakdown(r.payments[0]).check).toBe('match');
    expect(prorationPlan(r, r.payments[0]).status).toBe('needs_rules');
    expect(pays(r, '2026-10-01', '2026-12-31').map((i) => [i.date, i.amount])).toEqual([
      ['2026-11-10', 3_200_000],
      ['2026-12-10', 3_200_000],
    ]);
  });
});
