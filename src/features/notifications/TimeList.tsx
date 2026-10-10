import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { TimePickerModal } from '@/components/ui/TimePickerModal';
import { formatTimeOfDay, MAX_NOTIFICATION_TIMES, normalizeTimes } from '@/domain/notifications';
import { notify } from '@/lib/dialog';
import { colors, hitSlop, spacing } from '@/theme';

/**
 * 알림 시간 목록 — 시간마다 "변경"(OS 시간 선택) · "삭제"(2개 이상일 때), 아래에 "+ 알림 시간 추가" (최대 4개).
 * 기본 알림 시간과 종류별 시간이 같은 컴포넌트를 쓴다.
 */
export function TimeList({ times, onChange, testIDPrefix }: { times: readonly string[]; onChange: (next: string[]) => void; testIDPrefix: string }) {
  /** 편집 중: 바꿀 시간의 위치 (-1 = 새로 추가) */
  const [editing, setEditing] = useState<number | null>(null);
  const close = useCallback(() => setEditing(null), []);
  const confirm = useCallback(
    (value: string) => {
      const i = editing;
      setEditing(null);
      if (i == null) return;
      const others = times.filter((_, j) => j !== i);
      if (others.includes(value)) return notify('알림 시간', '이미 있는 시간이에요.');
      onChange(normalizeTimes(i === -1 ? [...times, value] : times.map((t, j) => (j === i ? value : t))) ?? [...times]);
    },
    [editing, times, onChange],
  );

  return (
    <View>
      {times.map((t, i) => (
        <View key={t} style={styles.row} testID={`${testIDPrefix}-time-${t}`}>
          <Ionicons name="time-outline" size={18} color={colors.textTertiary} />
          <AppText variant="body" tabular style={{ flex: 1 }}>
            {formatTimeOfDay(t)}
          </AppText>
          <Pressable onPress={() => setEditing(i)} hitSlop={hitSlop} accessibilityRole="button" accessibilityLabel={`${formatTimeOfDay(t)} 변경`} testID={`${testIDPrefix}-change-${t}`}>
            <AppText variant="body2Strong" color="primary">
              변경
            </AppText>
          </Pressable>
          {times.length > 1 ? (
            <Pressable onPress={() => onChange(times.filter((_, j) => j !== i))} hitSlop={hitSlop} accessibilityRole="button" accessibilityLabel={`${formatTimeOfDay(t)} 삭제`} testID={`${testIDPrefix}-remove-${t}`}>
              <Ionicons name="close" size={18} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>
      ))}
      {times.length < MAX_NOTIFICATION_TIMES ? (
        <Pressable onPress={() => setEditing(-1)} accessibilityRole="button" style={styles.add} testID={`${testIDPrefix}-add`}>
          <Ionicons name="add" size={18} color={colors.primary} />
          <AppText variant="body2Strong" color="primary">
            알림 시간 추가
          </AppText>
        </Pressable>
      ) : null}
      <TimePickerModal
        visible={editing != null}
        value={editing != null && editing >= 0 ? times[editing] : '18:00'}
        title={editing === -1 ? '알림 시간 추가' : '알림 시간 변경'}
        onCancel={close}
        onConfirm={confirm}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  add: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
});
