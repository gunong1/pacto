import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { RadioGroup } from '@/components/ui/controls';
import { DateField } from '@/components/ui/DateField';
import { effectiveDateError, type AmountDecision, type AmountEdit } from '@/domain/amountEdits';
import { formatDateKo, normalizeDateInput } from '@/domain/dates';
import { formatWon } from '@/domain/money';
import type { ISODate } from '@/domain/types';
import { colors, radius, spacing } from '@/theme';

type Choice = AmountDecision['kind'];

export interface AmountChangeSheetProps {
  /** 지금 묻는 결제 (null이면 닫힘) */
  edit: AmountEdit | null;
  /** 과거 적용일을 고르면 바뀌는 지난 일정 수 */
  pastCount: (date: ISODate) => number;
  onConfirm: (decision: AmountDecision) => void;
  onCancel: () => void;
}

/**
 * 반복 결제·수입 금액을 바꿀 때 "언제부터" 바뀌는지 묻는다 — 바로 덮어쓰지 않는다.
 * 기본: 다음 결제일부터 (과거 일정 보존). 과거 날짜를 고르면 바뀌는 지난 일정 수를 알리고 한 번 더 확인한다.
 */
export function AmountChangeSheet({ edit, pastCount, onConfirm, onCancel }: AmountChangeSheetProps) {
  return (
    <Modal visible={edit != null} transparent animationType="fade" onRequestClose={onCancel}>
      {/* 결제마다 새로 그린다 → 선택값이 앞 결제에서 넘어오지 않게 */}
      {edit ? <SheetBody key={edit.paymentId} edit={edit} pastCount={pastCount} onConfirm={onConfirm} onCancel={onCancel} /> : null}
    </Modal>
  );
}

function SheetBody({ edit, pastCount, onConfirm, onCancel }: AmountChangeSheetProps & { edit: AmountEdit }) {
  const income = edit.direction === 'income';
  const [choice, setChoice] = useState<Choice>(edit.nextDate ? 'next' : 'date');
  const [dateText, setDateText] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** 과거 적용일 확인 단계 */
  const [pastWarn, setPastWarn] = useState<{ date: ISODate; count: number } | null>(null);

  const correctNote = edit.current
    ? `지금 적용 중인 변경(${formatDateKo(edit.current.effectiveFrom)}부터 ${formatWon(edit.current.amount)})의 금액을 고쳐요. 그 기간의 지난 일정도 바뀌어요.`
    : `입력 실수 정정 — 지난 일정도 모두 이 금액으로 바뀌어요.${edit.upcoming.length ? ` 예정된 변경(${edit.upcoming.map((c) => `${formatDateKo(c.effectiveFrom)} ${formatWon(c.amount)}`).join(', ')})은 그대로예요.` : ''}`;

  const options = [
    ...(edit.nextDate ? [{ value: 'next' as const, label: `${income ? '다음 입금일' : '다음 결제일'}부터 (${formatDateKo(edit.nextDate)})`, description: '지난 일정은 그대로 두고 이후 일정만 바뀌어요' }] : []),
    { value: 'date' as const, label: '적용 날짜 직접 선택' },
    { value: 'correct' as const, label: '처음부터 이 금액이었어요', description: correctNote },
  ];

  const apply = () => {
    setError(null);
    if (choice !== 'date') return onConfirm({ kind: choice });
    const date = normalizeDateInput(dateText);
    if (!date) return setError('적용 날짜를 입력해주세요');
    const invalid = effectiveDateError(edit, date);
    if (invalid) return setError(invalid);
    const count = pastCount(date);
    // 과거 일정이 바뀌는 경우는 사용자가 명시적으로 확인했을 때만
    if (count > 0) return setPastWarn({ date, count });
    onConfirm({ kind: 'date', date });
  };

  return (
    <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="닫기">
      <Pressable style={styles.sheet} onPress={() => undefined} testID="amount-change-sheet">
        <ScrollView contentContainerStyle={{ gap: spacing.md }} keyboardShouldPersistTaps="handled">
          {pastWarn ? (
            <View style={{ gap: spacing.sm }} testID="amount-change-past-warning">
              <AppText variant="title3">지난 일정도 바뀌어요</AppText>
              <AppText variant="body2" color="textSecondary">
                {formatDateKo(pastWarn.date)}부터 적용하면 과거 일정 {pastWarn.count}건의 금액도 변경됩니다.
              </AppText>
              <View style={styles.buttons}>
                <Button label="취소" variant="secondary" onPress={() => setPastWarn(null)} style={{ flex: 1 }} testID="amount-change-past-cancel" />
                <Button label="변경 적용" onPress={() => onConfirm({ kind: 'date', date: pastWarn.date })} style={{ flex: 1 }} testID="amount-change-past-apply" />
              </View>
            </View>
          ) : (
            <>
              <View style={{ gap: 4 }}>
                <AppText variant="title3">{income ? '입금 금액이 변경되었어요' : '결제 금액이 변경되었어요'}</AppText>
                <AppText variant="body2" color="textSecondary">
                  {edit.label}
                </AppText>
                <AppText variant="bodyStrong" tabular testID="amount-change-diff">
                  {formatWon(edit.from)} → {formatWon(edit.to)}
                </AppText>
              </View>
              <AppText variant="body2Strong">언제부터 변경할까요?</AppText>
              <RadioGroup options={options} value={choice} onChange={(v) => { setChoice(v); setError(null); }} testIDPrefix="amount-change" />
              {choice === 'date' ? (
                <DateField label="적용 날짜" value={dateText} onChangeText={setDateText} error={error ?? undefined} testID="amount-change-date-input" />
              ) : null}
              <View style={styles.buttons}>
                <Button label="취소" variant="secondary" onPress={onCancel} style={{ flex: 1 }} testID="amount-change-cancel" />
                <Button label="변경 적용" onPress={apply} style={{ flex: 1 }} testID="amount-change-apply" />
              </View>
            </>
          )}
        </ScrollView>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.gutter,
    paddingBottom: spacing.xl,
    maxHeight: '85%',
  },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
});
