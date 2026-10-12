/**
 * 나눠 내는 몫(계약금·중도금·잔금·착수금)의 성격 golden — 모든 값은 가짜다.
 *
 * 원칙: "계약금"이라는 이름만 보고 일반 비용으로 분류하지 않는다. 그 몫이 무엇의 일부인지(상위 금액)로 성격을 정한다.
 *   임대차 보증금의 계약금·잔금 → 보증금 자금 이동(중립): 월 지출 합계에서 제외, 지급 일정은 각각 유지
 *   매매대금의 계약금·잔금 → 매매대금의 일부(지출 또는 수입) / 용역대금의 착수금·잔금 → 용역대금의 일부
 *   상위 금액(총액)은 별도 지급으로 추가하지 않는다 (같은 돈을 두 번 세지 않음)
 */
import { draftToRecord } from '@/data/draft';
import { toReviewModel } from '@/features/registration/extraction';

import { toAppResult } from '../../../../supabase/functions/_shared/extraction.ts';
import { scheduleForRange } from '../../schedule';
import { monthSpending } from '../../spending';
import { contract, pay } from './classificationFixtures';

const TODAY = '2026-10-08';
const q = (quote: string) => ({ evidence_quote: quote, evidence_page: 1, evidence_file: 1 });
const f = (value: unknown, quote: string | null = null) => ({ value, confidence: 'high', evidence_quote: quote, evidence_page: quote ? 1 : null, evidence_file: quote ? 1 : null });
const once = (p: Record<string, unknown>) => pay({ frequency: 'one_time', role: 'one_time_cashflow', day_of_month: null, ...p });
const DEP = '보증금 금 20,000,000원정은 계약 당일 계약금 2,000,000원을 지불하고, 잔금 18,000,000원은 2026년 10월 20일에 지불한다.';

const run = (output: unknown) => {
  const result = toAppResult(output, 'openai');
  const record = draftToRecord(toReviewModel(result, ['doc-1']).draft, 'c1', TODAY);
  return { result, record, oct: monthSpending([record], { year: 2026, month: 10 }), schedule: scheduleForRange([record], { start: '2026-10-01', end: '2026-10-31' }, TODAY) };
};
const lease = (payments: Record<string, unknown>[], fields: Record<string, unknown> = {}) =>
  contract({
    cls: { kind: 'lease', subtype: 'housing', domains: ['real_estate'] },
    title: '주택 월세 임대차계약서',
    dates: [
      { date: '2026-10-08', meaning: 'contract_signed', label: '계약일', confidence: 'high', source_type: 'explicit', ...q('계약일 2026년 10월 8일') },
      { date: '2026-10-20', meaning: 'contract_start', label: '임대차 시작일', confidence: 'high', source_type: 'explicit', ...q('2026년 10월 20일부터') },
      { date: '2028-10-19', meaning: 'contract_end', label: '임대차 종료일', confidence: 'high', source_type: 'explicit', ...q('2028년 10월 19일까지') },
    ],
    payments: [
      ...payments,
      pay({ kind: 'rent', label: '월세', amount: 850000, day_of_month: 20, ...q('월세 850,000원은 매월 20일 지불한다.') }),
      pay({ kind: 'maintenance_fee', label: '관리비', amount: 100000, day_of_month: 20, ...q('관리비 월 100,000원') }),
    ],
    fields,
  });
const DOWN = once({ kind: 'down_payment', label: '계약금', amount: 2000000, date: '2026-10-08', ...q(DEP) });
const BALANCE = once({ kind: 'balance_payment', label: '잔금', amount: 18000000, date: '2026-10-20', ...q(DEP) });

describe('임대차 보증금의 계약금·잔금 = 보증금 자금 이동 (실제 테스트 계약서와 같은 구조)', () => {
  const expectDepositParts = (r: ReturnType<typeof run>) => {
    // 1·2. 계약금·잔금은 월 지출 합계에서 제외 / 7. 월세 + 관리비만 월 지출 (10월 = 첫 달 월세·관리비)
    expect(r.oct.total).toBe(950000);
    expect(r.oct.items.map((i) => i.label).sort()).toEqual(['관리비', '월세']);
    // 3. 보증금 총액은 별도 지급으로 추가하지 않음 (계약 요약의 보증금으로만)
    expect(r.record.contract.depositAmount).toBe(20000000);
    expect(r.record.payments.some((p) => p.amount === 20000000)).toBe(false);
    // 4~6. 계약금·잔금은 실제 지급 일정으로 각각 (계약 당일 10-08 · 10-20), 보증금 자금 이동(중립)
    const parts = r.record.payments.filter((p) => p.label === '계약금' || p.label === '잔금');
    expect(parts.map((p) => [p.label, p.direction, p.startsOn])).toEqual([
      ['계약금', 'neutral', '2026-10-08'],
      ['잔금', 'neutral', '2026-10-20'],
    ]);
    const days = r.schedule.filter((i) => i.type === 'payment' && (i.title.includes('계약금') || i.title.includes('잔금'))).map((i) => i.date);
    expect(days).toEqual(['2026-10-08', '2026-10-20']);
    // 보증금 이동은 지출과 따로 집계 (이번 달 오가는 보증금)
    expect(r.oct.depositTotal).toBe(20000000);
  };

  test('보증금 총액 + 계약금 + 잔금이 함께 결제로 온 경우', () => {
    expectDepositParts(run(lease([once({ kind: 'deposit', direction: 'neutral', label: '보증금', amount: 20000000, date: '2026-10-08', ...q(DEP) }), DOWN, BALANCE])));
  });
  test('보증금은 계약 요약 칸(depositAmount)에만 있고 결제는 계약금·잔금만 온 경우', () => {
    expectDepositParts(run(lease([DOWN, BALANCE], { depositAmount: f(20000000, DEP) })));
  });
  test('AI가 보증금을 총액(role=total)으로 답한 경우', () => {
    expectDepositParts(run(lease([once({ kind: 'deposit', direction: 'neutral', role: 'total', label: '보증금', amount: 20000000, ...q(DEP) }), DOWN, BALANCE])));
  });
});

