/**
 * 월별 현금흐름 계층 요약 — 상위(돈의 성격: 일반 / 보증금) > 하위(계약 종류별). 출금·입금 등 모든 방향이 같은 컴포넌트.
 * 금액은 domain/spending.ts flowSummary가 만든 값을 그대로 그린다 (화면에서 다시 더하지 않음).
 * 하위 줄은 들여쓰고 왼쪽 선으로 묶어 "위 금액에 포함"임을 보인다 — 따로 더할 금액처럼 같은 줄에 나열하지 않는다.
 */
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { FLOW_LABELS, type FlowSummary } from '@/domain/spending';
import { colors, spacing } from '@/theme';

import { Amount } from './index';

export function FlowBreakdown({ summary, testID }: { summary: FlowSummary; testID: string }) {
  if (summary.groups.length === 0) return null;
  const labels = FLOW_LABELS[summary.direction];
  return (
    <View style={styles.box} testID={testID}>
      <AppText variant="caption" color="textTertiary" style={{ marginBottom: spacing.xs }}>
        아래 금액은 모두 {labels.total}에 포함돼요
      </AppText>
      {summary.groups.map((g) => (
        <View key={g.nature} style={styles.group} testID={`${testID}-${g.nature}`}>
          <View style={styles.row}>
            <AppText variant="body2Strong">{g.label}</AppText>
            <Amount value={g.amount} variant="body2Strong" />
          </View>
          {g.lines.length > 0 ? (
            <View style={styles.lines} accessibilityLabel={`${g.label} 중`}>
              {g.lines.map((l, i) => (
                <View key={l.label} style={styles.row} testID={`${testID}-${g.nature}-line-${i}`}>
                  <AppText variant="caption" color="textSecondary">
                    {l.label}
                    {l.contracts > 1 ? ` · 계약 ${l.contracts}개` : ''}
                  </AppText>
                  <Amount value={l.amount} variant="caption" color="textSecondary" />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: spacing.lg },
  group: { marginTop: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  lines: { marginTop: 4, marginLeft: spacing.xs, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.border, gap: 2 },
});
