/**
 * 급여 계산 엔진 (결정적 · 정수 원) — AI는 조건만 추출하고, 금액은 여기서 계산한다.
 *   계약서 → AI 조건 추출 → 정규화된 급여 데이터(결제 + 구성항목 + 근로 상세 규정) → 이 엔진 → 사용자 확인 → 지급 일정(schedule.ts)
 *
 * 구성항목 지급 유형 (PaymentComponent.pay — 지급 예측·현금흐름용, 통상임금·평균임금·과세 판정 아님):
 *   fixed 매월 확정 · conditional 조건 충족 시 · variable 실제 근무·실적에 따라 · one_time 특정 시점 1회 · unknown 확인 필요
 *
 * 확정 월 급여 = fixed 항목 중 확정 금액(amountKind exact)의 합. 조건부·변동·일회성은 따로 보여 주고 확정 급여·수입 합계에 넣지 않는다.
 * 일할 계산(중도 입사·퇴사)은 계약서에 있거나 사용자가 확인한 규정(급여 산정기간·지급 시기·일할 기준)이 모두 있을 때만 한다.
 * 금액은 결제(contract_payments) 하나 — 구성항목은 그 금액의 세부 내역이라 따로 수입으로 더하지 않는다.
 */
import { addDays, addMonths, dateInMonth, daysInMonth, diffDays, parseISODate, toISODate, weekdayOf } from './dates';
import { formatWon } from './money';
import { payBasisOf, weeklyPay, workWeekdaysOf } from './payBasis';
import { amountAt } from './paymentAmount';
import type { ComponentPayType, Contract, ContractPayment, ContractRecord, ISODate, PaymentComponent } from './types';

// ─────────────────────────────── 구성항목 분류 · 확정 급여 검증 ───────────────────────────────

/** 예전 데이터(pay 없음)는 '확인 필요'로 시작 — 합계가 정확히 맞으면 고정으로 본다 (salaryBreakdown) */
export const payTypeOf = (c: Pick<PaymentComponent, 'pay'>): ComponentPayType | 'legacy' => c.pay ?? 'legacy';
/** 확정 금액인지 — 최대(상한)·범위는 확정 금액이 아니다 */
export const isExactAmount = (c: Pick<PaymentComponent, 'amountKind'>): boolean => (c.amountKind ?? 'exact') === 'exact';

export const PAY_TYPE_LABEL: Record<ComponentPayType, string> = {
  fixed: '고정',
  conditional: '조건부',
  variable: '변동',
  one_time: '일회성',
  unknown: '확인 필요',
};
export const COMPONENT_STATUS_LABEL = { pending: '미확정', needs_check: '확인 필요', confirmed: '지급 확정', excluded: '지급 제외' } as const;

export type SalaryCheck =
  /** 구성항목이 없음 — 금액 그대로 */
  | 'no_components'
  /** 확정 항목 합계 = 계약상 월 급여 */
  | 'match'
  /** 확정 항목 합계 ≠ 계약상 월 급여 (조건부 항목과 무관하게 다름) */
  | 'mismatch'
  /** 월 급여가 조건부 항목을 포함한 총액인지 불명확 (전체 합계 = 월 급여) — 사용자 확인 */
  | 'includes_conditional'
  /** 유형을 모르는 항목이 있어 판단할 수 없음 */
  | 'needs_classification';

export interface SalaryBreakdown {
  /** 계약상 월 급여 (결제 금액, 세전) */
  contractAmount: number;
  check: SalaryCheck;
  /** 확정 항목 (고정 + 확정 금액) */
  fixed: PaymentComponent[];
  fixedTotal: number;
  /** 추가 지급 가능 (조건부·변동·일회성 + 최대/범위 금액) — 확정 급여·수입 합계에 넣지 않음 */
  extra: PaymentComponent[];
  /** 유형을 모르는 항목 */
  unknown: PaymentComponent[];
  /** 조건부 항목을 최대로 받았을 때 (예시 금액 — 확정 아님). 조건부 항목이 없으면 null */
  maxWithConditional: number | null;
}

const sum = (list: readonly PaymentComponent[]) => list.reduce((s, c) => s + (Number(c.amount) || 0), 0);

