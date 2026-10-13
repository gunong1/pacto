/*
 * 이미 등록된 계약의 보증금 계약금·잔금 정정 (로컬 Supabase) — 모든 값은 가짜
 * 실기기 테스트(2026-10-13): 표 형식 임대차계약서의 계약금·잔금이 일반 결제로 저장돼 홈에서 일반 지출로 집계됨.
 * 정정 방법: 계약 수정 화면에서 그 결제의 "이 돈의 성격"을 보증금·예치금으로 바꿔 저장 (save_contract).
 * - 결제 id · 다른 결제의 금액 변경 이력 · 묶음 연결은 그대로 (지우고 다시 만들지 않음)
 * - 저장 후 홈(monthSpending)·상세(fundViews)가 기대값과 일치 · 이후 반환 기록도 가능
 */
import { EMPTY_DRAFT, recordToDraft } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { fundViews } from '@/domain/cashflow';
import { monthSpending } from '@/domain/spending';

import { newUser } from './helpers';

jest.setTimeout(120_000);

const TODAY = '2026-10-08';
const base: Omit<PaymentDraft, 'kind' | 'label' | 'amount'> = { direction: 'expense', frequency: 'one_time', dayOfMonth: null, monthOfYear: null, startsOn: '2026-10-08', endsOn: null, installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null, moneyNature: 'ordinary' };
const draft: ContractDraft = {
  ...EMPTY_DRAFT,
  title: '테스트 주택 임대차',
  category: 'real_estate',
  contractType: 'lease',
  contractKind: 'lease',
  userPartyRole: 'lessee',
  startDate: '2026-10-20',
  endDate: '2028-10-19',
  depositAmount: 20_000_000,
  payments: [
    // 실기기와 같은 잘못된 저장 상태: 계약금·잔금이 일반 결제
    { ...base, kind: 'down_payment', label: '계약금', amount: 2_000_000 },
    { ...base, kind: 'balance_payment', label: '잔금', amount: 18_000_000, startsOn: '2026-10-20' },
    { ...base, kind: 'rent', label: '월세', amount: 850_000, frequency: 'monthly', dayOfMonth: 20, startsOn: '2026-10-20' },
  ],
};
const isPart = (label: string) => label === '계약금' || label === '잔금';
const OCT = { year: 2026, month: 10 } as const;

test('계약금·잔금 성격만 보증금으로 정정 — id·이력·연결 유지, 홈·상세 기대값', async () => {
  const a = await newUser('deposit-part-fix');
  const repo = new SupabaseContractRepository(a.client, () => TODAY);
  const created = await repo.create({ draft, source: 'manual', documents: [], aiChecks: [] });
  const id = created.contract.id;
  const rent = created.payments.find((p) => p.label === '월세')!;
  const saved = await repo.update(id, recordToDraft(created), [{ op: 'add', paymentId: rent.id, effectiveFrom: '2026-12-20', amount: 900_000 }]);

  // 정정 전: 실기기와 같은 잘못된 집계 (계약금·잔금이 일반 지출)
  const wrong = monthSpending([saved], OCT, TODAY);
  expect([wrong.total, wrong.ordinaryExpense, wrong.depositOut]).toEqual([20_850_000, 20_850_000, 0]);

  const snapshot = (r: typeof saved) => r.payments.map((p) => ({ id: p.id, label: p.label, amount: p.amount, startsOn: p.startsOn, direction: p.direction, fundId: p.fundId ?? null }));
  const before = snapshot(saved);
  const changes = saved.payments.find((p) => p.id === rent.id)!.amountChanges!.map((c) => [c.id, c.effectiveFrom, c.amount]);

  // 정정: 계약 수정 화면에서 성격만 바꿔 저장
  const d = recordToDraft(saved);
  const fixed = await repo.update(id, { ...d, payments: d.payments.map((p) => (isPart(p.label) ? { ...p, moneyNature: 'refundable_deposit' as const } : p)) });

  expect(snapshot(fixed)).toEqual(before);
  expect(fixed.payments.filter((p) => isPart(p.label)).map((p) => p.moneyNature)).toEqual(['refundable_deposit', 'refundable_deposit']);
  expect(fixed.payments.find((p) => p.id === rent.id)!.amountChanges!.map((c) => [c.id, c.effectiveFrom, c.amount])).toEqual(changes);

  // 홈: 일반 850,000 + 보증금 20,000,000 (보증금 총액을 따로 더하지 않음)
  const oct = monthSpending([fixed], OCT, TODAY);
  expect([oct.total, oct.ordinaryExpense, oct.depositOut]).toEqual([20_850_000, 850_000, 20_000_000]);
  // 상세: 보증금 20,000,000 = 계약금 + 잔금
  const [fund] = fundViews(fixed, TODAY);
  expect(fund.total).toBe(20_000_000);
  expect(fund.members.map((p) => p.amount).sort((x, y) => x - y)).toEqual([2_000_000, 18_000_000]);

  // 이후 반환 기록: 묶음이 만들어지고 계약금·잔금이 연결됨 (결제 id 그대로)
  const refunded = await repo.addRefund(id, fund.key, { amount: 20_000_000, refundedOn: '2028-10-19' });
  expect(refunded.payments.map((p) => p.id)).toEqual(before.map((p) => p.id));
  const linked = refunded.payments.filter((p) => isPart(p.label)).map((p) => p.fundId);
  expect(linked[0]).toBeTruthy();
  expect(linked[1]).toBe(linked[0]);
  expect(refunded.payments.find((p) => p.id === rent.id)!.fundId ?? null).toBeNull();
});
