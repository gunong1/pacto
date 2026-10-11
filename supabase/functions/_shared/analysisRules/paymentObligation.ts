/**
 * 금액의 의무 수준 (confirmed · optional · conditional · potential · informational)
 *
 * 규칙 O1 obligationOf — 목적: 모델 판단을 쓰되, 확정으로 왔어도 조건·선택 단서가 있으면 낮춘다
 *   입력: 모델 금액 객체 · 이름 · 근거 문장 / 출력: { obligation, conditionNote }
 *   예) "회원권 양도 수수료"(확정으로 옴) → conditional / "(선택) 필터 교체" → optional
 * 규칙 O2 weakOptional — 목적: "이용 시 월 5,000원" 같은 부가 비용은 확정 결제가 따로 있을 때만 선택형
 *   입력: 결제 목록 / 출력: 해당 결제의 obligation = optional
 * 테스트: src/domain/__tests__/extraction.test.ts (헬스장), golden
 */
import { PAYMENT_OBLIGATIONS } from '../contractRegistry.ts';
import { CONDITIONAL_CLAUSE, CONDITIONAL_COST, OPTIONAL_STRONG, OPTIONAL_WEAK } from './keywords.ts';
import type { ExtractedPayment } from './types.ts';
import { oneOf, text } from './values.ts';

export function obligationOf(p: Record<string, unknown>, label: string, quote: string): Pick<ExtractedPayment, 'obligation' | 'conditionNote'> {
  let obligation = oneOf(PAYMENT_OBLIGATIONS, p.payment_obligation) ?? (p.optional === true ? 'optional' : 'confirmed');
  if (obligation === 'confirmed') {
    if (CONDITIONAL_COST.test(label) || CONDITIONAL_CLAUSE.test(quote)) obligation = 'conditional';
    else if (OPTIONAL_STRONG.test(label) || OPTIONAL_STRONG.test(quote)) obligation = 'optional';
  }
  const condition = text(p.condition, 100);
  return { obligation, conditionNote: obligation === 'confirmed' ? null : condition };
}

export function weakOptional(payments: ExtractedPayment[]): void {
  for (const p of payments) {
    const q = p.evidence?.[0]?.quote ?? '';
    if (p.obligation === 'confirmed' && OPTIONAL_WEAK.test(`${p.label} ${q}`) && payments.some((x) => x !== p && x.obligation === 'confirmed' && x.direction === p.direction && !OPTIONAL_WEAK.test(`${x.label} ${x.evidence?.[0]?.quote ?? ''}`))) {
      p.obligation = 'optional';
    }
  }
}
