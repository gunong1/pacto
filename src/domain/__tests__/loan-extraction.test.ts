/**
 * 대출 계약 서버 정리 규칙 (analysisRules/loan.ts — toAppResult 경유). 모든 값은 가짜
 * 재현: 만기일시 가계대출 — AI가 실행금 3,000만원을 결제로, 회차별 이자를 결제 여러 개로, 본문·상환일정표의 원금 상환을 두 번 답한 경우
 */
import { toAppResult } from '../../../supabase/functions/_shared/extraction.ts';
import { draftToRecord } from '@/data/draft';
import { toReviewModel } from '@/features/registration/extraction';

import { withConfirmedRole } from '../cashflow';
import { scheduleForRange } from '../schedule';
import { monthSpending } from '../spending';
import * as F from './golden/fixtures';

const q = (quote: string | null) => ({ evidence_quote: quote, evidence_page: quote ? 1 : null, evidence_file: quote ? 1 : null });
const pay = (p: Record<string, unknown>) => ({
  role: 'one_time_cashflow', price_basis: 'actual', part_of: null, day_of_month: null, date: null, end_date: null, installment_count: null, is_variable: false, payment_obligation: 'confirmed', condition: null,
  business_day_rule: 'none', confidence: 'high', source_type: 'explicit', direction: 'expense', frequency: 'one_time', ...q(null), ...p,
});
const detail = (key: string, value: string | number, quote: string) => ({ key, text_value: typeof value === 'string' ? value : null, number_value: typeof value === 'number' ? value : null, boolean_value: null, confidence: 'high', source_type: 'explicit', ...q(quote) });
const date = (d: string, meaning: string, label: string) => ({ date: d, meaning, label, confidence: 'high', source_type: 'explicit', ...q(`${label} ${d}`) });

const bulletLoan = (payments: unknown[]) => {
  const base = F.loan();
  return toAppResult(
    {
      ...base,
      dates: [date('2026-10-20', 'loan_execution', '대출 실행일'), date('2027-10-19', 'maturity', '만기일')],
      details: [
        detail('principal', 30_000_000, '대출금액 금 삼천만원 (30,000,000원)'),
        detail('interest_rate', 6, '연 6.0% 고정'),
        detail('rate_type', 'fixed', '고정금리'),
        detail('repayment_method', 'bullet', '만기일시상환'),
        detail('interest_day_count', 'actual_365', '1년을 365일로 보고 실제 일수로 계산'),
        detail('interest_period', 'calendar_month', '매월 1일부터 말일까지의 이자를 다음 달 10일에 납부'),
      ],
      payments,
      checks: [],
    },
    'openai',
  );
};

const AI_PAYMENTS = [
  pay({ kind: 'other', label: '대출 실행금', amount: 30_000_000, date: '2026-10-20', ...q('대출 실행일에 30,000,000원을 지급') }),
  pay({ kind: 'interest', label: '첫 이자', amount: 59_178, date: '2026-11-10', ...q('2026.10.20~10.31 (12일) 이자 59,178원') }),
  pay({ kind: 'interest', label: '11월분 이자', amount: 147_945, date: '2026-12-10', ...q('11월분 이자 147,945원') }),
  pay({ kind: 'interest', label: '12월분 이자', amount: 152_877, date: '2027-01-10', ...q('12월분 이자 152,877원') }),
  pay({ kind: 'interest', label: '만기 최종 이자', amount: 93_699, date: '2027-10-19', ...q('만기 최종 이자 93,699원') }),
  pay({ kind: 'loan_repayment', label: '원금 상환', amount: 30_000_000, date: '2027-10-19', ...q('만기일에 원금 30,000,000원 일시 상환') }),
  pay({ kind: 'loan_repayment', label: '대출 원금 상환', amount: 30_000_000, date: '2027-10-19', ...q('[부속] 상환일정표 2027.10.19 원금 30,000,000') }),
  pay({ kind: 'interest', label: '연체이자', amount: 0, payment_obligation: 'conditional', ...q('연체 시 연 3%p 가산') }),
];

