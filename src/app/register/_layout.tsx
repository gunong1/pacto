import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { Pressable } from 'react-native';

import { useRegistration } from '@/features/registration/store';
import { colors, hitSlop, typography } from '@/theme';

function CloseButton() {
  return (
    <Pressable
      hitSlop={hitSlop}
      accessibilityLabel="닫기"
      testID="register-close"
      onPress={() => {
        useRegistration.getState().reset();
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
      <Stack.Screen name="analyzing" options={{ title: '', headerBackVisible: false, gestureEnabled: false }} />
      <Stack.Screen name="review" options={{ title: '계약정보 확인', headerBackVisible: false }} />
      <Stack.Screen name="manual" options={{ title: '직접 입력' }} />
    </Stack>
  );
}
