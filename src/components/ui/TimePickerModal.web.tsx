import { createElement, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { AppText } from './AppText';
import { Button } from './Button';
import type { TimePickerModalProps } from './TimePickerModal';

export type { TimePickerModalProps } from './TimePickerModal';

/** 웹 미리보기: 브라우저 기본 시간 입력(<input type="time">) */
export function TimePickerModal({ visible, value, title, onCancel, onConfirm }: TimePickerModalProps) {
  const [draft, setDraft] = useState(value);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} onShow={() => setDraft(value)}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="닫기" />
      <View style={styles.sheet} testID="time-picker">
        {title ? (
          <AppText variant="body2Strong" align="center">
            {title}
          </AppText>
        ) : null}
        {createElement('input', {
          type: 'time',
          value: draft,
          'data-testid': 'time-picker-input',
          onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
          style: { fontSize: 20, padding: 12, borderRadius: 8, border: `1px solid ${colors.border}` },
        })}
        <View style={styles.row}>
          <Button label="취소" variant="secondary" style={{ flex: 1 }} onPress={onCancel} testID="time-picker-cancel" />
          <Button label="확인" style={{ flex: 1 }} onPress={() => /^\d{2}:\d{2}$/.test(draft) && onConfirm(draft)} testID="time-picker-ok" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { margin: 'auto', marginTop: 160, width: 320, backgroundColor: colors.bg, padding: spacing.gutter, borderRadius: radius.lg, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
});
