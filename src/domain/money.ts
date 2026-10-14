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

/**
 * 읽기 쉬운 짧은 금액 (원 단위까지 정확히 유지): 43,500,000 → '4,350만원' · 722,581 → '72만 2,581원' · 230,000,000 → '2억 3,000만원'
 * 1만 원 미만은 그대로 '9,900원'. 반올림하지 않으므로 금액이 바뀌지 않는다.
 */
export function formatWonShort(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const n = Math.abs(Math.round(amount));
  if (n < 10_000) return `${sign}${withThousands(n)}원`;
  const eok = Math.floor(n / 100_000_000);
  const man = Math.floor((n % 100_000_000) / 10_000);
  const rest = n % 10_000;
  const parts = [eok > 0 ? `${withThousands(eok)}억` : null, man > 0 ? `${withThousands(man)}만` : null, rest > 0 ? withThousands(rest) : null].filter(Boolean);
  return `${sign}${parts.join(' ')}원`;
}

/**
 * 카드 너비에 맞는 금액 표기 — 전체('43,500,000원')가 들어가면 전체, 아니면 짧은 표기('4,350만원').
 * 글자 너비는 숫자 글꼴 평균(글자 크기 × 0.6)으로 어림한다 (fontScale: 기기 글자 크기 배율).
 */
export function wonForWidth(amount: number, width: number, fontSize: number, fontScale = 1): string {
  const full = formatWon(amount);
  if (width <= 0) return full;
  return textFits(full, width, fontSize, fontScale) ? full : formatWonShort(amount);
}

/** 글자 폭 어림 (숫자·한글 평균 = 글자 크기 × 0.6, 한글은 글자 크기만큼) — 카드 배치 결정용 */
export function textFits(text: string, width: number, fontSize: number, fontScale = 1): boolean {
  const units = [...text].reduce((s, ch) => s + (/[가-힣]/.test(ch) ? 1 : 0.6), 0);
  return units * fontSize * fontScale <= width;
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
