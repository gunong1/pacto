/**
 * 근로계약 급여 방식 (월급제·시급제·일급제·연봉제) — 고용 형태(정규직·계약직·단시간)와 별개 (레지스트리 details.payBasis)
 *
 * 저장 구조 (원래 의미를 잃지 않게):
 * - 급여 방식과 단가(시급·하루 근무시간·일급·월 예상 근무일수·연봉)는 계약 상세(details)에 그대로 둔다 — 월급으로 바꿔 저장하지 않음
 * - 캘린더·월 수입 합계에 쓰는 금액은 기존처럼 급여 결제(kind salary) 1건의 금액 = "예상 월 수입"
 *   (사용자가 고칠 수 있음 · 계산값과 다르면 "직접 고친 예상액"으로 표시)
 * - 급여 방식이 비어 있는 예전 계약·AI 분석 결과는 월급 금액이 급여 결제 금액 (그대로 호환)
 *
 * 계산 (세전 추정 — 실제 수령액이 아님):
 * - 시급제 (주 단위, weeklyPay): 주 소정근로시간 = 하루 소정근로시간 × 주 근무일수
 *     주 기본급 = 시급 × 주 소정근로시간
 *     주휴수당 = 시급 × min(8, 주 소정근로시간 ÷ 5) — 사용자가 "포함"을 골랐고 주 15시간 이상 · 고정 근무(하루 8시간·주 40시간 이하 · 주 6일 이하)일 때만
 *       ("포함" = 사용자가 지급 대상이라고 확인한 것. 법적 지급 요건 충족을 판정하지 않음 — 개근 여부 등은 모름)
 *       주 15시간 미만 → 계산하지 않고 조건 확인 안내 · 그 밖의 예외(하루 8시간·주 40시간 초과, 주 7일) → 확정하지 않고 확인 필요
 *       "시급에 이미 포함" → 따로 더하지 않음 (중복 가산 방지)
 *     주 예상 급여 = 주 기본급 + 주휴수당 (한 번만)
 *     예상 월 수입 = 주 예상 급여 × 월평균 주수(365 ÷ 12 ÷ 7 ≈ 4.345) — 월평균 추정치 (달마다 실제 지급액은 다름)
 *   예전 시급제 계약(주 근무일수 없이 월 예상 근무일수만): 시급 × 하루 근무시간 × 월 예상 근무일수 (주휴수당 없음)
 * - 일급제: 일급 × 월 예상 근무일수
 * - 연봉제: 연봉 ÷ 12 (계약서의 월 지급액과 다르면 사용자가 고친다)
 * - 월급제: 계산하지 않음 (주휴수당을 더하지 않음 — 월급에 포함된 것으로 봄)
 * 연장·야간·휴일근로수당, 결근·연차·퇴사 정산, 세금·4대보험 공제는 넣지 않는다.
 */
import type { ContractDetails } from './contractTypes';
import type { ContractPayment } from './types';
import { formatWon } from './money';

export const PAY_BASES = ['monthly', 'hourly', 'daily', 'annual'] as const;
export type PayBasis = (typeof PAY_BASES)[number];

export const PAY_BASIS_LABEL: Record<PayBasis, string> = { monthly: '월급제', hourly: '시급제', daily: '일급제', annual: '연봉제' };

/** 급여 방식 칸 — 일반 "근로 정보" 목록이 아니라 급여 방식 영역에서 보여준다 */
export const PAY_BASIS_KEYS: ReadonlySet<string> = new Set(['payBasis', 'hourlyWage', 'dailyWorkHours', 'weeklyWorkDays', 'workWeekdays', 'weeklyHolidayPay', 'dailyWage', 'monthlyWorkDays', 'annualSalary']);
/** 급여 산정·지급 규정 칸 — 급여 영역(PayrollRulesFields)에서 보여준다 (원 단위 처리는 화면에서 고르지 않음 — 공통 반올림) */
export const PAYROLL_RULE_KEYS: ReadonlySet<string> = new Set(['payPeriodStartDay', 'payTiming', 'prorationBasis', 'payRounding']);

