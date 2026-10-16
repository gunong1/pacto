import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { SwitchRow } from '@/components/ui/controls';
import { ListRow, Screen, Section, SectionGap } from '@/components/ui/layout';
import { NOTIFICATION_SETTING_GROUPS } from '@/domain/notificationGroups';
import { getEffectiveNotificationPreferences } from '@/domain/notifications';
import { NotificationGroupCard } from '@/features/notifications/NotificationGroupCard';
import { PushPermissionCard } from '@/features/notifications/PushPermissionCard';
import { useNotificationPreferences, usePushPermission, useSaveNotificationPreferences } from '@/features/notifications/queries';
import { confirm, notify } from '@/lib/dialog';
import { colors, spacing } from '@/theme';

/**
 * 알림 설정 — 알림 종류 7개(저장 키)를 3묶음 카드로 보여준다 (입출금 · 계약 만료·갱신 · 중요 확인).
 * 카드를 누르면 묶음 안 종류별 설정(기존 화면)으로. 기본 알림 시간·시간대·잠금화면 표시는 "고급 설정"으로.
 * 저장 구조·알림 계산은 그대로 — 묶음은 화면 구조일 뿐 (src/domain/notificationGroups.ts)
 */
export default function NotificationSettingsScreen() {
  const { data: prefs } = useNotificationPreferences();
  const save = useSaveNotificationPreferences();
  const [permission, refreshPermission] = usePushPermission();
  if (!prefs) return <Screen edges={[]} />;
  const eff = getEffectiveNotificationPreferences(prefs);

  const toggleAll = async (on: boolean) => {
    if (!on && !(await confirm('PACTO 알림을 모두 끌까요?', '해지 통보기한 같은 중요한 기한 알림도 오지 않아요.', '끄기', '유지하기'))) return;
    save.mutate({ enabled: on }, { onError: () => notify('저장하지 못했어요', '잠시 후 다시 시도해주세요.') });
  };

  return (
    <Screen edges={[]}>
      <View style={styles.intro}>
        <AppText variant="body2Strong">중요한 계약 일정을 놓치지 않도록 알려드려요.</AppText>
        <AppText variant="caption" color="textTertiary" style={{ marginTop: 2 }}>
          필요한 알림만 간편하게 설정하세요.
        </AppText>
      </View>
      <PushPermissionCard permission={permission} onChanged={refreshPermission} />
      <Section>
        <SwitchRow label="PACTO 알림 받기" value={eff.enabled} onValueChange={toggleAll} testID="notif-enabled" />
      </Section>
      <View style={[styles.groups, !eff.enabled && styles.off]} pointerEvents={eff.enabled ? 'auto' : 'none'} testID="notif-groups">
        {NOTIFICATION_SETTING_GROUPS.map((g) => (
          <NotificationGroupCard key={g.key} group={g} eff={eff} onPress={() => router.push({ pathname: '/settings/notification-group', params: { group: g.key } })} />
        ))}
      </View>
      <SectionGap />
      <Section>
        <ListRow
          title="고급 설정"
          subtitle="기본 알림 시간 · 알림 기준 시간대 · 잠금화면 표시"
          left={<Ionicons name="options-outline" size={20} color={colors.textSecondary} />}
          chevron
          onPress={() => router.push('/settings/notification-advanced')}
          testID="notif-advanced"
        />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  groups: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm, gap: spacing.md },
  off: { opacity: 0.45 },
});
