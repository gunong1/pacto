/**
 * 금액의 의무 수준 (confirmed · optional · conditional) — 새 분석은 potential을 conditional로 합친다
 *
 * 원칙: AI가 확정(confirmed)으로 답한 금액은 서버가 뒤집을 강한 근거가 있을 때만 낮춘다.
 *       단어는 "그 금액의 이름" 또는 "같은 구절에서 그 금액 바로 앞" 범위에서만 본다 (근거 문장 전체의 단어로 다른 금액을 낮추지 않음).
 *
 * 규칙 O1 obligationOf — 입력: 모델 금액 객체 · 이름 · 금액 · 근거 문장 / 출력: { obligation, conditionNote }
 *   예) "월 렌탈료 31,900원 … 연체 시 연체료 부과" → 월 렌탈료는 confirmed (연체 단서는 금액 뒤 다른 구절)
 *       "연체 시 연체료 1,000원" → conditional / 이름 "회원권 양도 수수료" → conditional
 *       "(선택) 필터 교체 9,900원" → optional / "보험료 1,200,000원 (특약 포함)" → confirmed ("특약"은 단서 아님)
 *       AI가 potential로 답함 → conditional
 * 규칙 O2 weakOptional — "락커 이용 시 월 5,000원"처럼 금액 바로 앞에 "이용 시"가 있는 부가 비용은,
 *   같은 방향의 더 큰 확정 결제(본 요금)가 따로 있을 때만 선택형
 *   예) "월 이용료 59,000원은 이용 시 매월 10일 결제" → "이용 시"가 금액 뒤 → 본 요금, 확정 유지
 * 테스트: payment-obligation.test.ts, golden
 */
import { PAYMENT_OBLIGATIONS } from '../contractRegistry.ts';
import { clauseBefore, CONDITIONAL_CLAUSE, CONDITIONAL_COST, OPTIONAL_STRONG, OPTIONAL_WEAK } from './keywords.ts';
import type { ExtractedPayment } from './types.ts';
import { oneOf, text } from './values.ts';

export function obligationOf(p: Record<string, unknown>, label: string, amount: number, quote: string): Pick<ExtractedPayment, 'obligation' | 'conditionNote'> {
  let obligation = oneOf(PAYMENT_OBLIGATIONS, p.payment_obligation) ?? (p.optional === true ? 'optional' : 'confirmed');
  if (obligation === 'potential') obligation = 'conditional';
  if (obligation === 'confirmed') {
    const before = clauseBefore(quote, amount) ?? '';
    if (CONDITIONAL_COST.test(label) || CONDITIONAL_CLAUSE.test(before)) obligation = 'conditional';
    else if (OPTIONAL_STRONG.test(label) || OPTIONAL_STRONG.test(before)) obligation = 'optional';
  }
  const condition = text(p.condition, 100);
  return { obligation, conditionNote: obligation === 'confirmed' ? null : condition };
}

export function weakOptional(payments: ExtractedPayment[]): void {
  const cue = (p: ExtractedPayment) => OPTIONAL_WEAK.test(p.label) || OPTIONAL_WEAK.test(clauseBefore(p.evidence?.[0]?.quote ?? '', p.amount) ?? '');
  for (const p of payments) {
    if (p.obligation !== 'confirmed' || !cue(p)) continue;
    if (payments.some((x) => x !== p && x.obligation === 'confirmed' && x.direction === p.direction && x.amount > p.amount && !cue(x))) p.obligation = 'optional';
  }
}
