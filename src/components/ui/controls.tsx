import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View, type TextInputProps } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

import { AppText } from './AppText';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'primary' | 'caution' | 'check' }) {
  const map = {
    neutral: [colors.infoSoft, 'textSecondary'],
    primary: [colors.primarySoft, 'primary'],
    caution: [colors.cautionSoft, 'caution'],
    check: [colors.checkSoft, 'check'],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <AppText variant="small" color={fg}>
        {label}
      </AppText>
    </View>
  );
}

export function Chip({ label, selected, onPress, testID }: { label: string; selected?: boolean; onPress?: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={[styles.chip, selected && styles.chipSelected]}>
      <AppText variant="captionStrong" color={selected ? 'textInverse' : 'textSecondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  scroll,
  testIDPrefix,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  scroll?: boolean;
  testIDPrefix?: string;
}) {
  const chips = options.map((o) => (
    <Chip key={o.value} label={o.label} selected={value === o.value} onPress={() => onChange(o.value)} testID={testIDPrefix ? `${testIDPrefix}-${o.value}` : undefined} />
  ));
  if (scroll) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {chips}
      </ScrollView>
    );
  }
  return <View style={[styles.chipRow, styles.wrap]}>{chips}</View>;
}

export interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string;
  hint?: string;
  /** AI 추출 신뢰도가 낮아 확인이 필요한 필드 */
  flagged?: boolean;
  suffix?: string;
}

export function TextField({ label, error, hint, flagged, suffix, style, ...input }: TextFieldProps) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <AppText variant="captionStrong" color="textSecondary">
          {label}
        </AppText>
        {flagged ? <Badge label="확인 필요" tone="check" /> : null}
      </View>
      <View style={[styles.inputWrap, flagged && styles.inputFlagged, !!error && styles.inputError]}>
        <TextInput
          placeholderTextColor={colors.textDisabled}
          style={[styles.input, style]}
          accessibilityLabel={label}
          {...input}
        />
        {suffix ? (
          <AppText variant="body2" color="textTertiary">
            {suffix}
          </AppText>
        ) : null}
      </View>
      {error ? (
        <AppText variant="caption" color="caution" style={styles.help}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" color="textTertiary" style={styles.help}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

export function SwitchRow({ label, description, value, onValueChange, testID }: { label: string; description?: string; value: boolean; onValueChange: (v: boolean) => void; testID?: string }) {
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1 }}>
        <AppText variant="body2Strong">{label}</AppText>
        {description ? (
          <AppText variant="caption" color="textTertiary" style={{ marginTop: 2 }}>
            {description}
          </AppText>
        ) : null}
      </View>
      <Switch
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: colors.primary, false: colors.border }}
        thumbColor={colors.bg}
      />
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.segment, active && styles.segmentActive]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
            <AppText variant="captionStrong" color={active ? 'text' : 'textTertiary'}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, alignSelf: 'flex-start' },
  chip: { paddingHorizontal: 12, height: 34, borderRadius: radius.pill, backgroundColor: colors.bgSubtle, justifyContent: 'center' },
  chipSelected: { backgroundColor: colors.primary },
  chipRow: { flexDirection: 'row', gap: spacing.sm },
  wrap: { flexWrap: 'wrap' },
  field: { marginBottom: spacing.lg },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 50,
    backgroundColor: colors.bg,
  },
  inputFlagged: { borderColor: '#F0C987', backgroundColor: '#FFFCF5' },
  inputError: { borderColor: colors.caution },
  input: { flex: 1, ...typography.body, color: colors.text, paddingVertical: 12 },
  help: { marginTop: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.md },
  segmented: { flexDirection: 'row', backgroundColor: colors.bgSubtle, borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.bg, boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)' },
});
