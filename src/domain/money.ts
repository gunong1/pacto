function withThousands(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** '₩1,250,300' */
export function formatKRW(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}₩${withThousands(Math.abs(amount))}`;
}

/** '39,900원' */
export function formatWon(amount: number): string {
  return `${withThousands(amount)}원`;
}

/** 3억, 1,200만 원 같은 큰 금액(보증금 등) 표기. */
export function formatWonCompact(amount: number): string {
  if (amount >= 100_000_000) {
    const eok = Math.floor(amount / 100_000_000);
    const man = Math.floor((amount % 100_000_000) / 10_000);
    return man > 0 ? `${eok}억 ${withThousands(man)}만원` : `${eok}억원`;
  }
  if (amount >= 10_000 && amount % 10_000 === 0) return `${withThousands(amount / 10_000)}만원`;
  return formatWon(amount);
}

/** 입력 문자열에서 숫자만 추출 ('1,250,300원' → 1250300). 비어 있으면 null. */
export function parseAmount(input: string): number | null {
  const digits = input.replace(/[^\d]/g, '');
  return digits.length === 0 ? null : Number(digits);
}

export function formatAmountInput(amount: number | null): string {
  return amount == null ? '' : withThousands(amount);
}

/** 금액 입력 최대 자릿수 — 정수 원을 정확히 다룰 수 있는 범위 (Number.MAX_SAFE_INTEGER 16자리 미만) */
export const AMOUNT_INPUT_MAX_DIGITS = 15;

/**
 * 입력 중인 금액 문자열 → 천 단위 쉼표 표시 + 커서 위치 (공통 금액 입력 AmountField).
 * - 숫자만 남긴다 (붙여넣은 "₩1,250,300원"·공백·문자도 숫자만) · 앞자리 0 제거 ("007" → "7", "0"은 그대로) · 최대 15자리
 * - cursor: 원래 문자열에서 커서 앞에 있던 숫자 개수를 그대로 유지하는 위치 (쉼표가 생기거나 없어져도 같은 숫자 뒤)
 * - 값(parseAmount)은 쉼표 없는 정수 — 저장·계산은 그 값으로
 */
export function formatAmountTyping(raw: string, cursor: number = raw.length): { text: string; cursor: number } {
  const digitsBefore = raw.slice(0, Math.max(0, Math.min(cursor, raw.length))).replace(/\D/g, '').length;
  let digits = raw.replace(/\D/g, '');
  const lead = digits.length - digits.replace(/^0+(?=\d)/, '').length;
  digits = digits.slice(lead).slice(0, AMOUNT_INPUT_MAX_DIGITS);
  if (digits.length === 0) return { text: '', cursor: 0 };
  const text = withThousands(Number(digits));
  const want = Math.min(Math.max(0, digitsBefore - lead), digits.length);
  let seen = 0;
  let pos = 0;
  while (pos < text.length && seen < want) {
    if (/\d/.test(text[pos])) seen += 1;
    pos += 1;
  }
  return { text, cursor: pos };
}
