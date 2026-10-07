import { profileOf } from './contractTypes';
import { addDays } from './dates';
import {
  contractTermSource,
  findEvidence,
  getNotificationPriority,
  termNeedsReview,
  type ActionEventType,
  type NotificationEvidence,
  type NotificationPriority,
  type NotificationSource,
} from './notificationPriority';
import { expandPayment } from './schedule';
import { currentTerm, isLive, terminationNoticeDeadline } from './status';
import type { ContractRecord, Direction, ISODate } from './types';

/**
 * PACTO 알림 정책 (언제 미리 알려줄지) — 기한 자체를 만드는 규칙이 아니다.
 * 예: 계약서 기준 해지 통보기한 2029-09-11 → PACTO가 30일·7일·1일 전과 당일에 알림.
 * DB 단계에서는 notification_rules 테이블로 옮긴다. V1은 "예정된 알림"을 계산해 보여주기만 한다 (Push 미연결).
 */
export const REMINDER_RULES = {
  contractEnd: [90, 30, 7],
  renewal: [30, 7],
  terminationNotice: [30, 7, 1, 0],
  paymentDaysBefore: 1,
} as const;

/** 알림 화면에 보여줄 알림 규칙 요약 (REMINDER_RULES에서 만든다 — 숫자를 화면에 따로 적지 않도록) */
export function reminderPolicySummary(): { label: string; when: string }[] {
  const days = (xs: readonly number[]) => {
    const before = xs.filter((d) => d > 0);
    return `${before.join('·')}일 전${xs.includes(0) ? '과 당일' : ''}`;
  };
  return [
    { label: '결제·입금', when: REMINDER_RULES.paymentDaysBefore === 1 ? '하루 전' : `${REMINDER_RULES.paymentDaysBefore}일 전` },
    { label: '해지·종료 통보기한', when: days(REMINDER_RULES.terminationNotice) },
    { label: '계약 만료', when: days(REMINDER_RULES.contractEnd) },
    { label: '자동갱신 예정일', when: days(REMINDER_RULES.renewal) },
  ];
}

export type ReminderKind = 'contract_end' | 'renewal' | 'termination_notice' | 'payment';

/**
 * 알림 원본 한 건 — 결제·통보기한·만료 하나당 하나.
 * fireOn = 알림이 울리는 날, targetDate = 계약 일정 날짜(결제일·기한). 둘을 섞어 보여주지 않는다.
 * 화면·발송은 reminderGroups.ts에서 같은 계약 + 같은 알림 날짜끼리 하나로 묶는다.
 */
export interface Reminder {
  key: string;
  kind: ReminderKind;
  fireOn: ISODate;
  targetDate: ISODate;
  contractId: string;
  contractTitle: string;
  message: string;
  /** 일정 이름 (결제: 월 렌탈료·설치비 …, 그 외: 해지 통보기한 등) */
  label: string;
  /** 결제 알림의 금액·방향 (결제가 아니면 null) */
  amount: number | null;
  direction: Direction | null;
  estimated: boolean;
  /** 일정 종류·중요도·출처 (캘린더와 같은 규칙) — 출처는 일정 날짜의 출처, 알림 시점은 항상 PACTO 정책 */
  actionType: ActionEventType;
  priority: NotificationPriority;
  source: NotificationSource;
  needsReview: boolean;
  /** 계약서 근거 (계약서 기준 일정이고 관련 조항을 찾은 경우만) */
  evidence: NotificationEvidence | null;
  /** 기한까지 남은 날 (D-30 → 30) */
  daysBefore: number;
}

const KIND_TARGET_LABEL: Record<Exclude<ReminderKind, 'payment'>, string> = {
  contract_end: '계약 종료',
  renewal: '자동갱신 예정일',
  termination_notice: '해지 통보기한',
};

