import { Text, type TextProps } from 'react-native';

import { colors, numeric, typography, type TypographyVariant } from '@/theme';

type ColorName = keyof typeof colors;

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  color?: ColorName;
  /** 숫자 폭 고정 (금액/D-Day) */
  tabular?: boolean;
  align?: 'left' | 'center' | 'right';
}

export function AppText({ variant = 'body', color = 'text', tabular, align, style, ...rest }: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[typography[variant], { color: colors[color] }, tabular && numeric, align && { textAlign: align }, style]}
    />
  );
}
