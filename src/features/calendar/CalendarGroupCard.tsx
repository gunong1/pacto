import { Pressable, StyleSheet, View } from 'react-native';

import { CategoryIcon } from '@/components/pacto';
import { AppText } from '@/components/ui/AppText';
import { cashflowBreakdown, secondaryLine, type CalendarContractGroup } from '@/domain/calendarGroups';
import { spacing } from '@/theme';

/**
 * 캘린더 요약 카드: 같은 계약·같은 날짜의 일정을 한 장으로.
 * 계약 이름 → 대표 일정(해지·만기 등 행동 일정은 강조) → 금액(방향별 합계) → 세부 내역 → 그 밖의 일정
 * 누르면 계약 상세에서 원본 일정을 모두 확인한다.
 */
export function CalendarGroupCard({ group, datePrefix, onPress, testID }: { group: CalendarContractGroup; datePrefix?: string; onPress?: () => void; testID?: string }) {
  const { primary, cashflows } = group;
  const secondary = secondaryLine(group);
  const lead = [datePrefix, primary?.label].filter(Boolean).join(' · ');
  return (
    <Pressable testID={testID} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} style={({ pressed }) => [styles.card, pressed && { opacity: 0.6 }]}>
      <CategoryIcon category={group.category} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body2Strong" numberOfLines={1}>
          {group.contractTitle}
        </AppText>
        {lead ? (
          <AppText variant={primary?.action ? 'captionStrong' : 'caption'} color={primary?.type === 'termination_notice' ? 'caution' : primary?.action ? 'amber' : 'textSecondary'} numberOfLines={1}>
            {lead}
          </AppText>
        ) : null}
        {cashflows.map((c) => {
          const breakdown = cashflowBreakdown(c);
          return (
            <View key={c.direction}>
              <AppText variant="body2Strong" tabular color={c.direction === 'income' ? 'positive' : c.direction === 'neutral' ? 'textSecondary' : 'text'}>
                {c.headline}
              </AppText>
              {breakdown ? (
                <AppText variant="caption" color="textTertiary" numberOfLines={2} tabular>
                  {breakdown}
                </AppText>
              ) : null}
            </View>
          );
        })}
        {secondary ? (
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {secondary}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: 12 },
});
