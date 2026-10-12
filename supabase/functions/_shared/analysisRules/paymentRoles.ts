/**
 * 금액의 역할 — 실제로 오가는 돈(결제)인지, 구성항목·총액·참고·면제·할인·할인 전 금액인지
 *
 * 원칙: 금액을 발견했다고 결제로 만들지 않는다. 결제가 아닌 금액은 참고 금액(references)으로만 보관하고
 *       홈·캘린더·알림 계산에는 넣지 않는다. 판단은 서버 한 곳(이 파일)에서만 한다.
 *
 * 규칙 R1 roleOf — 입력: 모델 금액 객체 · 이름 · 금액 · 근거 / 출력: component | total | reference(종류) | payment(할인 전 여부)
 *   예) role=waived · 0원 · (일회성·참고 금액인데 "면제·무료·무상") → 면제
 *       role=reference + price_basis=before_discount 또는 "45,900원(할인전)" → 할인 전
 *       AI가 informational(참고)로 답함 → 참고 금액 (결제로 저장하지 않음)
 *       이름 "E규정 할인" → 할인액 / role=total → 총액
 *       "31,900원(할인전 45,900원)"의 31,900 → 결제 (할인전은 45,900에 붙은 말)
 * 규칙 R2 namedParentComponents — 결제의 근거 문장이 더 큰 다른 결제를 "이름으로" 가리키며 포함·구성을 말할 때만 그 결제의 구성항목
 *   예) "고정연장근로수당 320,000원은 월 임금에 포함된다" + 월 임금 3,600,000 → 월 임금의 구성항목
 *       "관리비 월 70,000원 ※ 수도·공용전기 등 포함" + 월세 700,000 → 별개 결제 (월세를 가리키지 않음)
 * 규칙 R3 attachComponents — 구성항목(role=component)을 상위 결제에 붙인다 (part_of 이름 → 같은 방향·주기 → 더 큰 금액). 상위가 없으면 참고 금액
 *   ("…에 포함", "…으로 구성" 같은 단어만으로 다른 금액을 구성항목으로 합치지 않는다: 관리비(수도 포함)는 월세와 별개 결제)
 * 규칙 R4 totals — 총액은 계약 요약 칸(보증금·계약 총액) 하나에 담는다. 이미 다른 값이 있으면 참고 금액(총액)으로
 *   총액 판정: role=total, 또는 총액과 그 몫(계약금·중도금·잔금)이 함께 결제로 오면 (paymentAggregate.ts, 금액이 정확히 맞을 때만)
 * 규칙 R5 foldComponents — 정기 금액의 구성항목(기본급·수당)이 총액(급여)과 함께 결제로 오면 구성으로 (합이 정확히 맞을 때만)
 * 규칙 R6 preDiscountSiblings — 할인 전 금액과 실제(할인 적용) 금액이 함께 결제로 오면 할인 전 금액은 참고 금액(할인 전).
 *   실제 금액이 없으면 결제로 두되 금액을 비워 사용자가 실제 결제액을 입력하게 한다 (자동으로 빼서 계산하지 않음)
 * 규칙 R7 installmentParents — 나눠 내는 몫(계약금·중도금·잔금·착수금)은 이름이 아니라 상위 금액(총액)과의 관계로 성격을 정한다
 *   ① 의미 관계(필수): 몫의 이름·근거 문장이 상위 금액을 가리킨다 (보증금 → "보증금·전세금", 그 밖 → 상위 금액 이름)
 *   ② 합계 일치(보조 검증): 몫들의 합이 상위 금액(총액·role=total·보증금 칸)과 정확히 같다 (paymentAggregate.partsOfTotal)
 *   둘 다 맞을 때만 바꾼다 — 합만 맞는 일반 계약금(보증금 언급 없음)은 그대로:
 *   보증금(총액 또는 계약 요약 칸)의 몫 → 보증금 자금 이동(neutral): 월 지출에서 빠지고 지급 일정은 각각 유지
 *   매매대금·용역대금 등의 몫 → 그 금액의 방향(지출·수입)을 따른다. 상위 금액을 알 수 없으면 그대로 둔다
 *   예) 보증금 20,000,000 = 계약금 2,000,000(계약 당일) + 잔금 18,000,000(10-20) → 둘 다 neutral, 월 지출은 월세·관리비만
 * 테스트: payment-roles.test.ts, aggregate-payments.test.ts, discount-price.test.ts, golden (paymentParts.test.ts)
 */
