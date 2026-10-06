import { addDays, parseISODate, weekdayOf } from './dates';
import type { BusinessDayRule, ISODate } from './types';

/**
 * 영업일 계산 — "지급일이 휴일이면 직전 영업일" 같은 조건으로 실제 지급 예정일을 구한다.
 * 기본 휴일: 토·일 + 날짜가 고정된 법정공휴일(신정·삼일절·어린이날·현충일·광복절·개천절·한글날·성탄절).
 * 설·추석·부처님오신날(음력)과 대체공휴일·임시공휴일은 연도마다 달라 기본 목록에 넣지 않았다 —
 * 연도별 공휴일 목록을 registerHolidays()로 추가하면 함께 반영된다 (예: 공공데이터 특일 정보 API에서 받아 등록).
 */
const FIXED_HOLIDAYS = new Set(['01-01', '03-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25']);
const extraHolidays = new Set<ISODate>();

/** 연도별 공휴일(음력·대체공휴일 등) 추가 */
export function registerHolidays(dates: readonly ISODate[]) {
  for (const d of dates) extraHolidays.add(d);
}

export function isHoliday(date: ISODate): boolean {
  const { month, day } = parseISODate(date);
  return FIXED_HOLIDAYS.has(`${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`) || extraHolidays.has(date);
}

export function isBusinessDay(date: ISODate): boolean {
  const w = weekdayOf(date);
  return w !== 0 && w !== 6 && !isHoliday(date);
}

/** 계약서상 날짜 → 실제 예정일 (휴일이면 직전/다음 영업일) */
export function adjustToBusinessDay(date: ISODate, rule: BusinessDayRule): ISODate {
  if (rule === 'none') return date;
  const step = rule === 'previous' ? -1 : 1;
  let d = date;
  for (let i = 0; i < 14 && !isBusinessDay(d); i++) d = addDays(d, step);
  return d;
}

export const BUSINESS_DAY_RULE_LABEL: Record<BusinessDayRule, string> = {
  none: '',
  previous: '휴일이면 직전 영업일',
  next: '휴일이면 다음 영업일',
};
