/**
 * 캘린더 상단 월간 현금 흐름 — 출금 예정 / 입금 예정 카드 2장 (화면 표현만, 합계는 monthSpending 그대로).
 * - 금액: 카드에 다 들어가면 '43,500,000원', 아니면 '4,350만원' (wonForWidth — 금액은 바꾸지 않음)
 * - 출금에 보증금이 있으면 "보증금 2,000만원 포함" · 입금은 화살표·제목·색으로 구분 (색에만 의존하지 않음)
 * - 좁은 화면·큰 글자에서는 카드가 아래로 내려가 1열이 된다 (flexWrap + 최소 너비)
 * - 화면 낭독기·테스트용으로 전체 금액 문장을 accessibilityLabel에 둔다
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { formatKRW, formatWonShort, textFits, wonForWidth } from '@/domain/money';
import type { MonthSpending } from '@/domain/spending';
import { colors, radius, spacing, typography } from '@/theme';

type Totals = Pick<MonthSpending, 'total' | 'depositOut' | 'incomeTotal' | 'undeterminedTotal'> & Partial<Pick<MonthSpending, 'principalOut' | 'incomeEstimated'>>;

/** 전체 금액 문장 (예전 한 줄 요약과 같은 내용) — 화면 낭독기용 */
export function cashflowSummaryLabel(s: Totals): string {
  return [
    `총 출금 예정 ${formatKRW(s.total)}${s.depositOut > 0 ? ` (보증금 ${formatKRW(s.depositOut)} 포함)` : ''}${(s.principalOut ?? 0) > 0 ? ` (대출 원금 상환 ${formatKRW(s.principalOut!)} 포함)` : ''}`,
    s.incomeTotal > 0 ? `입금 +${formatKRW(s.incomeTotal)}${(s.incomeEstimated ?? 0) > 0 ? ` (세전 예상 ${formatKRW(s.incomeEstimated!)} 포함)` : ''}` : '입금 예정 없음',
    s.undeterminedTotal > 0 ? '확인 필요 금액 제외' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function MonthCashflowCards({ spending, testID }: { spending: Totals; testID?: string }) {
  const { fontScale } = useWindowDimensions();
  const [rowWidth, setRowWidth] = useState(0);
  // 2열 카드 안쪽 너비에 짧은 표기조차 안 들어가면 (좁은 화면·큰 글자·큰 금액) 1열로 쌓는다
  const half = (rowWidth - spacing.sm) / 2 - spacing.md * 2;
  const outShort = formatWonShort(spending.total);
  const inShort = `+${formatWonShort(spending.incomeTotal)}`;
  const stacked = rowWidth > 0 && !(textFits(outShort, half, AMOUNT_FONT, fontScale) && textFits(inShort, half, AMOUNT_FONT, fontScale));
  return (
    <View testID={testID} accessible accessibilityLabel={cashflowSummaryLabel(spending)} style={styles.wrap}>
      <View style={[styles.row, stacked && styles.stacked]} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
        <Card half={!stacked} kind="out" title="출금 예정" amount={spending.total} sub={[spending.depositOut > 0 ? `보증금 ${formatWonShort(spending.depositOut)} 포함` : null, (spending.principalOut ?? 0) > 0 ? `원금 상환 ${formatWonShort(spending.principalOut!)} 포함` : null].filter((x): x is string => !!x)} fontScale={fontScale} testID={testID ? `${testID}-out` : undefined} />
        <Card half={!stacked} kind="in" title="입금 예정" amount={spending.incomeTotal} sub={(spending.incomeEstimated ?? 0) > 0 ? [`세전 예상 ${formatWonShort(spending.incomeEstimated!)} 포함`] : []} fontScale={fontScale} testID={testID ? `${testID}-in` : undefined} />
      </View>
      {spending.undeterminedTotal > 0 ? (
        <AppText variant="small" color="textTertiary" align="center" style={{ marginTop: spacing.xs }}>
          입출금 방향을 확인할 금액은 합계에서 뺐어요
        </AppText>
      ) : null}
    </View>
  );
}

const AMOUNT_FONT = typography.title3.fontSize;

function Card({ half, kind, title, amount, sub, fontScale, testID }: { half: boolean; kind: 'out' | 'in'; title: string; amount: number; sub: string[]; fontScale: number; testID?: string }) {
  const [width, setWidth] = useState(0);
  const income = kind === 'in';
  const won = wonForWidth(amount, width, AMOUNT_FONT, fontScale);
  return (
    <View style={[styles.card, half && { flexBasis: 0 }]} testID={testID}>
      <View style={styles.head}>
        <Ionicons name={income ? 'arrow-down-circle' : 'arrow-up-circle'} size={16} color={income ? colors.positive : colors.primary} />
        <AppText variant="captionStrong" color="textSecondary">
          {title}
        </AppText>
      </View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <AppText variant="title3" tabular color={income && amount > 0 ? 'positive' : 'text'} numberOfLines={2} testID={testID ? `${testID}-amount` : undefined}>
          {income && amount > 0 ? `+${won}` : won}
        </AppText>
      </View>
      {sub.map((line, n) => (
        // 어절 단위로만 줄바꿈 ("보증금 2,000만원" / "포함") — 글자 중간에서 끊기지 않게
        <View key={line} style={styles.sub} testID={testID ? `${testID}-sub${n ? `-${n}` : ''}` : undefined}>
          {line.split(/(?<=만원|억원|원)\s/).map((w) => (
            <AppText key={w} variant="small" color="textTertiary" numberOfLines={1}>
              {w}
            </AppText>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', gap: spacing.sm },
  stacked: { flexDirection: 'column' },
  card: { flexGrow: 1, flexShrink: 1, minWidth: 0, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSubtle, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sub: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 4 },
});
