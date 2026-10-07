/**
 * 캘린더 요약 (화면 전용 view model) — "이 날짜에 이 계약 때문에 알아야 할 것"
 *
 * - 일정 원본(ScheduleItem: 결제·시작·주요 날짜·통보기한 …)은 그대로 두고, 같은 계약 + 같은 날짜만 카드 하나로 묶는다.
 *   계약이 다르면 같은 날·같은 회사여도 묶지 않는다.
 * - 같은 의미의 시작 일정(이용 시작 + 설치일 등)은 대표 문구 하나로 보여준다 (원본은 계약 상세에서 모두 확인).
 * - 금액은 결제 항목(확정 결제만 일정에 들어온다)만 방향별로 합산한다. 시작·종료·통보기한·내 일정은 금액을 만들지 않는다.
 * - 월 지출 합계(spending.ts)는 이 요약과 무관하게 결제 규칙에서 직접 계산한다 → 묶어도 합계가 바뀌지 않는다.
 */
import { formatWon } from './money';
import { NOTIFICATION_SOURCE_LABEL, type NotificationPriority } from './notificationPriority';
import type { ScheduleItem } from './schedule';
import type { ContractCategory, ContractDateKind, Direction, ISODate, ScheduleItemType } from './types';

const PRIORITY_RANK: Record<NotificationPriority, number> = { critical: 0, important: 1, normal: 2 };

/** 시작과 같은 의미의 주요 날짜 (같은 날 계약 시작이 있으면 따로 보여주지 않는다) */
const START_LIKE_DATE_KINDS: ReadonlySet<ContractDateKind> = new Set(['installation', 'activation', 'move_in', 'hire', 'handover']);

/** 시작 일정이 없을 때 주요 날짜로 대표 문구를 정한다 (예: 할부 차량 인도일 → 인도) */
const START_LIKE_LABEL: Partial<Record<ContractDateKind, string>> = {
  installation: '설치',
  activation: '개통',
  move_in: '입주',
  hire: '근무 시작',
  handover: '인도',
};

/**
 * 계약 시작과 같은 날의 시작 의미 날짜 → 대표 문구 하나
 * - 설치일: 이용 시작과 같은 뜻 → "이용 시작"
 * - 개통일·입사일: 더 구체적인 말로 → "개통" / "근무 시작"
 * - 입주일·인도일: 계약 시작과 별개 행동이라 함께 → "임대차 시작 · 입주"
 */
function mergedStartLabel(startTitle: string, kind: ContractDateKind | undefined): string {
  switch (kind) {
    case 'activation':
      return '개통';
    case 'hire':
      return '근무 시작';
    case 'move_in':
      return `${startTitle} · 입주`;
    case 'handover':
      return `${startTitle} · 인도`;
    default:
      return startTitle;
  }
}

/** 대표로 보여줄 순서 — 행동이 필요한 일정이 금액보다 앞선다 */
const PRIORITY: Record<ScheduleItemType, number> = {
  termination_notice: 0,
  renewal: 1,
  contract_end: 2,
  prepare: 3,
  payment: 4,
  contract_start: 5,
  key_date: 6,
  custom: 7,
};

/** 금액보다 위에 강조할 일정 (해지·갱신·종료·만기 확인) */
const ACTION_TYPES: ReadonlySet<ScheduleItemType> = new Set(['termination_notice', 'renewal', 'contract_end', 'prepare']);

export interface CashflowLine {
  label: string;
  amount: number;
  estimated: boolean;
}

export interface CashflowSummary {
  direction: Direction;
  total: number;
  items: CashflowLine[];
  estimated: boolean;
  /** "49,900원 결제 예정" / "3,600,000원 급여 예정" / "500만원 · 지출 합계 제외" */
  headline: string;
}

export interface CalendarContractGroup {
  key: string;
  contractId: string;
  date: ISODate;
  contractTitle: string;
  category: ContractCategory;
  /** 원본 일정 전체 (요약은 정보를 지우지 않는다) */
  items: ScheduleItem[];
  /** 대표 일정 (금액만 있는 날은 null) */
  primary: { type: ScheduleItemType; label: string; action: boolean; priority: NotificationPriority; sourceLabel: string | null; needsReview: boolean } | null;
  /** 묶음에서 가장 높은 중요도 (알림과 같은 규칙) */
  priority: NotificationPriority;
  /** 방향별 금액 (지출 → 수입 → 중립 순) */
  cashflows: CashflowSummary[];
  /** 대표 외 일정 문구 (중복 의미 제거 후) */
  secondaryLabels: string[];
  /** 점 표시용 일정 종류 */
  types: ScheduleItemType[];
}

const sameDay = (date: ISODate) => date.slice(0, 10);

/** 같은 계약 + 같은 날짜끼리 묶는다 (날짜 → 대표 일정 중요도 → 계약 이름 순) */
export function groupCalendarItems(items: readonly ScheduleItem[]): CalendarContractGroup[] {
  const buckets = new Map<string, ScheduleItem[]>();
  for (const i of items) {
    const k = `${i.contractId}|${sameDay(i.date)}`;
    const b = buckets.get(k);
    if (b) b.push(i);
    else buckets.set(k, [i]);
  }
  const groups = [...buckets.entries()].map(([key, list]) => summarizeGroup(key, list));
  return groups.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      rank(a) - rank(b) ||
      a.contractTitle.localeCompare(b.contractTitle),
  );
}

const rank = (g: CalendarContractGroup) => Math.min(...g.items.map((i) => PRIORITY[i.type]));

