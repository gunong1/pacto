/**
 * 알림 묶기 (화면·발송 전용) — 알림 원본(Reminder: 결제 한 건, 통보기한 한 번 …)은 그대로 두고
 * 같은 계약 + 같은 알림 날짜(fireOn)를 알림 하나로 합친다. 푸시도 이 묶음 하나당 한 번 보낸다.
 *
 * - 알림 날짜(언제 알려주는지)와 일정 날짜(실제 결제일·기한)를 따로 보여준다.
 * - 화면 목록에서는 같은 계약의 반복 결제 알림을 가장 가까운 것만 펼치고, 이후는 "이후 매월 11일 알림 예정"으로 줄인다.
 *   해지 통보기한·만료·갱신 알림은 줄이지 않는다 (행동이 필요한 알림).
 */
import { addMonths, formatMonthDayKo, parseISODate } from './dates';
import { daysUntil } from './dday';
import { formatWon } from './money';
import type { Reminder, ReminderKind } from './reminders';
import type { Direction, ISODate } from './types';

export const REMINDER_KIND_LABEL: Record<ReminderKind, string> = {
  termination_notice: '해지 통보기한',
  renewal: '자동갱신',
  contract_end: '만료',
  payment: '결제',
};

const PRIORITY: Record<ReminderKind, number> = { termination_notice: 0, renewal: 1, contract_end: 2, payment: 3 };

export interface ReminderGroup {
  key: string;
  contractId: string;
  contractTitle: string;
  /** 알림이 울리는 날 */
  fireOn: ISODate;
  /** 대표 종류 (통보기한 > 갱신 > 만료 > 결제) */
  kind: ReminderKind;
  /** "가정용 공기청정기 렌탈계약서 · 결제" */
  title: string;
  /** "내일 49,900원 결제 예정이에요." */
  message: string;
  /** "월 렌탈료 29,900원 · 설치비 20,000원" */
  detail: string | null;
  /** 실제 일정 날짜: "10월 12일 월 렌탈료 · 설치비 결제" */
  eventLines: string[];
  /** 원본 알림 (합쳐도 지우지 않는다) */
  reminders: Reminder[];
}

/** 같은 계약 + 같은 알림 날짜 → 알림 하나 (발송 단위) */
export function groupReminders(reminders: readonly Reminder[]): ReminderGroup[] {
  const buckets = new Map<string, Reminder[]>();
  for (const r of reminders) {
    const k = `${r.contractId}|${r.fireOn}`;
    const b = buckets.get(k);
    if (b) b.push(r);
    else buckets.set(k, [r]);
  }
  return [...buckets.entries()]
    .map(([key, list]) => summarize(key, list))
    .sort((a, b) => a.fireOn.localeCompare(b.fireOn) || PRIORITY[a.kind] - PRIORITY[b.kind] || a.contractTitle.localeCompare(b.contractTitle));
}

/** 알림 날짜 기준 일정까지 남은 날: 내일 / 오늘 / 3일 뒤 */
function relative(fireOn: ISODate, target: ISODate): string {
  const d = daysUntil(target, fireOn);
  return d === 0 ? '오늘' : d === 1 ? '내일' : `${d}일 뒤`;
}

const DIRECTION_ORDER: Direction[] = ['expense', 'income', 'neutral'];

/** 결제 알림 금액 요약 — 방향별 합계 문구와 세부 내역 */
function paymentSummary(pays: Reminder[]): { headline: string; detail: string | null } {
  const heads: string[] = [];
  for (const dir of DIRECTION_ORDER) {
    const xs = pays.filter((p) => p.direction === dir && p.amount != null);
    if (xs.length === 0) continue;
    const won = `${formatWon(xs.reduce((s, p) => s + p.amount!, 0))}${xs.some((p) => p.estimated) ? '(예상)' : ''}`;
    heads.push(dir === 'expense' ? `${won} 결제 예정` : dir === 'income' ? `+${won} 입금 예정` : `${won}(보증금 등) 예정`);
  }
  const detail = pays.length > 1 ? pays.map((p) => `${p.label} ${formatWon(p.amount ?? 0)}`).join(' · ') : (pays[0]?.label ?? null);
  return { headline: heads.join(', '), detail };
}