/**
 * 급여 구성 정리 + 합계 검증 (모든 정기 금액에 쓸 수 있음 — 급여 외에도 구성항목이 있으면 같은 규칙).
 * - 확정 항목 합계 = 계약 금액 → match (조건부 항목 때문에 전체 합계만 커진 경우도 정상)
 * - 확정 항목 합계 ≠ 계약 금액이고, 전체 합계(조건부 포함) = 계약 금액 → includes_conditional (총액에 성과급 포함인지 확인 요청)
 * - 예전 데이터(유형 없음): 전체 합계 = 계약 금액이면 모두 고정으로 본다(기존 표시 그대로) · 아니면 needs_classification (불일치로 단정하지 않음)
 */
export function salaryBreakdown(payment: Pick<ContractPayment, 'amount' | 'components'>): SalaryBreakdown {
  const all = payment.components ?? [];
  const legacy = all.filter((c) => payTypeOf(c) === 'legacy');
  const typed = all.filter((c) => payTypeOf(c) !== 'legacy');
  const legacyAsFixed = legacy.length > 0 && typed.length === 0 && sum(legacy) === payment.amount;
  const fixed = [...typed.filter((c) => c.pay === 'fixed' && isExactAmount(c)), ...(legacyAsFixed ? legacy : [])];
  const extra = typed.filter((c) => c.pay === 'conditional' || c.pay === 'variable' || c.pay === 'one_time' || (c.pay === 'fixed' && !isExactAmount(c)));
  const unknown = [...typed.filter((c) => c.pay === 'unknown'), ...(legacyAsFixed ? [] : legacy)];
  const fixedTotal = sum(fixed);
  const conditionalMax = extra.filter((c) => c.pay === 'conditional' && c.status !== 'excluded').reduce((s, c) => s + c.amount, 0);
  let check: SalaryCheck;
  if (all.length === 0) check = 'no_components';
  else if (fixedTotal === payment.amount) check = 'match';
  else if (unknown.length > 0) check = 'needs_classification';
  else if (fixedTotal + sum(extra.filter((c) => c.pay === 'conditional')) === payment.amount && extra.some((c) => c.pay === 'conditional')) check = 'includes_conditional';
  else check = 'mismatch';
  return {
    contractAmount: payment.amount,
    check,
    fixed,
    fixedTotal,
    extra,
    unknown,
    maxWithConditional: conditionalMax > 0 ? payment.amount + conditionalMax : null,
  };
}

/**
 * 변동수당 금액 — 산식 재료(단가·수량·비율)가 모두 있을 때만 (예: 통상시급 15,000 × 연장근로 10시간 × 150% = 225,000).
 * 하나라도 없으면 null (금액을 짐작하지 않음). 원 미만은 버림.
 */
export function variableAmount(c: Pick<PaymentComponent, 'calc'>): number | null {
  const k = c.calc;
  if (!k || k.unitAmount == null || k.quantity == null || k.ratePct == null) return null;
  if (k.unitAmount < 0 || k.quantity < 0 || k.ratePct < 0) return null;
  // 정수 연산: 단가(원)·수량(시간, 소수 가능 → 100배 정수)·비율(%) — 부동소수 오차 없이
  const qty100 = Math.round(k.quantity * 100);
  return Math.floor((k.unitAmount * qty100 * Math.round(k.ratePct)) / 10000);
}

// ─────────────────────────────── 급여 산정·지급 규정 ───────────────────────────────

export type PayTiming = 'same_month' | 'next_month';
export type ProrationBasis = 'calendar_days' | 'scheduled_workdays' | 'none';
export type PayRounding = 'floor_1' | 'round_1' | 'floor_10' | 'floor_100' | 'floor_1000';

export interface PayrollRules {
  /** 급여 산정기간 시작일 (1 = 매월 1일~말일, 21 = 21일~다음 달 20일) */
  periodStartDay: number | null;
  timing: PayTiming | null;
  basis: ProrationBasis | null;
  rounding: PayRounding | null;
}