function summarizeGroup(key: string, list: ScheduleItem[]): CalendarContractGroup {
  const first = list[0];
  const sorted = [...list].sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type]);
  const nonCash = sorted.filter((i) => !isCashflow(i));

  // 시작과 같은 의미의 일정은 하나로: 계약 시작이 있으면 그 문구, 없으면 첫 시작 의미 주요 날짜
  const startItem = nonCash.find((i) => i.type === 'contract_start');
  const startLike = nonCash.filter((i) => i.type === 'key_date' && i.dateKind != null && START_LIKE_DATE_KINDS.has(i.dateKind));
  const startLabel = startItem
    ? mergedStartLabel(startItem.title, startLike[0]?.dateKind)
    : startLike[0]
      ? (START_LIKE_LABEL[startLike[0].dateKind!] ?? startLike[0].title)
      : null;
  const merged = new Set<ScheduleItem>([...(startItem ? [startItem] : []), ...startLike]);

  const labels: { type: ScheduleItemType; label: string; item: ScheduleItem }[] = [];
  let startAdded = false;
  for (const i of nonCash) {
    if (merged.has(i)) {
      if (!startAdded && startLabel) labels.push({ type: startItem ? 'contract_start' : 'key_date', label: startLabel, item: startItem ?? i });
      startAdded = true;
      continue;
    }
    if (!labels.some((l) => l.label === i.title)) labels.push({ type: i.type, label: i.title, item: i });
  }

  const head = labels[0] ?? null;
  return {
    key,
    contractId: first.contractId,
    date: sameDay(first.date),
    contractTitle: first.contractTitle,
    category: first.category,
    items: list,
    primary: head
      ? {
          type: head.type,
          label: head.label,
          action: ACTION_TYPES.has(head.type),
          priority: head.item.priority,
          // 중요 일정과 PACTO 안내는 출처를 함께 보여준다 (PACTO 기본 안내를 계약서·법령 기한으로 오해하지 않도록)
          sourceLabel: head.item.priority !== 'normal' || head.item.source === 'pacto' ? NOTIFICATION_SOURCE_LABEL[head.item.source] : null,
          needsReview: head.item.needsReview,
        }
      : null,
    priority: list.map((i) => i.priority).sort((a, b) => PRIORITY_RANK[a] - PRIORITY_RANK[b])[0],
    cashflows: summarizeCashflows(list),
    // PACTO 기본 안내는 보조 줄에 있어도 출처를 붙인다 (계약서·법령 기한으로 오해하지 않도록)
    secondaryLabels: labels.slice(1).map((l) => (l.item.source === 'pacto' ? `${l.label} (${NOTIFICATION_SOURCE_LABEL.pacto})` : l.label)),
    types: [...new Set(list.map((i) => i.type))],
  };
}

/** 실제 돈이 오가는 항목: 결제 규칙에서 나온 결제(확정만 일정에 들어온다). 시작·종료·내 일정 금액은 넣지 않는다 */
function isCashflow(i: ScheduleItem): boolean {
  return i.type === 'payment' && i.paymentKind != null && i.direction != null && i.amount != null;
}

const DIRECTION_ORDER: Direction[] = ['expense', 'income', 'neutral'];
const INCOME_PAY_KINDS = new Set(['salary', 'bonus']);

/** 방향별 합계 — 지출은 "결제 예정", 수입은 "+… 급여 예정"/"+… 입금 예정", 중립(보증금 등)은 합계 제외 표시 */
export function summarizeCashflows(list: readonly ScheduleItem[]): CashflowSummary[] {
  const cash = list.filter(isCashflow);
  return DIRECTION_ORDER.flatMap((direction) => {
    const items = cash.filter((i) => i.direction === direction);
    if (items.length === 0) return [];
    const total = items.reduce((s, i) => s + i.amount!, 0);
    const estimated = items.some((i) => i.estimated);
    const won = `${formatWon(total)}${estimated ? ' (예상)' : ''}`;
    const headline =
      direction === 'expense'
        ? `${won} 결제 예정`
        : direction === 'income'
          ? `+${won} ${items.every((i) => INCOME_PAY_KINDS.has(i.paymentKind!)) ? '급여' : '입금'} 예정`
          : `${won} · 지출 합계 제외`;
    return [{ direction, total, estimated, headline, items: items.map((i) => ({ label: i.title, amount: i.amount!, estimated: i.estimated })) }];
  });
}

/** 세부 내역 한 줄: "월 렌탈료 29,900원 · 설치비 20,000원" (많으면 앞 max개 + "외 n건") */
export function cashflowBreakdown(c: CashflowSummary, max = 3): string | null {
  if (c.items.length <= 1) return c.items[0]?.label ?? null;
  const shown = c.items.slice(0, max).map((i) => `${i.label} ${formatWon(i.amount)}`);
  return c.items.length > max ? `${shown.join(' · ')} 외 ${c.items.length - max}건` : shown.join(' · ');
}

/** 대표 외 일정 문구 (많으면 "외 n건") */
export function secondaryLine(g: CalendarContractGroup, max = 2): string | null {
  const l = g.secondaryLabels;
  if (l.length === 0) return null;
  return l.length > max ? `${l.slice(0, max).join(' · ')} 외 ${l.length - max}건` : l.join(' · ');
}

/** 날짜 칸의 점: 계약별로 묶은 뒤 종류만 (행 개수만큼 찍지 않는다) */
export function dayMarkers(groups: readonly CalendarContractGroup[]): Map<ISODate, Set<ScheduleItemType>> {
  const out = new Map<ISODate, Set<ScheduleItemType>>();
  for (const g of groups) {
    const s = out.get(g.date) ?? new Set<ScheduleItemType>();
    for (const t of g.types) s.add(t);
    out.set(g.date, s);
  }
  return out;
}
