/**
 * 중도 입사 첫 달 예상 급여 — 근무 요일의 실제 소정근로일로 계산 (src/domain/payroll.ts workdayPlan)
 * 재현: 입사 2026-10-13(화) · 시급 13,000원 · 하루 4시간 · 월~금 · 주휴수당 포함
 *   예전에는 시급·일급제의 일할 계산을 꺼 두어 월평균 1,355,714원(주 312,000원 × 4.345주)이 첫 달 금액으로 보였다
 */
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';

import type { ContractDetails } from '../contractTypes';
import { monthlyPayEstimate, weeklyPay, weekdaysMismatch, workWeekdaysOf } from '../payBasis';
import { periodEndDayOf, periodStartDayOf, prorationPlan, proratedText, workdaysIn } from '../payroll';
import { scheduleForRange } from '../schedule';
import { monthSpending } from '../spending';

const TODAY = '2026-10-16';
const MON_FRI = '1,2,3,4,5';
const hourly = (extra: ContractDetails = {}): ContractDetails => ({ payBasis: 'hourly', hourlyWage: 13_000, dailyWorkHours: 4, weeklyWorkDays: 5, weeklyHolidayPay: 'included', ...extra });
const salary = (amount: number, day: number): PaymentDraft => ({ kind: 'salary', direction: 'income', directionBasis: 'user', label: '급여', amount, frequency: 'monthly', dayOfMonth: day, monthOfYear: null, startsOn: null, endsOn: null, installmentCount: null, isVariable: true, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null });
const record = (details: ContractDetails, day = 10, extra: Partial<ContractDraft> = {}) => {
  const avg = monthlyPayEstimate(details)?.amount ?? 2_200_000;
  return draftToRecord({ ...EMPTY_DRAFT, contractKind: 'employment', contractType: 'employment', title: '카페', startDate: '2026-10-13', details, payments: [salary(avg, day)], ...extra } as ContractDraft, 'r', TODAY);
};
const pays = (r: ReturnType<typeof record>, start = '2026-10-01', end = '2026-12-31') =>
  scheduleForRange([r], { start, end }, TODAY)
    .filter((i) => i.type === 'payment')
    .map((i) => [i.date, i.amount, i.title] as const);

