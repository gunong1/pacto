/**
 * 캘린더 요약 (화면 전용 view model) — "이 날짜에 이 계약 때문에 알아야 할 것"
 *
 * - 일정 원본(ScheduleItem: 결제·시작·주요 날짜·통보기한 …)은 그대로 두고, 같은 계약 + 같은 날짜만 카드 하나로 묶는다.
 *   계약이 다르면 같은 날·같은 회사여도 묶지 않는다.
 * - 같은 의미의 시작 일정(이용 시작 + 설치일 등)은 대표 문구 하나로 보여준다 (원본은 계약 상세에서 모두 확인).
 * - 금액은 결제 항목(확정 결제만 일정에 들어온다)만 방향별로 합산한다. 시작·종료·통보기한·내 일정은 금액을 만들지 않는다.
 * - 월 지출 합계(spending.ts)는 이 요약과 무관하게 결제 규칙에서 직접 계산한다 → 묶어도 합계가 바뀌지 않는다.
 * - 금액 문구는 오늘 기준: 앞으로 "결제 예정" / 오늘 "오늘 결제" / 지난 날짜 "결제일".
 *   앱은 실제로 돈이 나갔는지 모르므로 "결제 완료"처럼 단정하지 않는다.
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

/**
 * 일정 표시 등급 (화면 전용 — 일정·알림 원본은 그대로):
 * - primary 필수: 돈이 오가는 날(결제·급여·보증금 지급/반환/반환 확인) · 계약 만기 · 해지 통보기한 · 자동갱신 · 사용자가 직접 추가한 일정
 * - secondary 관리: 계약 시작 · 입주·인도·설치·개통·입사 · 납기·검수·잔금일·갱신 확인 같은 진행 일정
 * - reference 참고: 그 밖의 단순 기록 날짜(기타 날짜) — 기본 보기(핵심 일정)에서 숨김, 전체 보기·계약 상세에서 확인
 * 계약서 근거로 의무·기한이 있는 날짜(중요도 important 이상)·확인 필요한 날짜는 참고로 숨기지 않는다.
 */
export type ScheduleTier = 'primary' | 'secondary' | 'reference';
export function scheduleTier(i: Pick<ScheduleItem, 'type' | 'dateKind' | 'priority' | 'needsReview' | 'eventId' | 'actionType'>): ScheduleTier {
  if (i.type === 'custom' || i.eventId != null) return 'primary';
  if (i.type === 'payment' || i.actionType === 'deposit_return' || i.type === 'contract_end' || i.type === 'termination_notice' || i.type === 'renewal') return 'primary';
  if (i.type === 'contract_start' || i.type === 'prepare') return 'secondary';
  if (i.type === 'key_date') {
    // 날짜 종류가 없는 일정 = 계약 조건에서 계산한 경계(수습기간 종료 등) → 관리. 참고는 "기타 날짜"만
    if (i.dateKind !== 'other') return 'secondary';
    return i.priority !== 'normal' || i.needsReview ? 'secondary' : 'reference';
  }
  return 'secondary';
}

/** 캘린더 보기 — core 핵심 일정(참고 일정 숨김) · all 전체 보기. 원본 일정은 어느 쪽이든 그대로 */
export type CalendarViewMode = 'core' | 'all';
export function itemsForView<T extends Parameters<typeof scheduleTier>[0]>(items: readonly T[], mode: CalendarViewMode): { shown: T[]; hidden: number } {
  if (mode === 'all') return { shown: [...items], hidden: 0 };
  const shown = items.filter((i) => scheduleTier(i) !== 'reference');
  return { shown, hidden: items.length - shown.length };
}

/** 묶음 제목에 쓰는 시작 의미 짧은 말 (계약 종류 공통 — 날짜 종류로) */
const START_WORD: Partial<Record<ContractDateKind, string>> = { move_in: '입주', handover: '인도', hire: '입사', activation: '개통', installation: '설치' };
/** 결제 이름 앞의 상위 금액 이름은 제목에서 뺀다 ("보증금 잔금" → "잔금") */
const shortPay = (label: string) => label.replace(/^(보증금|전세금|임대차\s*보증금|매매대금|대금)\s+/, '').replace(/\s*\(.*\)$/, '');

