import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/controls';
import { authErrorMessage, authService } from '@/features/auth/authService';
import { AuthScreen, isEmail } from '@/features/auth/AuthScreen';
import { hitSlop, spacing } from '@/theme';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!isEmail(email) || !password) return setError('이메일과 비밀번호를 입력해주세요.');
    setBusy(true);
    setError(null);
    try {
      await authService.signInWithEmail(email, password);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen title="이메일로 로그인" footer={<Button label="로그인" onPress={submit} loading={busy} testID="sign-in-submit" />}>
      <TextField label="이메일" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="name@example.com" testID="sign-in-email" />
      <TextField label="비밀번호" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} testID="sign-in-password" error={error ?? undefined} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
        <Pressable onPress={() => router.push('/forgot-password')} hitSlop={hitSlop}>
          <AppText variant="body2" color="textSecondary">
            비밀번호를 잊으셨나요?
          </AppText>
        </Pressable>
        <Pressable onPress={() => router.replace('/sign-up')} hitSlop={hitSlop} testID="go-sign-up">
          <AppText variant="body2Strong" color="primary">
            가입하기
          </AppText>
        </Pressable>
      </View>
    </AuthScreen>
  );
}
