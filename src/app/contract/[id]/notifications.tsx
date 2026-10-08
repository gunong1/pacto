import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Screen, Section } from '@/components/ui/layout';
import {
  CONTRACT_OFFSET_PRESETS,
  getEffectiveNotificationPreferences,
  NOTIFICATION_CATEGORIES,
  toReminderRules,
  type CategoryPrefs,
  type CategoryPrefsMap,
  type ContractNotificationOverride,
  type NotificationPreferences,
  type NotificationCategory,
} from '@/domain/notifications';
import { reminderPolicySummary } from '@/domain/reminders';
import { useContract } from '@/features/contracts/queries';
import { CategoryPrefsEditor } from '@/features/notifications/CategoryPrefsEditor';
import { useContractNotificationOverride, useNotificationPreferences, useSaveContractNotificationOverride } from '@/features/notifications/queries';
import { notify } from '@/lib/dialog';
import { colors, radius, spacing } from '@/theme';

/**
 * 이 계약의 알림 — "내 기본 알림 설정 사용" 또는 "이 계약만 직접 설정" (예: 전세계약만 만료 180·90·30일 전).
 * 우선순위: PACTO 기본값 → 내 기본 설정 → 이 계약 설정
 */
export default function ContractNotificationsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: record } = useContract(id);
  const { data: prefs } = useNotificationPreferences();
  const { data: override, isFetched } = useContractNotificationOverride(id);
  if (!record || !prefs || !isFetched) return <Screen edges={[]} />;
  return <Editor id={id} title={record.contract.title} notificationsEnabled={record.contract.notificationsEnabled} prefs={prefs} override={override ?? null} />;
}

function Editor({
  id,
  title,
  notificationsEnabled,
  prefs,
  override,
}: {
  id: string;
  title: string;
  notificationsEnabled: boolean;
  prefs: NotificationPreferences;
  override: ContractNotificationOverride | null;
}) {
  const save = useSaveContractNotificationOverride(id);
  const [mode, setMode] = useState<'default' | 'custom'>(override ? 'custom' : 'default');
  const [draft, setDraft] = useState<CategoryPrefsMap>(() => getEffectiveNotificationPreferences(prefs, override).categories);
  const userEff = getEffectiveNotificationPreferences(prefs);

  const submit = () => {
    const value = mode === 'default' ? null : Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, draft[c]]));
    save.mutate(value, { onSuccess: () => notify('저장했어요', mode === 'default' ? '이 계약은 내 기본 알림 설정을 따라요.' : '이 계약에만 직접 설정한 알림 시점을 써요.'), onError: () => notify('저장하지 못했어요', '잠시 후 다시 시도해주세요.') });
  };
  const set = (changes: Partial<Record<NotificationCategory, CategoryPrefs>>) => setDraft({ ...draft, ...changes });

  return (
    <Screen
      edges={['bottom']}
      footer={<Button label="저장" onPress={submit} loading={save.isPending} testID="contract-notif-save" />}>
      <View style={styles.head}>
        <AppText variant="title3" numberOfLines={1}>
          {title}
        </AppText>
        {!notificationsEnabled ? (
          <AppText variant="caption" color="caution" style={{ marginTop: 4 }}>
            이 계약은 알림 받기가 꺼져 있어요. 계약 상세에서 켜야 알림이 와요.
          </AppText>
        ) : null}
      </View>
      <Section>
        <Option selected={mode === 'default'} onPress={() => setMode('default')} label="내 기본 알림 설정 사용" testID="contract-notif-default">
          <AppText variant="caption" color="textTertiary">
            {reminderPolicySummary(toReminderRules(userEff))
              .map((r) => `${r.label} ${r.when}`)
              .join(' · ')}
          </AppText>
        </Option>
        <Option selected={mode === 'custom'} onPress={() => setMode('custom')} label="이 계약만 직접 설정" testID="contract-notif-custom">
          <AppText variant="caption" color="textTertiary">
            이 계약에만 다른 알림 시점을 써요. 다른 계약은 그대로예요.
          </AppText>
        </Option>
      </Section>
      {mode === 'custom' ? (
        <Section title="이 계약의 알림 시점">
          <CategoryPrefsEditor value={draft} onChange={set} presets={CONTRACT_OFFSET_PRESETS} testIDPrefix="contract-notif" />
        </Section>
      ) : null}
    </Screen>
  );
}

function Option({ selected, onPress, label, children, testID }: { selected: boolean; onPress: () => void; label: string; children?: React.ReactNode; testID?: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.option, selected && styles.optionOn]} accessibilityRole="radio" accessibilityState={{ checked: selected }} testID={testID}>
      <View style={[styles.radio, selected && styles.radioOn]} />
      <View style={{ flex: 1 }}>
        <AppText variant="body2Strong">{label}</AppText>
        {children}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md, paddingBottom: spacing.sm },
  option: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.border, marginTop: 2 },
  radioOn: { borderColor: colors.primary, borderWidth: 6 },
});
