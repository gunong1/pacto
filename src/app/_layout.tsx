import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { useSession } from '@/features/session/store';
import { colors, typography } from '@/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  const signedIn = useSession((s) => s.signedIn);

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

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
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </QueryClientProvider>
  );
}
