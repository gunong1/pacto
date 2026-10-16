/**
 * 캘린더 날짜 색상 — 일요일·공휴일 빨강 · 토요일 파랑 · 평일 기본 (src/domain/holidays.ts)
 * 공휴일 데이터는 수록 목록만 사용 (음력·대체공휴일 계산 안 함) · 결제일 계산(businessDays)과 분리
 */
import { adjustToBusinessDay } from '../businessDays';
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
  test('결제일: "그날 그대로"는 공휴일이어도 그대로 · "휴일이면 직전/다음 영업일"은 대체공휴일·명절·선거일도 피함', () => {
    expect(adjustToBusinessDay('2026-10-05', 'none')).toBe('2026-10-05');
    expect(adjustToBusinessDay('2026-10-05', 'previous')).toBe('2026-10-02'); // 10/3 토(개천절)·10/4 일 건너뜀
    expect(adjustToBusinessDay('2026-10-05', 'next')).toBe('2026-10-06');
    expect(adjustToBusinessDay('2026-09-25', 'previous')).toBe('2026-09-23'); // 추석 연휴 9/24~26
    expect(adjustToBusinessDay('2026-06-03', 'next')).toBe('2026-06-04'); // 지방선거일
    expect(adjustToBusinessDay('2028-10-03', 'next')).toBe('2028-10-04'); // 수록 연도 밖: 고정 공휴일만
  });
});