function summarize(key: string, list: Reminder[]): ReminderGroup {
  const sorted = [...list].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.targetDate.localeCompare(b.targetDate));
  const head = sorted[0];
  const pays = sorted.filter((r) => r.kind === 'payment');
  let message: string;
  let detail: string | null;
  if (head.kind === 'payment') {
    const { headline, detail: d } = paymentSummary(pays);
    message = `${relative(head.fireOn, head.targetDate)} ${headline}이에요.`;
    detail = d;
  } else {
    // 행동이 필요한 알림이 대표, 같은 날 결제는 아래에 함께
    message = head.message;
    const others = sorted.slice(1).filter((r) => r.kind !== 'payment').map((r) => r.message);
    const pay = pays.length ? paymentSummary(pays) : null;
    detail = [...others, ...(pay ? [`${relative(pays[0].fireOn, pays[0].targetDate)} ${pay.headline} · ${pay.detail ?? ''}`.replace(/ · $/, '')] : [])].join('\n') || null;
  }
  return {
    key,
    contractId: head.contractId,
    contractTitle: head.contractTitle,
    fireOn: head.fireOn,
    kind: head.kind,
    title: `${head.contractTitle} · ${REMINDER_KIND_LABEL[head.kind]}`,
    message,
    detail,
    eventLines: eventLines(sorted),
    reminders: list,
  };
}

/** 실제 일정 날짜 줄 — 알림 날짜와 헷갈리지 않도록 일정 이름과 함께 */
function eventLines(list: Reminder[]): string[] {
  const lines = new Map<string, string[]>();
  for (const r of list) {
    const k = `${r.targetDate}|${r.kind}|${r.kind === 'payment' ? (r.direction === 'income' ? 'in' : 'out') : ''}`;
    const labels = lines.get(k) ?? [];
    if (!labels.includes(r.label)) labels.push(r.label);
    lines.set(k, labels);
  }
  return [...lines.entries()].map(([k, labels]) => {
    const [date, kind, dir] = k.split('|');
    const when = formatMonthDayKo(date);
    return kind === 'payment' ? `${when} ${labels.join(' · ')} ${dir === 'in' ? '입금' : '결제'}` : `${when} ${labels.join(' · ')}`;
  });
}

export interface ReminderDigestItem {
  group: ReminderGroup;
  /** 같은 계약의 이후 반복 결제 알림 요약 ("이후 매월 11일 알림 예정") */
  followUp: { count: number; text: string; fireDates: ISODate[] } | null;
}

/**
 * 화면 목록: 계약별 결제만 있는 알림은 가장 가까운 것만 펼치고 이후 반복은 한 줄로.
 * 통보기한·만료·갱신이 섞인 알림은 그대로 모두 보여준다.
 */
export function reminderDigest(groups: readonly ReminderGroup[]): ReminderDigestItem[] {
  const out: ReminderDigestItem[] = [];
  const firstPay = new Map<string, ReminderDigestItem>();
  const later = new Map<string, ISODate[]>();
  for (const g of groups) {
    const paymentOnly = g.reminders.every((r) => r.kind === 'payment');
    const lead = paymentOnly ? firstPay.get(g.contractId) : undefined;
    if (lead) {
      later.set(g.contractId, [...(later.get(g.contractId) ?? []), g.fireOn]);
      continue;
    }
    const item: ReminderDigestItem = { group: g, followUp: null };
    if (paymentOnly) firstPay.set(g.contractId, item);
    out.push(item);
  }
  for (const [contractId, dates] of later) {
    const lead = firstPay.get(contractId)!;
    lead.followUp = { count: dates.length, fireDates: dates, text: followUpText(lead.group.fireOn, dates) };
  }
  return out;
}

/** 매달 같은 날이면 "이후 매월 11일 알림 예정", 아니면 "이후 알림 2건 더 (11월 11일부터)" */
function followUpText(first: ISODate, dates: ISODate[]): string {
  const day = parseISODate(first).day;
  const monthly = dates.every((d, i) => d === addMonths(first, i + 1) && parseISODate(d).day === day);
  return monthly ? `이후 매월 ${day}일 알림 예정` : `이후 알림 ${dates.length}건 더 (${formatMonthDayKo(dates[0])}부터)`;
}
