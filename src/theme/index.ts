import type { TextStyle } from 'react-native';

/**
 * PACTO 디자인 토큰 — 금융/자산관리 앱 톤.
 * 화이트 중심 + 딥 네이비 1색. 보라색/그라데이션/네온 사용 금지.
 * 강조는 D-Day와 금액에만.
 */
export const colors = {
  bg: '#FFFFFF',
  bgSubtle: '#F4F6F9',
  bgPressed: '#EEF1F5',
  border: '#E3E7EC',
  divider: '#EFF1F4',

  text: '#191F28',
  textSecondary: '#4E5968',
  textTertiary: '#8B95A1',
  textDisabled: '#B0B8C1',
  textInverse: '#FFFFFF',

  primary: '#14306B',
  primaryPressed: '#0E2350',
  primarySoft: '#EBF0F9',
  accent: '#2457C5',

  caution: '#D6393A',
  cautionSoft: '#FDEFEF',
  check: '#B4690E',
  checkSoft: '#FFF5E6',
  info: '#6B7684',
  infoSoft: '#F2F4F6',
  positive: '#1E8A5A',
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  /** 화면 좌우 기본 여백 */
  gutter: 20,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

const tabular: TextStyle['fontVariant'] = ['tabular-nums'];

export const typography = {
  /** 홈 월 지출 등 화면의 대표 숫자 */
  display: { fontSize: 34, lineHeight: 42, fontWeight: '700', letterSpacing: -0.6 },
  title1: { fontSize: 24, lineHeight: 32, fontWeight: '700', letterSpacing: -0.4 },
  title2: { fontSize: 20, lineHeight: 28, fontWeight: '700', letterSpacing: -0.3 },
  title3: { fontSize: 17, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400', letterSpacing: -0.2 },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2 },
  body2: { fontSize: 15, lineHeight: 22, fontWeight: '400', letterSpacing: -0.1 },
  body2Strong: { fontSize: 15, lineHeight: 22, fontWeight: '600', letterSpacing: -0.1 },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  captionStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  small: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;

export const numeric = { fontVariant: tabular } satisfies TextStyle;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;
