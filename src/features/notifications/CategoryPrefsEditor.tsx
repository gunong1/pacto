import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Chip, SwitchRow } from '@/components/ui/controls';
import { Divider } from '@/components/ui/layout';
import {
  NOTIFICATION_CATEGORY_DEFS,
  NOTIFICATION_CATEGORY_GROUPS,
  needsCriticalOffConfirm,
  offsetLabel,
  type CategoryPrefs,
  type CategoryPrefsMap,
  type NotificationCategory,
} from '@/domain/notifications';
import { confirm } from '@/lib/dialog';
import { spacing } from '@/theme';

/** 중요한 기한 알림을 끌 때 한 번 확인 — 강제로 켜두지는 않는다 (최종 선택은 사용자) */
export async function confirmCriticalOff(label: string): Promise<boolean> {
  return confirm(`${label} 알림을 끌까요?`, '이 알림을 끄면 계약상 중요한 기한을 놓칠 수 있어요.', '끄기', '유지하기');
}

/**
 * 종류별 켜기/끄기 + 알림 시점(여러 개 선택). 사용자 전체 설정과 계약별 설정이 같은 편집기를 쓴다.
 * 화면은 묶음(NOTIFICATION_CATEGORY_GROUPS) 단위로 보여주고, 바꾸면 묶음에 속한 종류별 키에 같은 값을 저장한다.
 */
export function CategoryPrefsEditor({
  value,
  onChange,
  presets,
  disabled,
  testIDPrefix = 'notif',
}: {
  value: CategoryPrefsMap;
  onChange: (changes: Partial<Record<NotificationCategory, CategoryPrefs>>) => void;
  presets: readonly number[];
  disabled?: boolean;
  testIDPrefix?: string;
}) {
  const change = async (group: (typeof NOTIFICATION_CATEGORY_GROUPS)[number], next: CategoryPrefs) => {
    const critical = group.members.some((m) => NOTIFICATION_CATEGORY_DEFS[m].critical);
    if (critical && needsCriticalOffConfirm(group.key, next) && !needsCriticalOffConfirm(group.key, value[group.key])) {
      if (!(await confirmCriticalOff(group.label))) return;
    }
    onChange(Object.fromEntries(group.members.map((m) => [m, { enabled: next.enabled, offsets: [...next.offsets] }])));
  };
  return (
    <View style={disabled ? { opacity: 0.45 } : undefined} pointerEvents={disabled ? 'none' : 'auto'}>
      {NOTIFICATION_CATEGORY_GROUPS.map((def, i) => {
        const c = def.key;
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
              onValueChange={(on) => change(def, { ...v, enabled: on })}
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
                      onPress={() => change(def, { ...v, offsets: on ? v.offsets.filter((x) => x !== d) : [...v.offsets, d].sort((a, b) => b - a) })}
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
