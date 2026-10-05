import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';

import { authService } from '@/features/auth/authService';
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

  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync();
  }, [status]);

  if (status === 'loading') return null;
  const signedIn = status === 'signedIn';

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
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
          <Stack.Screen name="notifications" options={{ title: '알림' }} />
          <Stack.Screen name="register" options={{ headerShown: false, presentation: 'modal' }} />
          <Stack.Screen name="settings/delete-account" options={{ title: '회원 탈퇴' }} />
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
    </QueryClientProvider>
  );
}