// ───────────── 근무 요일 (details.workWeekdays = "1,2,3,4,5", 월=1 … 일=7) ─────────────
export const WEEKDAY_LABEL = ['월', '화', '수', '목', '금', '토', '일'] as const;

/** 저장된 근무 요일 (형식이 틀리거나 비어 있으면 null — 주 근무일수만으로 요일을 정하지 않음) */
export function workWeekdaysOf(details: ContractDetails | null | undefined): number[] | null {
  const v = details?.workWeekdays;
  if (typeof v !== 'string' || !/^[1-7](,[1-7])*$/.test(v.trim())) return null;
  return [...new Set(v.trim().split(',').map(Number))].sort((a, b) => a - b);
}
export const weekdaysToText = (days: readonly number[]): string => [...new Set(days)].sort((a, b) => a - b).join(',');
/** 저장된 주 근무일수와 고른 근무 요일 수가 다른지 (다르면 사용자 확인 — 계산은 근무 요일 기준) */
export function weekdaysMismatch(details: ContractDetails | null | undefined): { weeklyDays: number; weekdays: number } | null {
  const days = workWeekdaysOf(details);
  const weekly = details?.weeklyWorkDays;
  if (!days || typeof weekly !== 'number' || weekly <= 0 || weekly === days.length) return null;
  return { weeklyDays: weekly, weekdays: days.length };
}

/** "월·화·수·목·금" */
export const formatWeekdays = (days: readonly number[]): string => days.map((d) => WEEKDAY_LABEL[d - 1]).join('·');

/** 급여 방식별 입력 칸 (월급제는 급여 금액 = 월급 하나) */
export const PAY_BASIS_FIELDS: Record<PayBasis, readonly string[]> = {
  monthly: [],
  hourly: ['hourlyWage', 'dailyWorkHours', 'weeklyWorkDays'],
  daily: ['dailyWage', 'monthlyWorkDays'],
  annual: ['annualSalary'],
};

/** 예상치에서 뺀 것 (화면 안내 공통 문구) */
export const PAY_ESTIMATE_EXCLUDES = '연장·야간·휴일근로수당과 세금·4대보험 공제는 넣지 않았어요';
/** 주휴수당을 계산하지 않는 추정 (일급제·연봉제·예전 시급제) */
export const PAY_ESTIMATE_EXCLUDES_WITH_HOLIDAY = '주휴수당·연장·야간·휴일근로수당과 세금·4대보험 공제는 넣지 않았어요';

/** 주휴수당 포함 여부 — included 포함(사용자가 지급 대상이라고 확인) · excluded 제외 · in_wage 시급에 이미 포함 */
export const WEEKLY_HOLIDAY_PAY = ['included', 'excluded', 'in_wage'] as const;
export type WeeklyHolidayPay = (typeof WEEKLY_HOLIDAY_PAY)[number];
export const WEEKLY_HOLIDAY_LABEL: Record<WeeklyHolidayPay, string> = { included: '포함', excluded: '제외', in_wage: '시급에 이미 포함' };

/** 월평균 주수 (365일 ÷ 12개월 ÷ 7일 ≈ 4.345) */
export const WEEKS_PER_MONTH = 365 / 12 / 7;

/** 주휴수당 계산 상태 */
export type WeeklyHolidayStatus = 'added' | 'excluded' | 'in_wage' | 'not_selected' | 'below_15' | 'needs_check';

export interface WeeklyPay {
  /** 주 소정근로시간 */
  hours: number;
  /** 주 기본급 = 시급 × 주 소정근로시간 */
  base: number;
  holiday: {
    status: WeeklyHolidayStatus;
    /** 더한 주휴수당 (added일 때만 0보다 큼) */
    amount: number;
    /** 주휴 시간 = min(8, 주 소정근로시간 ÷ 5) (added일 때만) */
    hours: number | null;
    /** 화면 안내 */
    note: string;
  };
  /** 주 예상 급여 = 주 기본급 + 주휴수당 (한 번만) */
  total: number;
}

