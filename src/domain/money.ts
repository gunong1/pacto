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
