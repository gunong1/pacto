import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import type { YearMonth } from "@/domain/dates";
import { colors, radius, spacing } from "@/theme";

const YEAR_ROW = 44;
/** 선택할 수 있는 연도: 올해 기준 앞 10년 ~ 뒤 30년 (보고 있는 연도는 항상 포함) */
export function pickerYears(current: number, shown: number): number[] {
  const from = Math.min(current - 10, shown);
  const to = Math.max(current + 30, shown);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export interface MonthPickerSheetProps {
  visible: boolean;
  /** 지금 보고 있는 달 */
  value: YearMonth;
  /** 오늘이 속한 달 */
  current: YearMonth;
  onSelect: (ym: YearMonth) => void;
  onClose: () => void;
}

/**
 * 연도·월 빠른 이동 — 왼쪽 연도 목록(세로 스크롤)에서 연도를 고르고, 오른쪽 1~12월을 누르면 바로 그 달로 이동한다.
 * "오늘"은 이번 달로 바로 돌아간다.
 */
export function MonthPickerSheet(props: MonthPickerSheetProps) {
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="fade"
      onRequestClose={props.onClose}
    >
      {/* 열 때마다 새로 그린다 → 보고 있는 연도에서 시작 */}
      {props.visible ? <PickerBody {...props} /> : null}
    </Modal>
  );
}

function PickerBody({
  value,
  current,
  onSelect,
  onClose,
}: MonthPickerSheetProps) {
  const [year, setYear] = useState(value.year);
  const scroll = useRef<ScrollView | null>(null);
  const years = pickerYears(current.year, value.year);
  // 보고 있는 연도가 목록 위쪽에서 세 번째쯤 보이게
  const scrollToShown = () =>
    scroll.current?.scrollTo({
      y: Math.max(0, (years.indexOf(value.year) - 2) * YEAR_ROW),
      animated: false,
    });

  const pick = (ym: YearMonth) => {
    onSelect(ym);
    onClose();
  };

  return (
    <Pressable
      style={styles.backdrop}
      onPress={onClose}
      accessibilityLabel="닫기"
      testID="month-picker-backdrop"
    >
      <Pressable
        style={styles.sheet}
        onPress={() => undefined}
        testID="month-picker"
      >
        <View style={styles.head}>
          <AppText variant="title3">연도·월 이동</AppText>
          <Button
            label="오늘"
            variant="secondary"
            size="sm"
            onPress={() => pick(current)}
            testID="month-picker-today"
          />
        </View>
        <View style={styles.body}>
          <ScrollView
            ref={scroll}
            onLayout={scrollToShown}
            style={styles.years}
            showsVerticalScrollIndicator={false}
            testID="month-picker-years"
          >
            {years.map((y) => {
              const on = y === year;
              return (
                <Pressable
                  key={y}
                  onPress={() => setYear(y)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  aria-selected={on}
                  testID={`month-picker-year-${y}`}
                  style={[styles.year, on && styles.yearOn]}
                >
                  <AppText
                    variant="body2Strong"
                    tabular
                    color={
                      on
                        ? "textInverse"
                        : y === current.year
                          ? "primary"
                          : "text"
                    }
                  >
                    {y}년
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.months}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
              const on = year === value.year && m === value.month;
              const now = year === current.year && m === current.month;
              return (
                <View key={m} style={styles.monthCell}>
                  <Pressable
                    onPress={() => pick({ year, month: m })}
                    accessibilityRole="button"
                    accessibilityLabel={`${year}년 ${m}월로 이동`}
                    accessibilityState={{ selected: on }}
                    aria-selected={on}
                    testID={`month-picker-month-${m}`}
                    style={({ pressed }) => [
                      styles.month,
                      now && styles.monthNow,
                      on && styles.monthOn,
                      pressed && !on && styles.monthPressed,
                    ]}
                  >
                    <AppText
                      variant="body2Strong"
                      color={on ? "textInverse" : now ? "primary" : "text"}
                    >
                      {m}월
                    </AppText>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
        <Button
          label="닫기"
          variant="ghost"
          onPress={onClose}
          testID="month-picker-close"
        />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.gutter,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  body: { flexDirection: "row", gap: spacing.md, height: YEAR_ROW * 5 },
  years: { width: 92, flexGrow: 0 },
  year: {
    height: YEAR_ROW,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  yearOn: { backgroundColor: colors.primary },
  months: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "space-between",
  },
  monthCell: { width: "33.333%", padding: 4 },
  month: {
    height: YEAR_ROW + 6,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgSubtle,
  },
  monthNow: { borderWidth: 1, borderColor: colors.primary },
  monthOn: { backgroundColor: colors.primary },
  monthPressed: { opacity: 0.7 },
});
