import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/controls';
import { authErrorMessage, authService } from '@/features/auth/authService';
import { AuthScreen, isEmail } from '@/features/auth/AuthScreen';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!isEmail(email)) return setError('이메일 주소를 확인해주세요.');
    setBusy(true);
    setError(null);
    try {
      await authService.sendPasswordReset(email);
      setSent(true);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen
      title="비밀번호 재설정"
      description={sent ? '가입된 이메일이라면 재설정 링크를 보냈어요. 이 기기에서 메일의 링크를 열어주세요.' : '가입한 이메일로 재설정 링크를 보내드려요.'}
      footer={<Button label={sent ? '다시 보내기' : '링크 보내기'} onPress={submit} loading={busy} testID="forgot-submit" />}>
      <TextField label="이메일" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={error ?? undefined} testID="forgot-email" />
    </AuthScreen>
  );
}