describe('재현 — 월평균 1,355,714원은 첫 달 금액이 아니다', () => {
  test('월평균 예상 월 수입은 1,355,714원 (주 312,000원 × 4.345주) — 나머지 달에만 쓴다', () => {
    expect(monthlyPayEstimate(hourly({ workWeekdays: MON_FRI }))?.amount).toBe(1_355_714);
  });

  test('A. 산정기간 마감 25일 (9/26~10/25): 10/13~25 평일 9일 → 기본급 468,000 + 주휴 1주 52,000 (입사 주는 확인 필요)', () => {
    const r = record(hourly({ workWeekdays: MON_FRI, payPeriodStartDay: periodStartDayOf(25), payTiming: 'next_month' }));
    const plan = prorationPlan(r, r.payments[0]);
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    expect(plan.first).toMatchObject({ period: { from: '2026-09-26', to: '2026-10-25' }, worked: { from: '2026-10-13', to: '2026-10-25' }, days: 9, unit: 'workdays', payDate: '2026-11-10', total: 520_000 });
    expect(plan.first!.lines).toEqual([
      { label: '기본급', monthly: null, method: 'workdays', amount: 468_000, detail: '근무일 9일 × 4시간 × 시급 13,000원' },
      { label: '주휴수당', monthly: null, method: 'workdays', amount: 52_000, detail: '1주 × 52,000원 (예상)' },
    ]);
    expect(plan.first!.notes).toEqual(['입사·퇴사로 일부만 근무한 주 1주는 주휴수당 지급 여부를 정할 수 없어 넣지 않았어요 (확인 필요)']);
  });

  test('B. 산정기간 기본 (10/1~31): 10/13~31 평일 14일 → 기본급 728,000 + 주휴 2주 104,000 = 832,000 (10/26~30 주는 마지막 근무일이 10월이라 10월에)', () => {
    const r = record(hourly({ workWeekdays: MON_FRI, payTiming: 'next_month' }));
    const plan = prorationPlan(r, r.payments[0]);
    if (plan.status !== 'ready') throw new Error(plan.status);
    expect(plan.first).toMatchObject({ period: { from: '2026-10-01', to: '2026-10-31' }, days: 14, periodDays: 22, payDate: '2026-11-10', total: 832_000 });
    expect(plan.first!.lines.map((l) => l.amount)).toEqual([728_000, 104_000]);
    expect(plan.notes).toContain('급여 산정기간을 정하지 않아 매월 1일~말일로 계산했어요');
    expect(proratedText(plan.first!)).toEqual({ title: '첫 급여 · 10월 13일~31일 근무분', detail: '10월 소정근로일 22일 중 14일 근무 · 세전' });
  });

  test('B 캘린더·월 수입: 익월 지급 → 11/10 832,000 (첫 급여) · 12/10 월평균 1,355,714 · 10월 지급 없음 (한 번만 집계)', () => {
    const r = record(hourly({ workWeekdays: MON_FRI, payTiming: 'next_month' }));
    expect(pays(r)).toEqual([
      ['2026-11-10', 832_000, '첫 급여 · 10월 13일~31일 근무분'],
      ['2026-12-10', 1_355_714, '급여'],
    ]);
    expect(monthSpending([r], { year: 2026, month: 10 }, TODAY).incomeTotal).toBe(0);
    expect(monthSpending([r], { year: 2026, month: 11 }, TODAY).incomeTotal).toBe(832_000);
    expect(monthSpending([r], { year: 2026, month: 12 }, TODAY).incomeTotal).toBe(1_355_714);
  });

  test('당월 지급으로 바꾸면 같은 금액이 근무한 달(10/31)로 — 지급 예정 월만 바뀜', () => {
    const r = record(hourly({ workWeekdays: MON_FRI, payTiming: 'same_month' }), 31);
    expect(pays(r).slice(0, 2)).toEqual([
      ['2026-10-31', 832_000, '첫 급여 · 10월 13일~31일 근무분'],
      ['2026-11-30', 1_355_714, '급여'],
    ]);
    expect(monthSpending([r], { year: 2026, month: 10 }, TODAY).incomeTotal).toBe(832_000);
  });
});

describe('확인이 부족한 경우 — 월평균을 첫 달 금액처럼 보이지 않게', () => {
  test('지급 시기(당월·익월)를 안 고름 → 첫 급여 금액(832,000)은 계산, 지급일은 "첫 지급일 확인 필요"', () => {
    const r = record(hourly({ workWeekdays: MON_FRI }));
    const plan = prorationPlan(r, r.payments[0]);
    expect(plan).toMatchObject({ status: 'needs_rules', missing: ['timing'] });
    const first = pays(r)[0];
    expect(first[1]).toBe(832_000);
    expect(first[2]).toContain('첫 지급일 확인 필요');
  });

  test('근무 요일이 없음(주 5일만) → 월~금으로 정하지 않음 · 첫 회차는 "월평균 추정 · 근무 요일…" 안내', () => {
    const r = record(hourly({ payTiming: 'next_month' }));
    expect(workWeekdaysOf(r.contract.details)).toBeNull();
    expect(prorationPlan(r, r.payments[0])).toMatchObject({ status: 'needs_rules', missing: [] });
    const first = pays(r)[0];
    expect(first[1]).toBe(1_355_714);
    expect(first[2]).toContain('월평균 추정 · 근무 요일을 고르면 첫 달 금액을 근무일로 계산해요');
  });

  test('주휴수당 제외 → 첫 달은 기본급만 (728,000)', () => {
    const r = record(hourly({ workWeekdays: MON_FRI, payTiming: 'next_month', weeklyHolidayPay: 'excluded' }));
    const plan = prorationPlan(r, r.payments[0]);
    if (plan.status !== 'ready') throw new Error();
    expect(plan.first!.total).toBe(728_000);
    expect(plan.first!.lines).toHaveLength(1);
  });
});

