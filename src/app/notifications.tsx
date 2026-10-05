import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Divider, EmptyState, ListRow, Screen, Section } from '@/components/ui/layout';
import { formatMonthDayKo } from '@/domain/dates';
import { daysUntil } from '@/domain/dday';
import { REMINDER_RULES, upcomingReminders } from '@/domain/reminders';
import { useContracts, useToday } from '@/features/contracts/queries';
import { colors, radius, spacing } from '@/theme';

const KIND_LABEL = { contract_end: '만료', renewal: '자동갱신', termination_notice: '해지 통보기한', payment: '결제' } as const;

/**
 * 알림함 — V1은 "예정된 알림"을 계산해 보여준다.
 * Push 발송(P1)은 같은 규칙을 서버(pg_cron + Expo Push)에서 실행.
 */
export default function NotificationsScreen() {
  const today = useToday();
  const { data } = useContracts();
  const reminders = useMemo(() => (data ? upcomingReminders(data, today, 60) : []), [data, today]);

  return (
    <Screen edges={[]}>
      <View style={styles.info}>
        <AppText variant="caption" color="textSecondary">
          만료 {REMINDER_RULES.contractEnd.join('·')}일 전, 해지 통보기한 {REMINDER_RULES.terminationNotice.filter((d) => d > 0).join('·')}일 전과 당일, 결제 전날에 알려드려요. 푸시 알림은 정식 버전에서 연결됩니다.
        </AppText>
      </View>
      <Section title="예정된 알림" caption="앞으로 60일" testID="reminder-list">
        {reminders.length === 0 ? (
          <EmptyState title="예정된 알림이 없어요" />
        ) : (
          reminders.map((r, i) => {
            const d = daysUntil(r.fireOn, today);
            return (
              <View key={r.key}>
                {i > 0 ? <Divider /> : null}
                <ListRow
                  title={`${r.contractTitle} · ${KIND_LABEL[r.kind]}`}
                  subtitle={r.message}
                  right={
                    <AppText variant="caption" color={d === 0 ? 'primary' : 'textTertiary'} tabular>
                      {d === 0 ? '오늘' : formatMonthDayKo(r.fireOn)}
                    </AppText>
                  }
                  onPress={() => router.push(`/contract/${r.contractId}`)}
                />
              </View>
            );
          })
        )}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  info: { margin: spacing.gutter, marginBottom: 0, padding: spacing.md, backgroundColor: colors.bgSubtle, borderRadius: radius.md },
});
