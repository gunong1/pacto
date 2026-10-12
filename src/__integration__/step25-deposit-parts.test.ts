/*
 * 보증금의 계약금·잔금 = 보증금 자금 이동 — 저장된 계약 일회성 정리 (migration 20261023000002, 분석 규칙 R7과 같은 규칙). 모든 값은 가짜
 * - 이전에 지출로 저장된 계약금 2,000,000 · 잔금 18,000,000 (보증금 20,000,000) → 방향만 neutral, 일정·금액·행은 그대로
 * - 합이 보증금과 맞지 않으면 건드리지 않음
 */
import { EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { monthSpending } from '@/domain/spending';

import { adminClient, newUser } from './helpers';

jest.setTimeout(120_000);

const once = (label: string, amount: number, startsOn: string): PaymentDraft => ({
  kind: label === '계약금' ? 'down_payment' : 'balance_payment', direction: 'expense', label, amount, frequency: 'one_time', dayOfMonth: null, monthOfYear: null, startsOn, endsOn: null,
  installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null,
});
const monthly = (label: string, amount: number): PaymentDraft => ({ ...once(label, amount, '2026-10-20'), kind: label === '월세' ? 'rent' : 'maintenance_fee', frequency: 'monthly', dayOfMonth: 20 });
const lease = (balance: number): ContractDraft => ({
  ...EMPTY_DRAFT, title: '주택 월세 임대차', category: 'real_estate', contractType: 'lease', startDate: '2026-10-20', endDate: '2028-10-19', depositAmount: 20_000_000,
  payments: [once('계약금', 2_000_000, '2026-10-08'), once('잔금', balance, '2026-10-20'), monthly('월세', 850_000), monthly('관리비', 100_000)],
});

test('이전에 지출로 저장된 보증금의 계약금·잔금 → 보증금 자금 이동(neutral), 월 지출은 월세·관리비만 · 합이 다르면 그대로', async () => {
  const a = await newUser('deposit-parts');
  const repo = new SupabaseContractRepository(a.client, () => '2026-10-08');
  const ok = await repo.create({ draft: lease(18_000_000), source: 'upload', documents: [], aiChecks: [] });
  const off = await repo.create({ draft: lease(17_000_000), source: 'upload', documents: [], aiChecks: [] });
  // 이전 버전 저장 상태: 계약금·잔금이 지출
  expect(monthSpending([(await repo.get(ok.contract.id))!], { year: 2026, month: 10 }).total).toBe(20_950_000);

  const { error } = await adminClient().rpc('mark_deposit_installment_parts' as never);
  expect(error).toBeNull();

  const fixed = (await repo.get(ok.contract.id))!;
  expect(fixed.payments.map((p) => [p.label, p.direction, p.startsOn, p.amount])).toEqual([
    ['계약금', 'neutral', '2026-10-08', 2_000_000],
    ['잔금', 'neutral', '2026-10-20', 18_000_000],
    ['월세', 'expense', '2026-10-20', 850_000],
    ['관리비', 'expense', '2026-10-20', 100_000],
  ]);
  const oct = monthSpending([fixed], { year: 2026, month: 10 });
  expect([oct.total, oct.depositTotal]).toEqual([950_000, 20_000_000]);
  expect(fixed.contract.depositAmount).toBe(20_000_000);

  // 합이 보증금과 맞지 않으면 바꾸지 않음
  expect((await repo.get(off.contract.id))!.payments.filter((p) => p.frequency === 'one_time').map((p) => p.direction)).toEqual(['expense', 'expense']);
});
