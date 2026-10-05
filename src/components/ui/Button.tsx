import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { AppText } from './AppText';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: 'lg' | 'md' | 'sm';
  disabled?: boolean;
  loading?: boolean;
  left?: React.ReactNode;
  style?: ViewStyle;
  testID?: string;
}

const BG: Record<Variant, [string, string]> = {
  primary: [colors.primary, colors.primaryPressed],
  secondary: [colors.bgSubtle, colors.bgPressed],
  ghost: ['transparent', colors.bgSubtle],
  danger: [colors.cautionSoft, '#FADCDC'],
};

const FG: Record<Variant, keyof typeof colors> = {
  primary: 'textInverse',
  secondary: 'text',
  ghost: 'primary',
  danger: 'caution',
};

const HEIGHT = { lg: 56, md: 48, sm: 36 } as const;

export function Button({ label, onPress, variant = 'primary', size = 'lg', disabled, loading, left, style, testID }: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { height: HEIGHT[size], backgroundColor: BG[variant][pressed ? 1 : 0], paddingHorizontal: size === 'sm' ? spacing.md : spacing.xl },
        size === 'sm' && { borderRadius: radius.md },
        inactive && styles.disabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.textInverse : colors.primary} />
      ) : (
        <View style={styles.row}>
          {left}
          <AppText variant={size === 'sm' ? 'captionStrong' : 'bodyStrong'} color={FG[variant]}>
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  disabled: { opacity: 0.4 },
});
