import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Chip, SwitchRow } from '@/components/ui/controls';
import { Divider, ListRow, Screen, Section, SectionGap } from '@/components/ui/layout';
import { categorySummary, DEFAULT_TIMES, getEffectiveNotificationPreferences, isPactoDefault, NOTIFICATION_CATEGORY_GROUPS } from '@/domain/notifications';
import { notificationStore } from '@/data';
import { PushPermissionCard } from '@/features/notifications/PushPermissionCard';
import { TimeList } from '@/features/notifications/TimeList';
import { usePushPermission, useNotificationPreferences, useSaveNotificationPreferences } from '@/features/notifications/queries';
import { confirm, notify } from '@/lib/dialog';
import { colors, radius, spacing } from '@/theme';

/** 알림 기준 시간대 선택지 — 기기 시간대가 바뀌어도 자동으로 바꾸지 않는다 */
const TIMEZONES: { value: string; label: string }[] = [
  { value: 'Asia/Seoul', label: '한국' },
  { value: 'Asia/Tokyo', label: '일본' },
  { value: 'Asia/Shanghai', label: '중국' },
  { value: 'Asia/Singapore', label: '싱가포르' },
  { value: 'Australia/Sydney', label: '호주 시드니' },
  { value: 'Europe/London', label: '영국' },
  { value: 'Europe/Paris', label: '프랑스·독일' },
  { value: 'America/New_York', label: '미국 동부' },
  { value: 'America/Los_Angeles', label: '미국 서부' },
];

const SHOW_TEST = __DEV__ || process.env.EXPO_PUBLIC_SHOW_PUSH_TEST === 'true';

