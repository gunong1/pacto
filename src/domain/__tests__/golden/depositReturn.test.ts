/**
 * 보증금 반환 (실기기 2026-10: 전세계약서의 "보증금 반환 예정 200,000,000원 · 2028-11-30"이 기타 결제·확정·일반·출금으로 저장됨). 모든 값은 가짜
 * 원인: AI가 반환을 결제로 답함 → 서버에 반환 규칙이 없어 일반 결제(kind other 기본 방향 = 출금, 확정)로 통과 → 그대로 저장·집계.
 * 규칙 (모든 보증금·예치금 공통): 반환은 결제가 아니라 보증금 묶음의 반환 —
 *  - 문구에 적힌 반환일만 반환 예정일 (그날 반환 예정으로 입출금 예정에 — 일반 수입·지출과 따로) · 종료일만 있으면 "반환 확인"(합계 제외)
 *  - 방향은 사용자 역할로 (임차인 = 돌려받음 입금 / 임대인 = 돌려줌 출금 / 모르면 확인 필요)
 *  - 실제 반환은 반환 기록으로 (일부·전액) · 처음 낸 보증금과 반환 예정액을 함께 세지 않음
 */
import { draftToRecord, fixDepositReturn, recordToDraft } from '@/data/draft';
import { toReviewModel } from '@/features/registration/extraction';

import { toAppResult } from '../../../../supabase/functions/_shared/extraction.ts';
import { fundViews, misfiledDepositReturns, withConfirmedRole } from '../../cashflow';
import { monthSpending } from '../../spending';
import type { ContractRecord } from '../../types';
import { contract, pay } from './classificationFixtures';

const TODAY = '2026-10-13';
const q = (quote: string) => ({ evidence_quote: quote, evidence_page: 1, evidence_file: 1 });
const once = (p: Record<string, unknown>) => pay({ frequency: 'one_time', role: 'one_time_cashflow', day_of_month: null, ...p });
const RETURN_AT_END = '임대인은 임대차 종료 시 보증금을 임차인에게 반환한다.';
const RETURN_ON_DATE = '임대인은 2028년 11월 30일까지 보증금 전액을 임차인에게 반환한다.';

function jeonse(returnQuote: string, returnPayment = true) {
  return contract({
    cls: { kind: 'lease', subtype: 'housing', domains: ['real_estate'] },
    title: '주택 전세계약서',
    fields: { depositAmount: { value: 200_000_000, confidence: 'high', ...q('보증금 금 이억원정 (200,000,000원)') } },
    dates: [
      { date: '2026-10-10', meaning: 'contract_signed', label: '계약일', confidence: 'high', source_type: 'explicit', ...q('2026년 10월 10일') },
      { date: '2026-11-30', meaning: 'contract_start', label: '임대차 시작일', confidence: 'high', source_type: 'explicit', ...q('2026년 11월 30일부터 2028년 11월 29일까지') },
      { date: '2028-11-29', meaning: 'contract_end', label: '임대차 종료일', confidence: 'high', source_type: 'explicit', ...q('2026년 11월 30일부터 2028년 11월 29일까지') },
    ],
    payments: [
      once({ kind: 'deposit', label: '계약금', amount: 20_000_000, date: '2026-10-10', date_source: 'contract_date', direction: 'neutral', part_of: '보증금', ...q('보증금 중 계약금 20,000,000원은 계약 시 지급') }),
      once({ kind: 'deposit', label: '잔금', amount: 180_000_000, date: '2026-11-30', direction: 'neutral', part_of: '보증금', ...q('보증금 중 잔금 180,000,000원은 2026년 11월 30일 지급') }),
      // 실기기와 같은 AI 답: 반환을 결제로 · 종료일 다음 날짜(2028-11-30)를 날짜로
      ...(returnPayment ? [once({ kind: 'other', label: '보증금 반환 예정', amount: 200_000_000, date: '2028-11-30', direction: 'expense', ...q(returnQuote) })] : []),
    ],
  });
}

const register = (output: unknown, role: string | null, id = 'jeonse') => {
  const model = toReviewModel(toAppResult(output, 'openai'), ['doc-1']);
  return { model, record: draftToRecord(role ? withConfirmedRole(model.draft, role) : model.draft, id, TODAY) };
};
const month = (r: ContractRecord, year: number, m: number) => monthSpending([r], { year, month: m }, TODAY);

