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

/**
 * 정기 금액의 구성항목 — 같은 주기·같은 방향의 정기 금액 중 하나(총액)가 다른 금액 2개 이상의 합과 정확히 같으면,
 * 그 금액들은 총액의 구성항목이다 (예: 급여 1,270,000 = 기본급 1,200,000 + 식대·수당 70,000).
 * 실제 일정은 총액 한 건만 — 구성항목을 따로 수입·지출 일정으로 만들면 같은 돈을 두 번 센다.
 *
 * 애매하면 건드리지 않는다: 금액이 정확히 맞고, 다음 중 하나일 때만
 *  - 구성항목에는 지급일이 없고 총액에만 지급일이 있다 (계약서에서 총액에만 지급일이 붙어 있는 경우)
 *  - 총액 이름이 합계를 뜻한다 (급여·월급·임금·보수·합계·총 …)
 */
export const RECURRING_TOTAL_LABEL = /급여|월급|임금|보수|합계|총액|총 |총계|월 지급액|실수령/;

export interface ComponentCandidate extends AggregateCandidate {
  direction?: string | null;
  dayOfMonth?: number | null;
}

const isRecurringConfirmed = (p: AggregateCandidate) => p.frequency !== 'one_time' && (p.obligation ?? 'confirmed') === 'confirmed';

/** 합이 정확히 target인 부분집합 (항목 수가 적을 때만 — 많으면 찾지 않음) */
function exactSubset<T extends { amount: number }>(items: readonly T[], target: number): T[] | null {
  if (items.length > 10) return null;
  const all = items.reduce((s, p) => s + p.amount, 0);
  if (all === target && items.length >= 2) return [...items];
  let best: T[] | null = null;
  for (let mask = 1; mask < 1 << items.length; mask++) {
    const pick = items.filter((_, i) => mask & (1 << i));
    if (pick.length < 2) continue;
    if (pick.reduce((s, p) => s + p.amount, 0) === target && (!best || pick.length > best.length)) best = pick;
  }
  return best;
}

/** 총액과 그 구성항목 묶음 (구성항목은 한 총액에만) */
export function findRecurringComponents<T extends ComponentCandidate>(payments: readonly T[]): { total: T; parts: T[] }[] {
  const pool = payments.filter((p) => isRecurringConfirmed(p) && p.amount > 0);
  // 지급일이 있는 금액·큰 금액부터 총액 후보
  const totals = [...pool].sort((a, b) => Number(b.dayOfMonth != null) - Number(a.dayOfMonth != null) || b.amount - a.amount);
  const used = new Set<T>();
  const groups: { total: T; parts: T[] }[] = [];
  for (const total of totals) {
    if (used.has(total)) continue;
    const others = pool.filter((p) => p !== total && !used.has(p) && p.frequency === total.frequency && (p.direction ?? null) === (total.direction ?? null) && p.amount < total.amount);
    const parts = exactSubset(others, total.amount);
    if (!parts) continue;
    const dayOnlyOnTotal = total.dayOfMonth != null && parts.every((p) => p.dayOfMonth == null);
    if (!dayOnlyOnTotal && !RECURRING_TOTAL_LABEL.test(total.label)) continue;
    used.add(total);
    for (const p of parts) used.add(p);
    groups.push({ total, parts });
  }
  return groups;
}

/** 구성항목을 총액의 components로 옮기고 목록에서 뺀다 (순서 유지, 같은 이름의 구성항목은 한 번만) */
export function foldRecurringComponents<T extends ComponentCandidate & { components: { label: string; amount: number }[] }>(payments: readonly T[]): T[] {
  const groups = findRecurringComponents(payments);
  if (groups.length === 0) return [...payments];
  const parts = new Set(groups.flatMap((g) => g.parts));
  return payments
    .filter((p) => !parts.has(p))
    .map((p) => {
      const g = groups.find((x) => x.total === p);
      if (!g) return p;
      const components = [...p.components];
      for (const part of g.parts) if (!components.some((c) => c.label === part.label)) components.push({ label: part.label, amount: part.amount });
      return { ...p, components };
    });
}
