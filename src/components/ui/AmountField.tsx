/**
 * 공통 금액 입력 — 입력하는 즉시 천 단위 쉼표 ("200000000" → "200,000,000"). 값은 문자열로 주고받고,
 * 저장·계산은 parseAmount(value)로 쉼표 없는 정수를 쓴다 (규칙: domain/money.ts formatAmountTyping).
 * - 붙여넣기("₩1,250,300원")·삭제·빈 값·15자리까지 처리 · 쉼표가 생기거나 없어져도 커서는 같은 숫자 뒤에
 * - 숫자 키패드 (number-pad)
 */
import { useRef, useState } from 'react';
import type { NativeSyntheticEvent, TextInputSelectionChangeEventData } from 'react-native';

import { formatAmountTyping } from '@/domain/money';

import { TextField, type TextFieldProps } from './controls';

export interface AmountFieldProps extends Omit<TextFieldProps, 'value' | 'onChangeText' | 'keyboardType'> {
  value: string;
  onChangeText: (value: string) => void;
}

export function AmountField({ value, onChangeText, onSelectionChange, ...rest }: AmountFieldProps) {
  // 마지막으로 알려진 커서 (입력 전). 바뀐 길이만큼 옮긴 위치를 원래 문자열의 커서로 본다
  const caret = useRef<number>(value.length);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(undefined);
  return (
    <TextField
      {...rest}
      value={value}
      keyboardType="number-pad"
      selection={selection}
      onSelectionChange={(e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
        caret.current = e.nativeEvent.selection.end;
        if (selection) setSelection(undefined);
        onSelectionChange?.(e);
      }}
      onChangeText={(raw) => {
        const rawCursor = Math.min(raw.length, Math.max(0, caret.current + (raw.length - value.length)));
        const next = formatAmountTyping(raw, rawCursor);
        onChangeText(next.text);
        caret.current = next.cursor;
        // 커서가 끝이 아니면(중간 수정) 같은 숫자 뒤로 되돌린다 — 끝이면 기본 동작 그대로
        setSelection(next.cursor < next.text.length ? { start: next.cursor, end: next.cursor } : undefined);
      }}
    />
  );
}