/** 시급제 주 단위 예상 급여 (시급·하루 소정근로시간·주 근무일수가 모두 있을 때만) */
export function weeklyPay(details: ContractDetails | null | undefined): WeeklyPay | null {
  if (payBasisOf(details) !== 'hourly') return null;
  const wage = pos(details?.hourlyWage);
  const daily = pos(details?.dailyWorkHours);
  // 근무 요일을 골랐으면 그 개수가 주 근무일수
  const days = workWeekdaysOf(details)?.length ?? pos(details?.weeklyWorkDays);
  if (wage == null || daily == null || days == null) return null;
  const hours = Math.round(daily * days * 100) / 100;
  const base = Math.round(wage * hours);
  const choice = details?.weeklyHolidayPay as WeeklyHolidayPay | undefined;
  const holiday = ((): WeeklyPay['holiday'] => {
    if (choice === 'in_wage') return { status: 'in_wage', amount: 0, hours: null, note: '시급에 주휴수당이 포함돼 있어 따로 더하지 않았어요.' };
    if (choice !== 'included') return { status: choice === 'excluded' ? 'excluded' : 'not_selected', amount: 0, hours: null, note: choice === 'excluded' ? '주휴수당을 넣지 않았어요.' : '주휴수당 포함 여부를 고르지 않아 넣지 않았어요.' };
    if (hours < 15) return { status: 'below_15', amount: 0, hours: null, note: `주 소정근로시간이 ${n(hours)}시간(15시간 미만)이라 주휴수당을 계산하지 않았어요. 근로조건을 확인해주세요.` };
    if (daily > 8 || hours > 40 || days > 6)
      return { status: 'needs_check', amount: 0, hours: null, note: '하루 8시간·주 40시간을 넘거나 주 7일 근무라 주휴수당을 자동으로 정하지 않았어요. 계약서의 근로조건을 확인해주세요.' };
    const h = Math.min(8, hours / 5);
    return { status: 'added', amount: Math.round(wage * h), hours: Math.round(h * 100) / 100, note: '입력한 근로조건 기준 예상액이에요. 실제 지급 요건(소정근로일 개근 등) 충족 여부는 판정하지 않아요.' };
  })();
  return { hours, base, holiday, total: base + holiday.amount };
}

export function payBasisOf(details: ContractDetails | null | undefined): PayBasis | null {
  const v = details?.payBasis;
  return typeof v === 'string' && (PAY_BASES as readonly string[]).includes(v) ? (v as PayBasis) : null;
}

/** 근무일수·근무시간에 따라 매달 달라지는 예상 금액인지 (급여 결제를 변동 금액으로 둔다) */
export const isVariablePayBasis = (b: PayBasis | null): boolean => b === 'hourly' || b === 'daily';

export interface PayEstimate {
  basis: PayBasis;
  /** 예상 월 수입 (세전 기본급 추정). 입력이 모자라면 null */
  amount: number | null;
  /** 계산식 (예: "시급 10,030원 × 하루 8시간 × 월 22일") */
  formula: string | null;
  /** 계산에 더 필요한 칸 이름 */
  missing: string[];
}

const LABEL: Record<string, string> = { hourlyWage: '시급', dailyWorkHours: '하루 소정근로시간', weeklyWorkDays: '주 근무일수', dailyWage: '일급', monthlyWorkDays: '월 예상 근무일수', annualSalary: '연봉' };
const pos = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const n = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

