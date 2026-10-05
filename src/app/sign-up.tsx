import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/controls';
import { authErrorMessage, authService } from '@/features/auth/authService';
import { AuthScreen, isEmail, MIN_PASSWORD } from '@/features/auth/AuthScreen';
import { colors, spacing } from '@/theme';

function Check({ label, value, onChange, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  return (
    <Pressable style={styles.check} onPress={() => onChange(!value)} accessibilityRole="checkbox" accessibilityState={{ checked: value }} testID={testID}>
      <Ionicons name={value ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={value ? colors.primary : colors.textDisabled} />
      <AppText variant="body2" style={{ flex: 1 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [ai, setAi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async () => {
    if (!isEmail(email)) return setError('이메일 주소를 확인해주세요.');
    if (password.length < MIN_PASSWORD) return setError(`비밀번호는 ${MIN_PASSWORD}자 이상으로 만들어주세요.`);
    if (password !== confirm) return setError('비밀번호가 서로 달라요.');
    if (!terms || !privacy) return setError('필수 약관에 동의해주세요.');
    setBusy(true);
    setError(null);
    try {
      const { needsEmailConfirmation } = await authService.signUpWithEmail(email, password, { termsAgreed: terms, privacyAgreed: privacy, aiProcessingAgreed: ai });
      if (needsEmailConfirmation) setSentTo(email.trim());
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <AuthScreen title="인증 메일을 보냈어요" description={`${sentTo}로 보낸 메일의 링크를 누르면 가입이 완료됩니다.`} footer={<Button label="로그인으로" variant="secondary" onPress={() => router.replace('/sign-in')} />}>
        <View />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="PACTO 시작하기" description="계약서를 넣어두세요. 중요한 순간은 PACTO가 기억합니다." footer={<Button label="가입하기" onPress={submit} loading={busy} testID="sign-up-submit" />}>
      <TextField label="이메일" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="name@example.com" testID="sign-up-email" />
      <TextField label="비밀번호" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint={`${MIN_PASSWORD}자 이상`} testID="sign-up-password" />
      <TextField label="비밀번호 확인" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" testID="sign-up-confirm" />
      <View style={styles.consents}>
        <Check label="[필수] 이용약관 동의" value={terms} onChange={setTerms} testID="consent-terms" />
        <Check label="[필수] 개인정보 수집·이용 동의" value={privacy} onChange={setPrivacy} testID="consent-privacy" />
        <Check label="[선택] 계약서 자동 정리를 위한 외부 처리 동의" value={ai} onChange={setAi} testID="consent-ai" />
        <AppText variant="caption" color="textTertiary" style={{ marginTop: spacing.xs }}>
          약관 전문은 정식 출시 전에 제공됩니다. 선택 항목은 나중에 MY에서 바꿀 수 있어요.
        </AppText>
      </View>
      {error ? (
        <AppText variant="body2" color="caution" style={{ marginTop: spacing.md }} testID="sign-up-error">
          {error}
        </AppText>
      ) : null}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  consents: { marginTop: spacing.sm, gap: spacing.xs },
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
});