/** 규정 이름 (확인 필요 안내) */
export const PAYROLL_RULE_LABEL: Record<keyof PayrollRules, string> = {
  periodStartDay: '급여 산정기간',
  timing: '급여 지급 시기 (당월·익월)',
  basis: '일할 계산 기준',
  rounding: '원 단위 처리',
};
/** 급여 지급 시기 — 당월: 근무한 달에 지급 · 익월: 근무한 다음 달에 지급 (저장값 same_month·next_month 그대로) */
export const PAY_TIMING_LABEL: Record<PayTiming, { label: string; hint: string }> = {
  same_month: { label: '당월 지급', hint: '근무한 달에 급여 지급' },
  next_month: { label: '익월 지급', hint: '근무한 다음 달에 급여 지급' },
};
/** 산정기간 시작일 ↔ 마감일 (시작일 1 = 매월 말일 마감 · 시작일 26 = 매월 25일 마감) — 저장은 기존 시작일 칸 그대로 */
export const periodEndDayOf = (startDay: number | null): number | null => (startDay == null ? null : startDay === 1 ? null : startDay - 1);
export const periodStartDayOf = (endDay: number | null): number => (endDay == null ? 1 : endDay + 1);
const DETAIL_KEY: Record<keyof PayrollRules, string> = { periodStartDay: 'payPeriodStartDay', timing: 'payTiming', basis: 'prorationBasis', rounding: 'payRounding' };

/**
 * 계약의 급여 규정 — AI가 추정만 한 값(valueSources = inferred)은 확정 규정으로 쓰지 않는다 (사용자가 확인하면 user_confirmed).
 * 계약서 명시(explicit)·사용자 입력·사용자 확인 값만.
 */
