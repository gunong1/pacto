/**
 * 홈 화면 묶음 — 새 계산 없이 기존 결과를 고르고 묶기만 한다.
 * - 다가오는 일정: 캘린더와 같은 일정(scheduleForRange) · 같은 보기 규칙(핵심 일정) · 같은 묶음(같은 계약·같은 날짜 = 카드 하나)
 *   지급일 휴일 규칙·공휴일·일할 계산이 이미 반영된 날짜를 그대로 쓴다 (홈 전용 날짜 계산 없음)
 * - 계약별 금액: monthSpending의 항목을 계약별로 더하기만 (spending.contractFlowLines) → 줄의 합 = 총액
 */
import { groupCalendarItems, itemsForView, type CalendarContractGroup } from './calendarGroups';
import { addDays } from './dates';
import { daysUntil } from './dday';
import { scheduleForRange } from './schedule';
import { contractFlowLines, type ContractFlowLine, type SpendingItem } from './spending';
import type { ContractRecord, ISODate } from './types';

/** 다가오는 일정을 찾는 기간 (오늘부터) — 만기·갱신처럼 먼 일정도 가장 가까운 것부터 보이게 */
export const UPCOMING_HORIZON_DAYS = 400;

export interface UpcomingEntry {
  key: string;
  contractId: string;
  contractTitle: string;
  /** 일정 종류 (캘린더 카드 제목과 같음 — 예: "보험료 지급", "만기·보증금 반환 확인") */
  label: string;
  date: ISODate;
  days: number;
  group: CalendarContractGroup;
}

/** 오늘 이후 가장 가까운 계약 일정 (같은 계약·같은 날짜는 하나로) — 최대 max개 */
export function upcomingSchedule(records: ContractRecord[], today: ISODate, max = 3): UpcomingEntry[] {
  const { shown } = itemsForView(scheduleForRange(records, { start: today, end: addDays(today, UPCOMING_HORIZON_DAYS) }, today), 'core');
  return groupCalendarItems(shown, today)
    .filter((g) => g.date >= today)
    .slice(0, max)
    .map((g) => ({ key: g.key, contractId: g.contractId, contractTitle: g.contractTitle, label: g.title, date: g.date, days: daysUntil(g.date, today), group: g }));
}

/** 홈 금액 카드 한 장 — 위에서 max줄 + 나머지 (외 N건). 줄의 합 = total */
export interface FlowCard {
  total: number;
  lines: ContractFlowLine[];
  shown: ContractFlowLine[];
  rest: { count: number; amount: number };
}
export function flowCard(items: readonly SpendingItem[], max = 3): FlowCard {
  const lines = contractFlowLines(items);
  const shown = lines.slice(0, max);
  const hidden = lines.slice(max);
  return {
    total: items.reduce((s, i) => s + i.amount, 0),
    lines,
    shown,
    rest: { count: hidden.length, amount: hidden.reduce((s, l) => s + l.amount, 0) },
  };
}
