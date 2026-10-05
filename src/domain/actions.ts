import { daysUntil } from './dday';
import { currentTerm, deriveStatus, isLive, terminationNoticeDeadline } from './status';
import type { ContractCategory, ContractRecord, ContractStatus, ISODate } from './types';

/** "곧 종료/갱신되는 계약"으로 보는 기간 (일). */
export const UPCOMING_END_DAYS = 180;

export interface UpcomingEnd {
  contractId: string;
  contractTitle: string;
  category: ContractCategory;
  date: ISODate;
  days: number;
  autoRenewal: boolean;
  /** 아직 지나지 않은 해지 통보기한 (자동갱신 계약) */
  noticeDate: ISODate | null;
}

/** 곧 종료/갱신되는 계약 (종료일 순). excludeIds: 이미 "처리할 계약"에 나온 계약. */
export function upcomingEnds(
  records: ContractRecord[],
  today: ISODate,
  excludeIds: ReadonlySet<string> = new Set(),
  horizonDays: number = UPCOMING_END_DAYS,
): UpcomingEnd[] {
  const out: UpcomingEnd[] = [];
  for (const { contract } of records) {
    if (excludeIds.has(contract.id) || !isLive(contract, today)) continue;
    const term = currentTerm(contract, today);
    if (!term) continue;
    const days = daysUntil(term.termEnd, today);
    if (days < 0 || days > horizonDays) continue;
    out.push({
      contractId: contract.id,
      contractTitle: contract.title,
      category: contract.category,
      date: term.termEnd,
      days,
      autoRenewal: contract.autoRenewal,
      noticeDate: (() => {
        const n = terminationNoticeDeadline(contract, today);
        return n && !n.passed ? n.date : null;
      })(),
    });
  }
  return out.sort((a, b) => a.days - b.days);
}

export interface StatusSummary {
  /** 진행중(종료 임박·갱신 예정 포함) */
  live: number;
  endingSoon: number;
  renewalDue: number;
  closed: number;
}

export function statusSummary(records: ContractRecord[], today: ISODate): StatusSummary {
  const counts: Record<ContractStatus, number> = { active: 0, ending_soon: 0, renewal_due: 0, ended: 0, cancelled: 0 };
  for (const { contract } of records) counts[deriveStatus(contract, today)] += 1;
  return {
    live: counts.active + counts.ending_soon + counts.renewal_due,
    endingSoon: counts.ending_soon,
    renewalDue: counts.renewal_due,
    closed: counts.ended + counts.cancelled,
  };
}
