/**
 * 근로계약 급여 방식 (월급제·시급제·일급제·연봉제) — 고용 형태(정규직·계약직·단시간)와 별개 (레지스트리 details.payBasis)
 *
 * 저장 구조 (원래 의미를 잃지 않게):
 * - 급여 방식과 단가(시급·하루 근무시간·일급·월 예상 근무일수·연봉)는 계약 상세(details)에 그대로 둔다 — 월급으로 바꿔 저장하지 않음
 * - 캘린더·월 수입 합계에 쓰는 금액은 기존처럼 급여 결제(kind salary) 1건의 금액 = "예상 월 수입"
 *   (사용자가 고칠 수 있음 · 계산값과 다르면 "직접 고친 예상액"으로 표시)
 * - 급여 방식이 비어 있는 예전 계약·AI 분석 결과는 월급 금액이 급여 결제 금액 (그대로 호환)
 *
 * 계산 (세전 기본급 추정 — 실제 수령액이 아님):
 * - 시급제: 시급 × 하루 근무시간 × 월 예상 근무일수
 * - 일급제: 일급 × 월 예상 근무일수
 * - 연봉제: 연봉 ÷ 12 (계약서의 월 지급액과 다르면 사용자가 고친다)
 * 주휴수당·연장·야간·휴일근로수당, 세금·4대보험 공제는 검증된 계산 규칙이 없어 넣지 않는다.
 */
import type { ContractDetails } from './contractTypes';
import type { ContractPayment } from './types';
import { formatWon } from './money';

export const PAY_BASES = ['monthly', 'hourly', 'daily', 'annual'] as const;
export type PayBasis = (typeof PAY_BASES)[number];

export const PAY_BASIS_LABEL: Record<PayBasis, string> = { monthly: '월급제', hourly: '시급제', daily: '일급제', annual: '연봉제' };

/** 급여 방식 칸 — 일반 "근로 정보" 목록이 아니라 급여 방식 영역에서 보여준다 */
export const PAY_BASIS_KEYS: ReadonlySet<string> = new Set(['payBasis', 'hourlyWage', 'dailyWorkHours', 'dailyWage', 'monthlyWorkDays', 'annualSalary']);

/** 급여 방식별 입력 칸 (월급제는 급여 금액 = 월급 하나) */
export const PAY_BASIS_FIELDS: Record<PayBasis, readonly string[]> = {
  monthly: [],
  hourly: ['hourlyWage', 'dailyWorkHours', 'monthlyWorkDays'],
  daily: ['dailyWage', 'monthlyWorkDays'],
  annual: ['annualSalary'],
};

/** 예상치에서 뺀 것 (화면 안내 공통 문구) */
export const PAY_ESTIMATE_EXCLUDES = '주휴수당·연장·야간·휴일근로수당과 세금·4대보험 공제는 넣지 않았어요';

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

const LABEL: Record<string, string> = { hourlyWage: '시급', dailyWorkHours: '하루 근무시간', dailyWage: '일급', monthlyWorkDays: '월 예상 근무일수', annualSalary: '연봉' };
const pos = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const n = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

/** 급여 방식 → 예상 월 수입 (월급제·급여 방식 없음은 계산하지 않음 — 급여 금액이 곧 월급) */
export function monthlyPayEstimate(details: ContractDetails | null | undefined): PayEstimate | null {
  const basis = payBasisOf(details);
  if (!basis || basis === 'monthly') return null;
  const v = Object.fromEntries(PAY_BASIS_FIELDS[basis].map((k) => [k, pos(details?.[k])]));
  const missing = PAY_BASIS_FIELDS[basis].filter((k) => v[k] == null).map((k) => LABEL[k]);
  if (missing.length > 0) return { basis, amount: null, formula: null, missing };
  switch (basis) {
    case 'hourly':
      return { basis, amount: Math.round(v.hourlyWage! * v.dailyWorkHours! * v.monthlyWorkDays!), formula: `시급 ${formatWon(v.hourlyWage!)} × 하루 ${n(v.dailyWorkHours!)}시간 × 월 ${n(v.monthlyWorkDays!)}일`, missing };
    case 'daily':
      return { basis, amount: Math.round(v.dailyWage! * v.monthlyWorkDays!), formula: `일급 ${formatWon(v.dailyWage!)} × 월 ${n(v.monthlyWorkDays!)}일`, missing };
    case 'annual':
      return { basis, amount: Math.floor(v.annualSalary! / 12), formula: `연봉 ${formatWon(v.annualSalary!)} ÷ 12개월`, missing };
  }
}

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
