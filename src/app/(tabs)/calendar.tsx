import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ContractLine, EVENT_COLOR, EVENT_LEGEND } from '@/components/pacto';
import { MonthGrid } from '@/components/pacto/MonthGrid';
import { AppText } from '@/components/ui/AppText';
import { Screen, Section, SectionGap } from '@/components/ui/layout';
import { formatDateKo, isValidISODate, monthRange, shiftYearMonth, yearMonthOf, type YearMonth } from '@/domain/dates';
import { EVENT_TYPE_LABEL } from '@/domain/labels';
import { formatKRW, formatWonCompact, formatWon } from '@/domain/money';
import { scheduleForRange } from '@/domain/schedule';
import { monthSpending } from '@/domain/spending';
import type { ISODate, ScheduleItemType } from '@/domain/types';
import { useContracts, useToday } from '@/features/contracts/queries';
import { colors, radius, spacing } from '@/theme';

/** 계약 전용 캘린더: 결제일, 시작/종료, 자동갱신, 해지 통보기한, 내 일정 + 월 계약 지출 예정 */
export default function CalendarScreen() {
  const today = useToday();
  const { data: records } = useContracts();
  // 계약 상세 "캘린더 보기": ?date=YYYY-MM-DD&t=<nonce>
  const params = useLocalSearchParams<{ date?: string; t?: string }>();
  const [ym, setYm] = useState<YearMonth>(() => yearMonthOf(today));
  const [selected, setSelected] = useState<ISODate | null>(today);
  const [appliedNonce, setAppliedNonce] = useState<string | undefined>(undefined);
  if (params.t !== appliedNonce) {
    setAppliedNonce(params.t);
    if (params.date && isValidISODate(params.date)) {
      setYm(yearMonthOf(params.date));
      setSelected(params.date);
    }
  }

  const { items, markers, spending, payingContracts } = useMemo(() => {
    const list = records ?? [];
    const items = scheduleForRange(list, monthRange(ym), today);
    const markers = new Map<ISODate, Set<ScheduleItemType>>();
    for (const i of items) {
      if (!markers.has(i.date)) markers.set(i.date, new Set());
      markers.get(i.date)!.add(i.type);
    }
    const spending = monthSpending(list, ym);
    return { items, markers, spending, payingContracts: new Set(spending.items.map((i) => i.contractId)).size };
  }, [records, ym, today]);

  const dayItems = selected ? items.filter((i) => i.date === selected) : [];
  const isThisMonth = ym.year === yearMonthOf(today).year && ym.month === yearMonthOf(today).month;
  const monthItems = isThisMonth ? items.filter((i) => i.date >= today).slice(0, 8) : items.slice(0, 8);

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="title1">캘린더</AppText>
      </View>

      {/* 월 계약 지출 예정 — 달을 넘기면 함께 바뀐다 */}
      <View style={styles.spending} testID="calendar-month-total">
        <AppText variant="body2" color="textSecondary">
          {ym.month}월 계약 지출 예정
        </AppText>
        <AppText variant="title1" tabular style={{ marginTop: 2 }}>
          {formatKRW(spending.total)}
        </AppText>
        <AppText variant="caption" color="textTertiary" style={{ marginTop: 2 }}>
          {payingContracts > 0 ? `${payingContracts}개 계약에서 결제 예정` : '결제 예정인 계약이 없어요'}
          {spending.hasEstimated ? ' · 변동 금액은 예상치' : ''}
        </AppText>
        {spending.incomeTotal > 0 ? (
          <AppText variant="caption" color="textSecondary" style={{ marginTop: 2 }} testID="calendar-income">
            들어올 돈 +{formatKRW(spending.incomeTotal)} (급여·대금 등, 지출과 별도)
          </AppText>
        ) : null}
        {spending.depositTotal > 0 ? (
          <AppText variant="caption" color="textTertiary" style={{ marginTop: 2 }} testID="calendar-deposit-note">
            보증금 {formatWonCompact(spending.depositTotal)}은 돌려받는 돈이라 지출 합계에서 제외했어요
          </AppText>
        ) : null}
      </View>

      <View style={styles.calendar}>
        <MonthGrid
          yearMonth={ym}
          today={today}
          selected={selected}
          markers={markers}
          onSelect={setSelected}
          onChangeMonth={(d) => {
            setYm(shiftYearMonth(ym, d));
            setSelected(null);
          }}
        />
        <View style={styles.legend} testID="calendar-legend">
          {EVENT_LEGEND.map((l) => (
            <View key={l.label} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: l.color }]} />
              <AppText variant="small" color="textSecondary">
                {l.label}
              </AppText>
            </View>
          ))}
        </View>
      </View>

      <SectionGap />

      {selected ? (
        <Section title={formatDateKo(selected, true)} testID="calendar-day-list">
          {dayItems.length === 0 ? (
            <AppText variant="body2" color="textTertiary">
              이 날은 계약 일정이 없어요.
            </AppText>
          ) : (
            dayItems.map((i) => (
              <ContractLine
                key={i.key}
                category={i.category}
                title={i.contractTitle}
                subtitle={`${i.title}${i.estimated ? ' (예상)' : ''}${i.direction === 'neutral' ? ' · 지출 합계 제외' : i.direction === 'income' ? ' · 수입' : ''}`}
                right={i.amount != null ? <AppText variant="body2Strong" tabular color={i.direction === 'income' ? 'positive' : undefined}>{i.direction === 'income' ? '+' : ''}{formatWon(i.amount)}</AppText> : <TypeTag type={i.type} />}
                onPress={() => router.push(`/contract/${i.contractId}`)}
              />
            ))
          )}
        </Section>
      ) : (
        <Section title={`${ym.month}월 일정`}>
          {monthItems.map((i) => (
            <ContractLine
              key={i.key}
              category={i.category}
              title={i.contractTitle}
              subtitle={`${Number(i.date.slice(8))}일 · ${i.title}`}
              right={i.amount != null ? <AppText variant="body2Strong" tabular color={i.direction === 'income' ? 'positive' : undefined}>{i.direction === 'income' ? '+' : ''}{formatWon(i.amount)}</AppText> : <TypeTag type={i.type} />}
              onPress={() => router.push(`/contract/${i.contractId}`)}
            />
          ))}
          {items.length === 0 ? (
            <AppText variant="body2" color="textTertiary">
              이 달은 계약 일정이 없어요.
            </AppText>
          ) : null}
        </Section>
      )}
    </Screen>
  );
}

function TypeTag({ type }: { type: ScheduleItemType }) {
  return (
    <View style={styles.tag}>
      <View style={[styles.dot, { backgroundColor: EVENT_COLOR[type] }]} />
      <AppText variant="captionStrong" color="textSecondary">
        {EVENT_TYPE_LABEL[type]}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md },
  spending: { marginHorizontal: spacing.gutter, marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.bgSubtle },
  calendar: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg },
  legend: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: 4, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
