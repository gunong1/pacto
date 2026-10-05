import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { daysInMonth, toISODate, weekdayOf, type YearMonth } from '@/domain/dates';
import type { ContractEventType, ISODate } from '@/domain/types';
import { colors, hitSlop, radius, spacing } from '@/theme';

import { EVENT_COLOR } from './index';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const DOT_ORDER: ContractEventType[] = ['termination_notice', 'contract_end', 'renewal', 'payment', 'custom', 'contract_start'];

export interface MonthGridProps {
  yearMonth: YearMonth;
  today: ISODate;
  selected: ISODate | null;
  markers: Map<ISODate, Set<ContractEventType>>;
  onSelect: (date: ISODate) => void;
  onChangeMonth: (delta: number) => void;
}

/** 계약 전용 월 캘린더. 날짜 아래 점 색 = 일정 유형. */
export function MonthGrid({ yearMonth, today, selected, markers, onSelect, onChangeMonth }: MonthGridProps) {
  const { year, month } = yearMonth;
  const first = toISODate(year, month, 1);
  const lead = weekdayOf(first);
  const total = daysInMonth(year, month);
  const cells: (ISODate | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => toISODate(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <View>
      <View style={styles.header}>
        <Pressable onPress={() => onChangeMonth(-1)} hitSlop={hitSlop} accessibilityLabel="이전 달" testID="calendar-prev">
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
        <AppText variant="title2" tabular testID="calendar-title">
          {year}년 {month}월
        </AppText>
        <Pressable onPress={() => onChangeMonth(1)} hitSlop={hitSlop} accessibilityLabel="다음 달" testID="calendar-next">
          <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>
      <View style={styles.week}>
        {WEEKDAYS.map((w, i) => (
          <AppText key={w} variant="small" color={i === 0 ? 'caution' : 'textTertiary'} align="center" style={styles.cellText}>
            {w}
          </AppText>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((date, idx) => {
          if (!date) return <View key={`e${idx}`} style={styles.cell} />;
          const isSelected = date === selected;
          const isToday = date === today;
          const types = markers.get(date);
          const dots = types ? DOT_ORDER.filter((t) => types.has(t)).slice(0, 3) : [];
          return (
            <Pressable
              key={date}
              testID={`day-${date}`}
              onPress={() => onSelect(date)}
              style={styles.cell}
              accessibilityRole="button"
              accessibilityLabel={`${date}${types ? ` 일정 ${types.size}종` : ''}`}>
              <View style={[styles.dayCircle, isToday && styles.today, isSelected && styles.selected]}>
                <AppText variant="body2Strong" tabular color={isSelected ? 'textInverse' : idx % 7 === 0 ? 'caution' : 'text'}>
                  {Number(date.slice(8))}
                </AppText>
              </View>
              <View style={styles.dots}>
                {dots.map((t) => (
                  <View key={t} style={[styles.dot, { backgroundColor: EVENT_COLOR[t] }]} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm, marginBottom: spacing.sm },
  week: { flexDirection: 'row', marginBottom: spacing.xs },
  cellText: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 4, height: 52 },
  dayCircle: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  today: { backgroundColor: colors.primarySoft },
  selected: { backgroundColor: colors.primary },
  dots: { flexDirection: 'row', gap: 3, height: 6, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
});
