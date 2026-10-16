/**
 * 알림 설정 3묶음 카드 — 아이콘 · 이름·설명 · 상태(켜짐/꺼짐/일부 켜짐) · 요약 · 켜기/끄기
 * 일부만 켜진 상태를 켬/끔 스위치 하나로 뭉뚱그리지 않는다: 상태 표시와 동작 버튼을 나눈다.
 * 카드를 누르면 그룹 상세(종류별 설정)로, 버튼은 따로 동작한다.
 */
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { applyGroupAction, GROUP_STATE_LABEL, groupActions, groupHasCritical, groupState, groupSummary, type GroupAction, type SettingGroup } from '@/domain/notificationGroups';
import type { EffectivePreferences } from '@/domain/notifications';
import { confirmCriticalOff } from '@/features/notifications/CategoryPrefsEditor';
import { useSaveNotificationPreferences } from '@/features/notifications/queries';
import { notify } from '@/lib/dialog';
import { colors, hitSlop, radius, spacing } from '@/theme';

const ICON: Record<SettingGroup['key'], keyof typeof Ionicons.glyphMap> = { money: 'wallet-outline', term: 'calendar-outline', check: 'document-text-outline' };


/** 웹은 버튼 안에 버튼을 둘 수 없어(<button> 중첩) 카드 바깥은 역할 없이 — 앱(iOS·Android)에서는 카드 전체가 버튼 */
const CARD_ROLE = Platform.OS === 'web' ? undefined : ('button' as const);
/** 그룹 켜기/끄기 — 기존 종류별 키에만 저장 (해지 통보기한이 든 그룹을 끌 때는 확인) */
export function useGroupAction(eff: EffectivePreferences) {
  const save = useSaveNotificationPreferences();
  return async (g: SettingGroup, action: GroupAction) => {
    if (action === 'off' && groupHasCritical(g) && !(await confirmCriticalOff(g.label))) return;
    const patch = applyGroupAction(eff.categories, g, action);
    save.mutate({ categories: { ...eff.categories, ...patch } }, { onError: () => notify('저장하지 못했어요', '잠시 후 다시 시도해주세요.') });
  };
}

export function GroupControls({ group, eff, testID }: { group: SettingGroup; eff: EffectivePreferences; testID: string }) {
  const run = useGroupAction(eff);
  const state = groupState(eff.categories, group);
  return (
    <View style={styles.actions}>
      {groupActions(state).map((a) => (
        <Pressable
          key={a.action}
          onPress={() => run(group, a.action)}
          hitSlop={hitSlop}
          accessibilityRole="button"
          accessibilityLabel={`${group.label} ${a.label}`}
          style={({ pressed }) => [styles.actionBtn, a.action !== 'off' && styles.actionPrimary, pressed && { opacity: 0.7 }]}
          testID={`${testID}-${a.action}`}>
          <AppText variant="captionStrong" color={a.action !== 'off' ? 'textInverse' : 'primary'}>
            {a.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

export function NotificationGroupCard({ group, eff, onPress }: { group: SettingGroup; eff: EffectivePreferences; onPress?: () => void }) {
  const state = groupState(eff.categories, group);
  const testID = `notif-group-${group.key}`;
  return (
    <Pressable onPress={onPress} accessibilityRole={CARD_ROLE} accessibilityHint="세부 설정으로 이동해요" style={({ pressed }) => [styles.card, pressed && onPress ? { backgroundColor: colors.bgPressed } : null]} testID={testID}>
      <View style={styles.top}>
        <View style={styles.icon}>
          <Ionicons name={ICON[group.key]} size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="body2Strong">{group.label}</AppText>
          <AppText variant="caption" color="textTertiary" style={{ marginTop: 2 }}>
            {group.description}
          </AppText>
        </View>
        <View style={[styles.state, state === 'on' ? styles.stateOn : state === 'partial' ? styles.statePartial : null]} testID={`${testID}-state`}>
          <AppText variant="small" color={state === 'on' ? 'primary' : state === 'partial' ? 'check' : 'textTertiary'}>
            {GROUP_STATE_LABEL[state]}
          </AppText>
        </View>
      </View>
      <View style={styles.bottom}>
        <AppText variant="caption" color="textSecondary" style={{ flex: 1 }} testID={`${testID}-summary`}>
          {groupSummary(eff.categories, eff.defaultTimes, group)}
        </AppText>
        {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} /> : null}
      </View>
      <GroupControls group={group} eff={eff} testID={testID} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.bgSubtle, gap: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  state: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.bg },
  stateOn: { backgroundColor: colors.primarySoft },
  statePartial: { backgroundColor: colors.checkSoft },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  actionPrimary: { backgroundColor: colors.primary },
});
