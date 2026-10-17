import { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandSymbol } from '@/components/brand/Logo';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { deviceAuthMessage } from '@/domain/appLock';
import { authService } from '@/features/auth/authService';
import { disablePushForThisDevice } from '@/features/notifications/push';
import { confirm } from '@/lib/dialog';
import { colors, spacing } from '@/theme';

import { unlockApp } from './appLock';

/**
 * 잠금 화면 — 계약 화면 대신 이것만 그린다 (계약 화면은 잠금이 풀릴 때까지 숨김: src/app/_layout.tsx).
 * - 나타나면 기기 인증을 한 번 자동으로 띄운다. 취소하면 다시 띄우지 않고 "잠금 해제" 버튼을 기다린다.
 * - 인증을 쓸 수 없거나 계속 실패하면 로그아웃 후 다시 로그인할 수 있다 (영구히 갇히지 않음).
 * - Android 뒤로 가기는 잠금 화면에서 막는다 (숨겨진 이전 화면으로 가지 않게).
 */
/** 화면이 올라온 뒤 자동 인증 창을 띄우기까지 기다리는 시간 */
const AUTO_PROMPT_DELAY_MS = 500;

export function AppLockScreen() {
  const insets = useSafeAreaInsets();
  // 로그아웃 처리 중에만 버튼을 막는다. 인증 대기 중에도 [잠금 해제]·[로그아웃]은 항상 누를 수 있다
  // (인증 창이 응답 없이 멈춰도 다시 띄우거나 로그아웃할 수 있게 — 영구히 갇히지 않음)
  const [signingOut, setSigningOut] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const prompted = useRef(false);

  const unlock = async () => {
    setMessage(null);
    const r = await unlockApp();
    setMessage(deviceAuthMessage(r));
  };

  useEffect(() => {
    // 앱이 화면에 완전히 올라온 뒤 한 번만 자동으로 인증 창을 띄운다
    // (잠금화면 알림으로 들어오면 'active'가 먼저 오고 화면은 늦게 올라올 수 있어 잠깐 기다린다)
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryPrompt = () => {
      if (prompted.current || AppState.currentState !== 'active') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (prompted.current || AppState.currentState !== 'active') return;
        prompted.current = true;
        unlock();
      }, AUTO_PROMPT_DELAY_MS);
    };
    tryPrompt();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? tryPrompt() : clearTimeout(timer)));
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const signOut = async () => {
    if (!(await confirm('로그아웃할까요?', '이 기기의 앱 잠금 설정도 함께 꺼져요. 다시 로그인하면 계약 정보를 볼 수 있어요.', '로그아웃'))) return;
    setSigningOut(true);
    await disablePushForThisDevice().catch(() => undefined);
    await authService.signOut().catch(() => undefined);
    setSigningOut(false);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl }]} testID="app-lock-screen">
      <View style={styles.center}>
        <BrandSymbol size={56} />
        <AppText variant="title2" style={styles.title}>
          PACTO가 잠겨 있어요
        </AppText>
        <AppText variant="body2" color="textSecondary" style={styles.desc}>
          지문·얼굴인식 또는 기기 잠금으로 잠금을 해제해 주세요.
        </AppText>
        {message ? (
          <AppText variant="caption" color="caution" style={styles.desc} testID="app-lock-message">
            {message}
          </AppText>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Button label="잠금 해제" onPress={unlock} disabled={signingOut} testID="app-lock-unlock" />
        <Button label="로그아웃하고 다시 로그인" variant="ghost" size="md" onPress={signOut} loading={signingOut} testID="app-lock-sign-out" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: colors.bg, paddingHorizontal: spacing.gutter, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  title: { marginTop: spacing.lg, textAlign: 'center' },
  desc: { textAlign: 'center' },
  actions: { gap: spacing.sm },
});
