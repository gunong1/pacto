import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';

import { APP_STARTED_AT, BrandSplash, splashRemainingMs } from '@/components/brand/BrandSplash';

import { authService } from '@/features/auth/authService';
import { contractsQuery } from '@/features/contracts/queries';
import { usePushNavigation } from '@/features/notifications/push';
import { useSession } from '@/features/session/store';
import { colors, typography } from '@/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  const { status, setUser } = useSession();
  const userId = useRef<string | null | undefined>(undefined);

  // 세션 복원 + 변경 구독. 계정이 바뀌면 이전 사용자의 캐시를 즉시 비운다 (개인정보 보호).
  useEffect(() => {
    const apply = (user: Awaited<ReturnType<typeof authService.getUser>>) => {
      const next = user?.id ?? null;
      if (userId.current !== undefined && userId.current !== next) queryClient.clear();
      userId.current = next;
      setUser(user);
    };
    authService.getUser().then(apply);
    return authService.onChange(apply);
  }, [queryClient, setUser]);

  // 앱 실행 화면: 로그인 확인 + (로그인 상태면) 첫 계약 목록을 불러올 때까지 브랜드 화면으로 덮어 둔다.
  // 홈이 탭바와 빈 내용으로 먼저 보이지 않게 한다. 느리거나 실패해도 BOOT_MAX_MS 뒤에는 넘어간다 (홈이 다시 시도·오류 표시).
  const [dataReady, setDataReady] = useState(false);
  useEffect(() => {
    if (status !== 'signedIn' || dataReady) return;
    let active = true;
    const finish = () => active && setDataReady(true);
    const t = setTimeout(finish, BOOT_MAX_MS);
    queryClient.prefetchQuery(contractsQuery).finally(finish);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [status, dataReady, queryClient]);
  // 초기화가 빨라도 브랜드 문구를 읽을 수 있게 앱 시작부터 최소 시간은 보여준다
  const [minShown, setMinShown] = useState(() => splashRemainingMs(APP_STARTED_AT, Date.now()) === 0);
  useEffect(() => {
    if (minShown) return;
    const t = setTimeout(() => setMinShown(true), splashRemainingMs(APP_STARTED_AT, Date.now()));
    return () => clearTimeout(t);
  }, [minShown]);
  const booted = minShown && (status === 'signedOut' || dataReady);

  // 푸시를 눌렀을 때 해당 계약으로 (앱이 꺼져 있던 경우 포함) + 이 기기 토큰 갱신
  usePushNavigation(status === 'signedIn');

  // 기기 기본 스플래시(로고만)는 브랜드 화면이 그려지면 바로 내린다
  const hideNative = () => {
    SplashScreen.hideAsync().catch(() => undefined);
  };

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }} onLayout={hideNative}>
        <StatusBar style="dark" />
        <BrandSplash />
      </View>
    );
  }
  const signedIn = status === 'signedIn';

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <View style={{ flex: 1 }} onLayout={hideNative}>
        <Stack
          screenOptions={{
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerTitleStyle: { ...typography.title3, color: colors.text },
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: colors.bg },
          }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="contract/[id]/index" options={{ title: '' }} />
            <Stack.Screen name="contract/[id]/edit" options={{ title: '계약 정보 수정' }} />
            <Stack.Screen name="contract/[id]/event" options={{ title: '일정 추가', presentation: 'modal' }} />
            <Stack.Screen name="contract/[id]/ask" options={{ title: '이 계약에 질문하기' }} />
            <Stack.Screen name="contract/[id]/notifications" options={{ title: '이 계약의 알림' }} />
            <Stack.Screen name="notifications" options={{ title: '알림' }} />
            <Stack.Screen name="viewer" options={{ title: '계약서' }} />
            <Stack.Screen name="register" options={{ headerShown: false, presentation: 'modal' }} />
            <Stack.Screen name="settings/profile" options={{ title: '프로필 편집' }} />
            <Stack.Screen name="documents" options={{ title: '보관 문서' }} />
            <Stack.Screen name="settings/delete-account" options={{ title: '회원 탈퇴' }} />
            <Stack.Screen name="settings/notifications" options={{ title: '알림 설정' }} />
            <Stack.Screen name="settings/notification-type" options={{ title: '알림 종류 설정' }} />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="welcome" options={{ headerShown: false }} />
            <Stack.Screen name="sign-in" options={{ title: '' }} />
            <Stack.Screen name="sign-up" options={{ title: '' }} />
            <Stack.Screen name="forgot-password" options={{ title: '' }} />
          </Stack.Protected>
          {/* 메일 링크/OAuth 콜백 — 로그인 여부와 관계없이 열려야 한다 */}
          <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
          <Stack.Screen name="reset-password" options={{ title: '새 비밀번호' }} />
        </Stack>
        <SplashOverlay visible={!booted} />
      </View>
    </QueryClientProvider>
  );
}

/** 첫 데이터를 기다리는 최대 시간 — 넘으면 홈으로 넘기고 홈이 로딩·오류를 보여준다 */
const BOOT_MAX_MS = 15_000;
const FADE_MS = 200;

/** 첫 데이터가 준비될 때까지 덮어 두는 브랜드 화면 — 끝나면 짧게 흐려지며 사라진다 (opacity만) */
function SplashOverlay({ visible }: { visible: boolean }) {
  const [gone, setGone] = useState(false);
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (visible) return;
    Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => setGone(true));
  }, [visible, opacity]);
  if (gone) return null;
  return (
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity }} pointerEvents={visible ? 'auto' : 'none'}>
      <BrandSplash testID={visible ? 'brand-splash' : 'brand-splash-leaving'} />
    </Animated.View>
  );
}