export function payrollRules(contract: Pick<Contract, 'details' | 'valueSources'>): { rules: PayrollRules; unconfirmed: (keyof PayrollRules)[] } {
  const d = contract.details as Record<string, unknown>;
  const unconfirmed: (keyof PayrollRules)[] = [];
  const pick = <T>(k: keyof PayrollRules, ok: (v: unknown) => v is T): T | null => {
    const v = d[DETAIL_KEY[k]];
    if (v == null || !ok(v)) return null;
    if (contract.valueSources?.[`details.${DETAIL_KEY[k]}`] === 'inferred') {
      unconfirmed.push(k);
      return null;
    }
    return v;
  };
  return {
    rules: {
      periodStartDay: pick('periodStartDay', (v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 28),
      timing: pick('timing', (v): v is PayTiming => v === 'same_month' || v === 'next_month'),
      basis: pick('basis', (v): v is ProrationBasis => v === 'calendar_days' || v === 'scheduled_workdays' || v === 'none'),
      rounding: pick('rounding', (v): v is PayRounding => ['floor_1', 'round_1', 'floor_10', 'floor_100', 'floor_1000'].includes(v as string)),
    },
    unconfirmed,
  };
}

/** 날짜가 속한 급여 산정기간 */
export function payPeriodOf(date: ISODate, startDay: number): { from: ISODate; to: ISODate } {
  const { year, month, day } = parseISODate(date);
  const from = day >= startDay ? toISODate(year, month, startDay) : addMonths(toISODate(year, month, startDay), -1);
  return { from, to: addDays(addMonths(from, 1), -1) };
}

/** 산정기간의 계약상 지급일 (휴일 조정 전) — 기간이 끝나는 달(same_month) 또는 다음 달(next_month)의 지급일 */
export function payDateOf(period: { to: ISODate }, timing: PayTiming, payDay: number): ISODate {
  const { year, month } = parseISODate(period.to);
  const idx = year * 12 + (month - 1) + (timing === 'next_month' ? 1 : 0);
  return dateInMonth(Math.floor(idx / 12), (idx % 12) + 1, payDay);
}

/** 원 단위 처리 (정수 연산: 분자/분모 그대로 나눠 처리) — 규정이 없으면 원 미만 반올림한 "예상액" */
export function roundWon(numerator: number, denominator: number, rounding: PayRounding | null): number {
  const unit = rounding === 'floor_10' ? 10 : rounding === 'floor_100' ? 100 : rounding === 'floor_1000' ? 1000 : 1;
  if (rounding === 'round_1' || rounding == null) return Math.floor((2 * numerator + denominator) / (2 * denominator));
  return Math.floor(numerator / (denominator * unit)) * unit;
}

// ─────────────────────────────── 첫·마지막 급여 (일할 계산) ───────────────────────────────

export interface ProratedLine {
  label: string;
  /** 월 금액 (근무일 계산 줄은 null) */
  monthly: number | null;
  /** daily 일할 · full 전액 · workdays 실제 소정근로일 계산(시급·일급) */
  method: 'daily' | 'full' | 'workdays';
  amount: number;
  /** 계산 근거 (예: "근무일 9일 × 4시간 × 시급 13,000원") */
  detail?: string;
}

export interface ProratedPay {
  kind: 'first' | 'last';
  /** 급여 산정기간 */
  period: { from: ISODate; to: ISODate };
  /** 근무(재직) 기간 — 산정기간 안 */
  worked: { from: ISODate; to: ISODate };
  /** 적용 일수 / 기준 일수 — unit calendar: 달력 일수 · workdays: 근무 요일 기준 소정근로일 */
  days: number;
  periodDays: number;
  unit: 'calendar' | 'workdays';
  /** 계약상 지급일 (휴일 조정 전) */
  payDate: ISODate;
  lines: ProratedLine[];
  /** 예상 세전 지급액 */
  total: number;
  /** 원 미만 반올림한 예상액 (원 단위 처리는 고르지 않음 — 공통 반올림) */
  roundingAssumed: boolean;
  /** 이 기간 안내 (주휴수당 확인 필요 등) */
  notes?: string[];
}

export type ProrationPlan =
  | { status: 'not_applicable' }
  /** 필요한 규정이 확인되지 않음 — 자동 확정하지 않음 (missing: 확인할 규정) */
  | {
      status: 'needs_rules';
      missing: (keyof PayrollRules)[];
      reason?: string;
      /** 첫 급여 금액은 계산했지만 지급 시기를 몰라 지급일이 확정되지 않음 (첫 회차에만 이 금액 + 확인 필요) */
      firstEstimate?: ProratedPay | null;
      /** 첫 회차 안내 (예: 근무 요일이 없어 월평균 추정) */
      firstNote?: string;
    }
  | { status: 'ready'; first: ProratedPay | null; last: ProratedPay | null; firstPayDate: ISODate; lastPayDate: ISODate | null; notes: string[] };

/** 급여(정기 수입·지급) 결제 — 급여 엔진을 적용하는 대상 */
export const isSalaryPayment = (p: Pick<ContractPayment, 'kind' | 'frequency'>): boolean => p.kind === 'salary' && p.frequency === 'monthly';

/**
 * 첫 급여(중도 입사)·마지막 급여(중도 퇴사) 계획.
 * 필요한 규정: 급여 산정기간 · 지급 시기 · 일할 기준 · 지급일(결제의 매월 N일). 원 단위 처리는 없으면 반올림 "예상액".
 * 소정근로일수 기준은 근무일 수를 알 수 없어 자동 계산하지 않는다 (확인 필요).
 * 구성항목별로 일할(daily)/전액(full)이 다르면 항목마다 계산 (확정 항목 합계가 월 급여와 같을 때만 — 아니면 월 급여 전체를 일할).
 */
export function prorationPlan(record: Pick<ContractRecord, 'contract' | 'dates'>, payment: ContractPayment): ProrationPlan {
  if (!isSalaryPayment(payment)) return { status: 'not_applicable' };
  const { contract } = record;
  const basisPay = payBasisOf(contract.details);
  // 시급제·일급제: 근무 요일의 실제 소정근로일로 계산 (월평균 예상 월 수입을 첫·마지막 달에 그대로 쓰지 않음)
  if (basisPay === 'hourly' || basisPay === 'daily') return workdayPlan(record, payment);
  const hire = record.dates.find((d) => d.kind === 'hire')?.date ?? contract.startDate;
  if (!hire) return { status: 'needs_rules', missing: [], reason: '입사일(근로 시작일)이 없어요' };
  const { rules, unconfirmed } = payrollRules(contract);
  // 산정기간이 없으면 매월 1일~말일 (기본) · 원 단위 처리는 고르지 않음 (공통 반올림)
  const missing = (['timing', 'basis'] as const).filter((k) => rules[k] == null);
  if (payment.dayOfMonth == null) return { status: 'needs_rules', missing, reason: '급여 지급일이 없어요' };
  if (missing.length > 0) return { status: 'needs_rules', missing: [...new Set([...missing, ...unconfirmed.filter((k) => k !== 'rounding' && k !== 'periodStartDay')])] };
  const weekdays = workWeekdaysOf(contract.details);
  if (rules.basis === 'scheduled_workdays' && !weekdays) return { status: 'needs_rules', missing: [], reason: '소정근로일수 기준은 근무 요일이 필요해요 — 근무 요일을 골라주세요' };

  const timing = rules.timing!;
  const startDay = rules.periodStartDay ?? 1;
  const breakdown = salaryBreakdown(payment);
  const itemize = breakdown.check === 'match' && breakdown.fixed.length > 0;
  const notes: string[] = [];
  if (!itemize && (payment.components ?? []).length > 0) notes.push('구성항목 합계가 월 급여와 달라 월 급여 전체로 계산했어요');
  if ((payment.businessDayRule ?? 'none') === 'none') notes.push('지급일이 휴일일 때의 규정이 없어 계약상 지급일로 표시했어요');

  const partial = (kind: 'first' | 'last', date: ISODate): ProratedPay | null => {
    const period = payPeriodOf(date, startDay);
    const worked = kind === 'first' ? { from: date, to: period.to } : { from: period.from, to: date };
    const byWorkdays = rules.basis === 'scheduled_workdays';
    const periodDays = byWorkdays ? workdaysIn(period.from, period.to, weekdays!).length : diffDays(period.from, period.to) + 1;
    const days = byWorkdays ? workdaysIn(worked.from, worked.to, weekdays!).length : diffDays(worked.from, worked.to) + 1;
    if (days >= periodDays) return null; // 산정기간 전체 근무 — 일할 아님
    // 그 산정기간의 월 급여 (금액 변경 이력 반영) — 변경으로 구성항목 합계와 달라지면 월 급여 전체로
    const base = amountAt(payment, period.from);
    const items: { label: string; monthly: number; prorate: PaymentComponent['prorate'] }[] = itemize && base === payment.amount
      ? breakdown.fixed.map((c) => ({ label: c.label, monthly: c.amount, prorate: c.prorate ?? null }))
      : [{ label: payment.label, monthly: base, prorate: null }];
    const lines = items.map((it): ProratedLine => {
      const full = it.prorate === 'full' || (it.prorate == null && rules.basis === 'none');
      return { label: it.label, monthly: it.monthly, method: full ? 'full' : 'daily', amount: full ? it.monthly : roundWon(it.monthly * days, periodDays, null) };
    });
    return { kind, period, worked, days, periodDays, unit: byWorkdays ? 'workdays' : 'calendar', payDate: payDateOf(period, timing, payment.dayOfMonth!), lines, total: lines.reduce((s, l) => s + l.amount, 0), roundingAssumed: true };
  };

  const first = partial('first', hire);
  const firstPayDate = payDateOf(payPeriodOf(hire, startDay), timing, payment.dayOfMonth);
  const end = payment.endsOn ?? contract.endDate;
  const last = end ? partial('last', end) : null;
  const lastPayDate = end ? payDateOf(payPeriodOf(end, startDay), timing, payment.dayOfMonth) : null;
  if (rules.periodStartDay == null) notes.push('급여 산정기간을 정하지 않아 매월 1일~말일로 계산했어요');
  return { status: 'ready', first, last, firstPayDate, lastPayDate, notes };
}

// ─────────────────────── 시급제·일급제: 근무 요일 기준 실제 소정근로일 ───────────────────────

/** ISO 요일 (월=1 … 일=7) */
const isoWeekday = (d: ISODate): number => weekdayOf(d) || 7;

/** 기간 안의 근무 요일 날짜 */
export function workdaysIn(from: ISODate, to: ISODate, weekdays: readonly number[]): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekdays.includes(isoWeekday(d))) out.push(d);
  return out;
}