describe('새 분석: 보증금 반환은 결제가 아니라 보증금 묶음의 반환', () => {
  test('반환 항목은 결제로 남지 않음 (기타 결제·확정·일반·출금으로 저장되지 않음)', () => {
    const { record } = register(jeonse(RETURN_AT_END), 'lessee');
    expect(record.payments.map((p) => p.label)).toEqual(['계약금', '잔금']);
    expect(misfiledDepositReturns(record)).toEqual([]);
  });

  test('1·2. 임차인: 보증금 지급 = 출금 · 반환 = 입금 (반환일이 적혀 있으면 그날 보증금 입금 예정)', () => {
    const { record } = register(jeonse(RETURN_ON_DATE), 'lessee');
    expect(record.payments.map((p) => [p.label, p.direction, p.moneyNature])).toEqual([
      ['계약금', 'expense', 'refundable_deposit'],
      ['잔금', 'expense', 'refundable_deposit'],
    ]);
    const [fund] = fundViews(record, TODAY);
    expect([fund.total, fund.checkDate, fund.checkBasis, fund.refundDirection, fund.status]).toEqual([200_000_000, '2028-11-30', 'explicit', 'income', 'scheduled']);
    const nov = month(record, 2028, 11);
    expect([nov.depositIn, nov.ordinaryIncome, nov.depositOut, nov.ordinaryExpense]).toEqual([200_000_000, 0, 0, 0]);
  });

  test('3·4. 임대인: 보증금 수령 = 입금 · 반환 = 출금', () => {
    const { record } = register(jeonse(RETURN_ON_DATE), 'lessor');
    expect(record.payments.map((p) => p.direction)).toEqual(['income', 'income']);
    expect(fundViews(record, TODAY)[0].refundDirection).toBe('expense');
    const nov = month(record, 2028, 11);
    expect([nov.depositOut, nov.ordinaryExpense, nov.depositIn]).toEqual([200_000_000, 0, 0]);
  });

  test('5. 역할 미확정: 지급·반환 모두 방향 확인 필요 — 합계에 넣지 않음', () => {
    const { record } = register(jeonse(RETURN_ON_DATE), null);
    expect(record.payments.map((p) => p.direction)).toEqual(['neutral', 'neutral']);
    expect(fundViews(record, TODAY)[0].refundDirection).toBe('neutral');
    const nov = month(record, 2028, 11);
    expect([nov.incomeTotal, nov.total]).toEqual([0, 0]);
  });

  test('6. 종료일만 있고 반환일이 불명확 → 2028-11-30을 확정 반환일로 쓰지 않음 · 종료일에 "반환 확인"만 (합계 제외)', () => {
    const { record, model } = register(jeonse(RETURN_AT_END), 'lessee');
    expect(model.draft.funds?.[0].returnDueOn).toBeNull();
    const [fund] = fundViews(record, TODAY);
    expect([fund.checkDate, fund.checkBasis]).toEqual(['2028-11-29', 'contract_end']);
    expect(month(record, 2028, 11).incomeTotal).toBe(0);
  });

  test('7. 반환일이 문구에 명시 → 그날 반환 예정 (근거 문장 보존)', () => {
    const result = toAppResult(jeonse(RETURN_ON_DATE), 'openai');
    expect(result.depositReturns).toEqual([{ label: '보증금 반환 예정', amount: 200_000_000, date: '2028-11-30', quote: RETURN_ON_DATE }]);
  });

  test('8·9. 일부 반환 → 남은 반환 예정액 · 전액 반환 → 반환 완료 (원래 지급 결제는 그대로)', () => {
    const { record } = register(jeonse(RETURN_ON_DATE), 'lessee');
    const fundId = record.funds![0].id;
    const withRefunds = (amounts: number[]): ContractRecord => ({ ...record, funds: record.funds!.map((f) => ({ ...f, refunds: amounts.map((amount, i) => ({ id: `r${i}`, fundId, amount, refundedOn: '2028-11-30', note: null })) })) });
    const partial = fundViews(withRefunds([150_000_000]), '2028-11-30')[0];
    expect([partial.status, partial.refunded, partial.remaining]).toEqual(['partial', 150_000_000, 50_000_000]);
    // 반환일이 지났는데 남은 금액이 있으면 "반환 지연" (기존 규칙)
    expect(fundViews(withRefunds([150_000_000]), '2028-12-01')[0].status).toBe('delayed');
    const full = fundViews(withRefunds([150_000_000, 50_000_000]), '2028-12-01')[0];
    expect([full.status, full.remaining]).toEqual(['returned', 0]);
    expect(withRefunds([150_000_000]).payments.map((p) => p.amount)).toEqual([20_000_000, 180_000_000]);
  });

  test('10. 중복 합산 없음: 보증금 지급 2억(계약금 + 잔금)과 반환 예정 2억을 같은 돈으로 두 번 세지 않음', () => {
    const { record } = register(jeonse(RETURN_ON_DATE), 'lessee');
    const [fund] = fundViews(record, TODAY);
    expect([fund.total, fund.members.reduce((s, p) => s + p.amount, 0)]).toEqual([200_000_000, 200_000_000]);
    expect([month(record, 2026, 10).depositOut, month(record, 2026, 11).depositOut]).toEqual([20_000_000, 180_000_000]);
  });

  test('12. 역할 변경 후 다시 계산: 임차인 → 임대인이면 지급·반환 방향이 함께 바뀜', () => {
    const { model } = register(jeonse(RETURN_ON_DATE), null);
    const asLessee = draftToRecord(withConfirmedRole(model.draft, 'lessee'), 'j', TODAY);
    const asLessor = draftToRecord(withConfirmedRole(recordToDraft(asLessee), 'lessor'), 'j', TODAY);
    expect([fundViews(asLessee, TODAY)[0].refundDirection, fundViews(asLessor, TODAY)[0].refundDirection]).toEqual(['income', 'expense']);
    expect(month(asLessor, 2028, 11).depositOut).toBe(200_000_000);
  });

  test('13. 사용자가 직접 정한 방향은 역할을 바꿔도 그대로', () => {
    const { model } = register(jeonse(RETURN_ON_DATE), 'lessee');
    const userSet = { ...model.draft, payments: model.draft.payments.map((p, i) => (i === 0 ? { ...p, direction: 'expense' as const, directionBasis: 'user' as const } : p)) };
    const changed = withConfirmedRole(userSet, 'lessor');
    expect(changed.payments.map((p) => [p.direction, p.directionBasis])).toEqual([
      ['expense', 'user'],
      ['income', 'role'],
    ]);
  });
});

