import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LogoHorizontal } from '@/components/brand/Logo';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { authErrorMessage, authService, type OAuthProvider } from '@/features/auth/authService';
import { notify } from '@/lib/dialog';
import { colors, spacing } from '@/theme';

/** 시작 화면. 이메일 / Apple / Google (Kakao는 P1 이후). Supabase 미설정 시 미리보기(mock) 로그인. */
export default function WelcomeScreen() {
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const oauth = async (p: OAuthProvider) => {
    setBusy(p);
    try {
      await authService.signInWithProvider(p);
    } catch (e) {
      notify('로그인', authErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.hero}>
        <LogoHorizontal height={44} />
        <AppText variant="title1" style={{ marginTop: spacing.xxl }}>
          내 모든 계약이{'\n'}모이는 곳
        </AppText>
        <AppText variant="body" color="textSecondary" style={{ marginTop: spacing.md }}>
          계약서를 넣어두세요.{'\n'}중요한 순간은 PACTO가 기억합니다.
        </AppText>

        <View style={styles.points}>
          {[
            ['folder-open-outline', '계약서를 한곳에 보관'],
            ['calendar-outline', '결제일·만료일·해지 통보기한 관리'],
            ['wallet-outline', '매달 나가는 계약 지출을 한눈에'],
          ].map(([icon, text]) => (
            <View key={text} style={styles.point}>
              <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={20} color={colors.primary} />
              <AppText variant="body2" color="textSecondary">
                {text}
              </AppText>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.actions}>
        {Platform.OS !== 'android' ? (
          <Button label="Apple로 계속하기" loading={busy === 'apple'} onPress={() => oauth('apple')} left={<Ionicons name="logo-apple" size={18} color={colors.textInverse} />} testID="signin-apple" />
        ) : null}
        <Button label="Google로 계속하기" variant="secondary" loading={busy === 'google'} onPress={() => oauth('google')} left={<Ionicons name="logo-google" size={16} color={colors.text} />} testID="signin-google" />
        <Button label="이메일로 계속하기" variant="ghost" onPress={() => router.push('/sign-in')} testID="signin-email" />
        {authService.mode === 'mock' ? (
          <AppText variant="small" color="textTertiary" align="center" style={{ marginTop: spacing.xs }}>
            미리보기 모드 — 서버 없이 예시 데이터로 동작합니다
          </AppText>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  hero: { flex: 1, paddingHorizontal: spacing.gutter + 4, justifyContent: 'center' },
  points: { marginTop: spacing.xxxl, gap: spacing.md },
  point: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actions: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.lg, gap: spacing.sm },
});