import { findAggregateTotals, foldRecurringComponents, partsOfTotal } from '../paymentAggregate.ts';
import { AMOUNT_ROLES, DIRECTIONS, PAYMENT_OBLIGATIONS } from '../contractRegistry.ts';
import { DISCOUNT_APPLIED, DISCOUNT_ITEM, isPreDiscountAmount, PRE_DISCOUNT, WAIVED } from './keywords.ts';
import type { AppExtractionResult, Extracted, ExtractedPayment, ReferenceRole } from './types.ts';
import { oneOf, text } from './values.ts';
import { FREQUENCIES } from './vocabulary.ts';

export interface PendingComponent {
  label: string;
  amount: number;
  partOf: string | null;
  direction: string | null;
  frequency: string | null;
}

export interface TotalAmount {
  label: string;
  amount: number;
  deposit: boolean;
  /** 상위 금액의 방향 (모델 답) — 몫의 방향을 정할 때 (보증금은 늘 neutral) */
  direction?: string | null;
  evidence?: Extracted['evidence'];
}

export type Role =
  | { kind: 'component'; component: PendingComponent }
  | { kind: 'total'; deposit: boolean; direction: string | null }
  | { kind: 'reference'; role: Exclude<ReferenceRole, 'total'> }
  | { kind: 'payment'; beforeDiscount: boolean };

const isDeposit = (kind: unknown, label: string) => kind === 'deposit' || /보증금|전세금/.test(label);

export function roleOf(p: Record<string, unknown>, label: string, amount: number, quote: string, said: string): Role {
  const role = oneOf(AMOUNT_ROLES, p.role);
  if (role === 'component') {
    return { kind: 'component', component: { label, amount, partOf: text(p.part_of, 40), direction: oneOf(DIRECTIONS, p.direction), frequency: oneOf(FREQUENCIES, p.frequency) } };
  }
  if (role === 'total') return { kind: 'total', deposit: isDeposit(p.kind, label), direction: oneOf(DIRECTIONS, p.direction) };
  const beforeDiscount = p.price_basis === 'before_discount' || PRE_DISCOUNT.test(label) || isPreDiscountAmount(quote, amount);
  const oneTime = p.frequency === 'one_time';
  // 면제: AI가 waived로 답함 · 0원 · 참고 금액/일회성 금액인데 문구가 "면제·무료·무상"
  if (role === 'waived' || amount === 0) return { kind: 'reference', role: 'waived' };
  const informational = role === 'reference' || oneOf(PAYMENT_OBLIGATIONS, p.payment_obligation) === 'informational';
  if (!beforeDiscount && (informational || oneTime) && WAIVED.test(said)) return { kind: 'reference', role: 'waived' };
  if (informational) return { kind: 'reference', role: beforeDiscount ? 'before_discount' : 'reference' };
  if (!beforeDiscount && DISCOUNT_ITEM.test(label) && !DISCOUNT_APPLIED.test(label)) return { kind: 'reference', role: 'discount' };
  return { kind: 'payment', beforeDiscount };
}

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function namedParentComponents(payments: ExtractedPayment[], pending: PendingComponent[]): void {
  for (const p of [...payments]) {
    if (p.frequency === 'one_time') continue;
    const quote = (p.evidence ?? []).map((e) => e.quote).join(' ');
    const parent = payments.find(
      (x) => x !== p && x.direction === p.direction && x.frequency === p.frequency && x.amount > p.amount &&
        new RegExp(`${escapeRe(x.label)}\\s*(?:에|에는|에\\s*이미)\\s*포함|${escapeRe(x.label)}[은는이가]?\\s*[^.]{0,30}(?:으로|로)\\s*구성`).test(quote),
    );
    if (!parent) continue;
    payments.splice(payments.indexOf(p), 1);
    pending.push({ label: p.label, amount: p.amount, partOf: parent.label, direction: p.direction, frequency: p.frequency });
  }
}

export function attachComponents(payments: ExtractedPayment[], pending: readonly PendingComponent[], references: AppExtractionResult['references']): void {
  for (const c of pending) {
    const recurring = payments.filter((x) => x.frequency !== 'one_time' && x.amount > c.amount);
    const parent =
      recurring.find((x) => c.partOf && (x.label.includes(c.partOf) || c.partOf.includes(x.label))) ??
      recurring.find((x) => (!c.direction || x.direction === c.direction) && (!c.frequency || x.frequency === c.frequency)) ??
      null;
    if (parent && parent.components.length < 10 && !parent.components.some((x) => x.label === c.label)) parent.components.push({ label: c.label, amount: c.amount });
    else if (!parent) references.push({ label: c.label, amount: c.amount, role: 'reference' });
  }
}

