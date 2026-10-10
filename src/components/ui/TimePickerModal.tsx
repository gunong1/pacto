import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { AppText } from './AppText';
import { Button } from './Button';

const pad = (n: number) => String(n).padStart(2, '0');
const toDate = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
};
const toHHMM = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export interface TimePickerModalProps {
  visible: boolean;
  /** 'HH:MM' */
  value: string;
  title?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

/**
 * OS 기본 시간 선택 — Android: 시스템 시계 대화상자, iOS: 스크롤(spinner) 시트. 웹은 TimePickerModal.web.tsx.
 */
export function TimePickerModal(props: TimePickerModalProps) {
  return Platform.OS === 'android' ? <AndroidTimePicker {...props} /> : <IosTimePicker {...props} />;
}

/** Android는 시스템 대화상자를 연다 (화면에 그리는 것은 없음) */
function AndroidTimePicker({ visible, value, title, onCancel, onConfirm }: TimePickerModalProps) {
  useEffect(() => {
    if (!visible) return;
    DateTimePickerAndroid.open({
      value: toDate(value),
      mode: 'time',
      is24Hour: false,
      title,
      onChange: (event, date) => {
        if (event.type === 'set' && date) onConfirm(toHHMM(date));
        else onCancel();
      },
    });
  }, [visible, value, title, onCancel, onConfirm]);
  return null;
}

function IosTimePicker({ visible, value, title, onCancel, onConfirm }: TimePickerModalProps) {
  const [draft, setDraft] = useState(() => toDate(value));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel} onShow={() => setDraft(toDate(value))}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="닫기" />
      <View style={styles.sheet}>
        {title ? (
          <AppText variant="body2Strong" align="center">
            {title}
          </AppText>
        ) : null}
        <DateTimePicker value={draft} mode="time" display="spinner" locale="ko-KR" onChange={(_e, d) => d && setDraft(d)} />
        <View style={styles.row}>
          <Button label="취소" variant="secondary" style={{ flex: 1 }} onPress={onCancel} />
          <Button label="확인" style={{ flex: 1 }} onPress={() => onConfirm(toHHMM(draft))} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: colors.bg, padding: spacing.gutter, paddingBottom: spacing.xl * 1.5, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
});