/**
 * 같은 계약·같은 날짜 묶음의 제목 — 의미를 이어 붙인다 (계약 종류 공통, 특정 계약서 문구 하드코딩 없음).
 *   예) 잔금 + 임대차 시작 + 인도 → "입주·잔금일" · 계약 만기 + 보증금 반환 확인 → "만기·보증금 반환 확인" · 계약금 하나 → "계약금 지급"
 * 일정이 하나면 그 일정 이름 그대로.
 */
export function groupTitle(list: readonly ScheduleItem[]): string {
  if (list.length === 1) {
    const only = list[0];
    return isCashflow(only) && only.actionType !== 'deposit_return' ? `${only.title} ${only.direction === 'income' ? '입금' : '지급'}` : only.title;
  }
  const words: { w: string; kind: 'end' | 'action' | 'start' | 'pay' | 'refund' }[] = [];
  const add = (w: string, kind: (typeof words)[number]['kind']) => {
    if (w && !words.some((x) => x.w === w)) words.push({ w, kind });
  };
  if (list.some((i) => i.type === 'contract_end')) add('만기', 'end');
  for (const i of list) if (i.type === 'termination_notice' || i.type === 'renewal' || i.type === 'prepare') add(i.title, 'action');
  const startLike = list.find((i) => i.type === 'key_date' && i.dateKind && START_WORD[i.dateKind]);
  // 부동산 목적물 인도 = 입주 (차량·물건 인도는 "인도")
  if (startLike) add(startLike.dateKind === 'handover' && startLike.category === 'real_estate' ? '입주' : START_WORD[startLike.dateKind!]!, 'start');
  else if (list.some((i) => i.type === 'contract_start')) add('시작', 'start');
  // 결제가 여럿이면 하나씩 늘어놓지 않고 "결제"로 (각 금액은 카드 세부 내역·관련 일정에)
  const pays = [...new Set(list.filter((i) => isCashflow(i) && i.actionType !== 'deposit_return').map((i) => shortPay(i.title)))];
  if (pays.length === 1) add(pays[0], 'pay');
  else if (pays.length > 1) add('결제', 'pay');
  if (list.some((i) => i.actionType === 'deposit_return')) add(list.some((i) => i.actionType === 'deposit_return' && isCashflow(i)) ? '보증금 반환 예정' : '보증금 반환 확인', 'refund');
  for (const i of list) if (i.type === 'custom' || (i.type === 'key_date' && !(i.dateKind && START_WORD[i.dateKind]) && i.actionType !== 'deposit_return')) add(i.title, 'action');
  if (words.length === 0) return list[0].title;
  const shown = words.slice(0, 3);
  const last = shown[shown.length - 1];
  const tail = words.length > 3 ? ` 외 ${words.length - 3}` : '';
  return `${shown.map((x) => x.w).join('·')}${(last.kind === 'pay' || last.kind === 'start') && !tail ? '일' : ''}${tail}`;
}

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
  /** "49,900원 결제 예정"(앞으로) · "49,900원 오늘 결제" · "49,900원 결제일"(지난 날짜) / "+3,600,000원 급여 예정" / "500만원 · 방향 확인 필요 (합계 제외)" */
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
  /** 대표 외 PACTO 기본 안내 (묶음 카드에서도 출처를 보이게) */
  guideLabels: string[];
  /** 점 표시용 일정 종류 */
  types: ScheduleItemType[];
  /** 묶음 제목 (의미를 이어 붙임 — groupTitle) */
  title: string;
}

const sameDay = (date: ISODate) => date.slice(0, 10);

/** 같은 계약 + 같은 날짜끼리 묶는다 (날짜 → 대표 일정 중요도 → 계약 이름 순). today가 있으면 금액 문구를 오늘 기준으로 */
export function groupCalendarItems(items: readonly ScheduleItem[], today?: ISODate): CalendarContractGroup[] {
  const buckets = new Map<string, ScheduleItem[]>();
  for (const i of items) {
    const k = `${i.contractId}|${sameDay(i.date)}`;
    const b = buckets.get(k);
    if (b) b.push(i);
    else buckets.set(k, [i]);
  }
  const groups = [...buckets.entries()].map(([key, list]) => summarizeGroup(key, list, today));
  return groups.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      rank(a) - rank(b) ||
      a.contractTitle.localeCompare(b.contractTitle),
  );
}

