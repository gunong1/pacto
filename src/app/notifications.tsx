import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { EmptyState, Screen, Section } from '@/components/ui/layout';
import { IMPORTANT_DISPLAY_WINDOW, importantSchedule } from '@/domain/importantSchedule';
import { reminderPolicySummary } from '@/domain/reminders';
import { useContracts, useToday } from '@/features/contracts/queries';
import { ImportantScheduleCard } from '@/features/notifications/ImportantScheduleCard';
import { colors, hitSlop, radius, spacing } from '@/theme';

/**
 * 알림 화면 — 놓치면 손해인 "중요한 계약 일정"이 주인공. 알림 규칙(PACTO가 언제 알려주는지)은 맨 아래에 접어 둔다.
 * 결제 전날 알림을 하나씩 나열하지 않는다 (결제 일정은 캘린더·홈과 중복). 푸시 연결 후에는 "받은 알림" 기록을 둘 자리.
 * 알림 묶기(groupReminders)는 푸시 발송 단위로 쓴다.
 */
export default function NotificationsScreen() {
  const { data } = useContracts();
  const today = useToday();
  // 중요한 계약 일정: 알림 날짜와 별개로 앞으로 12개월(화면 표시 범위)에서 찾는다
  const important = useMemo(() => (data ? importantSchedule(data, today) : { items: [], total: 0 }), [data, today]);
  const hasContracts = (data?.length ?? 0) > 0;
  const [policyOpen, setPolicyOpen] = useState(false);

  return (
    <Screen edges={[]}>
      <View style={styles.info}>
        <AppText variant="caption" color="textSecondary">
          계약에서 놓치면 안 되는 순간을 알려드려요. 푸시 알림은 정식 버전에서 연결됩니다.
        </AppText>
      </View>
      {!hasContracts ? (
        <EmptyState title="아직 예정된 알림이 없어요." description="계약을 등록하면 결제일, 만료, 갱신, 해지기한 등 중요한 순간을 챙겨드려요." />
      ) : (
        <Section title="중요한 계약 일정" caption={`앞으로 ${IMPORTANT_DISPLAY_WINDOW.months}개월`} testID="important-list">
          {important.items.length === 0 ? (
            <AppText variant="body2" color="textTertiary" testID="important-empty">
              앞으로 {IMPORTANT_DISPLAY_WINDOW.months}개월 안에 챙길 중요한 계약 일정이 없어요. 결제 일정은 캘린더에서 확인할 수 있어요.
            </AppText>
          ) : (
            important.items.map((e) => <ImportantScheduleCard key={e.key} entry={e} />)
          )}
          {important.total > important.items.length ? (
            <AppText variant="small" color="textTertiary">
              나머지 중요 일정은 캘린더와 계약 상세에서 확인할 수 있어요.
            </AppText>
          ) : null}
        </Section>
      )}
      <Pressable onPress={() => router.push('/calendar')} accessibilityRole="button" hitSlop={hitSlop} style={styles.calendarLink} testID="open-calendar-from-notifications">
        <AppText variant="captionStrong" color="primary">
          결제 일정은 캘린더에서 보기
        </AppText>
      </Pressable>
      {/* 알림 규칙: 일정을 가리지 않도록 기본은 접어 둔다 */}
      <View style={styles.policy} testID="reminder-policy">
        <Pressable
          onPress={() => setPolicyOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: policyOpen }}
          hitSlop={hitSlop}
          style={styles.policyToggle}
          testID="reminder-policy-toggle"
        >
          <AppText variant="caption" color="textTertiary">
            알림은 언제 오나요?
          </AppText>
          <Ionicons name={policyOpen ? 'chevron-up' : 'chevron-forward'} size={14} color={colors.textTertiary} />
        </Pressable>
        {policyOpen ? (
          <View style={styles.policyBody} testID="reminder-policy-body">
            {reminderPolicySummary().map((r) => (
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
              알림 시점은 PACTO 설정이에요. 기한 자체는 계약서나 입력한 계약 정보를 기준으로 해요. 계약별로 계약 상세의 ‘이 계약 알림 받기’에서 끌 수 있어요.
            </AppText>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  info: { margin: spacing.gutter, marginBottom: 0, padding: spacing.md, backgroundColor: colors.bgSubtle, borderRadius: radius.md },
  calendarLink: { marginHorizontal: spacing.gutter, marginTop: spacing.md, alignSelf: 'flex-start' },
  policy: { marginHorizontal: spacing.gutter, marginTop: spacing.xl, marginBottom: spacing.xl },
  policyToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  policyBody: { marginTop: spacing.sm, padding: spacing.md, backgroundColor: colors.bgSubtle, borderRadius: radius.md },
  policyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
});