describe('퇴사 달 · 월급제 · 일급제', () => {
  test('퇴사 2026-12-09(수): 마지막 산정기간 12/1~9 평일 7일 → 364,000 + 주휴 1주(12/7 주는 일부 → 확인 필요, 11/30~12/4 주 +52,000)', () => {
    const r = record(hourly({ workWeekdays: MON_FRI, payTiming: 'next_month' }), 10, { endDate: '2026-12-09' });
    const plan = prorationPlan(r, r.payments[0]);
    if (plan.status !== 'ready') throw new Error();
    expect(plan.last).toMatchObject({ worked: { from: '2026-12-01', to: '2026-12-09' }, days: 7, payDate: '2027-01-10', total: 416_000 });
    expect(plan.last!.notes?.[0]).toContain('1주');
    expect(pays(r, '2026-10-01', '2027-02-28').map((x) => x[0])).toEqual(['2026-11-10', '2026-12-10', '2027-01-10']);
  });

  test('월급제 + 일할 기준 "소정근로일수" + 근무 요일: 2,200,000 × 14 ÷ 22 = 1,400,000 (예전엔 근무 요일이 없어 계산하지 않음)', () => {
    const r = record({ payBasis: 'monthly', workWeekdays: MON_FRI, payTiming: 'next_month', prorationBasis: 'scheduled_workdays' });
    const plan = prorationPlan(r, r.payments[0]);
    if (plan.status !== 'ready') throw new Error(JSON.stringify(plan));
    expect(plan.first).toMatchObject({ days: 14, periodDays: 22, unit: 'workdays', total: 1_400_000 });
  });

  test('월급제 + 달력 일수 + 원 단위 처리를 고르지 않아도 계산 (공통 반올림) · 산정기간 없으면 1일~말일', () => {
    const r = record({ payBasis: 'monthly', payTiming: 'next_month', prorationBasis: 'calendar_days' });
    const plan = prorationPlan(r, r.payments[0]);
    if (plan.status !== 'ready') throw new Error(JSON.stringify(plan));
    // 2,200,000 × 19 ÷ 31 = 1,348,387.1 → 1,348,387
    expect(plan.first).toMatchObject({ days: 19, periodDays: 31, unit: 'calendar', total: 1_348_387 });
  });

  test('일급제 + 근무 요일: 10/13~31 근무일 14일 × 일급 100,000 = 1,400,000', () => {
    const r = record({ payBasis: 'daily', dailyWage: 100_000, monthlyWorkDays: 20, workWeekdays: MON_FRI, payTiming: 'next_month' });
    const plan = prorationPlan(r, r.payments[0]);
    if (plan.status !== 'ready') throw new Error();
    expect(plan.first).toMatchObject({ days: 14, total: 1_400_000 });
  });
});

describe('도우미', () => {
  test('산정기간 마감일 ↔ 시작일 (저장은 기존 시작일 칸): 말일 ↔ 1 · 25일 ↔ 26', () => {
    expect([periodStartDayOf(null), periodStartDayOf(25), periodEndDayOf(1), periodEndDayOf(26), periodEndDayOf(null)]).toEqual([1, 26, null, 25, null]);
  });
  test('근무 요일 날짜 · 형식이 틀린 값은 근무 요일 없음', () => {
    expect(workdaysIn('2026-10-13', '2026-10-25', [1, 2, 3, 4, 5])).toHaveLength(9);
    expect(workdaysIn('2026-10-13', '2026-10-31', [1, 2, 3, 4, 5])).toHaveLength(14);
    expect(workWeekdaysOf({ workWeekdays: '1,8' })).toBeNull();
    expect(workWeekdaysOf({ workWeekdays: '5,1,3,3' })).toEqual([1, 3, 5]);
  });
  test('주 근무일수와 고른 요일 수가 다르면 확인 요청 · 주 계산은 고른 요일 수 기준', () => {
    expect(weekdaysMismatch({ weeklyWorkDays: 5, workWeekdays: '1,2,3' })).toBeTruthy();
    expect(weekdaysMismatch({ weeklyWorkDays: 5, workWeekdays: MON_FRI })).toBeFalsy();
    expect(weekdaysMismatch({ weeklyWorkDays: 5 })).toBeFalsy();
    expect(weeklyPay(hourly({ workWeekdays: '1,2,3' }))).toMatchObject({ hours: 12, base: 156_000 });
  });
});
