import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Amount, ContractLine, EVENT_COLOR } from '@/components/pacto';
import { MonthGrid } from '@/components/pacto/MonthGrid';
import { AppText } from '@/components/ui/AppText';
import { Screen, Section, SectionGap } from '@/components/ui/layout';
import { formatDateKo, monthRange, shiftYearMonth, yearMonthOf, type YearMonth } from '@/domain/dates';
import { EVENT_TYPE_LABEL } from '@/domain/labels';
import { formatWon } from '@/domain/money';
import { scheduleForRange } from '@/domain/schedule';
import { monthSpending } from '@/domain/spending';
import type { ContractEventType, ISODate } from '@/domain/types';
import { useContracts, useToday } from '@/features/contracts/queries';
import { colors, spacing } from '@/theme';

const LEGEND: ContractEventType[] = ['payment', 'termination_notice', 'contract_end', 'custom'];

/** 계약 전용 캘린더: 결제일, 시작/종료, 자동갱신, 해지 통보기한, 내 일정 */
export default function CalendarScreen() {
  const today = useToday();
  const { data: records } = useContracts();
  const [ym, setYm] = useState<YearMonth>(() => yearMonthOf(today));
  const [selected, setSelected] = useState<ISODate | null>(today);

  const { items, markers, spending } = useMemo(() => {
    const list = records ?? [];
    const items = scheduleForRange(list, monthRange(ym), today);
    const markers = new Map<ISODate, Set<ContractEventType>>();
    for (const i of items) {
      if (!markers.has(i.date)) markers.set(i.date, new Set());
      markers.get(i.date)!.add(i.type);
    }
    return { items, markers, spending: monthSpending(list, ym) };
  }, [records, ym, today]);

  const dayItems = selected ? items.filter((i) => i.date === selected) : [];
  const upcoming = items.filter((i) => i.date >= today).slice(0, 8);

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="title1">캘린더</AppText>
      </View>
      <View style={styles.calendar}>
        <MonthGrid
          yearMonth={ym}
          today={today}
          selected={selected}
          markers={markers}
          onSelect={setSelected}
          onChangeMonth={(d) => {
            const next = shiftYearMonth(ym, d);
            setYm(next);
            setSelected(null);
          }}
        />
        <View style={styles.legend}>
          {LEGEND.map((t) => (
            <View key={t} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: EVENT_COLOR[t] }]} />
              <AppText variant="small" color="textTertiary">
                {t === 'contract_end' ? '종료·갱신' : EVENT_TYPE_LABEL[t]}
              </AppText>
            </View>
          ))}
        </View>
        <View style={styles.monthTotal} testID="calendar-month-total">
          <AppText variant="body2" color="textSecondary">
            {ym.month}월 결제 예정
          </AppText>
          <Amount value={spending.total} variant="title3" />
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
                subtitle={`${i.title}${i.estimated ? ' (예상)' : ''}`}
                right={i.amount != null ? <AppText variant="body2Strong" tabular>{formatWon(i.amount)}</AppText> : <TypeTag type={i.type} />}
                onPress={() => router.push(`/contract/${i.contractId}`)}
              />
            ))
          )}
        </Section>
      ) : (
        <Section title={`${ym.month}월 일정`}>
          {(ym.year === yearMonthOf(today).year && ym.month === yearMonthOf(today).month ? upcoming : items.slice(0, 8)).map((i) => (
            <ContractLine
              key={i.key}
              category={i.category}
              title={i.contractTitle}
              subtitle={`${Number(i.date.slice(8))}일 · ${i.title}`}
              right={i.amount != null ? <AppText variant="body2Strong" tabular>{formatWon(i.amount)}</AppText> : <TypeTag type={i.type} />}
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

function TypeTag({ type }: { type: ContractEventType }) {
  return (
    <AppText variant="captionStrong" style={{ color: EVENT_COLOR[type] }}>
      {EVENT_TYPE_LABEL[type]}
    </AppText>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md },
  calendar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  monthTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg, marginHorizontal: spacing.sm, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
