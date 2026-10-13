/**
 * 홈 월별 요약 계층 (flowSummary) — 하위(계약 종류별)는 상위(일반 지출·보증금 지급)에 포함, 상위 합 = 총 출금. 모든 값은 가짜
 * 실기기 예시(2026-10): 임대차(계약금 2,000,000 · 잔금 18,000,000 · 월세 850,000 · 관리비 100,000) + 렌탈(보증금 5,000,000 · 월 769,000)
 *   총 출금 26,719,000 = 일반 지출 1,719,000 (임대차 950,000 + 렌탈 769,000) + 보증금 지급 25,000,000 (임대차 20,000,000 + 렌탈 5,000,000)
 * 중복 등록으로 보이는 계약은 알리기만 하고 합계에서 빼지 않는다.
 */
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';

import { withConfirmedRole } from '../cashflow';
import { likelyDuplicateGroups } from '../duplicates';
import { scheduleForRange } from '../schedule';
import { monthSpending, type FlowSummary } from '../spending';

const TODAY = '2026-10-08';
const OCT = { year: 2026, month: 10 } as const;
const pay = (o: Partial<PaymentDraft>): PaymentDraft => ({ kind: 'other', direction: 'neutral', label: '결제', amount: 1, frequency: 'monthly', dayOfMonth: 20, monthOfYear: null, startsOn: '2026-10-20', endsOn: null, installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null, moneyNature: 'ordinary', ...o });
const once = (o: Partial<PaymentDraft>) => pay({ frequency: 'one_time', dayOfMonth: null, ...o });

const leaseDraft: ContractDraft = {
  ...EMPTY_DRAFT,
  title: '주택 월세 임대차계약서',
  category: 'real_estate',
  contractType: 'lease',
  contractKind: 'lease',
  startDate: '2026-10-20',
  endDate: '2028-10-19',
  depositAmount: 20_000_000,
  parties: [
    { role: 'lessor', name: '김민수' },
    { role: 'lessee', name: '박지훈' },
  ],
  payments: [
    once({ kind: 'down_payment', label: '계약금', amount: 2_000_000, startsOn: '2026-10-08', moneyNature: 'refundable_deposit' }),
    once({ kind: 'balance_payment', label: '잔금', amount: 18_000_000, startsOn: '2026-10-20', moneyNature: 'refundable_deposit' }),
    pay({ kind: 'rent', label: '월세', amount: 850_000 }),
    pay({ kind: 'maintenance_fee', label: '관리비', amount: 100_000 }),
  ],
};
const rentalDraft: ContractDraft = {
  ...EMPTY_DRAFT,
  title: '자동차 장기렌트 계약서',
  category: 'vehicle',
  contractType: 'recurring',
  contractKind: 'rental',
  startDate: '2026-10-10',
  endDate: '2029-10-09',
  parties: [
    { role: 'provider', name: '가상렌탈' },
    { role: 'customer', name: '박지훈' },
  ],
  payments: [once({ kind: 'deposit', label: '보증금', amount: 5_000_000, startsOn: '2026-10-10', moneyNature: 'refundable_deposit' }), pay({ kind: 'recurring_fee', label: '월 대여료', amount: 769_000, dayOfMonth: 25, startsOn: '2026-10-25' })],
};
const lease = (id: string, role = 'lessee', d: ContractDraft = leaseDraft) => draftToRecord(withConfirmedRole(d, role), id, TODAY);
const rental = draftToRecord(withConfirmedRole(rentalDraft, 'customer'), 'car', TODAY);

const shape = (f: FlowSummary) => f.groups.map((g) => [g.label, g.amount, g.lines.map((l) => l.amount)]);
/** 계층이 지켜야 할 규칙: 하위 합 = 상위, 상위 합 = 총액 (하위를 따로 더하면 총액보다 커진다) */
const consistent = (f: FlowSummary) => {
  for (const g of f.groups) expect(g.lines.reduce((s, l) => s + l.amount, 0)).toBe(g.amount);
  expect(f.groups.reduce((s, g) => s + g.amount, 0)).toBe(f.total);
};

