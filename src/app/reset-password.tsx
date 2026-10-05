import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/controls';
import { authErrorMessage, authService } from '@/features/auth/authService';
import { AuthScreen, MIN_PASSWORD } from '@/features/auth/AuthScreen';
import { useSession } from '@/features/session/store';
import { notify } from '@/lib/dialog';

/** 재설정 메일 링크(pacto://reset-password?code=...) 또는 로그인 상태에서 비밀번호 변경 */
export default function ResetPasswordScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const signedIn = useSession((s) => s.status === 'signedIn');
  const [ready, setReady] = useState(!code);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) return;
    authService
      .exchangeCode(code)
      .then(() => setReady(true))
      .catch((e) => setError(authErrorMessage(e)));
  }, [code]);

  const submit = async () => {
    if (password.length < MIN_PASSWORD) return setError(`비밀번호는 ${MIN_PASSWORD}자 이상으로 만들어주세요.`);
    if (password !== confirm) return setError('비밀번호가 서로 달라요.');
    setBusy(true);
    setError(null);
    try {
      await authService.updatePassword(password);
      notify('비밀번호 변경', '새 비밀번호로 변경했어요.');
      router.replace('/');
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const usable = ready && (signedIn || !!code);
  return (
    <AuthScreen
      title="새 비밀번호 설정"
      description={usable ? undefined : error ?? '링크를 확인하고 있어요…'}
      footer={<Button label="변경하기" onPress={submit} loading={busy} disabled={!usable} />}>
      <TextField label="새 비밀번호" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" hint={`${MIN_PASSWORD}자 이상`} />
      <TextField label="새 비밀번호 확인" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" error={usable ? error ?? undefined : undefined} />
    </AuthScreen>
  );
}
