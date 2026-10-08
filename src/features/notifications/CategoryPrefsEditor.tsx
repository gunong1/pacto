import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Chip, SwitchRow } from '@/components/ui/controls';
import { Divider } from '@/components/ui/layout';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_DEFS,
  needsCriticalOffConfirm,
  offsetLabel,
  type CategoryPrefs,
  type CategoryPrefsMap,
  type NotificationCategory,
} from '@/domain/notifications';
import { confirm } from '@/lib/dialog';
import { spacing } from '@/theme';

/** 중요한 기한 알림을 끌 때 한 번 확인 — 강제로 켜두지는 않는다 (최종 선택은 사용자) */
export async function confirmCriticalOff(category: NotificationCategory): Promise<boolean> {
  const label = NOTIFICATION_CATEGORY_DEFS[category].label;
  return confirm(`${label} 알림을 끌까요?`, '이 알림을 끄면 계약상 중요한 기한을 놓칠 수 있어요.', '끄기', '유지하기');
}

/**
 * 종류별 켜기/끄기 + 알림 시점(여러 개 선택). 사용자 전체 설정과 계약별 설정이 같은 편집기를 쓴다.
 */
export function CategoryPrefsEditor({
  value,
  onChange,
  presets,
  disabled,
  testIDPrefix = 'notif',
}: {
  value: CategoryPrefsMap;
  onChange: (category: NotificationCategory, next: CategoryPrefs) => void;
  presets: readonly number[];
  disabled?: boolean;
  testIDPrefix?: string;
}) {
  const change = async (c: NotificationCategory, next: CategoryPrefs) => {
    if (needsCriticalOffConfirm(c, next) && !needsCriticalOffConfirm(c, value[c])) {
      if (!(await confirmCriticalOff(c))) return;
    }
    onChange(c, next);
  };
  return (
    <View style={disabled ? { opacity: 0.45 } : undefined} pointerEvents={disabled ? 'none' : 'auto'}>
      {NOTIFICATION_CATEGORIES.map((c, i) => {
        const def = NOTIFICATION_CATEGORY_DEFS[c];
        const v = value[c];
        // 사용자 설정에 이미 있는 값(예: 계약별 180일)도 선택지로 보여준다
        const options = [...new Set([...presets, ...v.offsets])].sort((a, b) => b - a);
        return (
          <View key={c} testID={`${testIDPrefix}-${c}`}>
            {i > 0 ? <Divider /> : null}
            <SwitchRow
              label={def.label}
              description={def.description}
              value={v.enabled}
              onValueChange={(on) => change(c, { ...v, enabled: on })}
              testID={`${testIDPrefix}-${c}-switch`}
            />
            {v.enabled ? (
              <View style={styles.chips}>
                {options.map((d) => {
                  const on = v.offsets.includes(d);
                  return (
                    <Chip
                      key={d}
                      label={offsetLabel(d)}
                      selected={on}
                      onPress={() => change(c, { ...v, offsets: on ? v.offsets.filter((x) => x !== d) : [...v.offsets, d].sort((a, b) => b - a) })}
                      testID={`${testIDPrefix}-${c}-${d}`}
                    />
                  );
                })}
              </View>
            ) : null}
            {v.enabled && v.offsets.length === 0 ? (
              <AppText variant="small" color="caution" style={{ marginBottom: spacing.sm }}>
                알림 시점을 하나 이상 골라주세요. 고르지 않으면 이 알림은 오지 않아요.
              </AppText>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingBottom: spacing.md },
});