describe('다른 상위 금액의 몫은 그 금액의 성격을 따른다 (이름이 같아도)', () => {
  test('상품 매매: 매매대금 30,000,000 = 계약금 3,000,000 + 잔금 27,000,000 → 매매대금의 일부(지출), 매매대금은 별도 지급 아님', () => {
    const SALE = '매매대금 30,000,000원 중 계약금 3,000,000원은 계약 시, 잔금 27,000,000원은 2026년 10월 30일 지급한다.';
    const r = run(
      contract({
        cls: { kind: 'sale', subtype: 'goods' },
        title: '중고 장비 매매계약서',
        dates: [{ date: '2026-10-08', meaning: 'contract_signed', label: '계약일', confidence: 'high', source_type: 'explicit', ...q('계약일 2026년 10월 8일') }],
        payments: [
          once({ kind: 'purchase_price', label: '매매대금', amount: 30000000, date: '2026-10-08', ...q(SALE) }),
          once({ kind: 'down_payment', label: '계약금', amount: 3000000, date: '2026-10-08', ...q(SALE) }),
          once({ kind: 'balance_payment', label: '잔금', amount: 27000000, date: '2026-10-30', ...q(SALE) }),
        ],
      }),
    );
    expect(r.record.payments.map((p) => [p.label, p.direction])).toEqual([
      ['계약금', 'expense'],
      ['잔금', 'expense'],
    ]);
    expect(r.oct.total).toBe(30000000);
  });

  test('용역(수급인): 용역대금 = 착수금 + 잔금 → 받을 돈(수입)의 일부, 지출로 바꾸지 않음', () => {
    const SVC = '용역대금 10,000,000원 중 착수금 3,000,000원은 계약 시, 잔금 7,000,000원은 검수 후 2026년 10월 30일 지급한다.';
    const r = run(
      contract({
        cls: { kind: 'service', subtype: 'development' },
        title: '앱 개발 용역계약서',
        dates: [{ date: '2026-10-08', meaning: 'contract_signed', label: '계약일', confidence: 'high', source_type: 'explicit', ...q('계약일 2026년 10월 8일') }],
        payments: [
          once({ kind: 'service_fee', direction: 'income', role: 'total', label: '용역대금', amount: 10000000, ...q(SVC) }),
          once({ kind: 'down_payment', direction: 'income', label: '착수금', amount: 3000000, date: '2026-10-08', ...q(SVC) }),
          once({ kind: 'balance_payment', direction: 'income', label: '잔금', amount: 7000000, date: '2026-10-30', ...q(SVC) }),
        ],
      }),
    );
    expect(r.record.payments.map((p) => [p.label, p.direction])).toEqual([
      ['착수금', 'income'],
      ['잔금', 'income'],
    ]);
    expect(r.oct.incomeTotal).toBe(10000000);
    expect(r.oct.total).toBe(0);
  });

  test('상위 금액을 알 수 없는 계약금은 그대로 (근거 없이 보증금으로 바꾸지 않음)', () => {
    const r = run(lease([once({ kind: 'down_payment', label: '가입 계약금', amount: 50000, date: '2026-10-08', ...q('가입 계약금 50,000원') })]));
    expect(r.record.payments.find((p) => p.label === '가입 계약금')?.direction).toBe('expense');
  });

  test('보증금 금액과 합이 맞지 않으면 바꾸지 않음 (애매하면 건드리지 않는다)', () => {
    const r = run(lease([DOWN, once({ kind: 'balance_payment', label: '잔금', amount: 17000000, date: '2026-10-20', ...q(DEP) })], { depositAmount: f(20000000, DEP) }));
    expect(r.record.payments.filter((p) => p.label === '계약금' || p.label === '잔금').map((p) => p.direction)).toEqual(['expense', 'expense']);
  });
});
