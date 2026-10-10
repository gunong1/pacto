import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { daysInMonth, toISODate, weekdayOf, type YearMonth } from '@/domain/dates';
import type { ISODate, ScheduleItemType } from '@/domain/types';
import { colors, hitSlop, radius, spacing } from '@/theme';

import { EVENT_COLOR } from './index';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const DOT_ORDER: ScheduleItemType[] = ['termination_notice', 'contract_end', 'renewal', 'prepare', 'payment', 'custom', 'contract_start', 'key_date'];

/** 같은 색(종료·갱신, 일정)은 점 하나로 */
function dotColors(types: Set<ScheduleItemType>): string[] {
  const out: string[] = [];
  for (const t of DOT_ORDER) {
    if (!types.has(t)) continue;
    const c = EVENT_COLOR[t];
    if (!out.includes(c)) out.push(c);
  }
  return out.slice(0, 3);
}

export interface MonthGridProps {
  yearMonth: YearMonth;
  today: ISODate;
  selected: ISODate | null;
  markers: Map<ISODate, Set<ScheduleItemType>>;
  onSelect: (date: ISODate) => void;
  onChangeMonth: (delta: number) => void;
  /** 제목(연·월)을 누르면 — 연도·월 빠른 이동 */
  onPressTitle?: () => void;
  /** 이번 달이 아닐 때 "오늘" 버튼 — 이번 달로 바로 돌아가기 */
  onToday?: () => void;
}

/** 계약 전용 월 캘린더. 날짜 아래 점 색 = 일정 유형. */
export function MonthGrid({ yearMonth, today, selected, markers, onSelect, onChangeMonth, onPressTitle, onToday }: MonthGridProps) {
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
        <View style={styles.titleRow}>
          <Pressable
            onPress={onPressTitle}
            disabled={!onPressTitle}
            hitSlop={hitSlop}
            accessibilityRole="button"
            accessibilityLabel={`${year}년 ${month}월, 연도·월 빠르게 이동`}
            testID="calendar-title"
            style={({ pressed }) => [styles.title, pressed && styles.titlePressed]}>
            <AppText variant="title2" tabular>
              {year}년 {month}월
            </AppText>
            {onPressTitle ? <Ionicons name="chevron-down" size={16} color={colors.textTertiary} /> : null}
          </Pressable>
          {onToday ? (
            <Pressable onPress={onToday} hitSlop={hitSlop} accessibilityRole="button" accessibilityLabel="이번 달로 이동" testID="calendar-today" style={styles.todayChip}>
              <AppText variant="caption" color="primary">
                오늘
              </AppText>
            </Pressable>
          ) : null}
        </View>
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
          const dots = types ? dotColors(types) : [];
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
                {dots.map((c) => (
                  <View key={c} style={[styles.dot, { backgroundColor: c }]} />
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.xs, paddingVertical: 2, borderRadius: radius.md },
  titlePressed: { backgroundColor: colors.bgSubtle },
  todayChip: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary },
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
