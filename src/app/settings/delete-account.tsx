import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Screen, Section } from '@/components/ui/layout';
import { authErrorMessage, authService } from '@/features/auth/authService';
import { useContracts } from '@/features/contracts/queries';
import { confirm, notify } from '@/lib/dialog';
import { colors, radius, spacing } from '@/theme';

/** 회원 탈퇴 — 삭제 범위를 분명히 알리고 확인 후 진행 (스토어 심사 요건: 앱 내 계정 삭제) */
export default function DeleteAccountScreen() {
  const { data } = useContracts();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const docs = data?.reduce((n, r) => n + r.documents.length, 0) ?? 0;

  const run = async () => {
    const ok = await confirm('회원 탈퇴', '모든 계약과 원본 계약서가 삭제되며 되돌릴 수 없습니다. 탈퇴할까요?', '탈퇴');
    if (!ok) return;
    setBusy(true);
    try {
      await authService.deleteAccount();
    } catch (e) {
      notify('회원 탈퇴', authErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']} footer={<Button label="탈퇴하기" variant="danger" disabled={!agreed} loading={busy} onPress={run} testID="delete-account-submit" />}>
      <Section>
        <AppText variant="title2">탈퇴하면 PACTO에 보관한{'\n'}모든 계약이 삭제돼요</AppText>
        <View style={styles.box}>
          <AppText variant="body2">• 계약 {data?.length ?? 0}건과 결제·일정·메모</AppText>
          <AppText variant="body2">• 원본 계약서 파일 {docs}개</AppText>
          <AppText variant="body2">• 계정과 동의 기록</AppText>
        </View>
        <AppText variant="caption" color="textTertiary">
          삭제된 정보는 복구할 수 없어요. 필요한 계약서는 탈퇴 전에 따로 저장해주세요.
        </AppText>
        <Pressable style={styles.agree} onPress={() => setAgreed((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} testID="delete-account-agree">
          <Ionicons name={agreed ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={agreed ? colors.caution : colors.textDisabled} />
          <AppText variant="body2">위 내용을 확인했고 탈퇴에 동의합니다</AppText>
        </Pressable>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { marginVertical: spacing.lg, padding: spacing.lg, gap: 6, borderRadius: radius.md, backgroundColor: colors.bgSubtle },
  agree: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl },
});
