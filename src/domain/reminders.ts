import { addDays } from './dates';
import { expandPayment } from './schedule';
import { currentTerm, isLive, terminationNoticeDeadline } from './status';
import type { ContractRecord, ISODate } from './types';

/**
 * 알림 규칙 기본값. DB 단계에서는 notification_rules(P1) 테이블로 옮긴다.
 * V1(Step 1~4)에서는 "예정된 알림" 목록을 계산해 보여주기만 한다 (Push 미연결).
 */
export const REMINDER_RULES = {
  contractEnd: [90, 30, 7],
  renewal: [30, 7],
  terminationNotice: [7, 1, 0],
  paymentDaysBefore: 1,
} as const;

export type ReminderKind = 'contract_end' | 'renewal' | 'termination_notice' | 'payment';

export interface Reminder {
  key: string;
  kind: ReminderKind;
  fireOn: ISODate;
  targetDate: ISODate;
  contractId: string;
  contractTitle: string;
  message: string;
}

function offsetText(days: number): string {
  return days === 0 ? '오늘' : `${days}일 남았습니다`;
}

/** today ~ today+horizonDays 사이에 울릴 알림. 계약별 알림이 꺼져 있으면 제외. */
export function upcomingReminders(records: ContractRecord[], today: ISODate, horizonDays = 60): Reminder[] {
  const until = addDays(today, horizonDays);
  const inWindow = (d: ISODate) => d >= today && d <= until;
  const out: Reminder[] = [];

  for (const record of records) {
    const { contract } = record;
    if (!contract.notificationsEnabled || !isLive(contract, today)) continue;
    const base = { contractId: contract.id, contractTitle: contract.title };

    const term = currentTerm(contract, today);
    if (term) {
      const offsets = contract.autoRenewal ? REMINDER_RULES.renewal : REMINDER_RULES.contractEnd;
      for (const off of offsets) {
        const fireOn = addDays(term.termEnd, -off);
        if (!inWindow(fireOn)) continue;
        out.push({
          ...base,
          key: `end:${contract.id}:${off}`,
          kind: contract.autoRenewal ? 'renewal' : 'contract_end',
          fireOn,
          targetDate: term.termEnd,
          message: contract.autoRenewal
            ? `자동갱신 예정일까지 ${off}일 남았습니다.`
            : `계약 종료까지 ${off}일 남았습니다.`,
        });
      }
    }

    const notice = terminationNoticeDeadline(contract, today);
    if (notice && !notice.passed) {
      for (const off of REMINDER_RULES.terminationNotice) {
        const fireOn = addDays(notice.date, -off);
        if (!inWindow(fireOn)) continue;
        out.push({
          ...base,
          key: `notice:${contract.id}:${off}`,
          kind: 'termination_notice',
          fireOn,
          targetDate: notice.date,
          message:
            off === 0
              ? '오늘은 해지 통보기한입니다. 자동갱신을 원하지 않으면 오늘까지 해지 의사를 전달해주세요.'
              : `자동갱신 방지를 위한 해지 통보기한이 ${offsetText(off)}.`,
        });
      }
    }

    for (const p of record.payments) {
      for (const o of expandPayment(p, contract, { start: today, end: addDays(until, REMINDER_RULES.paymentDaysBefore) })) {
        const fireOn = addDays(o.date, -REMINDER_RULES.paymentDaysBefore);
        if (!inWindow(fireOn)) continue;
        out.push({
          ...base,
          key: `pay:${p.id}:${o.date}`,
          kind: 'payment',
          fireOn,
          targetDate: o.date,
          message: `내일 ${p.label} 결제일입니다.`,
        });
      }
    }
  }

  // 사용자 일정 알림은 P1 notification_rules 도입 시 추가
  return out.sort((a, b) => a.fireOn.localeCompare(b.fireOn) || a.contractTitle.localeCompare(b.contractTitle));
}
