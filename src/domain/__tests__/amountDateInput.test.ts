/**
 * 공통 금액·날짜 입력 규칙 (AmountField · DateField) — 보증금 반환 기록·결제 금액·구성항목·급여 지급 확정이 같은 규칙.
 * 표시는 천 단위 쉼표, 저장·계산은 쉼표 없는 정수 (parseAmount). 날짜는 숫자만 입력해도 YYYY-MM-DD.
 */
import { normalizeDateInput, isValidISODate } from '../dates';
import { AMOUNT_INPUT_MAX_DIGITS, formatAmountInput, formatAmountTyping, parseAmount } from '../money';

describe('금액 입력: 입력 즉시 천 단위 쉼표 · 값은 정확한 정수', () => {
  test('200000000 → "200,000,000" · 저장 값 200000000', () => {
    const { text } = formatAmountTyping('200000000');
    expect(text).toBe('200,000,000');
    expect(parseAmount(text)).toBe(200_000_000);
  });

  test('한 글자씩 입력해도 쉼표가 바로 생김', () => {
    let v = '';
    const shown: string[] = [];
    for (const ch of '1234567') {
      v = formatAmountTyping(v + ch).text;
      shown.push(v);
    }
    expect(shown).toEqual(['1', '12', '123', '1,234', '12,345', '123,456', '1,234,567']);
  });

  test('삭제: 끝에서 지우면 쉼표도 다시 맞춰짐 · 모두 지우면 빈 값(null)', () => {
    expect(formatAmountTyping('1,234,56').text).toBe('123,456');
    expect(formatAmountTyping('1,23').text).toBe('123');
    expect(formatAmountTyping('').text).toBe('');
    expect(parseAmount('')).toBeNull();
  });

  test('붙여넣기: "₩1,250,300원" · 공백·문자 섞여도 숫자만', () => {
    expect(formatAmountTyping('₩1,250,300원').text).toBe('1,250,300');
    expect(formatAmountTyping(' 2 000 000 ').text).toBe('2,000,000');
    expect(formatAmountTyping('abc').text).toBe('');
  });

  test('앞자리 0 제거 · 0 하나는 그대로', () => {
    expect(formatAmountTyping('0050000').text).toBe('50,000');
    expect(formatAmountTyping('0').text).toBe('0');
  });

  test('큰 금액: 15자리까지 정확 (부동소수 오차 없음) · 넘으면 더 입력되지 않음', () => {
    const max = '9'.repeat(AMOUNT_INPUT_MAX_DIGITS);
    expect(parseAmount(formatAmountTyping(max).text)).toBe(Number(max));
    expect(formatAmountTyping(max + '9').text).toBe(formatAmountTyping(max).text);
  });

  test('커서: 중간에 숫자를 넣거나 지워도 같은 숫자 뒤에 남음', () => {
    // "1,000|,000"(커서는 숫자 4개 뒤)에 5를 넣으면 입력 직후 문자열은 "1,0005|,000" → "10,005,000"에서 숫자 5개 뒤(6번째 칸)
    const ins = formatAmountTyping('1,0005,000', 6);
    expect(ins).toEqual({ text: '10,005,000', cursor: 6 });
    // "12,3|45"에서 3을 지움 → "12,|45" → "1,245" · 커서는 숫자 2개 뒤
    const del = formatAmountTyping('12,45', 3);
    expect(del).toEqual({ text: '1,245', cursor: 3 });
    // 끝에서 입력하면 커서도 끝
    expect(formatAmountTyping('12345', 5)).toEqual({ text: '12,345', cursor: 6 });
  });

  test('기존 저장 값 표시: 금액 → 입력값 → 다시 저장하면 같은 값', () => {
    for (const n of [0, 769_000, 20_000_000, 200_000_000]) expect(parseAmount(formatAmountTyping(formatAmountInput(n)).text)).toBe(n);
  });
});

describe('날짜 입력: 숫자만 입력해도 YYYY-MM-DD · 없는 날짜는 저장하지 않음', () => {
  test('261130 → 2026-11-30 · 20261130 → 2026-11-30 · 2026.11.30 → 2026-11-30', () => {
    expect(['261130', '20261130', '2026.11.30', '2026-11-30', '2026/11/30'].map(normalizeDateInput)).toEqual(Array(5).fill('2026-11-30'));
  });

  test('없는 날짜 · 덜 입력한 값 → null (기록 버튼 막힘)', () => {
    expect(['261131', '20260230', '2611', '2026-13-01', ''].map(normalizeDateInput)).toEqual([null, null, null, null, null]);
    expect(isValidISODate('2026-02-30')).toBe(false);
  });
});
