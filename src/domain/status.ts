import { addDays, addMonths } from './dates';
import { daysUntil } from './dday';
import type { Contract, ContractStatus, ISODate } from './types';

/** 종료 임박/갱신 예정으로 보는 기준 (일). */
export const ENDING_SOON_DAYS = 30;

export interface TermInfo {
  /** 현재 회차 종료일. 자동갱신이 지난 경우 갱신 회차로 계산된 날짜. */
  termEnd: ISODate;
  /** 자동갱신으로 회차를 넘겨 계산했는지 (사용자 확인 필요). */
  isEstimatedRenewal: boolean;
  renewalCount: number;
}

/**
 * 현재 회차 종료일.
 * 자동갱신 계약이 원래 종료일을 지났다면 갱신주기만큼 넘겨 계산한다.
 * DB 값(endDate)은 바꾸지 않는다 — 사용자가 확인 후 수정.
 */
export function currentTerm(contract: Contract, today: ISODate): TermInfo | null {
  const { endDate, autoRenewal, renewalPeriodMonths, lifecycle } = contract;
  if (!endDate) return null;
  if (lifecycle !== 'active' || !autoRenewal || !renewalPeriodMonths || endDate >= today) {
    return { termEnd: endDate, isEstimatedRenewal: false, renewalCount: 0 };
  }
  let k = 0;
  let termEnd = endDate;
  while (termEnd < today) {
    k += 1;
    termEnd = addMonths(endDate, k * renewalPeriodMonths);
  }
  return { termEnd, isEstimatedRenewal: true, renewalCount: k };
}

export interface NoticeDeadline {
  date: ISODate;
  /** 현재 회차의 기한이 이미 지났는지. */
  passed: boolean;
}

/** 해지 통보기한 = 현재 회차 종료일 − 통보일수. */
export function terminationNoticeDeadline(contract: Contract, today: ISODate): NoticeDeadline | null {
  if (contract.terminationNoticeDays == null || contract.lifecycle !== 'active') return null;
  const term = currentTerm(contract, today);
  if (!term) return null;
  const date = addDays(term.termEnd, -contract.terminationNoticeDays);
  return { date, passed: date < today };
}

/** 화면 표시용 상태. 진행/종료/해지만 저장하고 나머지는 날짜로 계산. */
export function deriveStatus(
  contract: Contract,
  today: ISODate,
  thresholdDays: number = ENDING_SOON_DAYS,
): ContractStatus {
  if (contract.lifecycle === 'cancelled') return 'cancelled';
  if (contract.lifecycle === 'ended') return 'ended';
  if (!contract.endDate) return 'active';
  if (!contract.autoRenewal && contract.endDate < today) return 'ended';

  const term = currentTerm(contract, today);
  if (!term) return 'active';
  const days = daysUntil(term.termEnd, today);
  if (contract.autoRenewal && days <= thresholdDays) return 'renewal_due';
  if (days <= thresholdDays) return 'ending_soon';
  return 'active';
}

/** 현재 유효(지출·일정 계산 대상)한 계약인지. */
export function isLive(contract: Contract, today: ISODate): boolean {
  const status = deriveStatus(contract, today);
  return status !== 'ended' && status !== 'cancelled';
}

/**
 * 결제가 발생할 수 있는 마지막 날.
 * 해지/종료 처리 → 처리일, 자동갱신 → 제한 없음(null), 그 외 → 종료일.
 */
export function paymentCutoff(contract: Contract): ISODate | null {
  if (contract.lifecycle !== 'active') {
    // 처리일을 모르면 이후 결제는 없는 것으로 본다
    return contract.lifecycleChangedOn ?? contract.endDate ?? '0000-01-01';
  }
  if (contract.autoRenewal) return null;
  return contract.endDate;
}
