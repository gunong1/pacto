import { diffDays } from './dates';
import type { ISODate } from './types';

/** 목표일까지 남은 일수. 오늘이면 0, 지났으면 음수. */
export function daysUntil(target: ISODate, today: ISODate): number {
  return diffDays(today, target);
}

/** 'D-7' / 'D-Day' / 'D+3' */
export function formatDDay(days: number): string {
  if (days === 0) return 'D-Day';
  return days > 0 ? `D-${days}` : `D+${Math.abs(days)}`;
}

export function dDayLabel(target: ISODate, today: ISODate): string {
  return formatDDay(daysUntil(target, today));
}
