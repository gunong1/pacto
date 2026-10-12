/**
 * 당사자 자동 연결 · 지급 방향 — 이번 수정 전에 저장된 계약(로컬 DB, 모든 값은 가짜)
 * - 예전 모양: 렌탈 계약인데 당사자 임대인·임차인, 결제 지급자 임차인 · 방향 neutral(확인 필요)
 * - 읽을 때 같은 규칙: 렌탈회사(임대인)·고객(임차인), 방향 출금 → 10월 5,769,000 (DB는 그대로)
 * - 다시 저장하면 정리된 값이 저장되고 결제 id·보증금 묶음은 그대로
 * - 사용자가 직접 고른 방향은 바뀌지 않음
 */
import { recordToDraft } from '@/data/draft';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { monthSpending } from '@/domain/spending';

import { adminClient, newUser } from './helpers';

jest.setTimeout(60_000);

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
const TODAY = '2026-10-09';
const pay = (o: Record<string, unknown>) => ({ kind: 'other', frequency: 'one_time', amount: 1, direction: 'neutral', ...o });

async function seedLegacy(prefix: string, userDirection = false) {
  const a = await newUser(prefix);
  const r = await (a.client as unknown as Rpc).rpc('save_contract', {
    p_contract: {
      title: '자동차 장기렌트 계약서', category: 'rental', contract_type: 'recurring', contract_kind: 'rental', contract_subtype: 'vehicle',
      start_date: '2026-10-20', end_date: '2030-10-19', deposit_amount: 5_000_000,
      parties: [{ role: 'lessor', name: '주식회사 팩토렌터카' }, { role: 'lessee', name: '김도윤' }],
    },
    p_funds: [{ key: 'dep', kind: 'deposit', label: '보증금', total_amount: null }],
    p_payments: [
      pay({ kind: 'deposit', label: '보증금', amount: 5_000_000, starts_on: '2026-10-20', money_nature: 'refundable_deposit', payer_role: 'lessee', payee_role: 'lessor', fund_key: 'dep' }),
      pay({ kind: 'rent', label: '월 렌트료', amount: 649_000, frequency: 'monthly', day_of_month: 20, starts_on: '2026-10-20', money_nature: 'ordinary', payer_role: 'lessee', payee_role: 'lessor', ...(userDirection ? { direction: 'income', direction_basis: 'user' } : {}) }),
      pay({ kind: 'setup_fee', label: '초기 등록대행비', amount: 120_000, starts_on: '2026-10-20', money_nature: 'ordinary', payer_role: 'lessee', payee_role: 'lessor' }),
    ],
  });
  if (r.error) throw new Error(r.error.message);
  return { a, id: r.data as string, repo: new SupabaseContractRepository(a.client, () => TODAY) };
}
const dbPayments = async (id: string) =>
  ((await adminClient().from('contract_payments').select('id, label, direction, direction_basis, payer_role, payee_role, fund_id').eq('contract_id', id).order('sort_order')).data ?? []) as Record<string, unknown>[];

test('예전 저장 계약: 읽기 → 렌탈회사·고객 · 10월 5,769,000 · 11월 649,000 (DB는 그대로)', async () => {
  const { id, repo } = await seedLegacy('roles-read');
  const before = await dbPayments(id);
  const rec = (await repo.get(id))!;
  expect(rec.contract.parties).toEqual([{ role: 'provider', name: '주식회사 팩토렌터카', term: '임대인' }, { role: 'customer', name: '김도윤', term: '임차인' }]);
  expect(rec.payments.map((p) => [p.id, p.direction, p.payerRole])).toEqual(before.map((p) => [p.id, 'expense', 'customer']));
  expect(monthSpending([rec], { year: 2026, month: 10 }, TODAY)).toMatchObject({ total: 5_769_000, ordinaryExpense: 769_000, depositOut: 5_000_000, undeterminedTotal: 0 });
  expect(monthSpending([rec], { year: 2026, month: 11 }, TODAY)).toMatchObject({ total: 649_000, undeterminedTotal: 0 });
  expect(await dbPayments(id)).toEqual(before); // 읽기만으로 DB를 바꾸지 않음
});

test('다시 저장: 정리된 값 저장 · 결제 id·보증금 묶음 연결 그대로', async () => {
  const { id, repo } = await seedLegacy('roles-save');
  const before = await dbPayments(id);
  await repo.update(id, recordToDraft((await repo.get(id))!));
  const after = await dbPayments(id);
  expect(after.map((p) => p.id)).toEqual(before.map((p) => p.id));
  expect(after.map((p) => p.fund_id)).toEqual(before.map((p) => p.fund_id));
  expect(after.map((p) => [p.direction, p.direction_basis, p.payer_role, p.payee_role])).toEqual(before.map(() => ['expense', 'contract', 'customer', 'provider']));
  const row = (await adminClient().from('contracts').select('parties').eq('id', id).single()).data!;
  expect(row.parties).toEqual([{ role: 'provider', name: '주식회사 팩토렌터카', term: '임대인' }, { role: 'customer', name: '김도윤', term: '임차인' }]);
});

test('사용자가 직접 고른 방향은 덮어쓰지 않음', async () => {
  const { id, repo } = await seedLegacy('roles-user', true);
  const rec = (await repo.get(id))!;
  expect(rec.payments.map((p) => [p.label, p.direction, p.directionBasis])).toEqual([
    ['보증금', 'expense', 'contract'],
    ['월 렌트료', 'income', 'user'],
    ['초기 등록대행비', 'expense', 'contract'],
  ]);
});
