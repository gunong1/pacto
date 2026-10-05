import { daysUntil } from './dday';
import { currentTerm, deriveStatus, isLive, terminationNoticeDeadline } from './status';
import type { ContractCategory, ContractRecord, ContractStatus, ISODate } from './types';

/** "지금 처리해야 할 계약"으로 보는 기간 (일). */
export const ACTION_WINDOW_DAYS = 30;
/** "곧 종료/갱신되는 계약"으로 보는 기간 (일). */
export const UPCOMING_END_DAYS = 180;

export type ActionKind = 'termination_notice' | 'contract_end' | 'renewal' | 'custom';

export interface ActionItem {
  key: string;
  kind: ActionKind;
  contractId: string;
  contractTitle: string;
  category: ContractCategory;
  date: ISODate;
  days: number;
  label: string;
}

/**
 * 사용자가 행동해야 하는 항목: 해지 통보기한, 만료, 자동갱신, 사용자 일정.
 * 결제일은 반복적이라 여기 넣지 않고 캘린더/지출에서 보여준다.
 */
export function actionItems(
  records: ContractRecord[],
  today: ISODate,
  windowDays: number = ACTION_WINDOW_DAYS,
): ActionItem[] {
  const out: ActionItem[] = [];
  for (const { contract, events } of records) {
    if (!isLive(contract, today)) continue;
    const base = { contractId: contract.id, contractTitle: contract.title, category: contract.category };
    const within = (date: ISODate) => {
      const d = daysUntil(date, today);
      return d >= 0 && d <= windowDays ? d : null;
    };

    const notice = terminationNoticeDeadline(contract, today);
    if (notice && !notice.passed) {
      const d = within(notice.date);
      if (d != null) out.push({ ...base, key: `notice:${contract.id}`, kind: 'termination_notice', date: notice.date, days: d, label: '해지 통보기한' });
    }

    const term = currentTerm(contract, today);
    if (term) {
      const d = within(term.termEnd);
      if (d != null) {
        out.push(
          contract.autoRenewal
            ? { ...base, key: `renew:${contract.id}`, kind: 'renewal', date: term.termEnd, days: d, label: '자동갱신 예정' }
            : { ...base, key: `end:${contract.id}`, kind: 'contract_end', date: term.termEnd, days: d, label: '계약 만료' },
        );
      }
    }

    for (const e of events) {
      if (e.completedAt || e.eventType === 'payment') continue;
      const d = within(e.eventDate);
      if (d != null) out.push({ ...base, key: `event:${e.id}`, kind: 'custom', date: e.eventDate, days: d, label: e.title });
    }
  }
  return out.sort((a, b) => a.days - b.days || a.contractTitle.localeCompare(b.contractTitle));
}

export interface UpcomingEnd {
  contractId: string;
  contractTitle: string;
  category: ContractCategory;
  date: ISODate;
  days: number;
  autoRenewal: boolean;
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
