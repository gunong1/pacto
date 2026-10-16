/**
 * 대한민국 공휴일 조회 — 캘린더 날짜 색상·공휴일 이름 표시 전용 (데이터: holidaysKr.data.ts, 출처는 그 파일 머리말)
 * 결제일·지급일·알림 계산(businessDays.ts 등)에는 쓰지 않는다 — 공휴일이라는 이유로 계약상 날짜를 바꾸지 않음.
 * 음력 명절·대체공휴일을 계산하지 않고 수록된 목록만 쓴다. 수록 연도 밖은 공휴일 정보 없음(주말 색상만).
 */
import { weekdayOf } from './dates';
import { HOLIDAY_YEARS, KR_HOLIDAYS } from './holidaysKr.data';
import type { ISODate } from './types';

/** 공휴일 이름 (대체공휴일·임시공휴일 포함) — 공휴일이 아니면 null */
export function holidayNames(date: ISODate): readonly string[] | null {
  return KR_HOLIDAYS[date] ?? null;
}

/** 날짜 글자색: 일요일·공휴일 holiday(빨강) · 토요일 saturday(파랑, 공휴일이면 빨강) · 평일 default */
export type DayColor = 'holiday' | 'saturday' | 'default';
export function dayColorOf(date: ISODate): DayColor {
  const w = weekdayOf(date);
  if (w === 0 || holidayNames(date)) return 'holiday';
  return w === 6 ? 'saturday' : 'default';
}

/** 이 연도의 공휴일 정보가 있는지 */
export const hasHolidayData = (year: number): boolean => year >= HOLIDAY_YEARS.from && year <= HOLIDAY_YEARS.to;
export { HOLIDAY_YEARS };
