import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { authErrorMessage, authService } from '@/features/auth/authService';
import { colors, spacing } from '@/theme';

/** 이메일 인증 / OAuth 콜백: pacto://auth/callback?code=... → 세션 교환 후 홈 */
export default function AuthCallbackScreen() {
  const { code, error_description } = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const [error, setError] = useState<string | null>(error_description ? '인증에 실패했어요. 다시 시도해주세요.' : null);

  useEffect(() => {
    if (!code) return;
    authService
      .exchangeCode(code)
      .then(() => router.replace('/'))
      .catch((e) => setError(authErrorMessage(e)));
  }, [code]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.gutter, backgroundColor: colors.bg }}>
      {error || !code ? (
        <>
          <AppText variant="title3" align="center">
            {error ?? '잘못된 링크예요.'}
          </AppText>
          <Button label="처음으로" variant="secondary" style={{ marginTop: spacing.xl }} onPress={() => router.replace('/')} />
        </>
      ) : (
        <ActivityIndicator color={colors.primary} />
      )}
    </View>
  );
}
