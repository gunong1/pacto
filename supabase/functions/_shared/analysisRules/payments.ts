/**
 * 금액 → 결제 목록 + 결제가 아닌 금액(참고 금액) + 총액 — 금액 규칙을 정해진 순서로 적용한다.
 * 순서: 역할(R1) → 날짜(PD1) → 의무 수준(O1) → 지급일 안전장치(PD2) → 문구의 첫 결제 날짜로 결제일(PD4) → 선택형(O2) → 일시불(PD3)
 *       → 구성항목(R2·R3) → 총액(R4) → 구성 묶기(R5) → 할인 전(R6)
 * 조건부 비용(위약금·연체료 등)은 여기서 결제로 남겨 두고, 계약 체크로 옮기는 일은 checks.ts(C4)가 한다.
 */
import { extractDepositReturns, type DepositReturn } from './depositReturn.ts';
import { BUSINESS_DAY_RULES, DIRECTIONS, PARTY_ROLE_CODES, PAYMENT_KIND_CODES, PAYMENT_KIND_DEFS } from '../contractRegistry.ts';
import { INSTALLMENT_PART } from '../paymentAggregate.ts';
import { obligationOf, weakOptional } from './paymentObligation.ts';
import { dayFromOwnDate, guardIncomePayday, lumpSum, resolvePaymentDate } from './paymentDates.ts';
import { aggregateTotals, attachComponents, foldComponents, namedParentComponents, preDiscountSiblings, roleOf, type PendingComponent, type TotalAmount } from './paymentRoles.ts';
import type { AppExtractionResult, ExtractedDate, ExtractedPayment } from './types.ts';
import { quoteContradictsAmount } from './evidenceCheck.ts';
import { confidenceOf, isObj, MAX_AMOUNT, oneOf, quoteOf, sourceOf, text, toInt, validDate } from './values.ts';
import { FREQUENCIES } from './vocabulary.ts';

export interface BuiltPayments {
  payments: ExtractedPayment[];
  references: AppExtractionResult['references'];
  /** 총액 — 계약 요약 칸(보증금·계약 총액)으로 옮긴다 (totalsToFields) */
  totals: TotalAmount[];
  /** 보증금 반환 — 결제에서 뺀 금액 (총액·몫 규칙보다 먼저: 반환 예정액이 보증금 총액으로 잘못 묶이지 않게) */
  depositReturns: DepositReturn[];
}

export function buildPayments(raw: unknown, dates: readonly ExtractedDate[]): BuiltPayments {
  const payments: ExtractedPayment[] = [];
  const pending: PendingComponent[] = [];
  const references: AppExtractionResult['references'] = [];
  const totals: TotalAmount[] = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    if (!isObj(p) || payments.length >= 20) continue;
    const amount = toInt(p.amount, 0, MAX_AMOUNT);
    if (amount === null) continue;
    const label = text(p.label, 40) ?? '결제';
    const evidence = quoteOf(p).evidence;
    const quote = evidence?.[0]?.quote ?? '';
    const said = `${label} ${(evidence ?? []).map((e) => e.quote).join(' ')}`;
    const role = roleOf(p, label, amount, quote, said);
    if (role.kind === 'component') {
      pending.push(role.component);
      continue;
    }
    if (role.kind === 'total') {
      totals.push({ label, amount, deposit: role.deposit, direction: role.direction, evidence });
      continue;
    }
    if (role.kind === 'reference') {
      references.push({ label, amount, role: role.role });
      continue;
    }
    const frequency = oneOf(FREQUENCIES, p.frequency);
    if (frequency === null) continue;
    const oneTime = frequency === 'one_time';
    const kind = oneOf(PAYMENT_KIND_CODES, p.kind) ?? 'other';
    const { date, dateSource } = resolvePaymentDate(validDate(p.date) ? p.date.trim() : null, p.date_source, quote, dates);
    if (payments.some((x) => x.kind === kind && x.amount === amount && x.frequency === frequency && x.date === date)) continue;
    const kindDefault = PAYMENT_KIND_DEFS.find((k) => k.code === kind)?.direction ?? 'expense';
    payments.push({
      kind,
      direction: oneOf(DIRECTIONS, p.direction) ?? kindDefault,
      label,
      amount,
      frequency,
      dayOfMonth: oneTime ? null : toInt(p.day_of_month, 1, 31),
      date,
      dateSource,
      endDate: !oneTime && validDate(p.end_date) ? p.end_date.trim() : null,
      installmentCount: oneTime ? null : toInt(p.installment_count, 1, 600),
      isVariable: p.is_variable === true,
      ...obligationOf(p, label, amount, quote),
      // "최대·한도·이내" 금액은 확정 금액이 아니다 — 확정 결제로 두지 않고 조건부(실제 금액 확인)로
      ...(p.price_basis === 'max' && obligationOf(p, label, amount, quote).obligation === 'confirmed' ? { obligation: 'conditional' as const, conditionNote: text(p.condition, 80) ?? '최대 금액 — 실제 금액 확인 필요' } : {}),
      components: [],
      // 할인 전(정상가) 금액: 실제 결제액이 아니므로 확정하지 않고 사용자 확인을 받는다 (자동으로 빼서 계산하지 않음)
      amountCheck: role.beforeDiscount ? 'discount_unconfirmed' : null,
      businessDayRule: oneTime ? 'none' : (oneOf(BUSINESS_DAY_RULES, p.business_day_rule) ?? 'none'),
      // 근거 문장의 금액과 다르면 값은 그대로 두고 확인 필요로 (evidenceCheck.ts)
      confidence: (evidence ?? []).some((e) => quoteContradictsAmount(amount, e.quote)) ? 'low' : confidenceOf(p.confidence),
      sourceType: sourceOf(p.source_type),
      ...(evidence ? { evidence } : {}),
      // 계약서가 지급자·수령자를 밝힌 경우만 (근거 문장이 있을 때 — 없으면 계약 종류의 기본 흐름)
      payerRole: evidence ? (oneOf(PARTY_ROLE_CODES, p.payer_role) ?? null) : null,
      payeeRole: evidence ? (oneOf(PARTY_ROLE_CODES, p.payee_role) ?? null) : null,
      // 나눠 내는 몫의 상위 금액 (AI가 계약서 구조로 답한 이름) — 의미 관계 근거로만 (installmentParents)
      ...(INSTALLMENT_PART.test(label) && text(p.part_of, 40) ? { partOf: text(p.part_of, 40) } : {}),
    });
  }
  const depositReturns = extractDepositReturns(payments);
  guardIncomePayday(payments, dates);
  dayFromOwnDate(payments);
  weakOptional(payments);
  lumpSum(payments);
  namedParentComponents(payments, pending);
  attachComponents(payments, pending, references);
  aggregateTotals(payments, totals);
  foldComponents(payments);
  preDiscountSiblings(payments, references);
  return { payments, references, totals, depositReturns };
}