test('L1 실행금 3,000만원은 결제가 아님 → 대출 원금(정보) · 참고 금액', () => {
  const r = bulletLoan(AI_PAYMENTS);
  expect(r.payments.some((p) => p.amount === 30_000_000 && p.date === '2026-10-20')).toBe(false);
  expect(r.details.principal?.value).toBe(30_000_000);
  expect(r.references.some((x) => x.label === '대출 실행금' && x.amount === 30_000_000)).toBe(true);
});

test('L2 회차별 이자 4건 → 이자 납부 규칙 1건 (매월 10일 · 11/10부터 만기까지) · 회차 금액은 참고 금액으로 보관', () => {
  const r = bulletLoan(AI_PAYMENTS);
  const interest = r.payments.filter((p) => p.kind === 'interest');
  expect(interest).toHaveLength(1);
  expect(interest[0]).toMatchObject({ label: '대출 이자', frequency: 'monthly', dayOfMonth: 10, date: '2026-11-10', endDate: '2027-10-19', isVariable: true, obligation: 'confirmed' });
  expect(r.references.filter((x) => /이자/.test(x.label) && x.role === 'reference').map((x) => x.amount)).toEqual([59_178, 147_945, 152_877, 93_699]);
});

test('L3 본문·부속 일정표의 같은 원금 상환 → 1건만 (만기일 · 3,000만원)', () => {
  const r = bulletLoan(AI_PAYMENTS);
  const principal = r.payments.filter((p) => p.kind === 'loan_repayment');
  expect(principal.map((p) => [p.amount, p.date, p.frequency])).toEqual([[30_000_000, '2027-10-19', 'one_time']]);
});

test('조건부 연체이자는 결제가 아님 (규칙에 넣지 않음)', () => {
  const r = bulletLoan(AI_PAYMENTS);
  expect(r.payments.some((p) => p.label === '연체이자')).toBe(false);
});

test('L4 원금 상환이 빠졌으면 만기일시 상환 정보로 만기일에 1건 만듦 · 금액만 같은 다른 의무는 합치지 않음', () => {
  const r = bulletLoan(AI_PAYMENTS.filter((p) => (p as unknown as { kind: string }).kind !== 'loan_repayment'));
  expect(r.payments.filter((p) => p.kind === 'loan_repayment').map((p) => [p.label, p.amount, p.date])).toEqual([['대출 원금 상환', 30_000_000, '2027-10-19']]);
});

test('분할 상환 대출(원리금 312,000 × 36회)은 그대로 — 대출 규칙이 기존 계약 처리를 바꾸지 않음', () => {
  const r = toAppResult(F.loan(), 'openai');
  expect(r.payments.map((p) => [p.kind, p.amount, p.frequency])).toEqual([['loan_repayment', 312_000, 'monthly']]);
});

test('5·통합: 분석 결과 → 등록 확인 → 저장 기록 → 일정·합계 (실행금 없음 · 이자 1건 · 11/10 59,178 · 12/10 147,945 · 만기 원금+최종 이자)', () => {
  const r = bulletLoan(AI_PAYMENTS);
  const draft = toReviewModel(r as never, ['doc-1']).draft;
  expect(draft.details).toMatchObject({ principal: 30_000_000, interestRate: 6, rateType: 'fixed', repaymentMethod: 'bullet', interestDayCount: 'actual_365', interestPeriod: 'calendar_month' });
  const rec = draftToRecord(withConfirmedRole(draft, 'borrower'), 'loan', '2026-10-14');
  const list = scheduleForRange([rec], { start: '2026-10-01', end: '2027-10-31' }, '2026-10-14').filter((i) => i.type === 'payment');
  expect(list.filter((i) => i.date === '2026-10-20')).toEqual([]);
  expect(list.slice(0, 2).map((i) => [i.date, i.amount])).toEqual([
    ['2026-11-10', 59_178],
    ['2026-12-10', 147_945],
  ]);
  const last = list.filter((i) => i.date === '2027-10-19').map((i) => i.amount).sort((a, b) => a! - b!);
  expect(last).toEqual([93_699, 30_000_000]);
  // 같은 이자를 두 번 세지 않음: 13회 + 원금 1회
  expect(list).toHaveLength(14);
  expect(monthSpending([rec], { year: 2026, month: 10 }, '2026-10-14').incomeTotal).toBe(0);
});