/** 통보기한 단계별 문구 — 결제 알림 문법("내일 …입니다")과 다르게, 해야 할 일을 먼저 */
function noticeMessage(label: string, off: number): string {
  if (off === 0) return `오늘이 ${label}입니다. 갱신을 원하지 않으면 오늘까지 의사를 알려주세요.`;
  if (off === 1) return `내일이 ${label}이에요. 갱신을 원하지 않으면 미리 의사를 알려주세요.`;
  if (off <= 7) return `${label}이 ${off}일 남았어요.`;
  return `${label}까지 ${off}일 남았어요. 해지·갱신 여부를 미리 확인해보세요.`;
}

/** 일정 날짜의 출처·중요도·근거 (알림 시점과 무관) */
function meta(record: ContractRecord, actionType: ActionEventType, fields: readonly string[]) {
  const source = contractTermSource(record.contract);
  const needsReview = termNeedsReview(record.contract, fields);
  return { actionType, source, needsReview, priority: getNotificationPriority(actionType, { source, needsReview }), evidence: findEvidence(record, actionType, source) };
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
    const endType: ActionEventType = /만기/.test(profileOf(contract.contractType).endEvent) ? 'maturity' : 'contract_end';
    if (term) {
      const offsets = contract.autoRenewal ? REMINDER_RULES.renewal : REMINDER_RULES.contractEnd;
      for (const off of offsets) {
        const fireOn = addDays(term.termEnd, -off);
        if (!inWindow(fireOn)) continue;
        out.push({
          ...base,
          ...meta(record, contract.autoRenewal ? 'renewal' : endType, contract.autoRenewal ? ['endDate', 'renewalPeriodMonths'] : ['endDate']),
          daysBefore: off,
          key: `end:${contract.id}:${off}`,
          kind: contract.autoRenewal ? 'renewal' : 'contract_end',
          fireOn,
          targetDate: term.termEnd,
          label: KIND_TARGET_LABEL[contract.autoRenewal ? 'renewal' : 'contract_end'],
          amount: null,
          direction: null,
          estimated: false,
          message: contract.autoRenewal
            ? `자동갱신 예정일까지 ${off}일 남았습니다.`
            : `계약 종료까지 ${off}일 남았습니다.`,
        });
      }
    }

    const notice = terminationNoticeDeadline(contract, today);
    const noticeLabel = profileOf(contract.contractType).noticeLabel;
    const noticeMeta = meta(record, 'termination_notice', ['endDate', 'terminationNoticeDays']);
    if (notice && !notice.passed) {
      for (const off of REMINDER_RULES.terminationNotice) {
        const fireOn = addDays(notice.date, -off);
        if (!inWindow(fireOn)) continue;
        out.push({
          ...base,
          ...noticeMeta,
          key: `notice:${contract.id}:${off}`,
          kind: 'termination_notice',
          fireOn,
          targetDate: notice.date,
          label: noticeLabel,
          amount: null,
          direction: null,
          estimated: false,
          daysBefore: off,
          message: noticeMessage(noticeLabel, off),
        });
      }
    }

    for (const p of record.payments) {
      for (const o of expandPayment(p, contract, { start: today, end: addDays(until, REMINDER_RULES.paymentDaysBefore) }, record.dates)) {
        const fireOn = addDays(o.date, -REMINDER_RULES.paymentDaysBefore);
        if (!inWindow(fireOn)) continue;
        out.push({
          ...base,
          key: `pay:${p.id}:${o.date}`,
          kind: 'payment',
          fireOn,
          targetDate: o.date,
          ...meta(record, p.direction === 'income' ? 'income' : 'payment', []),
          daysBefore: REMINDER_RULES.paymentDaysBefore,
          message: `내일 ${p.label} ${p.direction === 'income' ? '입금' : '결제'}일입니다.`,
          label: o.installment ? `${p.label} ${o.installment.no}/${o.installment.total}회` : p.label,
          amount: o.amount,
          direction: p.direction,
          estimated: o.estimated,
        });
      }
    }
  }

  // 사용자 일정 알림은 P1 notification_rules 도입 시 추가
  return out.sort((a, b) => a.fireOn.localeCompare(b.fireOn) || a.contractTitle.localeCompare(b.contractTitle));
}
