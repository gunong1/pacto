/**
 * 분석 결과의 돈의 성격·방향 (서버 규칙 F1 · 지시문 v16) Golden — 모든 이름·금액은 가짜다.
 * - 분석 시점에는 사용자가 어느 쪽인지 모른다: 역할에 따라 방향이 달라지는 금액은 방향 확인 필요(neutral)
 * - 계약 구조상 사용자가 언제나 한쪽인 종류(구독·렌탈·대출·보험 …)는 방향이 명확 (basis = contract)
 * - 계약서가 "누가 누구에게" 지급하는지 밝히면 그 역할(payer/payee) — 근거 문장이 있을 때만
 * - 보증금(몫 포함)은 성격 refundable_deposit + 보증금 묶음 하나 (총액 = 계약 요약 보증금)
 * - 보증인·대리인은 당사자로 따로 (계약 당사자 역할과 섞지 않음)
 */
import { draftToRecord } from '@/data/draft';
import { toReviewModel } from '@/features/registration/extraction';

import { toAppResult } from '../../../../supabase/functions/_shared/extraction.ts';
import { withConfirmedRole } from '../../cashflow';
import { matchUserParty } from '../../partyMatch';
import { monthSpending } from '../../spending';
import { contract, pay } from './classificationFixtures';

const TODAY = '2026-10-08';
const q = (quote: string) => ({ evidence_quote: quote, evidence_page: 1, evidence_file: 1 });
const once = (p: Record<string, unknown>) => pay({ frequency: 'one_time', role: 'one_time_cashflow', day_of_month: null, ...p });
const DEP = '보증금 20,000,000원 중 계약금 2,000,000원은 계약 당일, 잔금 18,000,000원은 2026년 10월 20일 지급한다.';

const leaseOut = (extra: { payments?: Record<string, unknown>[]; parties?: unknown[] } = {}) => ({
  ...contract({
    cls: { kind: 'lease', subtype: 'housing', domains: ['real_estate'] },
    title: '주택 월세 임대차계약서',
    dates: [
      { date: '2026-10-08', meaning: 'contract_signed', label: '계약일', confidence: 'high', source_type: 'explicit', ...q('계약일 2026년 10월 8일') },
      { date: '2026-10-20', meaning: 'contract_start', label: '시작', confidence: 'high', source_type: 'explicit', ...q('2026년 10월 20일부터') },
      { date: '2028-10-19', meaning: 'contract_end', label: '종료', confidence: 'high', source_type: 'explicit', ...q('2028년 10월 19일까지') },
    ],
    fields: { depositAmount: { value: 20000000, confidence: 'high', ...q(DEP) } },
    payments: extra.payments ?? [
      once({ kind: 'down_payment', direction: 'expense', label: '계약금', amount: 2000000, date: '2026-10-08', ...q(DEP) }),
      once({ kind: 'balance_payment', direction: 'expense', label: '잔금', amount: 18000000, date: '2026-10-20', ...q(DEP) }),
      pay({ kind: 'rent', direction: 'expense', label: '월세', amount: 850000, day_of_month: 20, payer_role: 'lessee', payee_role: 'lessor', ...q('임차인은 월세 850,000원을 매월 20일 임대인에게 지급한다.') }),
    ],
  }),
  parties: extra.parties ?? [
    { role: 'lessor', name: '김민수', confidence: 'high', ...q('임대인 김민수') },
    { role: 'lessee', name: '박지훈', confidence: 'high', ...q('임차인 박지훈') },
    { role: 'guarantor', name: '최영희', confidence: 'high', ...q('연대보증인 최영희') },
  ],
});
const review = (out: unknown) => toReviewModel(toAppResult(out, 'openai'), ['doc-1']);

describe('분석 결과 → 확인 화면 초안', () => {
  test('임대차: 모델이 "사용자 기준 지출"이라고 답해도 역할을 모르면 방향 확인 필요 · 보증금 몫은 성격 보증금 + 묶음', () => {
    const m = review(leaseOut());
    expect(m.draft.payments.map((p) => [p.label, p.direction, p.moneyNature, p.fundKey ?? null])).toEqual([
      ['계약금', 'neutral', 'refundable_deposit', 'deposit'],
      ['잔금', 'neutral', 'refundable_deposit', 'deposit'],
      ['월세', 'neutral', 'ordinary', null],
    ]);
    expect(m.draft.funds).toEqual([{ key: 'deposit', kind: 'deposit', label: '보증금', totalAmount: null, returnDueOn: null, depositorRole: null, holderRole: null }]);
    expect(m.draft.userPartyRole).toBeNull();
  });
  test('계약서가 지급자·수령자를 밝히면 그대로 (근거 문장이 있을 때만)', () => {
    const r = toAppResult(leaseOut(), 'openai');
    expect(r.payments.find((p) => p.label === '월세')).toMatchObject({ payerRole: 'lessee', payeeRole: 'lessor' });
    const noQuote = toAppResult(leaseOut({ payments: [pay({ kind: 'rent', label: '월세', amount: 850000, payer_role: 'lessee', evidence_quote: null, evidence_page: null, evidence_file: null })] }), 'openai');
    expect(noQuote.payments[0].payerRole).toBeNull();
  });
  test('보증인·대리인은 당사자로 따로 · 이름 대조는 기기에서 추천만', () => {
    const m = review(leaseOut());
    expect(m.draft.parties.map((p) => p.role)).toEqual(['lessor', 'lessee', 'guarantor']);
    expect(matchUserParty('lease', m.draft.parties, ['최영희'])).toMatchObject({ role: 'guarantor', moneySide: false });
  });
  test('역할 확정 후: 임차인 10월 총 출금 20,850,000 = 일반(월세) 850,000 + 보증금 20,000,000', () => {
    const r = draftToRecord(withConfirmedRole(review(leaseOut()).draft, 'lessee'), 'c', TODAY);
    expect(monthSpending([r], { year: 2026, month: 10 })).toMatchObject({ total: 20850000, ordinaryExpense: 850000, depositOut: 20000000, undeterminedTotal: 0 });
  });
  test('구조상 한쪽인 종류(렌탈): 역할 없이도 출금 · 근거 contract', () => {
    const out = contract({ cls: { kind: 'rental', subtype: 'appliance' }, title: '정수기 렌탈', payments: [pay({ label: '월 렌탈료', amount: 29900, day_of_month: 10 })] });
    const r = toAppResult(out, 'openai');
    expect(r.payments.map((p) => [p.direction, p.directionBasis, p.moneyNature])).toEqual([['expense', 'contract', 'ordinary']]);
  });
  test('대출: 차주가 원리금을 냄 → 출금 (대출기관은 회사)', () => {
    const out = contract({ cls: { kind: 'loan', subtype: 'credit' }, title: '신용대출', payments: [pay({ kind: 'loan_repayment', label: '월 원리금', amount: 312000 })] });
    expect(toAppResult(out, 'openai').payments.map((p) => [p.direction, p.directionBasis])).toEqual([['expense', 'contract']]);
  });
  test('매매 계약금(보증금 아님): 성격 일반 · 역할 모르면 확인 필요', () => {
    const out = contract({ cls: { kind: 'sale', subtype: 'goods' }, title: '장비 매매', payments: [once({ kind: 'down_payment', label: '계약금', amount: 1000000, date: '2026-10-10', ...q('계약금 1,000,000원') })] });
    expect(toAppResult(out, 'openai').payments.map((p) => [p.direction, p.moneyNature])).toEqual([['neutral', 'ordinary']]);
  });
});
