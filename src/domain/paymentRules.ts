import { addDays, addMonths } from './dates';
import type { ContractPayment, ContractRecord, ISODate } from './types';

/**
 * 계약 조건에서 나오는 "기간별 금액"과 "기간 경계" — 저장하지 않고 계약 정보에서 계산한다 (수정하면 자동 반영).
 * 계약서의 숫자를 그대로 결제로 만들지 않고, 조건(수습기간 등)을 해석해 실제 금액을 정한다.
 * 새 규칙(예: 렌탈 첫 3개월 할인)은 AMOUNT_RULES / BOUNDARY_RULES에 추가한다.
 */

export interface AmountPeriod {
  from: ISODate;
  to: ISODate;
  amount: number;
  /** 화면 표시: '수습기간 90%' */
  label: string;
}

export interface PeriodBoundary {
  key: string;
  label: string;
  date: ISODate;
  /** 기간 정보 (상세 표시용) */
  period: { from: ISODate; to: ISODate };
}

/** 근로계약 수습기간: 입사일(없으면 근로 시작일)부터 N개월 — 끝나는 날 = 시작 + N개월 - 1일 */
export function probationPeriod(record: Pick<ContractRecord, 'contract' | 'dates'>): { from: ISODate; to: ISODate; months: number } | null {
  const { contract } = record;
  const months = contract.details.probationMonths;
  if (contract.contractType !== 'employment' || typeof months !== 'number' || months <= 0) return null;
  const from = record.dates.find((d) => d.kind === 'hire')?.date ?? contract.startDate;
  if (!from) return null;
  return { from, to: addDays(addMonths(from, months), -1), months };
}

type AmountRule = (record: Pick<ContractRecord, 'contract' | 'dates'>, payment: ContractPayment) => AmountPeriod[];

const AMOUNT_RULES: AmountRule[] = [
  // 수습기간 중 임금은 월 임금의 N% — 급여(정기) 결제에만 적용
  (record, payment) => {
    const rate = record.contract.details.probationPayRate;
    const period = probationPeriod(record);
    if (!period || typeof rate !== 'number' || rate <= 0 || rate >= 100 || payment.kind !== 'salary' || payment.frequency === 'one_time') return [];
    return [{ from: period.from, to: period.to, amount: Math.round((payment.amount * rate) / 100), label: `수습기간 ${rate}%` }];
  },
];

/** 결제에 적용되는 기간별 금액 (계약서 기준 금액과 다른 기간) */
export function amountPeriods(record: Pick<ContractRecord, 'contract' | 'dates'>, payment: ContractPayment): AmountPeriod[] {
  return AMOUNT_RULES.flatMap((rule) => rule(record, payment));
}

/** 계약서상 지급일(nominal) 기준으로 그 회차 금액 */
export function amountOn(periods: readonly AmountPeriod[], payment: ContractPayment, nominalDate: ISODate): { amount: number; note: string | null } {
  const p = periods.find((x) => nominalDate >= x.from && nominalDate <= x.to);
  return p ? { amount: p.amount, note: p.label } : { amount: payment.amount, note: null };
}

/** 기간 경계 일정 (수습기간 종료 예정 등) */
export function periodBoundaries(record: Pick<ContractRecord, 'contract' | 'dates'>): PeriodBoundary[] {
  const p = probationPeriod(record);
  return p ? [{ key: 'probation-end', label: '수습기간 종료 예정', date: p.to, period: { from: p.from, to: p.to } }] : [];
}
