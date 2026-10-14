import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CategoryIcon } from '@/components/pacto';
import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/controls';
import { cashflowBreakdown, scheduleTier, secondaryLine, type CalendarContractGroup } from '@/domain/calendarGroups';
import { formatWon } from '@/domain/money';
import { colors, spacing } from '@/theme';

/**
 * 캘린더 요약 카드: 같은 계약·같은 날짜의 일정을 한 장으로.
 * 계약 이름 → 대표 일정(해지·만기 등 행동 일정은 강조) → 금액(방향별 합계) → 세부 내역 → 그 밖의 일정
 * 누르면 계약 상세에서 원본 일정을 모두 확인한다. 일정이 여럿이면 "관련 일정 N개"를 펼쳐 원본 일정을 하나씩 본다
 * (금액·지급·반환 기록·알림은 원본 일정 그대로 — 화면에서만 묶음).
 */
const TIER_TAG = { primary: null, secondary: '관리', reference: '참고' } as const;
export function CalendarGroupCard({ group, datePrefix, onPress, testID }: { group: CalendarContractGroup; datePrefix?: string; onPress?: () => void; testID?: string }) {
  const { primary, cashflows } = group;
  const secondary = secondaryLine(group);
  const lead = [datePrefix, group.items.length > 1 ? group.title : (primary?.label ?? group.title)].filter(Boolean).join(' · ');
  const [open, setOpen] = useState(false);
  // 펼치기 버튼은 카드 버튼 밖에 둔다 (버튼 안 버튼 금지)
  return (
    <View style={styles.wrap} testID={testID}>
      <Pressable testID={testID ? `${testID}-open` : undefined} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} style={({ pressed }) => [styles.card, pressed && { opacity: 0.6 }]}>
        <CategoryIcon category={group.category} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.titleRow}>
            <AppText variant="body2Strong" numberOfLines={1} style={{ flexShrink: 1 }}>
              {group.contractTitle}
            </AppText>
            {primary?.needsReview ? <Badge label="확인 필요" tone="check" /> : group.priority === 'critical' ? <Badge label="중요" tone="caution" /> : group.priority === 'important' ? <Badge label="확인" /> : null}
          </View>
          {lead ? (
            <AppText variant={primary?.action ? 'captionStrong' : 'caption'} color={primary?.type === 'termination_notice' ? 'caution' : primary?.action ? 'amber' : 'textSecondary'} numberOfLines={1}>
              {lead}
            </AppText>
          ) : null}
          {primary?.sourceLabel ? (
            <AppText variant="small" color="textTertiary">
              {primary.sourceLabel}
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
          {group.items.length > 1 && group.guideLabels.length > 0 ? (
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {group.guideLabels.join(' · ')}
            </AppText>
          ) : null}
          {secondary && group.items.length <= 1 ? (
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {secondary}
            </AppText>
          ) : null}
        </View>
      </Pressable>
      <View style={styles.below}>
        {group.items.length > 1 ? (
          <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" aria-expanded={open} hitSlop={6} testID={testID ? `${testID}-toggle` : undefined}>
            <AppText variant="captionStrong" color="primary">
              관련 일정 {group.items.length}개 {open ? '▴' : '▾'}
            </AppText>
          </Pressable>
        ) : null}
        {open ? (
          <View style={styles.items} testID={testID ? `${testID}-items` : undefined}>
            {group.items.map((i) => {
              const tag = TIER_TAG[scheduleTier(i)];
              return (
                <View key={i.key} style={styles.itemRow}>
                  <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
                    {i.title}
                    {tag ? ` · ${tag}` : ''}
                  </AppText>
                  {i.amount != null && i.type === 'payment' ? (
                    <AppText variant="caption" color="textSecondary" tabular>
                      {i.direction === 'income' ? '+' : ''}
                      {formatWon(i.amount)}
                    </AppText>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 12 },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  below: { paddingLeft: 40 + spacing.md, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  items: {
    marginTop: 2,
    paddingLeft: spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    gap: 2,
  },
  itemRow: { flexDirection: 'row', gap: spacing.sm },
});
