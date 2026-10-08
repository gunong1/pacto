import { profileOf } from "./contractTypes";
import { noticeActionType, noticeLabelOf, type NoticeKind } from "./noticeKind";
import { addDays } from "./dates";
import {
  contractTermSource,
  findEvidence,
  getNotificationPriority,
  termNeedsReview,
  type ActionEventType,
  type NotificationEvidence,
  type NotificationPriority,
  type NotificationSource,
} from "./notificationPriority";
import { expandPayment } from "./schedule";
import { currentTerm, isLive, terminationNoticeDeadline } from "./status";
import type { ContractRecord, Direction, ISODate } from "./types";

/**
 * 알림 시점 (기한 며칠 전에 알려줄지) — 기한 자체를 만드는 규칙이 아니다.
 * 예: 계약서 기준 해지 통보기한 2029-09-11 → PACTO가 30일·7일·1일 전과 당일에 알림.
 * 빈 목록 = 그 종류 알림을 보내지 않음. 사용자 설정·계약별 설정은 notifications.ts에서 이 형식으로 바꾼다.
 */
export interface ReminderRules {
  contractEnd: readonly number[];
  renewal: readonly number[];
  /** 해지·종료 통보기한 (의미를 확정할 수 없는 통보기한도 놓치지 않도록 이 시점을 쓴다) */
  terminationNotice: readonly number[];
  /** 갱신 통보기한 */
  renewalNotice: readonly number[];
  /** 갱신 여부 확인·협의 시점 */
  renewalDecision: readonly number[];
  payment: readonly number[];
}

/** PACTO 기본 알림 시점 */
export const REMINDER_RULES: ReminderRules = {
  contractEnd: [90, 30, 7],
  renewal: [30, 7],
  terminationNotice: [30, 7, 1, 0],
  renewalNotice: [30, 7, 1, 0],
  renewalDecision: [30, 7],
  payment: [1],
};

/** "30·7·1일 전과 당일" / "하루 전" / "당일" / "꺼짐" */
export function offsetsText(xs: readonly number[]): string {
  if (xs.length === 0) return "꺼짐";
  const before = [...xs].filter((d) => d > 0).sort((a, b) => b - a);
  if (before.length === 0) return "당일";
  if (before.length === 1 && before[0] === 1)
    return xs.includes(0) ? "하루 전과 당일" : "하루 전";
  return `${before.join("·")}일 전${xs.includes(0) ? "과 당일" : ""}`;
}

/** 알림 규칙 요약 (설정 값에서 만든다 — 숫자를 화면에 따로 적지 않도록) */
export function reminderPolicySummary(
  rules: ReminderRules = REMINDER_RULES,
): { label: string; when: string }[] {
  return [
    { label: "결제·입금", when: offsetsText(rules.payment) },
    // 설정 화면과 같은 묶음 — 해지·종료 통보기한과 갱신 통보기한은 한 줄 (함께 저장된다)
    { label: "해지·갱신 통보기한", when: offsetsText(rules.terminationNotice) },
    { label: "갱신 여부 확인", when: offsetsText(rules.renewalDecision) },
    { label: "계약 만료", when: offsetsText(rules.contractEnd) },
    { label: "자동갱신 예정일", when: offsetsText(rules.renewal) },
  ];
}

export type ReminderKind =
  | "contract_end"
  | "renewal"
  | "termination_notice"
  | "payment";

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

const KIND_TARGET_LABEL: Record<Exclude<ReminderKind, "payment">, string> = {
  contract_end: "계약 종료",
  renewal: "자동갱신 예정일",
  termination_notice: "해지 통보기한",
};

/** 통보기한 종류별 알림 시점 — 의미가 불확실한 기한(unknown)은 해지·종료 통보기한 시점으로 놓치지 않게 */
function noticeOffsets(rules: ReminderRules, kind: NoticeKind): readonly number[] {
  if (kind === "renewal_notice") return rules.renewalNotice;
  if (kind === "renewal_decision") return rules.renewalDecision;
  return rules.terminationNotice;
}

/** 통보기한 단계별 문구 — 결제 알림 문법("내일 …입니다")과 다르게, 해야 할 일을 먼저. 계약서 의미를 더 강하게 쓰지 않는다 */
function noticeMessage(kind: NoticeKind, label: string, off: number): string {
  if (kind === "renewal_decision")
    return off === 0
      ? "오늘까지 갱신 여부를 상대방과 협의해주세요."
      : `${label}까지 ${off}일 남았어요. 갱신 여부를 상대방과 협의해보세요.`;
  if (kind === "unknown")
    return off === 0
      ? "오늘이 통보·갱신 관련 기한이에요. 이 일정의 의미를 확인해주세요."
      : `통보·갱신 관련 기한까지 ${off}일 남았어요. 이 일정의 의미를 확인해주세요.`;
  if (kind === "renewal_notice") {
    if (off === 0) return `오늘이 ${label}입니다. 오늘까지 갱신 또는 갱신 거절 의사를 알려주세요.`;
    if (off === 1) return `내일이 ${label}이에요. 갱신 여부를 미리 정해두세요.`;
    return `${label}까지 ${off}일 남았어요.`;
  }
  if (off === 0)
    return `오늘이 ${label}입니다. 갱신을 원하지 않으면 오늘까지 의사를 알려주세요.`;
  if (off === 1)
    return `내일이 ${label}이에요. 갱신을 원하지 않으면 미리 의사를 알려주세요.`;
  if (off <= 7) return `${label}이 ${off}일 남았어요.`;
  return `${label}까지 ${off}일 남았어요. 해지·갱신 여부를 미리 확인해보세요.`;
}

