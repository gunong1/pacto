/**
 * 시급제 주휴수당 간편 계산 (src/domain/payBasis.ts weeklyPay) — 계약 기반 예상 수입. 모든 값은 가짜 (시급 10,030원)
 * 주휴수당 = 시급 × min(8, 주 소정근로시간 ÷ 5) · 주 15시간 이상 + 사용자가 "포함"을 고른 경우만
 * 예상 월 수입 = (주 기본급 + 주휴수당) × 365 ÷ 12 ÷ 7 (월평균 추정)
 */
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import { contractFormSchema, draftToForm, draftToQuickForm, formToDraft, quickDirectionAdvice, type ContractFormValues } from '@/features/contracts/form';

import { detailSchema, type ContractDetails } from '../contractTypes';
import { monthlyPayEstimate, WEEKS_PER_MONTH, weeklyPay } from '../payBasis';
import { scheduleForRange } from '../schedule';
import { monthSpending } from '../spending';

const TODAY = '2026-10-15';
const hourly = (daily: number, days: number, holiday?: 'included' | 'excluded' | 'in_wage'): ContractDetails => ({
  payBasis: 'hourly',
  hourlyWage: 10_030,
  dailyWorkHours: daily,
  weeklyWorkDays: days,
  ...(holiday ? { weeklyHolidayPay: holiday } : {}),
});
const monthly = (weeklyTotal: number) => Math.round(weeklyTotal * WEEKS_PER_MONTH);

describe('주 소정근로시간별 주휴수당 (포함 선택)', () => {
  test('주 40시간 (8시간 × 5일): 주 기본급 401,200 + 주휴 8시간분 80,240 = 481,440 → 월 2,091,971', () => {
    const w = weeklyPay(hourly(8, 5, 'included'))!;
    expect(w).toMatchObject({ hours: 40, base: 401_200, holiday: { status: 'added', amount: 80_240, hours: 8 }, total: 481_440 });
    expect(monthlyPayEstimate(hourly(8, 5, 'included'))).toMatchObject({ amount: 2_091_971, formula: '주 예상 급여 481,440원 × 월평균 4.345주' });
    expect(monthly(481_440)).toBe(2_091_971);
  });

  test('주 20시간 (4시간 × 5일): 200,600 + 주휴 4시간분 40,120 = 240,720 → 월 1,045,986', () => {
    expect(weeklyPay(hourly(4, 5, 'included'))).toMatchObject({ hours: 20, base: 200_600, holiday: { status: 'added', amount: 40_120, hours: 4 }, total: 240_720 });
    expect(monthlyPayEstimate(hourly(4, 5, 'included'))?.amount).toBe(1_045_986);
  });

  test('주 15시간 (3시간 × 5일) — 경계값 포함: 150,450 + 주휴 3시간분 30,090 = 180,540 → 월 784,489', () => {
    expect(weeklyPay(hourly(3, 5, 'included'))).toMatchObject({ hours: 15, base: 150_450, holiday: { status: 'added', amount: 30_090, hours: 3 }, total: 180_540 });
    expect(monthlyPayEstimate(hourly(3, 5, 'included'))?.amount).toBe(784_489);
    // 주 15시간이 다른 요일 구성이어도 같은 기준 (5시간 × 3일 → 15 ÷ 5 = 3시간분)
    expect(weeklyPay(hourly(5, 3, 'included'))?.holiday).toMatchObject({ status: 'added', amount: 30_090, hours: 3 });
  });

  test('주 14시간 (3.5시간 × 4일): 15시간 미만 → 주휴수당 계산 안 함 + 조건 확인 안내, 기본급만', () => {
    const w = weeklyPay(hourly(3.5, 4, 'included'))!;
    expect(w).toMatchObject({ hours: 14, base: 140_420, holiday: { status: 'below_15', amount: 0, hours: null }, total: 140_420 });
    expect(w.holiday.note).toContain('15시간 미만');
    expect(monthlyPayEstimate(hourly(3.5, 4, 'included'))?.amount).toBe(monthly(140_420));
  });
});

