import { addDays } from './dates';
import type { ContractPayment, ISODate, PaymentAmountChange } from './types';

/**
 * 반복 결제·수입의 날짜별 금액 — 홈·캘린더·알림·상세·지출·수입 계산이 모두 이 함수를 쓴다.
 * 원칙: 현재 조건이 바뀌어도 과거가 자동으로 다시 쓰이지 않는다.
 *   어떤 날짜의 금액 = 그 날짜 이전(포함)에 시작된 가장 최근 변경의 금액, 없으면 최초 금액(payment.amount)
 */

/** 적용일 순 변경 이력 */
export function sortedChanges(payment: Pick<ContractPayment, 'amountChanges'>): PaymentAmountChange[] {
  return [...(payment.amountChanges ?? [])].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
}

/** 그 날짜(계약서상 결제일 기준)에 적용되는 금액 */
export function amountAt(payment: Pick<ContractPayment, 'amount' | 'amountChanges'>, date: ISODate): number {
  return changeAt(payment, date)?.amount ?? payment.amount;
}

/** 그 날짜에 적용 중인 변경 (없으면 null = 최초 금액) */
export function changeAt(payment: Pick<ContractPayment, 'amountChanges'>, date: ISODate): PaymentAmountChange | null {
  let hit: PaymentAmountChange | null = null;
  for (const c of sortedChanges(payment)) {
    if (c.effectiveFrom <= date) hit = c;
    else break;
  }
  return hit;
}

export interface AmountVersion {
  /** 적용 시작 (최초 금액은 결제 시작일) */
  from: ISODate;
  /** 적용 끝 (다음 변경 전날). null = 계속 */
  to: ISODate | null;
  amount: number;
  /** null = 최초 금액 */
  change: PaymentAmountChange | null;
}

/** 금액 기간 목록 — effective_to는 저장하지 않고 다음 변경 적용일 - 1일로 계산 */
export function amountVersions(payment: Pick<ContractPayment, 'amount' | 'amountChanges' | 'startsOn'>): AmountVersion[] {
  const changes = sortedChanges(payment);
  const versions: AmountVersion[] = [{ from: payment.startsOn, to: null, amount: payment.amount, change: null }];
  for (const c of changes) {
    versions[versions.length - 1].to = addDays(c.effectiveFrom, -1);
    versions.push({ from: c.effectiveFrom, to: null, amount: c.amount, change: c });
  }
  return versions;
}

/** 오늘 기준 금액이 적용된 결제 (목록·상세의 "현재 금액" 표시용 — 일정 전개에는 쓰지 않는다) */
export function withAmountAt<P extends Pick<ContractPayment, 'amount' | 'amountChanges'>>(payment: P, date: ISODate): P {
  return payment.amountChanges?.length ? { ...payment, amount: amountAt(payment, date) } : payment;
}