/** 일정 날짜의 출처·중요도·근거 (알림 시점과 무관) */
function meta(
  record: ContractRecord,
  actionType: ActionEventType,
  fields: readonly string[],
) {
  const source = contractTermSource(record.contract);
  const needsReview = termNeedsReview(record.contract, fields);
  return {
    actionType,
    source,
    needsReview,
    priority: getNotificationPriority(actionType, { source, needsReview }),
    evidence: findEvidence(record, actionType, source),
  };
}

/** 결제 알림 문구: 알림 날짜 기준 내일/오늘/N일 뒤 */
function paymentWhen(off: number): string {
  return off === 0 ? "오늘" : off === 1 ? "내일" : `${off}일 뒤`;
}

/**
 * today ~ today+horizonDays 사이에 울릴 알림. 계약별 알림이 꺼져 있으면 제외.
 * rulesFor: 계약마다 적용할 알림 시점 (사용자 설정 + 계약별 설정). 없으면 PACTO 기본값, null이면 그 계약 알림 없음.
 */
export function upcomingReminders(
  records: ContractRecord[],
  today: ISODate,
  horizonDays = 60,
  opts: {
    rulesFor?: (contract: ContractRecord["contract"]) => ReminderRules | null;
  } = {},
): Reminder[] {
  const until = addDays(today, horizonDays);
  const inWindow = (d: ISODate) => d >= today && d <= until;
  const out: Reminder[] = [];

  for (const record of records) {
    const { contract } = record;
    if (!contract.notificationsEnabled || !isLive(contract, today)) continue;
    const rules = opts.rulesFor ? opts.rulesFor(contract) : REMINDER_RULES;
    if (!rules) continue;
    const base = { contractId: contract.id, contractTitle: contract.title };

    const term = currentTerm(contract, today);
    const endType: ActionEventType = /만기/.test(
      profileOf(contract.contractType).endEvent,
    )
      ? "maturity"
      : "contract_end";
    if (term) {
      const offsets = contract.autoRenewal ? rules.renewal : rules.contractEnd;
      for (const off of offsets) {
        const fireOn = addDays(term.termEnd, -off);
        if (!inWindow(fireOn)) continue;
        out.push({
          ...base,
          ...meta(
            record,
            contract.autoRenewal ? "renewal" : endType,
            contract.autoRenewal
              ? ["endDate", "renewalPeriodMonths"]
              : ["endDate"],
          ),
          daysBefore: off,
          key: `end:${contract.id}:${term.termEnd}:${off}`,
          kind: contract.autoRenewal ? "renewal" : "contract_end",
          fireOn,
          targetDate: term.termEnd,
          label:
            KIND_TARGET_LABEL[
              contract.autoRenewal ? "renewal" : "contract_end"
            ],
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
    const noticeLabel = noticeLabelOf(contract.noticeKind, contract.contractType);
    const noticeMeta = meta(record, noticeActionType(contract.noticeKind), [
      "endDate",
      "terminationNoticeDays",
    ]);
    // 의미가 불확실한 통보기한은 확인 필요 (critical로 단정하지 않음)
    if (contract.noticeKind === "unknown") {
      noticeMeta.needsReview = true;
      noticeMeta.priority = getNotificationPriority(noticeMeta.actionType, { source: noticeMeta.source, needsReview: true });
    }
    if (notice && !notice.passed) {
      for (const off of noticeOffsets(rules, contract.noticeKind)) {
        const fireOn = addDays(notice.date, -off);
        if (!inWindow(fireOn)) continue;
        out.push({
          ...base,
          ...noticeMeta,
          key: `notice:${contract.id}:${notice.date}:${off}`,
          kind: "termination_notice",
          fireOn,
          targetDate: notice.date,
          label: noticeLabel,
          amount: null,
          direction: null,
          estimated: false,
          daysBefore: off,
          message: noticeMessage(contract.noticeKind, noticeLabel, off),
        });
      }
    }

    const maxPayOff = Math.max(0, ...rules.payment);
    for (const p of rules.payment.length ? record.payments : []) {
      for (const o of expandPayment(
        p,
        contract,
        { start: today, end: addDays(until, maxPayOff) },
        record.dates,
      )) {
        for (const off of rules.payment) {
          const fireOn = addDays(o.date, -off);
          if (!inWindow(fireOn)) continue;
          out.push({
            ...base,
            key: `pay:${p.id}:${o.date}:${off}`,
            kind: "payment",
            fireOn,
            targetDate: o.date,
            ...meta(
              record,
              p.direction === "income" ? "income" : "payment",
              [],
            ),
            daysBefore: off,
            message: `${paymentWhen(off)} ${p.label} ${p.direction === "income" ? "입금" : "결제"}일입니다.`,
            label: o.installment
              ? `${p.label} ${o.installment.no}/${o.installment.total}회`
              : p.label,
            amount: o.amount,
            direction: p.direction,
            estimated: o.estimated,
          });
        }
      }
    }
  }

  // 사용자 일정 알림은 P1 notification_rules 도입 시 추가
  return out.sort(
    (a, b) =>
      a.fireOn.localeCompare(b.fireOn) ||
      a.contractTitle.localeCompare(b.contractTitle),
  );
}
