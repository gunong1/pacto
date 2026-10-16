/**
 * 캘린더 날짜 색상 — 일요일·공휴일 빨강 · 토요일 파랑 · 평일 기본 (src/domain/holidays.ts)
 * 공휴일 데이터는 수록 목록만 사용 (음력·대체공휴일 계산 안 함) · 결제일 계산(businessDays)과 분리
 */
import { isBusinessDay } from '../businessDays';
import { dayColorOf, hasHolidayData, holidayNames } from '../holidays';

describe('공휴일 이름', () => {
  test('고정 공휴일·명절·대체공휴일·임시공휴일(선거일)', () => {
    expect(holidayNames('2026-10-03')).toEqual(['개천절']);
    expect(holidayNames('2026-10-05')).toEqual(['대체공휴일(개천절)']);
    expect(holidayNames('2026-06-03')).toEqual(['전국동시지방선거']);
    expect(holidayNames('2025-06-03')).toEqual(['임시공휴일(대통령선거)']);
    expect(holidayNames('2026-10-06')).toBeNull();
  });
  test('수록 연도 2018~2027', () => {
    expect([hasHolidayData(2018), hasHolidayData(2027), hasHolidayData(2028)]).toEqual([true, true, false]);
  });
});

describe('날짜 색상', () => {
  test('일요일 빨강 · 토요일 파랑 · 평일 기본 · 평일 공휴일 빨강 · 토요일 공휴일은 빨강', () => {
    expect(dayColorOf('2026-10-18')).toBe('holiday'); // 일
    expect(dayColorOf('2026-10-17')).toBe('saturday'); // 토
    expect(dayColorOf('2026-10-16')).toBe('default'); // 금
    expect(dayColorOf('2026-10-05')).toBe('holiday'); // 월 · 대체공휴일
    expect(dayColorOf('2026-10-03')).toBe('holiday'); // 토 · 개천절
    expect(dayColorOf('2028-10-03')).toBe('default'); // 수록 연도 밖 → 주말만 색
  });
  test('색상용 공휴일은 결제일 계산(영업일)에 영향 없음 — 대체공휴일 10/5는 영업일 계산에 등록하지 않음', () => {
    expect(isBusinessDay('2026-10-05')).toBe(true);
  });
});