/**
 * 산정기간의 주휴수당 (주 = 월~일). 한 주의 주휴수당은 그 주의 마지막 근무 요일이 속한 산정기간에 넣는다
 * (산정기간 경계에 걸친 주를 두 번 세지 않음). 그 주의 근무 요일을 모두 재직 중일 때만 더하고,
 * 입사·퇴사로 일부만 근무한 주는 지급 여부를 정하지 않고 "확인 필요"로 센다. 주휴수당 조건은 weeklyPay와 같다 (15시간·예외)
 */
export function periodWeeklyHoliday(
  details: Contract['details'],
  period: { from: ISODate; to: ISODate },
  employed: { from: ISODate; to: ISODate | null },
): { status: 'added' | 'none'; weeks: number; uncertainWeeks: number; perWeek: number; amount: number; note: string | null } {
  const w = weeklyPay(details);
  const weekdays = workWeekdaysOf(details);
  if (!w || !weekdays || w.holiday.status !== 'added') return { status: 'none', weeks: 0, uncertainWeeks: 0, perWeek: 0, amount: 0, note: w && w.holiday.status !== 'added' && w.holiday.status !== 'excluded' && w.holiday.status !== 'in_wage' ? w.holiday.note : null };
  let weeks = 0;
  let uncertainWeeks = 0;
  for (let monday = addDays(period.from, 1 - isoWeekday(period.from)); monday <= period.to; monday = addDays(monday, 7)) {
    const days = weekdays.map((wd) => addDays(monday, wd - 1));
    const last = days[days.length - 1];
    if (last < period.from || last > period.to) continue;
    const inJob = days.filter((d) => d >= employed.from && (employed.to == null || d <= employed.to));
    if (inJob.length === 0) continue;
    if (inJob.length === days.length) weeks++;
    else uncertainWeeks++;
  }
  const perWeek = w.holiday.amount;
  return {
    status: 'added',
    weeks,
    uncertainWeeks,
    perWeek,
    amount: weeks * perWeek,
    note: uncertainWeeks > 0 ? `입사·퇴사로 일부만 근무한 주 ${uncertainWeeks}주는 주휴수당 지급 여부를 정할 수 없어 넣지 않았어요 (확인 필요)` : null,
  };
}

