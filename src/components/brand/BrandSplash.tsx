import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme';

import { BrandSymbol } from './Logo';

/** 브랜드 슬로건 — 개인·가족·기업 계약관리까지 쓰는 문구라 특정 계약 유형을 암시하도록 바꾸지 않는다 */
export const BRAND_SLOGAN = '모든 계약을 한곳에.';

/** 앱 시작 시점 (이 모듈은 앱 시작 때 불러온다) — 최소 노출 시간·로딩 표시 시점을 여기서부터 센다 */
export const APP_STARTED_AT = Date.now();

/** 브랜드 문구를 읽을 수 있는 최소 노출 시간 — 앱 시작 시점부터 센다 (초기화가 더 걸리면 추가 대기 없음) */
export const MIN_SPLASH_DURATION_MS = 800;

/** 최소 노출 시간까지 남은 시간: 초기화 200ms → 600ms 더, 700ms → 100ms 더, 1.5초 → 0 */
export function splashRemainingMs(startedAt: number, now: number, min = MIN_SPLASH_DURATION_MS): number {
  return Math.max(0, startedAt + min - now);
}

/** 이 시간보다 오래 걸릴 때만 문구 아래에 작은 로딩 표시 (짧은 진입에는 브랜드만) */
export const SPLASH_SPINNER_DELAY_MS = 1200;

/**
 * 앱 실행 화면 — 심볼 + PACTO + 슬로건. 로딩 문구는 넣지 않는다.
 * 글자 크기 설정이 커도 레이아웃이 깨지지 않도록 확대 배율을 제한한다.
 */
export function BrandSplash({ testID = 'brand-splash' }: { testID?: string }) {
  const insets = useSafeAreaInsets();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    // 로그인 확인 → 데이터 준비 단계로 화면이 바뀌어도 다시 세지 않도록 앱 시작부터
    const t = setTimeout(() => setSlow(true), splashRemainingMs(APP_STARTED_AT, Date.now(), SPLASH_SPINNER_DELAY_MS));
    return () => clearTimeout(t);
  }, []);
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]} testID={testID} accessibilityLabel={`PACTO, ${BRAND_SLOGAN}`}>
      <View style={styles.group}>
        <BrandSymbol size={72} />
        <Text style={styles.name} maxFontSizeMultiplier={1.3} accessibilityRole="header">
          PACTO
        </Text>
        <Text style={styles.slogan} maxFontSizeMultiplier={1.3}>
          {BRAND_SLOGAN}
        </Text>
        {/* 자리는 미리 잡아 두어 로딩 표시가 나타나도 로고가 움직이지 않게 */}
        <View style={styles.spinnerSlot}>{slow ? <ActivityIndicator size="small" color={colors.textTertiary} testID="brand-splash-spinner" /> : null}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  group: { alignItems: 'center', paddingHorizontal: spacing.gutter, marginTop: spacing.xxxl },
  name: { marginTop: spacing.xl, fontSize: 32, lineHeight: 40, fontWeight: '600', letterSpacing: 1.5, color: colors.primary, textAlign: 'center' },
  slogan: { marginTop: spacing.sm, fontSize: 17, lineHeight: 24, fontWeight: '500', letterSpacing: -0.2, color: colors.textSecondary, textAlign: 'center' },
  spinnerSlot: { height: 20, marginTop: spacing.xxl, justifyContent: 'center' },
});
