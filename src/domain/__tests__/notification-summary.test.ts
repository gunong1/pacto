/** 알림 화면 요약 (종류별 시점은 설정 화면에서만) · 실행 화면 최소 노출 시간 */
import { splashRemainingMs } from '@/components/brand/BrandSplash';

import { notificationSettingsSummary, PACTO_DEFAULT_CATEGORIES } from '../notifications';

const off = { enabled: false, offsets: [] };

describe('알림 설정 요약', () => {
  test('기본값(모두 켜짐) → 주요 계약 알림 사용 중', () => {
    expect(notificationSettingsSummary(null)).toEqual({ title: '오전 9:00 · 주요 계약 알림 사용 중', detail: null });
  });
  test('결제 알림만 꺼짐 → 중요 일정 중심 / 결제 알림 꺼짐', () => {
    expect(notificationSettingsSummary({ categories: { payment: off } })).toEqual({ title: '오전 9:00 · 중요 일정 중심', detail: '결제 알림 꺼짐' });
  });
  test('시점을 모두 뺀 종류도 꺼진 것으로', () => {
    expect(notificationSettingsSummary({ defaultTimes: ['08:00'], categories: { payment: { enabled: true, offsets: [] } } }).title).toBe('오전 8:00 · 중요 일정 중심');
  });
  test('계약 알림 일부 꺼짐', () => {
    expect(notificationSettingsSummary({ categories: { termination_notice: off } })).toEqual({ title: '오전 9:00 · 일부 계약 알림 꺼짐', detail: null });
    expect(notificationSettingsSummary({ categories: { renewal: off, payment: off } })).toEqual({ title: '오전 9:00 · 일부 계약 알림 꺼짐', detail: '결제 알림 꺼짐' });
  });
  test('계약 알림 모두 꺼짐 / 전부 꺼짐 / 전체 끔', () => {
    const allContractOff = Object.fromEntries(Object.keys(PACTO_DEFAULT_CATEGORIES).filter((c) => c !== 'payment').map((c) => [c, off]));
    expect(notificationSettingsSummary({ categories: allContractOff })).toEqual({ title: '오전 9:00 · 결제 알림만 사용 중', detail: '계약 기한 알림 꺼짐' });
    expect(notificationSettingsSummary({ categories: { ...allContractOff, payment: off } })).toEqual({ title: '켜진 알림 종류가 없어요', detail: null });
    expect(notificationSettingsSummary({ enabled: false })).toEqual({ title: '알림이 꺼져 있어요', detail: null });
  });
});

describe('실행 화면 최소 노출 800ms — 앱 시작 시점부터', () => {
  test.each([
    [200, 600],
    [700, 100],
    [1500, 0],
    [800, 0],
  ])('초기화 %ims → %ims 더 보여줌', (elapsed, remaining) => {
    expect(splashRemainingMs(1_000, 1_000 + elapsed)).toBe(remaining);
  });
});
