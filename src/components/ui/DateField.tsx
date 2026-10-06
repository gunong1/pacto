import { normalizeDateInput } from '@/domain/dates';

import { TextField, type TextFieldProps } from './controls';

export interface DateFieldProps extends Omit<TextFieldProps, 'value' | 'onChangeText' | 'keyboardType'> {
  value: string;
  onChangeText: (value: string) => void;
}

/**
 * 공통 날짜 입력. '-' 없이 숫자만 입력해도 된다.
 * - 8자리(20261012)는 입력 즉시, 6자리(261012)는 입력을 마칠 때 'YYYY-MM-DD'로 바꾼다.
 * - 존재하지 않는 날짜는 그대로 두어 폼 검증이 오류를 보여주게 한다.
 */
export function DateField({ value, onChangeText, onBlur, hint, ...rest }: DateFieldProps) {
  const handleChange = (text: string) => {
    const digits = text.replace(/\D/g, '');
    if (/^\d{8}$/.test(text.trim()) && digits.length === 8) {
      onChangeText(normalizeDateInput(text) ?? text);
      return;
    }
    onChangeText(text);
  };

  return (
    <TextField
      {...rest}
      value={value}
      onChangeText={handleChange}
      onBlur={(e) => {
        const normalized = normalizeDateInput(value);
        if (normalized && normalized !== value) onChangeText(normalized);
        onBlur?.(e);
      }}
      keyboardType="number-pad"
      maxLength={10}
      placeholder={rest.placeholder ?? '예: 261012'}
      hint={hint ?? '숫자만 입력해도 돼요 (261012 → 2026-10-12)'}
    />
  );
}
