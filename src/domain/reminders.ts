import { profileFor, profileKeyOf } from './contractKinds';
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
import { fundViews, type FundView } from "./cashflow";
import { formatWon } from "./money";
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
  /** 보증금·예치금 반환 확인 (반환 예정일 또는 계약 종료일 기준) — 기준일이 지나도 반환 기록이 없으면 PACTO가 이어서 알린다 */
  depositReturn: readonly number[];
}

/** PACTO 기본 알림 시점 */
export const REMINDER_RULES: ReminderRules = {
  contractEnd: [90, 30, 7],
  renewal: [30, 7],
  terminationNotice: [30, 7, 1, 0],
  renewalNotice: [30, 7, 1, 0],
  renewalDecision: [30, 7],
  payment: [1],
  depositReturn: [30, 7, 0],
};

/** 반환 확인 기준일이 지났는데 반환 기록이 없을 때 이어서 알리는 시점 (기준일 + N일) — PACTO 고정, 그 종류 알림을 끄면 함께 꺼짐 */
export const DEPOSIT_FOLLOW_UP_DAYS: readonly number[] = [7, 30, 60, 90];

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
    { label: "보증금 반환 확인", when: rules.depositReturn.length ? `${offsetsText(rules.depositReturn)} · 반환 전까지 이후에도` : offsetsText(rules.depositReturn) },
  ];
}

export type ReminderKind =
  | "contract_end"
  | "renewal"
  | "termination_notice"
  | "payment"
  | "deposit_return";

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
  /** 기한까지 남은 날 (D-30 → 30). 기준일이 지난 뒤 알림(보증금 반환 확인)은 음수 (+7일 → -7) */
  daysBefore: number;
  /** 해야 할 일 문장 (보증금 반환 확인 — 받을 쪽/줄 쪽/모름에 따라 다름). 없으면 종류별 기본 안내 */
  hint?: string;
}

