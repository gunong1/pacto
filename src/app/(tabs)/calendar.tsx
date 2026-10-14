import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { EVENT_LEGEND } from '@/components/pacto';
import { MonthGrid } from '@/components/pacto/MonthGrid';
import { MonthPickerSheet } from '@/components/pacto/MonthPickerSheet';
import { AppText } from '@/components/ui/AppText';
import { Screen, Section, SectionGap } from '@/components/ui/layout';
import { ChipGroup } from '@/components/ui/controls';
import { dayMarkers, groupCalendarItems, itemsForView, type CalendarViewMode } from '@/domain/calendarGroups';
import { formatDateKo, isValidISODate, monthRange, shiftYearMonth, yearMonthOf, type YearMonth } from '@/domain/dates';
import { scheduleForRange } from '@/domain/schedule';
import { monthSpending } from '@/domain/spending';
import type { ISODate } from '@/domain/types';
import { CalendarGroupCard } from '@/features/calendar/CalendarGroupCard';
import { MonthCashflowCards } from '@/features/calendar/MonthCashflowCards';
import { useContracts, useToday } from '@/features/contracts/queries';
import { spacing } from '@/theme';

/** 계약 전용 캘린더: 결제일, 시작/종료, 자동갱신, 해지 통보기한, 내 일정 + 월 계약 지출 예정 */
export default function CalendarScreen() {
  const today = useToday();
  const { data: records } = useContracts();
  // 계약 상세 "캘린더 보기": ?date=YYYY-MM-DD&t=<nonce>
  const params = useLocalSearchParams<{ date?: string; t?: string }>();
  const [ym, setYm] = useState<YearMonth>(() => yearMonthOf(today));
  const [picker, setPicker] = useState(false);
  /** 연도·월 빠른 이동 / 오늘 */
  const [selected, setSelected] = useState<ISODate | null>(today);
  // 보기: 핵심 일정(참고 일정 숨김) / 전체 보기 — 이 기기에 기억 (원본 일정은 어느 쪽이든 그대로)
  const [mode, setMode] = useState<CalendarViewMode>('core');
  useEffect(() => {
    AsyncStorage.getItem(VIEW_KEY)
      .then((v) => (v === 'all' || v === 'core') && setMode(v))
      .catch(() => undefined);
  }, []);
  const changeMode = (m: CalendarViewMode) => {
    setMode(m);
    AsyncStorage.setItem(VIEW_KEY, m).catch(() => undefined);
  };
  const goTo = (next: YearMonth) => {
    setYm(next);
    // 이번 달로 돌아오면 오늘을 선택 (처음 들어왔을 때와 같게)
    const now = yearMonthOf(today);
    setSelected(next.year === now.year && next.month === now.month ? today : null);
  };
  const [appliedNonce, setAppliedNonce] = useState<string | undefined>(undefined);
  if (params.t !== appliedNonce) {
    setAppliedNonce(params.t);
    if (params.date && isValidISODate(params.date)) {
      setYm(yearMonthOf(params.date));
      setSelected(params.date);
    }
  }

  // 일정 원본(결제·시작·주요 날짜 …)은 그대로 계산하고, 화면에서만 같은 계약·같은 날짜를 카드 하나로 묶는다.
  // 월 지출 합계는 이 묶음과 별개로 결제 규칙에서 직접 계산한다 (spending.ts)
  // 핵심 일정 보기는 참고 일정만 숨긴다 (필수·관리 일정·내 일정은 그대로) — 금액 합계는 보기와 무관
  const { groups, markers, spending, hidden } = useMemo(() => {
    const list = records ?? [];
    const { shown, hidden } = itemsForView(scheduleForRange(list, monthRange(ym), today), mode);
    const groups = groupCalendarItems(shown, today);
    const spending = monthSpending(list, ym, today);
    return { groups, markers: dayMarkers(groups), spending, hidden };
  }, [records, ym, today, mode]);

  const dayGroups = selected ? groups.filter((g) => g.date === selected) : [];
  const isThisMonth = ym.year === yearMonthOf(today).year && ym.month === yearMonthOf(today).month;
  const monthGroups = isThisMonth ? groups.filter((g) => g.date >= today).slice(0, 8) : groups.slice(0, 8);

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
            setYm(shiftYearMonth(ym, d));
            setSelected(null);
          }}
          onPressTitle={() => setPicker(true)}
          onToday={isThisMonth ? undefined : () => goTo(yearMonthOf(today))}
          subtitle={
            // 월 금액은 홈(이번 달 계약 재무 요약)과 같은 monthSpending 기준 — 출금·입금 카드 2장
            <MonthCashflowCards spending={spending} testID="calendar-month-total" />
          }
        />
        <MonthPickerSheet visible={picker} value={ym} current={yearMonthOf(today)} onSelect={goTo} onClose={() => setPicker(false)} />
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

      <View style={styles.mode} testID="calendar-view-mode">
        <ChipGroup
          options={[
            { value: 'core', label: '핵심 일정' },
            { value: 'all', label: '전체 보기' },
          ]}
          value={mode}
          onChange={(v) => changeMode(v as CalendarViewMode)}
          testIDPrefix="calendar-mode"
        />
        {mode === 'core' && hidden > 0 ? (
          <AppText variant="small" color="textTertiary" testID="calendar-hidden">
            참고 일정 {hidden}개는 숨겼어요 (전체 보기·계약 상세에서 확인)
          </AppText>
        ) : null}
      </View>

      <SectionGap />

      {selected ? (
        <Section title={formatDateKo(selected, true)} testID="calendar-day-list">
          {dayGroups.length === 0 ? (
            <AppText variant="body2" color="textTertiary">
              이 날은 계약 일정이 없어요.
            </AppText>
          ) : (
            dayGroups.map((g) => <CalendarGroupCard key={g.key} group={g} testID={`calendar-group-${g.contractId}`} onPress={() => router.push(`/contract/${g.contractId}`)} />)
          )}
        </Section>
      ) : (
        <Section title={`${ym.month}월 일정`}>
          {monthGroups.map((g) => (
            <CalendarGroupCard key={g.key} group={g} datePrefix={`${Number(g.date.slice(8))}일`} onPress={() => router.push(`/contract/${g.contractId}`)} />
          ))}
          {groups.length === 0 ? (
            <AppText variant="body2" color="textTertiary">
              이 달은 계약 일정이 없어요.
            </AppText>
          ) : null}
        </Section>
      )}
    </Screen>
  );
}

const VIEW_KEY = 'pacto.calendar.view';

const styles = StyleSheet.create({
  // 범례 ↔ 보기 버튼 20 (calendar paddingBottom) · 버튼 ↔ 캘린더 영역 끝(구분띠) 24 — 고정 높이 없이 여백만 (글자 확대 시 내용 따라 늘어남)
  mode: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.xxl, gap: 4 },
  header: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md },
  calendar: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xl },
  legend: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: 4, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
