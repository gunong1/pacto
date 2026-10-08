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

/**
 * 날짜 표기 규칙 (화면·알림 공통 — 화면마다 직접 문자열을 만들지 않는다)
 * - 일회성 날짜(종료일·통보기한·만기·잔금일 …)는 항상 연도까지: formatDateKo '2028. 8. 20.' / 문장 안에서는 formatDateLongKo '2028년 8월 20일'
 * - 반복 일정은 반복 표현: formatRecurringDayKo '매월 20일'
 * - 상대 표현(오늘·내일)은 실제 날짜를 함께: formatRelativeDateKo '내일 · 2026. 10. 9.'
 */
export function formatDateLongKo(date: ISODate): string {
  const { year, month, day } = parseISODate(date);
  return `${year}년 ${month}월 ${day}일`;
}

/** '매월 20일' / '매년 3월 1일' */
export function formatRecurringDayKo(day: number, month?: number | null): string {
  return month ? `매년 ${month}월 ${day}일` : `매월 ${day}일`;
}

/** '오늘 · 2026. 10. 8.' / '내일 · 2026. 10. 9.' / 그 밖에는 '2028. 8. 20.' */
export function formatRelativeDateKo(date: ISODate, today: ISODate): string {
  if (date === today) return `오늘 · ${formatDateKo(date)}`;
  if (date === addDays(today, 1)) return `내일 · ${formatDateKo(date)}`;
  return formatDateKo(date);
}

/** '12월 1일' — 연도가 없어 일회성 날짜에는 쓰지 않는다 (같은 달 안 목록·달력 칸처럼 연도가 분명한 곳만) */
export function formatMonthDayKo(date: ISODate): string {
  const { month, day } = parseISODate(date);
  return `${month}월 ${day}일`;
}

/**
 * 날짜 입력 정규화 — 사용자가 '-'를 입력하지 않아도 되게 한다.
 * '261005' → '2026-10-05', '20261012' → '2026-10-12', '2026-10-12' → 그대로, '2026.10.12' → '2026-10-12'
 * 실제 존재하지 않는 날짜(13월, 평년 2/29 등)나 형식이 맞지 않으면 null.
 */
export function normalizeDateInput(input: string): ISODate | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  let y: number, m: number, d: number;
  const sep = /^(\d{4})[-./\s](\d{1,2})[-./\s](\d{1,2})\.?$/.exec(trimmed);
  const digits = trimmed.replace(/\D/g, '');
  if (sep) {
    [y, m, d] = [Number(sep[1]), Number(sep[2]), Number(sep[3])];
  } else if (/^\d+$/.test(trimmed) && digits.length === 8) {
    [y, m, d] = [Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8))];
  } else if (/^\d+$/.test(trimmed) && digits.length === 6) {
    [y, m, d] = [2000 + Number(digits.slice(0, 2)), Number(digits.slice(2, 4)), Number(digits.slice(4, 6))];
  } else {
    return null;
  }
  const iso = toISODate(y, m, d);
  return isValidISODate(iso) ? iso : null;
}
