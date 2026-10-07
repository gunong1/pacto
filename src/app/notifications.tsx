import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/controls';
import { Divider, EmptyState, Screen, Section } from '@/components/ui/layout';
import { formatMonthDayKo } from '@/domain/dates';
import { daysUntil } from '@/domain/dday';
import { IMPORTANT_DISPLAY_WINDOW, importantSchedule } from '@/domain/importantSchedule';
import { groupReminders, reminderDigest, type ReminderDigestItem } from '@/domain/reminderGroups';
import { upcomingReminders } from '@/domain/reminders';
import type { ISODate } from '@/domain/types';
import { useContracts, useToday } from '@/features/contracts/queries';
import { ImportantScheduleCard } from '@/features/notifications/ImportantScheduleCard';
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
  // 중요한 계약 일정은 알림 날짜와 별개로 앞으로 12개월(화면 표시 범위)에서 따로 찾는다
  const important = useMemo(() => (data ? importantSchedule(data, today) : { items: [], total: 0 }), [data, today]);

  return (
    <Screen edges={[]}>
      <View style={styles.info}>
        <AppText variant="caption" color="textSecondary">
          계약에서 놓치면 안 되는 순간을 알려드려요. 푸시 알림은 정식 버전에서 연결됩니다.
        </AppText>
      </View>
      {important.items.length > 0 ? (
        <Section title="중요한 계약 일정" caption={`앞으로 ${IMPORTANT_DISPLAY_WINDOW.months}개월`} testID="important-list">
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
      <Section title="다음 알림" caption="앞으로 60일 안에 보낼 알림" testID="reminder-list">
        {items.length === 0 && important.items.length === 0 ? (
          <EmptyState title="아직 예정된 알림이 없어요." description="계약을 등록하면 결제일, 만료, 갱신, 해지기한 등 중요한 순간을 챙겨드려요." />
        ) : items.length === 0 ? (
          <EmptyState title="60일 안에 보낼 알림이 없어요" />
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
        <View style={styles.titleRow}>
          <AppText variant="body2Strong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {group.title}
          </AppText>
          {group.priority === 'critical' ? <Badge label="중요" tone="caution" /> : group.priority === 'important' ? <Badge label="확인" /> : null}
        </View>
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
        {group.sourceLabel ? (
          <AppText variant="small" color="textTertiary">
            날짜: {group.sourceLabel} · 알림 시점: PACTO 알림 설정
          </AppText>
        ) : null}
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  info: { margin: spacing.gutter, marginBottom: 0, padding: spacing.md, backgroundColor: colors.bgSubtle, borderRadius: radius.md },
});