const KIND_TARGET_LABEL: Record<Exclude<ReminderKind, "payment">, string> = {
  contract_end: "계약 종료",
  renewal: "자동갱신 예정일",
  termination_notice: "해지 통보기한",
  deposit_return: "보증금 반환 확인",
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

/**
 * 결제 알림 문구 — 돈의 방향별로 (방향을 모르는 금액을 "결제일"로 안내하지 않는다)
 *   출금 확정: "내일 월세 결제일입니다." / 입금 확정: "내일 월 급여 수령 예정일입니다."
 *   방향 확인 필요: "내일 보증금 잔금 예정일이에요. 내는 돈인지 받는 돈인지 확인해주세요."
 * 선택형·조건부·참고 금액은 expandPayment가 일정으로 만들지 않아 알림도 없다
 */
export function paymentMessage(when: string, label: string, direction: Direction): string {
  if (direction === "expense") return `${when} ${label} 결제일입니다.`;
  if (direction === "income") return `${when} ${label} 수령 예정일입니다.`;
  return `${when} ${label} 예정일이에요. 내는 돈인지 받는 돈인지 확인해주세요.`;
}

/** 결제 알림의 종류·중요도 — 방향을 모르면 "확인 필요" 표시 (확정 일정처럼 보이지 않게) */
function paymentMeta(record: ContractRecord, direction: Direction) {
  const m = meta(record, direction === "income" ? "income" : "payment", []);
  if (direction !== "neutral") return m;
  return { ...m, needsReview: true, priority: getNotificationPriority(m.actionType, { source: m.source, needsReview: true }) };
}

/** 결제 알림 문구: 알림 날짜 기준 내일/오늘/N일 뒤 */
function paymentWhen(off: number): string {
  return off === 0 ? "오늘" : off === 1 ? "내일" : `${off}일 뒤`;
}

/**
 * 보증금 반환 확인 문구 — 반환이 확정되지 않았으므로 "입금됩니다"처럼 단정하지 않는다.
 * 기준: 계약서에 적힌 반환 예정일(explicit) / 계약 종료일(contract_end — 확정 반환일 아님)
 * 해야 할 일: 돌려받을 쪽 → 돌려받으면 기록 · 돌려줄 쪽 → 반환·정산 확인 · 모름 → 역할 확인
 */
export function depositReminderText(v: Pick<FundView, "label" | "checkBasis" | "userSide" | "refunded" | "remaining">, daysBefore: number): { message: string; hint: string } {
  const basisName = v.checkBasis === "explicit" ? `계약서에 적힌 ${v.label} 반환 예정일` : `${v.label} 반환 확인 기준일(계약 종료일)`;
  let message: string;
  if (daysBefore > 1) message = `${basisName}까지 ${daysBefore}일 남았어요.`;
  else if (daysBefore === 1) message = `내일이 ${basisName}이에요.`;
  else if (daysBefore === 0) message = `오늘이 ${basisName}이에요.`;
  else message = `${basisName}이 ${-daysBefore}일 지났는데 아직 반환 완료 기록이 없어요.`;
  const left = v.refunded > 0 ? `일부 반환 후 남은 금액 ${formatWon(v.remaining)}` : null;
  let hint: string;
  if (v.userSide === "depositor") hint = `${left ? `${left}을 ` : ""}돌려받으면 반환 기록을 남겨주세요.`;
  else if (v.userSide === "holder") hint = `${left ? `${left}의 ` : `돌려줄 ${v.label}의 `}반환·정산을 확인하고 기록해주세요.`;
  else hint = `${left ? `${left}의 ` : ""}반환·정산 상황을 확인해주세요. 이 계약에서 내 역할을 정하면 받을 돈인지 줄 돈인지 구분해 알려드려요.`;
  return { message, hint };
}

/**
 * 보증금·예치금 반환 확인 알림 — 계약 종료(상태)와 반환 완료(정산)는 따로 본다.
 * 계약이 끝났어도 반환이 끝나지 않았으면 계속 알리고, 반환 완료(남은 금액 0)면 알리지 않는다.
 * - 기준일 전: 사용자 설정 시점 (기본 30·7일 전과 당일)
 * - 기준일 후: 반환 기록이 없으면 +7·30·60·90일 (설정에서 이 종류를 끄면 함께 꺼짐)
 * - 자동갱신 중인 계약의 계약 종료일 기준은 반환 시점이 아니므로 알리지 않는다 (해지·종료 처리 후 또는 계약서 반환 예정일이 있으면 알림)
 */
function depositReminders(record: ContractRecord, rules: ReminderRules, today: ISODate, inWindow: (d: ISODate) => boolean): Reminder[] {
  if (rules.depositReturn.length === 0) return [];
  const { contract } = record;
  const out: Reminder[] = [];
  for (const v of fundViews(record, today)) {
    if (v.status === "returned" || v.remaining <= 0 || !v.checkDate || !v.checkBasis) continue;
    if (v.checkBasis === "contract_end" && contract.lifecycle === "active" && contract.autoRenewal) continue;
    const m = meta(record, "deposit_return", v.checkBasis === "explicit" ? [] : ["endDate"]);
    const slots = [
      ...rules.depositReturn.map((off) => ({ off, key: `deposit:${v.key}:${v.checkDate}:${off}` })),
      ...DEPOSIT_FOLLOW_UP_DAYS.map((n) => ({ off: -n, key: `deposit-after:${v.key}:${v.checkDate}:${n}` })),
    ];
    for (const { off, key } of slots) {
      const fireOn = addDays(v.checkDate, -off);
      if (!inWindow(fireOn)) continue;
      const text = depositReminderText(v, off);
      out.push({
        contractId: contract.id,
        contractTitle: contract.title,
        ...m,
        key,
        kind: "deposit_return",
        fireOn,
        targetDate: v.checkDate,
        label: `${v.label} 반환 확인`,
        // 반환은 확정 금액이 아니므로 결제 합계에 넣지 않는다
        amount: null,
        direction: null,
        estimated: false,
        daysBefore: off,
        message: text.message,
        hint: text.hint,
      });
    }
  }
  return out;
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
    if (!contract.notificationsEnabled) continue;
    const rules = opts.rulesFor ? opts.rulesFor(contract) : REMINDER_RULES;
    if (!rules) continue;
    // 보증금 반환 확인은 계약이 끝난 뒤에도 (반환이 끝날 때까지)
    out.push(...depositReminders(record, rules, today, inWindow));
    if (!isLive(contract, today)) continue;
    const base = { contractId: contract.id, contractTitle: contract.title };

    const term = currentTerm(contract, today);
    const endType: ActionEventType = /만기/.test(
      profileFor(contract).endEvent,
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
    const noticeLabel = noticeLabelOf(contract.noticeKind, profileKeyOf(contract));
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
            ...paymentMeta(record, p.direction),
            daysBefore: off,
            message: paymentMessage(paymentWhen(off), p.label, p.direction),
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