/** 총액과 그 몫(계약금·잔금)이 함께 결제로 오면 총액을 결제에서 뺀다 (방향은 보지 않음 — 모델이 보증금은 neutral, 계약금은 expense처럼 달리 답해도 같은 돈) */
export function aggregateTotals(payments: ExtractedPayment[], totals: TotalAmount[]): void {
  for (const total of findAggregateTotals(payments)) {
    payments.splice(payments.indexOf(total), 1);
    totals.push({ label: total.label, amount: total.amount, deposit: isDeposit(total.kind, total.label), direction: total.direction, evidence: total.evidence });
  }
}

/** 총액 → 계약 요약 칸 (보증금 · 계약 총액). 칸에 다른 값이 이미 있으면 참고 금액(총액)으로 */
export function totalsToFields(totals: readonly TotalAmount[], fields: Record<string, Extracted>, references: AppExtractionResult['references']): void {
  for (const t of totals) {
    const key = t.deposit ? 'depositAmount' : 'totalAmount';
    const cur = fields[key]?.value;
    if (cur == null) fields[key] = { value: t.amount, confidence: 'high', ...(t.evidence ? { evidence: t.evidence } : {}) };
    else if (cur !== t.amount) references.push({ label: t.label, amount: t.amount, role: 'total' });
  }
}

/** R7 — 몫의 성격은 상위 금액을 따른다 (보증금 칸 값도 상위 금액으로 본다) */
const DEPOSIT_WORD = /보증금|전세금/;

/** 의미 관계: 몫의 이름·근거 문장이 상위 금액을 가리키는가 (보증금은 "보증금·전세금", 그 밖은 상위 금액 이름) */
export function isPartOf(p: Pick<ExtractedPayment, 'label' | 'evidence'>, parent: { deposit: boolean; label: string }): boolean {
  const said = [p.label, ...(p.evidence ?? []).map((e) => e.quote)].join(' ');
  if (parent.deposit) return DEPOSIT_WORD.test(said);
  const name = parent.label.replace(/\s+/g, '');
  return name.length >= 2 && !/^(총액|합계|금액)$/.test(name) && said.replace(/\s+/g, '').includes(name);
}

export function installmentParents(payments: ExtractedPayment[], totals: readonly TotalAmount[], depositAmount: unknown): void {
  const parents: { amount: number; deposit: boolean; direction: string | null; label: string }[] = [
    ...totals.map((t) => ({ amount: t.amount, deposit: t.deposit, direction: t.direction ?? null, label: t.label })),
    ...(typeof depositAmount === 'number' && !totals.some((t) => t.deposit && t.amount === depositAmount) ? [{ amount: depositAmount, deposit: true, direction: 'neutral', label: '보증금' }] : []),
  ].sort((a, b) => Number(b.deposit) - Number(a.deposit));
  const done = new Set<ExtractedPayment>();
  for (const parent of parents) {
    const parts = partsOfTotal(payments.filter((p) => !done.has(p)), parent.amount);
    // 합이 맞아도 몫 모두가 그 상위 금액의 일부라는 근거가 있어야 한다 (합계는 보조 조건)
    if (!parts.length || !parts.every((p) => isPartOf(p, parent))) continue;
    for (const p of parts) {
      done.add(p);
      if (parent.deposit) p.direction = 'neutral';
      else if (parent.direction === 'expense' || parent.direction === 'income') p.direction = parent.direction;
    }
  }
}

/** 급여 1,270,000 = 기본급 1,200,000 + 식대·수당 70,000 → 실제 수입 일정은 급여 한 건, 기본급·수당은 급여의 구성 */
export function foldComponents(payments: ExtractedPayment[]): void {
  const folded = foldRecurringComponents(payments);
  payments.splice(0, payments.length, ...folded);
}

export function preDiscountSiblings(payments: ExtractedPayment[], references: AppExtractionResult['references']): void {
  for (const p of [...payments]) {
    if (p.amountCheck !== 'discount_unconfirmed') continue;
    const actual = payments.some((x) => x !== p && x.amountCheck !== 'discount_unconfirmed' && x.frequency === p.frequency && x.direction === p.direction && x.amount < p.amount);
    if (!actual) continue;
    payments.splice(payments.indexOf(p), 1);
    references.push({ label: p.label, amount: p.amount, role: 'before_discount' });
  }
}
