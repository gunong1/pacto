import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Divider, ListRow, Screen, Section, SectionGap } from '@/components/ui/layout';
import { groupRows, settingGroup } from '@/domain/notificationGroups';
import { categorySummary, getEffectiveNotificationPreferences } from '@/domain/notifications';
import { NotificationGroupCard } from '@/features/notifications/NotificationGroupCard';
import { useNotificationPreferences } from '@/features/notifications/queries';
import { spacing } from '@/theme';

/** 알림 묶음 상세 — 묶음 켜기/끄기 + 종류별 설정(기존 화면 그대로: 켜기·며칠 전·알림 시간) */
export default function NotificationGroupScreen() {
  const { group: key } = useLocalSearchParams<{ group?: string }>();
  const group = settingGroup(key);
  const { data: prefs } = useNotificationPreferences();
  if (!prefs || !group) return <Screen edges={[]} />;
  const eff = getEffectiveNotificationPreferences(prefs);
  const rows = groupRows(group);
  return (
    <Screen edges={[]}>
      <View style={styles.top}>
        <NotificationGroupCard group={group} eff={eff} />
      </View>
      <SectionGap />
      <Section title="알림 종류" caption="종류마다 며칠 전에, 몇 시에 알려줄지 따로 정할 수 있어요." testID="notif-group-rows">
        {rows.map((r, i) => (
          <View key={r.key}>
            {i > 0 ? <Divider /> : null}
            <ListRow
              title={r.label}
              subtitle={categorySummary(eff.categories[r.key], eff.defaultTimes)}
              chevron
              onPress={() => router.push({ pathname: '/settings/notification-type', params: { key: r.key } })}
              testID={`notif-type-${r.key}`}
            />
          </View>
        ))}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg },
});
