import type { ISODate } from './types';

/**
 * 날짜 유틸. 모든 계산은 시간대 없는 'YYYY-MM-DD' 문자열 기준.
 * 내부적으로 UTC 자정 Date를 사용해 DST/시간대 영향을 받지 않는다.
 */

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000; // 한국은 DST 없음

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidISODate(value: string): boolean {
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parseISODate(value: ISODate): { year: number; month: number; day: number } {
  const m = ISO_RE.exec(value);
  if (!m) throw new Error(`Invalid date: ${value}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function toISODate(year: number, month: number, day: number): ISODate {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function toUTCms(value: ISODate): number {
  const { year, month, day } = parseISODate(value);
  return Date.UTC(year, month - 1, day);
}

function fromUTCms(ms: number): ISODate {
  const d = new Date(ms);
  return toISODate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 한국 시간 기준 오늘 날짜. */
export function todayInSeoul(now: Date = new Date()): ISODate {
  return fromUTCms(now.getTime() + KST_OFFSET_MS);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** b - a (일). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTCms(b) - toUTCms(a)) / DAY_MS);
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromUTCms(toUTCms(date) + days * DAY_MS);
}

/** 해당 월에 없는 일자는 말일로 보정 (예: 31일 결제 → 2월 28/29일). */
export function dateInMonth(year: number, month: number, day: number): ISODate {
  return toISODate(year, month, Math.min(day, daysInMonth(year, month)));
}

/** 월 단위 이동. 1/31 + 1개월 = 2/28(29). */
export function addMonths(date: ISODate, months: number): ISODate {
  const { year, month, day } = parseISODate(date);
  const idx = year * 12 + (month - 1) + months;
  return dateInMonth(Math.floor(idx / 12), (idx % 12) + 1, day);
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

export interface YearMonth {
  year: number;
  month: number;
}

export function yearMonthOf(date: ISODate): YearMonth {
  const { year, month } = parseISODate(date);
  return { year, month };
}

export function shiftYearMonth(ym: YearMonth, months: number): YearMonth {
  const idx = ym.year * 12 + (ym.month - 1) + months;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function monthRange(ym: YearMonth): { start: ISODate; end: ISODate } {
  return {
    start: toISODate(ym.year, ym.month, 1),
    end: toISODate(ym.year, ym.month, daysInMonth(ym.year, ym.month)),
  };
}

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** 0=일 ... 6=토 */
export function weekdayOf(date: ISODate): number {
  return new Date(toUTCms(date)).getUTCDay();
}

/** '2026. 12. 1. (화)' */
export function formatDateKo(date: ISODate, withWeekday = false): string {
  const { year, month, day } = parseISODate(date);
  const base = `${year}. ${month}. ${day}.`;
  return withWeekday ? `${base} (${WEEKDAYS_KO[weekdayOf(date)]})` : base;
}

/** '12월 1일' */
export function formatMonthDayKo(date: ISODate): string {
  const { month, day } = parseISODate(date);
  return `${month}월 ${day}일`;
}
