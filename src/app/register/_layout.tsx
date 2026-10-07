import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { Pressable } from 'react-native';

import { documentStore } from '@/data';
import { useRegistration } from '@/features/registration/store';
import { colors, hitSlop, typography } from '@/theme';

function CloseButton() {
  return (
    <Pressable
      hitSlop={hitSlop}
      accessibilityLabel="닫기"
      testID="register-close"
      onPress={() => {
        // 저장하지 않은 업로드는 정리 (계약에 연결되지 않은 원본만 삭제)
        const { uploaded, reset } = useRegistration.getState();
        documentStore.discard(uploaded.map((d) => d.id)).catch(() => undefined);
        reset();
        router.dismissTo('/');
      }}>
      <Ionicons name="close" size={24} color={colors.text} />
    </Pressable>
  );
}

export default function RegisterLayout() {
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { ...typography.title3, color: colors.text },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.bg },
        headerRight: () => <CloseButton />,
      }}>
      <Stack.Screen name="index" options={{ title: '계약 등록' }} />
      <Stack.Screen name="capture" options={{ title: '계약서 촬영' }} />
      <Stack.Screen name="analyzing" options={{ title: '', headerBackVisible: false, headerLeft: () => null, gestureEnabled: false }} />
      <Stack.Screen name="review" options={{ title: '계약정보 확인', headerBackVisible: false, headerLeft: () => null }} />
      <Stack.Screen name="manual" options={{ title: '직접 입력' }} />
    </Stack>
  );
}