/** 급여 방식 → 예상 월 수입 (월급제·급여 방식 없음은 계산하지 않음 — 급여 금액이 곧 월급) */
export function monthlyPayEstimate(details: ContractDetails | null | undefined): PayEstimate | null {
  const basis = payBasisOf(details);
  if (!basis || basis === 'monthly') return null;
  const fields = hourlyFields(basis, details);
  const v: Record<string, number | null> = Object.fromEntries(fields.map((k) => [k, pos(details?.[k])]));
  const missing = fields.filter((k) => v[k] == null).map((k) => LABEL[k]);
  if (missing.length > 0) return { basis, amount: null, formula: null, missing };
  switch (basis) {
    case 'hourly': {
      const w = weeklyPay(details);
      if (w) return { basis, amount: Math.round(w.total * WEEKS_PER_MONTH), formula: `주 예상 급여 ${formatWon(w.total)} × 월평균 4.345주`, missing };
      // 예전 시급제 계약 (주 근무일수 없이 월 예상 근무일수)
      return { basis, amount: Math.round(v.hourlyWage! * v.dailyWorkHours! * v.monthlyWorkDays!), formula: `시급 ${formatWon(v.hourlyWage!)} × 하루 ${n(v.dailyWorkHours!)}시간 × 월 ${n(v.monthlyWorkDays!)}일`, missing };
    }
    case 'daily':
      return { basis, amount: Math.round(v.dailyWage! * v.monthlyWorkDays!), formula: `일급 ${formatWon(v.dailyWage!)} × 월 ${n(v.monthlyWorkDays!)}일`, missing };
    case 'annual':
      return { basis, amount: Math.floor(v.annualSalary! / 12), formula: `연봉 ${formatWon(v.annualSalary!)} ÷ 12개월`, missing };
  }
}

/** 계산에 쓰는 칸 — 시급제는 주 근무일수, 주 근무일수 없이 월 예상 근무일수만 있는 예전 계약은 그 값 */
function hourlyFields(basis: PayBasis, details: ContractDetails | null | undefined): readonly string[] {
  const hasWeekly = pos(details?.weeklyWorkDays) != null || workWeekdaysOf(details) != null;
  if (basis === 'hourly' && !hasWeekly && pos(details?.monthlyWorkDays) != null) return ['hourlyWage', 'dailyWorkHours', 'monthlyWorkDays'];
  // 근무 요일만 고른 경우 주 근무일수 칸은 비어 있어도 된다
  if (basis === 'hourly' && workWeekdaysOf(details) != null) return ['hourlyWage', 'dailyWorkHours'];
  return PAY_BASIS_FIELDS[basis];
}

/** 예전 시급제 계약(월 예상 근무일수 기준)인지 — 화면에 그 칸을 보여 준다 */
export const usesLegacyMonthlyDays = (details: ContractDetails | null | undefined): boolean => payBasisOf(details) === 'hourly' && hourlyFields('hourly', details).includes('monthlyWorkDays');

/** 급여 금액 이름 — 월급제(또는 방식 없음)는 월급, 나머지는 예상 월 수입·월 지급액 */
export function payAmountLabel(basis: PayBasis | null): string {
  if (basis === 'hourly' || basis === 'daily') return '예상 월 수입';
  if (basis === 'annual') return '월 지급액';
  return '월급';
}

/** 저장된 급여 금액이 계산값과 다른지 (사용자가 직접 고친 예상액) */
export function payEstimateEdited(details: ContractDetails | null | undefined, amount: number): boolean {
  const e = monthlyPayEstimate(details);
  return e?.amount != null && e.amount !== amount;
}

/**
 * 저장 전 급여 결제에 급여 방식 반영 — 시급·일급은 변동(예상) 금액, 월급·연봉은 고정 금액.
 * 급여 방식이 비어 있으면(예전 계약·AI 결과) 결제를 그대로 둔다.
 */
export function applyPayBasis<P extends Pick<ContractPayment, 'kind' | 'frequency' | 'isVariable'>>(payments: readonly P[], details: ContractDetails | null | undefined): P[] {
  const basis = payBasisOf(details);
  if (!basis) return [...payments];
  return payments.map((p) => (p.kind === 'salary' && p.frequency === 'monthly' ? { ...p, isVariable: isVariablePayBasis(basis) } : p));
}