/** 시급제·일급제 첫·마지막 급여 — 실제 소정근로일 × 하루 소정근로시간 × 시급 (일급제: 근무일 × 일급) + 주휴수당 */
function workdayPlan(record: Pick<ContractRecord, 'contract' | 'dates'>, payment: ContractPayment): ProrationPlan {
  const { contract } = record;
  const d = contract.details as Record<string, unknown>;
  const hourly = payBasisOf(contract.details) === 'hourly';
  const hire = record.dates.find((x) => x.kind === 'hire')?.date ?? contract.startDate;
  if (!hire) return { status: 'needs_rules', missing: [], reason: '입사일(근로 시작일)이 없어요' };
  const weekdays = workWeekdaysOf(contract.details);
  const avgNote = '월평균 추정 · 근무 요일을 고르면 첫 달 금액을 근무일로 계산해요';
  if (!weekdays) return { status: 'needs_rules', missing: [], reason: '근무 요일이 없어 첫·마지막 달도 월평균 추정액으로 보여 드려요. 근무 요일을 골라주세요', firstNote: avgNote };
  const num = (k: string) => (typeof d[k] === 'number' && (d[k] as number) > 0 ? (d[k] as number) : null);
  const wage = hourly ? num('hourlyWage') : num('dailyWage');
  const hours = hourly ? num('dailyWorkHours') : 1;
  if (wage == null || hours == null) return { status: 'needs_rules', missing: [], reason: hourly ? '시급·하루 소정근로시간이 필요해요' : '일급이 필요해요', firstNote: avgNote };
  if (payment.dayOfMonth == null) return { status: 'needs_rules', missing: [], reason: '급여 지급일이 없어요' };
  const { rules } = payrollRules(contract);
  const startDay = rules.periodStartDay ?? 1;
  const end = payment.endsOn ?? contract.endDate;

  const partial = (kind: 'first' | 'last', date: ISODate, timing: PayTiming | null): ProratedPay | null => {
    const period = payPeriodOf(date, startDay);
    const worked = kind === 'first' ? { from: date, to: end && end < period.to ? end : period.to } : { from: hire > period.from ? hire : period.from, to: date };
    if (worked.from === period.from && worked.to === period.to) return null; // 산정기간 전체 근무 — 월평균 그대로
    const workedDays = workdaysIn(worked.from, worked.to, weekdays).length;
    const periodDays = workdaysIn(period.from, period.to, weekdays).length;
    const base = Math.round(wage * hours * workedDays);
    const lines: ProratedLine[] = [
      { label: '기본급', monthly: null, method: 'workdays', amount: base, detail: hourly ? `근무일 ${workedDays}일 × ${hours}시간 × 시급 ${formatWon(wage)}` : `근무일 ${workedDays}일 × 일급 ${formatWon(wage)}` },
    ];
    const notes: string[] = [];
    if (hourly) {
      const h = periodWeeklyHoliday(contract.details, period, { from: hire, to: end });
      if (h.status === 'added' && h.weeks > 0) lines.push({ label: '주휴수당', monthly: null, method: 'workdays', amount: h.amount, detail: `${h.weeks}주 × ${formatWon(h.perWeek)} (예상)` });
      if (h.note) notes.push(h.note);
    }
    const payDate = timing ? payDateOf(period, timing, payment.dayOfMonth!) : '';
    return { kind, period, worked, days: workedDays, periodDays, unit: 'workdays', payDate, lines, total: lines.reduce((s, l) => s + l.amount, 0), roundingAssumed: true, notes };
  };

  const timing = rules.timing;
  if (!timing) return { status: 'needs_rules', missing: ['timing'], reason: '급여 지급 시기(당월·익월)를 고르면 첫 급여 지급일이 정해져요', firstEstimate: partial('first', hire, null) };
  const notes: string[] = ['첫·마지막 달은 근무 요일의 실제 소정근로일로, 나머지 달은 월평균 추정액으로 보여 드려요'];
  if (rules.periodStartDay == null) notes.push('급여 산정기간을 정하지 않아 매월 1일~말일로 계산했어요');
  return {
    status: 'ready',
    first: partial('first', hire, timing),
    last: end ? partial('last', end, timing) : null,
    firstPayDate: payDateOf(payPeriodOf(hire, startDay), timing, payment.dayOfMonth),
    lastPayDate: end ? payDateOf(payPeriodOf(end, startDay), timing, payment.dayOfMonth) : null,
    notes,
  };
}

