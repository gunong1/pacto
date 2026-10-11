/**
 * 금액의 역할 — 실제로 오가는 돈(결제)인지, 구성항목·합계·참고·면제·할인 금액인지
 *
 * 규칙 R1 roleOf — 목적: 결제로 만들지 않을 금액을 먼저 가른다 (모델의 role + 이름·문구)
 *   입력: 모델 금액 객체 · 이름 · 문구 / 출력: component | total | reference | waived | discount | payment(+할인 전 여부)
 *   예) role=total → 합계 / 일회성 "설치비 면제" → waived / 이름 "E규정 할인" → discount / "45,900원(할인전)" → 결제(할인 전 확인 필요)
 * 규칙 R2 componentsFromHint — 목적: role 없이 "…에 포함·…으로 구성"이라고 적힌 정기 금액을 더 큰 정기 금액의 구성으로
 * 규칙 R3 attachComponents — 목적: 구성항목을 상위 결제에 붙인다 (part_of 이름 → 같은 방향·주기 → 더 큰 금액). 상위가 없으면 참고 금액
 * 규칙 R4 aggregateTotals — 목적: 총액(보증금 등)과 그 몫(계약금·잔금)이 함께 결제로 오면 총액은 합계로 (paymentAggregate.ts)
 * 규칙 R5 foldComponents — 목적: 정기 금액의 구성항목(기본급·수당)이 총액(급여)과 함께 결제로 오면 구성으로 (paymentAggregate.ts)
 * 테스트: aggregate-payments.test.ts, discount-price.test.ts, extraction.test.ts, golden
 */
import { findAggregateTotals, foldRecurringComponents } from '../paymentAggregate.ts';
import { AMOUNT_ROLES, DIRECTIONS } from '../contractRegistry.ts';
import { COMPONENT_HINT, DISCOUNT_APPLIED, DISCOUNT_ITEM, PRE_DISCOUNT, WAIVED } from './keywords.ts';
import type { AppExtractionResult, ExtractedPayment } from './types.ts';
import { oneOf, text } from './values.ts';
import { FREQUENCIES } from './vocabulary.ts';

export interface PendingComponent {
  label: string;
  amount: number;
  partOf: string | null;
  direction: string | null;
  frequency: string | null;
}

export type Role =
  | { kind: 'component'; component: PendingComponent }
  | { kind: 'reference'; role: 'total' | 'reference' | 'waived' | 'discount' }
  | { kind: 'payment'; beforeDiscount: boolean };

export function roleOf(p: Record<string, unknown>, label: string, amount: number, said: string): Role {
  const role = oneOf(AMOUNT_ROLES, p.role);
  if (role === 'component') {
    return { kind: 'component', component: { label, amount, partOf: text(p.part_of, 40), direction: oneOf(DIRECTIONS, p.direction), frequency: oneOf(FREQUENCIES, p.frequency) } };
  }
  if (role === 'total' || role === 'reference') return { kind: 'reference', role };
  // 금액 문구(이름 + 원문)로 할인 전·할인액·면제를 가린다 — 모델이 결제로 보냈어도 결제로 만들지 않는다
  const beforeDiscount = p.price_basis === 'before_discount' || PRE_DISCOUNT.test(said);
  if (!beforeDiscount && p.frequency === 'one_time' && WAIVED.test(said)) return { kind: 'reference', role: 'waived' };
  if (!beforeDiscount && DISCOUNT_ITEM.test(label) && !DISCOUNT_APPLIED.test(label)) return { kind: 'reference', role: 'discount' };
  return { kind: 'payment', beforeDiscount };
}

export function componentsFromHint(payments: ExtractedPayment[], pending: PendingComponent[]): void {
  for (const p of [...payments]) {
    if (p.frequency === 'one_time' || !p.evidence?.some((e) => COMPONENT_HINT.test(e.quote))) continue;
    const parent = payments.find((x) => x !== p && x.direction === p.direction && x.frequency === p.frequency && x.amount > p.amount);
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

/** 총액(보증금·전세금·매매대금)과 그 몫이 함께 결제로 오면 총액은 합계(참고)로 — 같은 돈을 두 번 세지 않는다 (방향은 보지 않음) */
export function aggregateTotals(payments: ExtractedPayment[], references: AppExtractionResult['references']): void {
  for (const total of findAggregateTotals(payments)) {
    payments.splice(payments.indexOf(total), 1);
    references.push({ label: total.label, amount: total.amount, role: 'total' });
  }
}

/** 급여 1,270,000 = 기본급 1,200,000 + 식대·수당 70,000 → 실제 수입 일정은 급여 한 건, 기본급·수당은 급여의 구성 */
export function foldComponents(payments: ExtractedPayment[]): void {
  const folded = foldRecurringComponents(payments);
  payments.splice(0, payments.length, ...folded);
}