const rank = (g: CalendarContractGroup) => Math.min(...g.items.map((i) => PRIORITY[i.type]));

function summarizeGroup(key: string, list: ScheduleItem[], today?: ISODate): CalendarContractGroup {
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
    cashflows: summarizeCashflows(list, today ? timingOf(sameDay(first.date), today) : 'upcoming'),
    // PACTO 기본 안내는 보조 줄에 있어도 출처를 붙인다 (계약서·법령 기한으로 오해하지 않도록)
    secondaryLabels: labels.slice(1).map((l) => (l.item.source === 'pacto' ? `${l.label} (${NOTIFICATION_SOURCE_LABEL.pacto})` : l.label)),
    guideLabels: labels.slice(1).filter((l) => l.item.source === 'pacto').map((l) => `${l.label} (${NOTIFICATION_SOURCE_LABEL.pacto})`),
    types: [...new Set(list.map((i) => i.type))],
    // 금액 없이 같은 뜻의 일정만 겹치면(근로 시작 = 입사일 등) 이미 합친 문구 그대로
    title: list.length > 1 && labels.length === 1 && nonCash.length === list.length ? labels[0].label : groupTitle(sorted),
  };
}

/** 실제 돈이 오가는 항목: 결제 규칙에서 나온 결제(확정만 일정에 들어온다). 시작·종료·내 일정 금액은 넣지 않는다 */
function isCashflow(i: ScheduleItem): boolean {
  return i.type === 'payment' && i.paymentKind != null && i.direction != null && i.amount != null;
}

const DIRECTION_ORDER: Direction[] = ['expense', 'income', 'neutral'];
const INCOME_PAY_KINDS = new Set(['salary', 'bonus']);

/** 일정 날짜가 오늘보다 앞인지 */
export type CashflowTiming = 'upcoming' | 'today' | 'past';
export const timingOf = (date: ISODate, today: ISODate): CashflowTiming => (date > today ? 'upcoming' : date === today ? 'today' : 'past');

/** 금액 뒤 문구 — 앞으로: "결제 예정" / 오늘: "오늘 결제" / 지난 날짜: "결제일" (결제 완료로 단정하지 않음) */
function whenLabel(word: string, timing: CashflowTiming): string {
  return timing === 'upcoming' ? `${word} 예정` : timing === 'today' ? `오늘 ${word}` : `${word}일`;
}

/**
 * 방향별 합계 — 출금은 결제(보증금만이면 "보증금 지급"), 입금은 급여/입금(보증금이면 "보증금 입금"),
 * 방향 확인 필요(neutral)는 합계에 넣지 않는다고 표시 (cashflow.ts — 홈·캘린더 합계와 같은 규칙)
 */
export function summarizeCashflows(list: readonly ScheduleItem[], timing: CashflowTiming = 'upcoming'): CashflowSummary[] {
  const cash = list.filter(isCashflow);
  return DIRECTION_ORDER.flatMap((direction) => {
    const items = cash.filter((i) => i.direction === direction);
    if (items.length === 0) return [];
    const total = items.reduce((s, i) => s + i.amount!, 0);
    const estimated = items.some((i) => i.estimated);
    const won = `${formatWon(total)}${estimated ? ' (예상)' : ''}`;
    const allDeposit = items.every((i) => i.moneyNature === 'deposit');
    const headline =
      direction === 'expense'
        ? `${won} ${whenLabel(allDeposit ? '보증금 지급' : '결제', timing)}`
        : direction === 'income'
          ? `+${won} ${whenLabel(allDeposit ? '보증금 입금' : items.every((i) => INCOME_PAY_KINDS.has(i.paymentKind!)) ? '급여' : '입금', timing)}`
          : `${won} · 방향 확인 필요 (합계 제외)`;
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
