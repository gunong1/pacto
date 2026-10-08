import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/controls';
import { Divider, EmptyState, Screen, Section } from '@/components/ui/layout';
import { importantSchedule } from '@/domain/importantSchedule';
import { effectiveRulesSummary, formatSendTime, formatTimeOfDay, getEffectiveNotificationPreferences, upcomingDigest } from '@/domain/notifications';
import { reminderPolicySummary } from '@/domain/reminders';
import { useContracts, useToday } from '@/features/contracts/queries';
import { ImportantScheduleCard } from '@/features/notifications/ImportantScheduleCard';
import { PushPermissionCard } from '@/features/notifications/PushPermissionCard';
import { useNotificationPreferences, usePushPermission, useUpcomingNotifications } from '@/features/notifications/queries';
import { colors, hitSlop, radius, spacing } from '@/theme';

/**
 * 알림 화면 — 놓치면 안 되는 "중요한 계약 일정"(없으면 숨김) + 실제로 보낼 "다음 알림" + 내 알림 규칙(접힘) + 설정 변경.
 * "다음 알림"은 서버가 실제 푸시로 보낼 예정 알림이다 (내부 계산 범위 같은 숫자는 보여주지 않는다).
 */
export default function NotificationsScreen() {
  const { data } = useContracts();
  const today = useToday();
  const { data: prefs } = useNotificationPreferences();
  const { data: upcoming } = useUpcomingNotifications();
  const [permission, refreshPermission] = usePushPermission();
  const [policyOpen, setPolicyOpen] = useState(false);
  const important = useMemo(() => (data ? importantSchedule(data, today) : { items: [], total: 0 }), [data, today]);
  const digest = useMemo(() => upcomingDigest(upcoming ?? []), [upcoming]);
  const hasContracts = (data?.length ?? 0) > 0;
  const eff = getEffectiveNotificationPreferences(prefs ?? null);
  const titles = useMemo(() => new Map((data ?? []).map((r) => [r.contract.id, r.contract.title])), [data]);

  return (
    <Screen edges={[]}>
      <View style={styles.info}>
        <AppText variant="caption" color="textSecondary">
          계약에서 놓치면 안 되는 순간을 알려드려요.
        </AppText>
      </View>
      {hasContracts ? <PushPermissionCard permission={permission} onChanged={refreshPermission} compact /> : null}
      {!hasContracts ? (
        <EmptyState title="아직 예정된 알림이 없어요." description="계약을 등록하면 결제일, 만료, 갱신, 해지기한 등 중요한 순간을 챙겨드려요." />
      ) : (
        <>
          {important.items.length > 0 ? (
            <Section title="중요한 계약 일정" testID="important-list">
              {important.items.map((e) => (
                <ImportantScheduleCard key={e.key} entry={e} />
              ))}
              {important.total > important.items.length ? (
                <AppText variant="small" color="textTertiary">
                  나머지 중요 일정은 캘린더와 계약 상세에서 확인할 수 있어요.
                </AppText>
              ) : null}
            </Section>
          ) : null}
          <Section title="다음 알림" testID="upcoming-list">
            {!eff.enabled ? (
              <AppText variant="body2" color="textTertiary" testID="upcoming-off">
                PACTO 알림이 꺼져 있어요. 알림 설정에서 켤 수 있어요.
              </AppText>
            ) : digest.length === 0 ? (
              <AppText variant="body2" color="textTertiary" testID="upcoming-empty">
                아직 예정된 알림이 없어요.
              </AppText>
            ) : (
              digest.map(({ item, followUp }, i) => (
                <View key={item.id} testID={`upcoming-${i}`}>
                  {i > 0 ? <Divider /> : null}
                  <Pressable style={styles.item} onPress={() => router.push(`/contract/${item.contractId}`)} accessibilityRole="button">
                    <View style={styles.itemHead}>
                      <AppText variant="captionStrong" color="textSecondary">
                        {formatSendTime(item.scheduledAt, eff.timezone)}
                      </AppText>
                      {item.priority === 'critical' ? <Badge label="중요" tone="caution" /> : item.priority === 'important' ? <Badge label="확인" tone="check" /> : null}
                    </View>
                    <AppText variant="body2Strong" numberOfLines={1} style={{ marginTop: 2 }}>
                      {titles.get(item.contractId) ?? item.display.contractTitle}
                    </AppText>
                    <AppText variant="body2">{item.display.message}</AppText>
                    {item.display.detail ? (
                      <AppText variant="caption" color="textSecondary">
                        {item.display.detail}
                      </AppText>
                    ) : null}
                    {item.display.sourceLabel ? (
                      <AppText variant="small" color="textTertiary" style={{ marginTop: 2 }}>
                        {item.display.sourceLabel}
                      </AppText>
                    ) : null}
                    {followUp ? (
                      <AppText variant="small" color="textTertiary" style={{ marginTop: 2 }} testID={`upcoming-${i}-followup`}>
                        {followUp}
                      </AppText>
                    ) : null}
                  </Pressable>
                </View>
              ))
            )}
          </Section>
        </>
      )}
      {/* 알림 규칙 (내 설정 요약): 일정을 가리지 않도록 기본은 접어 둔다 */}
      <View style={styles.policy} testID="reminder-policy">
        <Pressable
          onPress={() => setPolicyOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: policyOpen }}
          hitSlop={hitSlop}
          style={styles.policyToggle}
          testID="reminder-policy-toggle">
          <AppText variant="caption" color="textTertiary">
            알림은 언제 오나요?
          </AppText>
          <Ionicons name={policyOpen ? 'chevron-up' : 'chevron-forward'} size={14} color={colors.textTertiary} />
        </Pressable>
        {policyOpen ? (
          <View style={styles.policyBody} testID="reminder-policy-body">
            {reminderPolicySummary(effectiveRulesSummary(prefs ?? null)).map((r) => (
              <View key={r.label} style={styles.policyRow}>
                <AppText variant="caption" color="textSecondary">
                  {r.label}
                </AppText>
                <AppText variant="caption" color="textSecondary" tabular>
                  {r.when}
                </AppText>
              </View>
            ))}
            <AppText variant="small" color="textTertiary" style={{ marginTop: spacing.xs }}>
              알림 시점은 PACTO 설정이에요. 기한 자체는 계약서나 입력한 계약 정보를 기준으로 해요. {formatTimeOfDay(eff.timeOfDay)}에 알려드려요.
            </AppText>
          </View>
        ) : null}
        <Button label="알림 설정 변경" variant="secondary" size="sm" onPress={() => router.push('/settings/notifications')} style={{ marginTop: spacing.md, alignSelf: 'flex-start' }} testID="open-notification-settings" />
        <Pressable onPress={() => router.push('/calendar')} accessibilityRole="button" hitSlop={hitSlop} style={{ marginTop: spacing.md, alignSelf: 'flex-start' }} testID="open-calendar-from-notifications">
          <AppText variant="captionStrong" color="primary">
            결제 일정은 캘린더에서 보기
          </AppText>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  info: { margin: spacing.gutter, marginBottom: 0, padding: spacing.md, backgroundColor: colors.bgSubtle, borderRadius: radius.md },
  item: { paddingVertical: spacing.md },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  policy: { marginHorizontal: spacing.gutter, marginTop: spacing.xl, marginBottom: spacing.xl },
  policyToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  policyBody: { marginTop: spacing.sm, padding: spacing.md, backgroundColor: colors.bgSubtle, borderRadius: radius.md },
  policyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
});
