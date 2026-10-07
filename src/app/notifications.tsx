import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Divider, EmptyState, Screen, Section } from '@/components/ui/layout';
import { formatMonthDayKo } from '@/domain/dates';
import { daysUntil } from '@/domain/dday';
import { groupReminders, reminderDigest, type ReminderDigestItem } from '@/domain/reminderGroups';
import { REMINDER_RULES, upcomingReminders } from '@/domain/reminders';
import type { ISODate } from '@/domain/types';
import { useContracts, useToday } from '@/features/contracts/queries';
import { colors, radius, spacing } from '@/theme';

/**
 * 알림함 — V1은 "예정된 알림"을 계산해 보여준다.
 * Push 발송(P1)은 같은 규칙을 서버(pg_cron + Expo Push)에서 실행.
 */
export default function NotificationsScreen() {
  const today = useToday();
  const { data } = useContracts();
  // 원본 알림(결제 한 건마다) → 같은 계약·같은 알림 날짜는 하나로 → 반복 결제 알림은 가장 가까운 것만 펼침
  const items = useMemo(() => (data ? reminderDigest(groupReminders(upcomingReminders(data, today, 60))) : []), [data, today]);

  return (
    <Screen edges={[]}>
      <View style={styles.info}>
        <AppText variant="caption" color="textSecondary">
          만료 {REMINDER_RULES.contractEnd.join('·')}일 전, 해지 통보기한 {REMINDER_RULES.terminationNotice.filter((d) => d > 0).join('·')}일 전과 당일, 결제 전날에 알려드려요. 푸시 알림은 정식 버전에서 연결됩니다.
        </AppText>
      </View>
      <Section title="예정된 알림" caption="앞으로 60일" testID="reminder-list">
        {items.length === 0 ? (
          <EmptyState title="예정된 알림이 없어요" />
        ) : (
          items.map((item, i) => (
            <View key={item.group.key}>
              {i > 0 ? <Divider /> : null}
              <ReminderRow item={item} today={today} />
            </View>
          ))
        )}
      </Section>
    </Screen>
  );
}

/** 알림 한 건: 계약·종류 / 알림 문구 / 세부 내역 / 실제 일정 날짜 / 이후 반복 — 오른쪽은 "알림 날짜"임을 명시 */
function ReminderRow({ item, today }: { item: ReminderDigestItem; today: ISODate }) {
  const { group, followUp } = item;
  const d = daysUntil(group.fireOn, today);
  return (
    <Pressable onPress={() => router.push(`/contract/${group.contractId}`)} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]} testID={`reminder-${group.key}`}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body2Strong" numberOfLines={1}>
          {group.title}
        </AppText>
        <AppText variant="body2" color="textSecondary">
          {group.message}
        </AppText>
        {group.detail ? (
          <AppText variant="caption" color="textTertiary" tabular>
            {group.detail}
          </AppText>
        ) : null}
        {group.eventLines.map((l) => (
          <AppText key={l} variant="caption" color="textSecondary" tabular>
            일정 · {l}
          </AppText>
        ))}
        {followUp ? (
          <AppText variant="caption" color="textTertiary">
            {followUp.text}
          </AppText>
        ) : null}
      </View>
      <View style={styles.when}>
        <AppText variant="captionStrong" color={d === 0 ? 'primary' : 'textSecondary'} tabular>
          {d === 0 ? '오늘' : formatMonthDayKo(group.fireOn)}
        </AppText>
        <AppText variant="small" color="textTertiary">
          알림 예정
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: 12 },
  when: { alignItems: 'flex-end' },
  info: { margin: spacing.gutter, marginBottom: 0, padding: spacing.md, backgroundColor: colors.bgSubtle, borderRadius: radius.md },
});
