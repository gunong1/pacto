import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { EmptyState, Screen, Section } from '@/components/ui/layout';
import { importantSchedule } from '@/domain/importantSchedule';
import { effectiveRulesSummary, formatTimeOfDay, getEffectiveNotificationPreferences } from '@/domain/notifications';
import { reminderPolicySummary } from '@/domain/reminders';
import { useContracts, useToday } from '@/features/contracts/queries';
import { ImportantScheduleCard } from '@/features/notifications/ImportantScheduleCard';
import { PushPermissionCard } from '@/features/notifications/PushPermissionCard';
import { useNotificationPreferences, usePushPermission } from '@/features/notifications/queries';
import { colors, hitSlop, radius, spacing } from '@/theme';

/**
 * 알림 화면 = 놓치면 안 되는 중요한 계약 일정(critical·important, 최대 5개) + 내가 알림을 받는 방식(설정 요약).
 * 앞으로 보낼 푸시 목록은 보여주지 않는다 — 미래 일정 전체는 캘린더, 실제 알림은 푸시가 맡는다 (scheduled_notifications는 서버 발송용으로 그대로).
 * 카드의 날짜는 실제 계약 일정 날짜이고, 푸시 발송 시각은 보여주지 않는다.
 */
export default function NotificationsScreen() {
  const { data } = useContracts();
  const today = useToday();
  const { data: prefs } = useNotificationPreferences();
  const [permission] = usePushPermission();
  const important = useMemo(() => (data ? importantSchedule(data, today) : { items: [], total: 0 }), [data, today]);
  const hasContracts = (data?.length ?? 0) > 0;
  const eff = getEffectiveNotificationPreferences(prefs ?? null);
  // 일정이 있는지와 푸시를 받는지는 별개 — 꺼져 있어도 중요한 일정은 계속 보여준다
  const pushOff = !eff.enabled || permission === 'denied' || permission === 'blocked';

  return (
    <Screen edges={[]}>
      <View style={styles.info}>
        <AppText variant="body2Strong">계약에서 놓치면 안 되는 순간을 알려드려요.</AppText>
      </View>
      {pushOff ? (
        <View style={styles.off} testID="push-off">
          <AppText variant="body2Strong">알림이 꺼져 있어요</AppText>
          <AppText variant="caption" color="textSecondary" style={{ marginTop: 2 }}>
            계약의 중요한 순간을 알려드리려면 알림을 켜주세요.
          </AppText>
          <Button label="알림 설정" size="sm" variant="secondary" onPress={() => router.push('/settings/notifications')} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }} testID="push-off-settings" />
        </View>
      ) : permission === 'undetermined' && hasContracts ? (
        <PushPermissionCard permission={permission} onChanged={() => undefined} compact />
      ) : null}
      {!hasContracts ? (
        <EmptyState title="아직 예정된 알림이 없어요." description="계약을 등록하면 결제일, 만료, 갱신, 해지기한 등 중요한 순간을 챙겨드려요." />
      ) : (
        <Section title="중요한 계약 일정" testID="important-list">
          {important.items.length === 0 ? (
            <View testID="important-empty">
              <AppText variant="body2" color="textSecondary">
                지금 확인할 중요한 계약 일정이 없어요.
              </AppText>
              <AppText variant="caption" color="textTertiary" style={{ marginTop: 2 }}>
                결제와 일반 일정은 캘린더에서 확인할 수 있어요.
              </AppText>
            </View>
          ) : (
            // critical 먼저, 같은 중요도는 날짜가 가까운 순 · 최대 5개 (전체 보기 화면은 아직 없음 — total로 확장 가능)
            important.items.map((e) => <ImportantScheduleCard key={e.key} entry={e} />)
          )}
        </Section>
      )}
      <Section title="알림 설정" caption="PACTO가 미리 알려드리는 시점" testID="reminder-policy">
        {reminderPolicySummary(effectiveRulesSummary(prefs ?? null)).map((r) => (
          <View key={r.label} style={styles.policyRow}>
            <AppText variant="body2" color="textSecondary">
              {r.label}
            </AppText>
            <AppText variant="body2" tabular>
              {r.when}
            </AppText>
          </View>
        ))}
        <AppText variant="small" color="textTertiary" style={{ marginTop: spacing.xs }}>
          {eff.enabled ? `${formatTimeOfDay(eff.timeOfDay)}에 알려드려요. ` : ''}기한 자체는 계약서나 입력한 계약 정보를 기준으로 해요.
        </AppText>
        <Button label="알림 설정 변경" variant="secondary" size="sm" onPress={() => router.push('/settings/notifications')} style={{ marginTop: spacing.md, alignSelf: 'flex-start' }} testID="open-notification-settings" />
      </Section>
      <View style={styles.calendar}>
        <AppText variant="caption" color="textSecondary">
          결제와 전체 일정은 캘린더에서 확인할 수 있어요.
        </AppText>
        <Pressable onPress={() => router.push('/calendar')} accessibilityRole="button" hitSlop={hitSlop} testID="open-calendar-from-notifications">
          <AppText variant="captionStrong" color="primary">
            캘린더 보기
          </AppText>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  info: { margin: spacing.gutter, marginBottom: 0, padding: spacing.md, backgroundColor: colors.bgSubtle, borderRadius: radius.md },
  off: { marginHorizontal: spacing.gutter, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  policyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  calendar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginHorizontal: spacing.gutter, marginVertical: spacing.xl },
});