export default function NotificationSettingsScreen() {
  const { data: prefs } = useNotificationPreferences();
  const save = useSaveNotificationPreferences();
  const [permission, refreshPermission] = usePushPermission();
  const [testing, setTesting] = useState(false);
  const [tzOpen, setTzOpen] = useState(false);
  if (!prefs) return <Screen edges={[]} />;
  const eff = getEffectiveNotificationPreferences(prefs);
  const patch = (p: Parameters<typeof save.mutate>[0]) => save.mutate(p, { onError: () => notify('저장하지 못했어요', '잠시 후 다시 시도해주세요.') });

  const toggleAll = async (on: boolean) => {
    if (!on && !(await confirm('PACTO 알림을 모두 끌까요?', '해지 통보기한 같은 중요한 기한 알림도 오지 않아요.', '끄기', '유지하기'))) return;
    patch({ enabled: on });
  };
  const reset = async () => {
    if (await confirm('PACTO 기본값으로 되돌릴까요?', '알림 종류와 시점, 알림 시간이 기본값(오전 9:00)으로 돌아가요.', '되돌리기')) patch({ categories: {}, defaultTimes: [...DEFAULT_TIMES], enabled: true });
  };
  const sendTest = async (delaySeconds = 0) => {
    setTesting(true);
    const r = await notificationStore.sendTest({ delaySeconds });
    setTesting(false);
    if ('error' in r) notify('테스트 알림', r.error === 'test_push_disabled' ? '서버에서 테스트 알림이 꺼져 있어요 (ALLOW_TEST_PUSH).' : `보내지 못했어요 (${r.error})`);
    else if ('scheduledInSeconds' in r) notify('테스트 알림', `${r.scheduledInSeconds}초 뒤에 보내요. 앱을 닫거나 백그라운드로 보내 확인해보세요.`);
    else notify('테스트 알림', r.devices === 0 ? '알림을 받을 기기가 없어요. 먼저 "알림 받기"를 눌러주세요.' : `기기 ${r.devices}대 중 ${r.ok}대로 보냈어요.${r.errors.length ? ` (오류: ${r.errors.join(', ')})` : ''}`);
  };

  const tzLabel = TIMEZONES.find((t) => t.value === eff.timezone)?.label ?? eff.timezone;
  return (
    <Screen edges={[]}>
      <PushPermissionCard permission={permission} onChanged={refreshPermission} />
      <Section>
        <SwitchRow label="PACTO 알림 받기" value={eff.enabled} onValueChange={toggleAll} testID="notif-enabled" />
      </Section>
      <View style={eff.enabled ? undefined : styles.off} pointerEvents={eff.enabled ? 'auto' : 'none'}>
        <SectionGap />
        <Section title="기본 알림 시간" caption={`모든 알림이 이 시간에 와요 (${tzLabel} 시간 기준). 알림 종류마다 다른 시간을 쓸 수도 있어요.`} testID="notif-default-times">
          <TimeList times={eff.defaultTimes} onChange={(t) => patch({ defaultTimes: t })} testIDPrefix="notif-default" />
        </Section>
        <SectionGap />
        <Section title="알림 종류" caption="기한 며칠 전에, 몇 시에 알려줄지예요. 눌러서 바꿀 수 있어요." testID="notif-types">
          {NOTIFICATION_CATEGORY_GROUPS.map((g, i) => (
            <View key={g.key}>
              {i > 0 ? <Divider /> : null}
              <ListRow
                title={g.label}
                subtitle={categorySummary(eff.categories[g.key], eff.defaultTimes)}
                chevron
                onPress={() => router.push({ pathname: '/settings/notification-type', params: { key: g.key } })}
                testID={`notif-type-${g.key}`}
              />
            </View>
          ))}
        </Section>
      </View>
      <SectionGap />
      <Section title="알림 기준 시간대" caption="해외에 있어도 자동으로 바뀌지 않아요. 계약 기한 알림 시간이 흔들리지 않도록 직접 바꿀 때만 바뀌어요.">
        <ListRow title={tzLabel} subtitle={tzOpen ? undefined : '바꾸기'} chevron onPress={() => setTzOpen((o) => !o)} testID="notif-tz-toggle" />
        {tzOpen ? (
          <View style={styles.chips}>
            {TIMEZONES.map((t) => (
              <Chip
                key={t.value}
                label={t.label}
                selected={eff.timezone === t.value}
                onPress={() => {
                  patch({ timezone: t.value });
                  setTzOpen(false);
                }}
                testID={`notif-tz-${t.value}`}
              />
            ))}
          </View>
        ) : null}
      </Section>
      <SectionGap />
      <Section title="잠금화면 표시">
        <SwitchRow
          label="알림에 계약 상세 표시"
          description={eff.showDetails ? '계약명과 금액이 알림에 보여요. 잠금화면에서 다른 사람이 볼 수 있어요.' : '알림에는 "확인할 계약 일정이 있어요"처럼 간단히만 보여요. 자세한 내용은 앱에서 확인해요.'}
          value={eff.showDetails}
          onValueChange={(v) => patch({ showDetails: v })}
          testID="notif-show-details"
        />
      </Section>
      <View style={styles.footer}>
        {!isPactoDefault(prefs.categories) || eff.defaultTimes.join(',') !== DEFAULT_TIMES.join(',') || !eff.enabled ? (
          <Button label="PACTO 기본값으로 되돌리기" variant="secondary" onPress={reset} testID="notif-reset" />
        ) : (
          <AppText variant="caption" color="textTertiary" style={{ textAlign: 'center' }} testID="notif-is-default">
            PACTO 기본 알림 설정을 쓰고 있어요
          </AppText>
        )}
      </View>
      {SHOW_TEST ? (
        <View style={styles.dev} testID="notif-test">
          <AppText variant="captionStrong" color="textSecondary">
            개발·테스트용
          </AppText>
          <View style={styles.devRow}>
            <Button label="테스트 알림 보내기" size="sm" variant="secondary" loading={testing} onPress={() => sendTest(0)} testID="notif-test-now" />
            <Button label="10초 뒤 보내기" size="sm" variant="ghost" onPress={() => sendTest(10)} testID="notif-test-delay" />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingBottom: spacing.md },
  off: { opacity: 0.45 },
  footer: { padding: spacing.gutter, paddingTop: spacing.xl },
  dev: { margin: spacing.gutter, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, gap: spacing.sm },
  devRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
});
