/**
 * 총액(aggregate) ≠ 실제 지급(scheduled payment) — 앱·서버 공용 규칙 (순수 함수, 외부 의존 없음).
 *
 * 계약서의 총액(보증금·전세금·매매대금·총 계약금액 …)이 계약금·중도금·잔금·착수금처럼 나눠 내는 몫으로 분해되어 있으면
 * 총액은 정보 표시용 합계이고, 실제로 오가는 돈은 나눠 내는 몫뿐이다. 총액을 결제로 또 넣으면 같은 돈을 두 번 센다.
 *   보증금 20,000,000 = 계약금 2,000,000 + 잔금 18,000,000            → 보증금은 합계
 *   총 계약금액 10,000,000 = 착수금 3,000,000 + 중도금 3,000,000 + 잔금 4,000,000 → 총 계약금액은 합계
 *
 * 판단: 일회성·확정 금액 중, 나눠 내는 몫 이름이 아닌 금액이 나눠 내는 몫(2개 이상, 일회성·확정)의 합과 정확히 같으면 합계.
 * 금액이 정확히 맞을 때만 — 애매하면 건드리지 않는다.
 */

/** 나눠 내는 몫의 이름 ("총 계약금액"의 계약금액은 총액이라 제외) */
export const INSTALLMENT_PART = /계약금(?!액)|중도금|잔금|착수금|선금|선급금|중간금|잔여금/;

export interface AggregateCandidate {
  label: string;
  amount: number;
  frequency: string;
  obligation?: string | null;
}

const isOneTimeConfirmed = (p: AggregateCandidate) => p.frequency === 'one_time' && (p.obligation ?? 'confirmed') === 'confirmed';

/** 합계(총액)로 볼 결제들 — 같은 목록 안의 나눠 내는 몫으로 이미 지급이 표현된 것 */
export function findAggregateTotals<T extends AggregateCandidate>(payments: readonly T[]): T[] {
  const parts = payments.filter((p) => isOneTimeConfirmed(p) && INSTALLMENT_PART.test(p.label));
  if (parts.length < 2) return [];
  return payments.filter((total) => {
    if (!isOneTimeConfirmed(total) || INSTALLMENT_PART.test(total.label) || total.amount <= 0) return false;
    // 나눠 내는 몫 전체의 합, 또는 같은 총액을 이루는 몫들(작은 금액만)의 합
    const sum = parts.reduce((s, p) => s + p.amount, 0);
    if (sum === total.amount) return true;
    const smaller = parts.filter((p) => p.amount < total.amount);
    return smaller.length >= 2 && smaller.reduce((s, p) => s + p.amount, 0) === total.amount;
  });
}

/** 합계로 바꾼 금액의 안내 문구 (상세 화면 · 저장 데이터 정리) */
export const AGGREGATE_NOTE = '총액 — 계약금·잔금 등으로 나눠 지급';