describe('포함 / 제외 전환 · 중복 가산 방지', () => {
  test('같은 근로조건에서 포함 ↔ 제외 ↔ 시급에 이미 포함 → 주휴수당만 더하거나 빠짐 (기본급은 그대로, 한 번만 합산)', () => {
    const inc = weeklyPay(hourly(4, 5, 'included'))!;
    const exc = weeklyPay(hourly(4, 5, 'excluded'))!;
    const inWage = weeklyPay(hourly(4, 5, 'in_wage'))!;
    const none = weeklyPay(hourly(4, 5))!;
    expect(inc.total - exc.total).toBe(inc.holiday.amount);
    expect([exc.base, inWage.base, none.base]).toEqual([inc.base, inc.base, inc.base]);
    expect([exc.holiday.status, inWage.holiday.status, none.holiday.status]).toEqual(['excluded', 'in_wage', 'not_selected']);
    expect([exc.total, inWage.total, none.total]).toEqual([200_600, 200_600, 200_600]);
    expect(inWage.holiday.note).toContain('따로 더하지 않았어요');
    expect(monthlyPayEstimate(hourly(4, 5, 'excluded'))?.amount).toBe(871_655);
  });

  test('월급제·일급제·연봉제에는 주휴수당을 더하지 않는다 (포함을 골라 두었어도)', () => {
    expect(weeklyPay({ ...hourly(8, 5, 'included'), payBasis: 'monthly' })).toBeNull();
    expect(monthlyPayEstimate({ ...hourly(8, 5, 'included'), payBasis: 'monthly' })).toBeNull();
    expect(weeklyPay({ payBasis: 'daily', dailyWage: 120_000, monthlyWorkDays: 20, weeklyHolidayPay: 'included' })).toBeNull();
    expect(monthlyPayEstimate({ payBasis: 'daily', dailyWage: 120_000, monthlyWorkDays: 20, weeklyHolidayPay: 'included' })?.amount).toBe(2_400_000);
  });

  test('예외는 확정하지 않음: 하루 8시간 초과 · 주 40시간 초과 · 주 7일 → 확인 필요 (주휴수당 0)', () => {
    for (const [daily, days] of [[10, 4], [8, 6], [3, 7]] as const) {
      const w = weeklyPay(hourly(daily, days, 'included'))!;
      expect(w.holiday).toMatchObject({ status: 'needs_check', amount: 0 });
      expect(w.total).toBe(w.base);
    }
  });

  test('예전 시급제 계약(주 근무일수 없이 월 예상 근무일수) → 예전 계산 그대로, 주휴수당 없음', () => {
    const legacy = { payBasis: 'hourly', hourlyWage: 10_030, dailyWorkHours: 8, monthlyWorkDays: 22, weeklyHolidayPay: 'included' };
    expect(weeklyPay(legacy)).toBeNull();
    expect(monthlyPayEstimate(legacy)?.amount).toBe(1_765_280);
    // 주 근무일수를 넣으면 주 단위 계산으로
    expect(monthlyPayEstimate({ ...legacy, weeklyWorkDays: 5 })?.amount).toBe(2_091_971);
  });

  test('주 근무일수는 0~7 (소수 허용)', () => {
    const s = detailSchema('employment');
    expect(s.safeParse({ weeklyWorkDays: 5.5, weeklyHolidayPay: 'in_wage' }).success).toBe(true);
    expect(s.safeParse({ weeklyWorkDays: 7.5 }).success).toBe(false);
    expect(s.safeParse({ weeklyHolidayPay: 'yes' }).success).toBe(false);
  });
});

describe('저장 · 수정 · 계약 상세 · 수입 집계 — 같은 계산', () => {
  const form = (details: Record<string, string>, amount: string): ContractFormValues => {
    const v = draftToForm({ ...EMPTY_DRAFT, contractKind: 'employment', contractType: 'employment', title: '편의점 아르바이트', startDate: '2026-10-01' });
    return { ...v, details: { ...v.details, ...details }, quick: { amount, direction: quickDirectionAdvice('employment').direction, frequency: 'monthly', day: '10', nextDate: '' } };
  };
  const save = (v: ContractFormValues) => formToDraft(contractFormSchema.parse(v), TODAY);
  const base = { payBasis: 'hourly', hourlyWage: '10,030', dailyWorkHours: '4', weeklyWorkDays: '5' };

  test('저장: 주 근무일수·주휴수당 선택이 그대로 보관되고 급여 금액 = 예상 월 수입(변동)', () => {
    const d = save(form({ ...base, weeklyHolidayPay: 'included' }, '1,045,986'));
    expect(d.details).toMatchObject({ payBasis: 'hourly', hourlyWage: 10_030, dailyWorkHours: 4, weeklyWorkDays: 5, weeklyHolidayPay: 'included' });
    expect(d.payments[0]).toMatchObject({ kind: 'salary', amount: 1_045_986, isVariable: true });
  });

  test('수정: 다시 열면 같은 값 · 제외로 바꿔 저장하면 선택만 바뀜', () => {
    const d = save(form({ ...base, weeklyHolidayPay: 'included' }, '1,045,986'));
    const edit = draftToQuickForm({ ...d, payments: d.payments.map((p) => ({ ...p, id: 'p0' })) });
    expect(edit.details).toMatchObject({ weeklyWorkDays: '5', weeklyHolidayPay: 'included' });
    const off = formToDraft(contractFormSchema.parse({ ...edit, details: { ...edit.details, weeklyHolidayPay: 'excluded' }, quick: { ...edit.quick!, amount: '871,655' } }), TODAY);
    expect(off.details.weeklyHolidayPay).toBe('excluded');
    expect(off.payments[0]).toMatchObject({ id: 'p0', amount: 871_655 });
  });

  test('수입 집계·캘린더: 같은 예상 월 수입 · "주휴수당 포함 월평균 추정" 안내 (주휴수당이 두 번 더해지지 않음)', () => {
    const r = draftToRecord(save(form({ ...base, weeklyHolidayPay: 'included' }, '1,045,986')), 'w', TODAY);
    expect(monthSpending([r], { year: 2026, month: 11 }, TODAY)).toMatchObject({ incomeTotal: 1_045_986, incomeEstimated: 1_045_986 });
    const items = scheduleForRange([r], { start: '2026-11-01', end: '2026-11-30' }, TODAY).filter((i) => i.type === 'payment');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ amount: 1_045_986, estimated: true, detail: '시급제 · 주휴수당 포함 월평균 추정 (실제 지급액과 달라요)' });
    // 제외면 기본급 추정 안내
    const r2 = draftToRecord(save(form({ ...base, weeklyHolidayPay: 'excluded' }, '871,655')), 'x', TODAY);
    expect(scheduleForRange([r2], { start: '2026-11-01', end: '2026-11-30' }, TODAY).find((i) => i.type === 'payment')?.detail).toBe('시급제 · 세전 기본급 추정 (실제 수령액과 달라요)');
  });
});
