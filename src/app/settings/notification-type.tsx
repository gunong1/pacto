import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Chip, RadioGroup, SwitchRow } from '@/components/ui/controls';
import { Screen, Section, SectionGap } from '@/components/ui/layout';
import {
  formatTimes,
  getEffectiveNotificationPreferences,
  needsCriticalOffConfirm,
  NOTIFICATION_CATEGORY_DEFS,
  NOTIFICATION_CATEGORY_GROUPS,
  offsetLabel,
  OFFSET_PRESETS,
  type CategoryPrefs,
} from '@/domain/notifications';
import { confirmCriticalOff } from '@/features/notifications/CategoryPrefsEditor';
import { useNotificationPreferences, useSaveNotificationPreferences } from '@/features/notifications/queries';
import { TimeList } from '@/features/notifications/TimeList';
import { notify } from '@/lib/dialog';
import { spacing } from '@/theme';

type TimeMode = 'default' | 'custom';

/**
 * 알림 종류 하나의 설정 — 켜기/끄기 · 며칠 전(여러 개) · 알림 시간(기본 알림 시간 사용 / 이 알림만 다른 시간, 여러 개).
 * 묶음(해지·갱신 통보기한 = 해지·종료 + 갱신 통보)은 속한 종류별 키에 같은 값을 저장한다.
 */
export default function NotificationTypeScreen() {
  const { key } = useLocalSearchParams<{ key?: string }>();
  const group = NOTIFICATION_CATEGORY_GROUPS.find((g) => g.key === key);
  const { data: prefs } = useNotificationPreferences();
  const save = useSaveNotificationPreferences();
  if (!prefs || !group) return <Screen edges={[]} />;
  const eff = getEffectiveNotificationPreferences(prefs);
  const v = eff.categories[group.key];
  const critical = group.members.some((m) => NOTIFICATION_CATEGORY_DEFS[m].critical);

  const write = async (next: CategoryPrefs) => {
    if (critical && needsCriticalOffConfirm(group.key, next) && !needsCriticalOffConfirm(group.key, v)) {
      if (!(await confirmCriticalOff(group.label))) return;
    }
    const value = (): CategoryPrefs => (next.times?.length ? { enabled: next.enabled, offsets: [...next.offsets], times: [...next.times] } : { enabled: next.enabled, offsets: [...next.offsets] });
    save.mutate(
      { categories: { ...eff.categories, ...Object.fromEntries(group.members.map((m) => [m, value()])) } },
      { onError: () => notify('저장하지 못했어요', '잠시 후 다시 시도해주세요.') },
    );
  };
  const mode: TimeMode = v.times?.length ? 'custom' : 'default';
  const options = [...new Set([...OFFSET_PRESETS, ...v.offsets])].sort((a, b) => b - a);

  return (
    <Screen edges={[]}>
      <Section caption={group.description}>
        <AppText variant="title3">{group.label}</AppText>
        <View style={{ height: spacing.sm }} />
        <SwitchRow label="이 알림 받기" value={v.enabled} onValueChange={(on) => write({ ...v, enabled: on })} testID="type-enabled" />
      </Section>
      {v.enabled ? (
        <>
          <SectionGap />
          <Section title="언제 알려드릴까요?" caption="기한 며칠 전에 알릴지 골라주세요. 여러 개 고를 수 있어요." testID="type-offsets">
            <View style={styles.chips}>
              {options.map((d) => {
                const on = v.offsets.includes(d);
                return (
                  <Chip
                    key={d}
                    label={offsetLabel(d)}
                    selected={on}
                    onPress={() => write({ ...v, offsets: on ? v.offsets.filter((x) => x !== d) : [...v.offsets, d].sort((a, b) => b - a) })}
                    testID={`type-offset-${d}`}
                  />
                );
              })}
            </View>
            {v.offsets.length === 0 ? (
              <AppText variant="small" color="caution">
                알림 시점을 하나 이상 골라주세요. 고르지 않으면 이 알림은 오지 않아요.
              </AppText>
            ) : null}
          </Section>
          <SectionGap />
          <Section title="알림 시간" testID="type-times">
            <RadioGroup<TimeMode>
              options={[
                { value: 'default', label: '기본 알림 시간 사용', description: formatTimes(eff.defaultTimes) },
                { value: 'custom', label: '이 알림만 다른 시간 사용' },
              ]}
              value={mode}
              onChange={(m) => {
                if (m === mode) return;
                // 다른 시간을 고르면 지금 기본 시간에서 시작 (바로 바꿀 수 있음)
                write({ ...v, times: m === 'custom' ? [...eff.defaultTimes] : undefined });
              }}
              testIDPrefix="type-time-mode"
            />
            {mode === 'custom' ? (
              <View style={{ marginTop: spacing.sm }}>
                <TimeList times={v.times!} onChange={(t) => write({ ...v, times: t })} testIDPrefix="type" />
              </View>
            ) : null}
          </Section>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingBottom: spacing.sm },
});
