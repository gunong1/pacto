import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { notify } from '@/lib/dialog';
import { colors, radius, spacing } from '@/theme';

import { enablePush, openSystemSettings, PUSH_UNAVAILABLE_COPY, pushUnavailableReason, type PushPermission } from './push';

/** 이 기기의 알림 상태 — 권한이 없어도 앱은 그대로 쓸 수 있고, 여기서 상태를 안내한다 */
export function PushPermissionCard({ permission, onChanged, compact }: { permission: PushPermission | null; onChanged: () => void; compact?: boolean }) {
  if (permission === null) return null;
  if (permission === 'granted' && compact) return null;
  const reason = pushUnavailableReason();
  const turnOn = async () => {
    try {
      const r = await enablePush();
      if (r === 'blocked') notify('알림이 꺼져 있어요', '휴대폰 설정에서 PACTO 알림을 허용해주세요.');
    } catch {
      notify('알림을 켜지 못했어요', '잠시 후 다시 시도해주세요.');
    }
    onChanged();
  };
  const copy =
    permission === 'granted'
      ? { title: '이 기기에서 알림을 받고 있어요', body: '설정한 시점에 PACTO가 알려드려요.' }
      : permission === 'unavailable'
        ? { title: '이 기기에서는 푸시 알림을 받을 수 없어요', body: reason ? PUSH_UNAVAILABLE_COPY[reason] : '' }
        : permission === 'blocked'
          ? { title: '알림이 꺼져 있어요', body: '휴대폰 설정에서 PACTO 알림을 허용해주세요.' }
          : { title: '중요한 계약 일정을 알려드릴까요?', body: '결제일, 만료, 갱신·해지기한을 놓치지 않도록 알려드려요.' };
  return (
    <View style={[styles.card, permission === 'granted' && styles.ok]} testID="push-permission">
      <AppText variant="body2Strong">{copy.title}</AppText>
      {copy.body ? (
        <AppText variant="caption" color="textSecondary" style={{ marginTop: 2 }}>
          {copy.body}
        </AppText>
      ) : null}
      {permission === 'undetermined' || permission === 'denied' ? <Button label="알림 받기" size="sm" onPress={turnOn} style={styles.button} testID="push-enable" /> : null}
      {permission === 'blocked' ? <Button label="설정 열기" size="sm" variant="secondary" onPress={openSystemSettings} style={styles.button} testID="push-open-settings" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: spacing.gutter, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSubtle },
  ok: { backgroundColor: colors.primarySoft },
  button: { marginTop: spacing.sm, alignSelf: 'flex-start' },
});