describe('기존 데이터: 결제로 저장된 보증금 반환 (자동으로 바꾸지 않고 사용자 확인으로 정리)', () => {
  // 실기기와 같은 저장 상태를 이전 규칙(반환 항목이 결제로 남음)으로 재현
  const saved = (): ContractRecord => {
    const { record } = register(jeonse(RETURN_AT_END, false), 'lessee', 'old');
    const wrong = { ...record.payments[0], id: 'wrong', kind: 'other' as const, label: '보증금 반환 예정', amount: 200_000_000, startsOn: '2028-11-30', direction: 'expense' as const, moneyNature: 'ordinary' as const, fundId: null, directionBasis: null };
    return { ...record, payments: [...record.payments, wrong] };
  };

  test('지금 상태 재현: 2028년 11월 일반 지출 2억 (잘못된 집계) · 찾기 규칙이 이 항목만 찾음', () => {
    const r = saved();
    expect(month(r, 2028, 11).ordinaryExpense).toBe(200_000_000);
    expect(misfiledDepositReturns(r).map((p) => p.id)).toEqual(['wrong']);
  });

  test('14. 정리(반환일 불명확): 결제 삭제 · 반환일 비움(종료일 반환 확인) · 다른 결제 id·보증금 연결 그대로 · 일반 지출 0', () => {
    const r = saved();
    const before = r.payments.filter((p) => p.id !== 'wrong').map((p) => [p.id, p.amount, p.fundId]);
    const fixed = draftToRecord(fixDepositReturn(r, 'wrong', false), 'old', TODAY);
    expect(fixed.payments.map((p) => [p.id, p.amount, p.fundId])).toEqual(before);
    expect(fundViews(fixed, TODAY)[0]).toMatchObject({ total: 200_000_000, checkBasis: 'contract_end', refundDirection: 'income' });
    expect([month(fixed, 2028, 11).ordinaryExpense, month(fixed, 2028, 11).incomeTotal]).toEqual([0, 0]);
  });

  test('14-1. 정리(계약서에 반환일이 적혀 있다고 사용자가 확인): 그 날짜가 반환 예정일 → 보증금 입금 예정 2억', () => {
    const fixed = draftToRecord(fixDepositReturn(saved(), 'wrong', true), 'old', TODAY);
    expect(fundViews(fixed, TODAY)[0]).toMatchObject({ checkDate: '2028-11-30', checkBasis: 'explicit' });
    expect(month(fixed, 2028, 11).depositIn).toBe(200_000_000);
  });

  test('최초 보증금 "보증금"·계약금·잔금은 반환 항목으로 찾지 않음', () => {
    const { record } = register(jeonse(RETURN_AT_END, false), 'lessee');
    expect(misfiledDepositReturns({ ...record, payments: [...record.payments, { ...record.payments[0], id: 'd', label: '보증금' }] })).toEqual([]);
  });
});