/**
 * 일할 계산 표시 문구 (분수 "7/31" 대신 날짜로) — 실제 근무 기간·산정기간에서 만든다.
 * title "첫 급여 · 10월 15일~31일 근무분" / detail "10월 총 31일 중 17일분 일할 계산 · 세전"
 * (산정기간이 달력 한 달이 아니면 "급여 산정기간 31일 중 …")
 */
export function proratedText(p: Pick<ProratedPay, 'kind' | 'period' | 'worked' | 'days' | 'periodDays'> & { unit?: ProratedPay['unit'] }): { title: string; detail: string } {
  const md = (d: ISODate) => ({ m: Number(d.slice(5, 7)), d: Number(d.slice(8, 10)) });
  const a = md(p.worked.from);
  const b = md(p.worked.to);
  const range = a.m !== b.m ? `${a.m}월 ${a.d}일~${b.m}월 ${b.d}일` : a.d === b.d ? `${a.m}월 ${a.d}일` : `${a.m}월 ${a.d}일~${b.d}일`;
  const wholeMonth = p.period.from.slice(8, 10) === '01' && p.period.from.slice(0, 7) === p.period.to.slice(0, 7) && Number(p.period.to.slice(8, 10)) === daysInMonth(Number(p.period.to.slice(0, 4)), Number(p.period.to.slice(5, 7)));
  const base = wholeMonth ? `${md(p.period.from).m}월 총 ${p.periodDays}일` : `급여 산정기간 ${p.periodDays}일`;
  const title = `${p.kind === 'first' ? '첫 급여' : '마지막 급여'} · ${range} 근무분`;
  if (p.unit === 'workdays') return { title, detail: `${wholeMonth ? `${md(p.period.from).m}월` : '급여 산정기간'} 소정근로일 ${p.periodDays}일 중 ${p.days}일 근무 · 세전` };
  return { title, detail: `${base} 중 ${p.days}일분 일할 계산 · 세전` };
}

/** 이 회차(계약상 지급일)의 금액이 일할 계산 대상이면 그 계산 */
export function proratedFor(plan: ProrationPlan, nominalDate: ISODate): ProratedPay | null {
  if (plan.status !== 'ready') return null;
  if (plan.first && plan.first.payDate === nominalDate) return plan.first;
  if (plan.last && plan.last.payDate === nominalDate) return plan.last;
  return null;
}