describe('홈 출금 요약: 총 출금 > 일반 지출·보증금 지급 > 계약 종류별', () => {
  const oct = monthSpending([lease('lease'), rental], OCT, TODAY);

  test('실기기 예시 구조: 26,719,000 = 일반 1,719,000 (950,000 + 769,000) + 보증금 25,000,000 (20,000,000 + 5,000,000)', () => {
    expect(oct.outflow.total).toBe(26_719_000);
    expect(shape(oct.outflow)).toEqual([
      ['일반 지출', 1_719_000, [950_000, 769_000]],
      ['보증금 지급', 25_000_000, [20_000_000, 5_000_000]],
    ]);
    consistent(oct.outflow);
  });

  test('중복 합산 없음: 일반 지출 + 종류별 하위 금액을 더한 값은 총액이 아니다 (하위는 상위에 포함)', () => {
    const ordinary = oct.outflow.groups.find((g) => g.nature === 'ordinary')!;
    const naive = oct.outflow.groups.reduce((s, g) => s + g.amount, 0) + ordinary.lines.reduce((s, l) => s + l.amount, 0);
    expect(naive).toBe(28_438_000); // 예전 화면처럼 모두 같은 줄에 놓고 더하면 나오는 틀린 값
    expect(oct.outflow.total).not.toBe(naive);
    expect(oct.outflow.total).toBe(oct.items.reduce((s, i) => s + i.amount, 0));
  });

  test('기존 집계와 같은 값: 총 출금·일반 지출·보증금 지급 = monthSpending의 total·ordinaryExpense·depositOut', () => {
    expect([oct.outflow.total, oct.outflow.groups[0].amount, oct.outflow.groups[1].amount]).toEqual([oct.total, oct.ordinaryExpense, oct.depositOut]);
    expect(oct.outflow.groups[0].lines.map((l) => l.amount)).toEqual(oct.byKind.map((k) => k.amount));
  });

  test('캘린더와 일치: 10월 결제 일정(출금)의 합 = 홈 총 출금 · 보증금 일정의 합 = 보증금 지급', () => {
    const items = scheduleForRange([lease('lease'), rental], { start: '2026-10-01', end: '2026-10-31' }, TODAY).filter((i) => i.type === 'payment' && i.direction === 'expense' && i.amount != null);
    expect(items.reduce((s, i) => s + i.amount!, 0)).toBe(oct.outflow.total);
    expect(items.filter((i) => i.moneyNature === 'deposit').reduce((s, i) => s + i.amount!, 0)).toBe(oct.outflow.groups[1].amount);
  });

  test('보증금이 없는 달: 일반 지출만 (빈 보증금 줄 없음)', () => {
    const nov = monthSpending([lease('lease'), rental], { year: 2026, month: 11 }, TODAY);
    expect(shape(nov.outflow)).toEqual([['일반 지출', 1_719_000, [950_000, 769_000]]]);
    consistent(nov.outflow);
  });

  test('입금도 같은 구조: 임대인이면 총 입금 > 일반 수입·보증금 받음 > 종류별', () => {
    const asLessor = monthSpending([lease('lease', 'lessor')], OCT, TODAY);
    expect(asLessor.outflow.groups).toEqual([]);
    expect(shape(asLessor.inflow)).toEqual([
      ['일반 수입', 950_000, [950_000]],
      ['보증금 받음·반환', 20_000_000, [20_000_000]],
    ]);
    expect(asLessor.inflow.total).toBe(asLessor.incomeTotal);
    consistent(asLessor.inflow);
  });
});

describe('중복 등록으로 보이는 계약: 알리기만 하고 합계에서 빼지 않음', () => {
  test('같은 계약서를 두 번 등록 (제목만 다름) → 한 묶음 · 합계에는 둘 다 포함 · 같은 종류 줄에 "계약 2개"', () => {
    const dup = lease('lease-2', 'lessee', { ...leaseDraft, title: '주택 임대차 (다시 등록)' });
    const records = [lease('lease-1'), dup, rental];
    expect(likelyDuplicateGroups(records)).toEqual([{ key: 'lease-1+lease-2', contractIds: ['lease-1', 'lease-2'] }]);
    const oct = monthSpending(records, OCT, TODAY);
    expect(oct.outflow.total).toBe(26_719_000 + 20_950_000);
    expect(oct.outflow.groups[1].lines[0]).toMatchObject({ amount: 40_000_000, contracts: 2 });
    consistent(oct.outflow);
  });

  test('한쪽만 보증금 성격을 고친 중복도 찾음 (성격·방향은 비교하지 않음)', () => {
    const fixedOne = draftToRecord(withConfirmedRole({ ...leaseDraft, payments: leaseDraft.payments.map((p) => ({ ...p, moneyNature: 'ordinary' as const })) }, 'lessee'), 'old', TODAY);
    expect(likelyDuplicateGroups([lease('new'), fixedOne]).map((g) => g.contractIds)).toEqual([['new', 'old']]);
  });

  test('조건이 하나라도 다르면 중복 아님: 시작일 · 금액 · 당사자 · 종료한 계약', () => {
    const base = lease('a');
    expect(likelyDuplicateGroups([base, lease('b', 'lessee', { ...leaseDraft, startDate: '2026-11-01' })])).toEqual([]);
    expect(likelyDuplicateGroups([base, lease('c', 'lessee', { ...leaseDraft, payments: leaseDraft.payments.map((p) => (p.label === '월세' ? { ...p, amount: 900_000 } : p)) })])).toEqual([]);
    expect(likelyDuplicateGroups([base, lease('d', 'lessee', { ...leaseDraft, parties: [{ role: 'lessor', name: '김민수' }, { role: 'lessee', name: '최서연' }] })])).toEqual([]);
    const ended = lease('e');
    expect(likelyDuplicateGroups([base, { ...ended, contract: { ...ended.contract, lifecycle: 'ended' } }])).toEqual([]);
  });
});
