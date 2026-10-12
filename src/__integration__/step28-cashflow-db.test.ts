/*
 * 현금흐름·당사자 식별 DB (migration 20261026000001 · save_contract). 모든 값은 가짜
 * - 새 칸(money_nature · direction_basis · payer/payee · fund 연결 · user_party_relation)은 보낸 경우에만 바뀐다
 *   → 예전 앱처럼 그 키 없이 다시 저장해도 값이 유지되고 결제 id·neutral 행이 그대로 (Golden 15)
 * - 돌려받을 돈 묶음은 한 계약에 여러 개 (보증금 + 예치금) · 계약 요약 보증금을 총액으로 쓰는 묶음은 계약당 하나
 * - 반환 기록은 별도 행 (원래 지급 행을 바꾸지 않음) · 본인만
 * - 내 계약자 정보(이름)는 본인만 읽고 쓴다 · 최대 5개 · 앞뒤 공백 없음
 */
import { EMPTY_DRAFT, recordToDraft } from '@/data/draft';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { fundViews } from '@/domain/cashflow';
import { monthSpending } from '@/domain/spending';

import { adminClient, newUser } from './helpers';

jest.setTimeout(120_000);

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
const rpc = async (c: unknown, args: Record<string, unknown>) => {
  const r = await (c as Rpc).rpc('save_contract', args);
  if (r.error) throw new Error(r.error.message);
  return r.data as string;
};
const contract = { title: '주택 임대차', category: 'real_estate', contract_kind: 'lease', deposit_amount: 20_000_000 };
const pay = (o: Record<string, unknown>) => ({ kind: 'other', label: '납부금', frequency: 'one_time', starts_on: '2026-10-10', amount: 1, ...o });
const payments = async (id: string) =>
  ((await adminClient().from('contract_payments').select('id, label, direction, money_nature, direction_basis, payer_role, payee_role, fund_id').eq('contract_id', id).order('sort_order')).data ?? []) as {
    id: string;
    label: string;
    direction: string;
    money_nature: string | null;
    direction_basis: string | null;
    payer_role: string | null;
    payee_role: string | null;
    fund_id: string | null;
  }[];
const funds = async (id: string) => (await adminClient().from('contract_funds').select('id, kind, label, total_amount, return_due_on').eq('contract_id', id).order('sort_order')).data ?? [];

test('새 칸 저장 · 묶음 여러 개 · 예전 앱처럼 다시 저장해도 유지', async () => {
  const a = await newUser('cf-db');
  const id = await rpc(a.client, {
    p_contract: { ...contract, user_party_role: 'lessee', user_party_relation: 'self' },
    p_funds: [
      { key: 'dep', kind: 'deposit', label: '보증금', total_amount: null },
      { key: 'esc', kind: 'escrow', label: '관리 예치금', total_amount: 300_000, return_due_on: '2027-10-31' },
    ],
    p_payments: [
      pay({ kind: 'down_payment', label: '보증금 계약금', amount: 2_000_000, direction: 'expense', money_nature: 'refundable_deposit', direction_basis: 'role', fund_key: 'dep' }),
      pay({ kind: 'balance_payment', label: '보증금 잔금', amount: 18_000_000, direction: 'expense', money_nature: 'refundable_deposit', direction_basis: 'role', fund_key: 'dep' }),
      pay({ label: '관리 예치금', amount: 300_000, direction: 'expense', money_nature: 'refundable_deposit', direction_basis: 'role', fund_key: 'esc' }),
      pay({ kind: 'rent', label: '월세', amount: 850_000, frequency: 'monthly', day_of_month: 25, direction: 'neutral', money_nature: 'ordinary', payer_role: 'lessee', payee_role: 'lessor' }),
      pay({ label: '예전 neutral', amount: 500_000, direction: 'neutral' }),
    ],
  });
  const f = await funds(id);
  expect(f.map((x) => [x.kind, x.label, x.total_amount])).toEqual([
    ['deposit', '보증금', null],
    ['escrow', '관리 예치금', 300_000],
  ]);
  const before = await payments(id);
  expect(before.map((p) => [p.label, p.direction, p.money_nature, p.direction_basis, p.fund_id])).toEqual([
    ['보증금 계약금', 'expense', 'refundable_deposit', 'role', f[0].id],
    ['보증금 잔금', 'expense', 'refundable_deposit', 'role', f[0].id],
    ['관리 예치금', 'expense', 'refundable_deposit', 'role', f[1].id],
    ['월세', 'neutral', 'ordinary', null, null],
    ['예전 neutral', 'neutral', null, null, null],
  ]);
  expect([before[3].payer_role, before[3].payee_role]).toEqual(['lessee', 'lessor']);

  // 예전 앱: 새 키 없이 같은 결제(id·방향)를 다시 보낸다 → 새 칸·묶음·역할 관계 유지, 결제 id 그대로
  await rpc(a.client, {
    p_contract_id: id,
    p_contract: { ...contract, title: '주택 임대차 (수정)' },
    p_payments: before.map((p) => ({ id: p.id, ...pay({ label: p.label, direction: p.direction, amount: 1000 }) })),
  });
  const after = await payments(id);
  expect(after.map((p) => p.id)).toEqual(before.map((p) => p.id));
  expect(after.map((p) => [p.direction, p.money_nature, p.direction_basis, p.payer_role, p.payee_role, p.fund_id])).toEqual(
    before.map((p) => [p.direction, p.money_nature, p.direction_basis, p.payer_role, p.payee_role, p.fund_id]),
  );
  expect(await funds(id)).toHaveLength(2);
  const c = (await adminClient().from('contracts').select('user_party_role, user_party_relation').eq('id', id).single()).data!;
  expect(c).toEqual({ user_party_role: 'lessee', user_party_relation: 'self' });

  // 반환 기록: 별도 행 · 원래 지급 행은 그대로
  const r1 = await a.client.from('fund_refunds').insert({ fund_id: f[0].id, amount: 5_000_000, refunded_on: '2027-11-01' });
  expect(r1.error).toBeNull();
  expect((await payments(id)).map((p) => [p.direction, p.money_nature])).toEqual(after.map((p) => [p.direction, p.money_nature]));

  // 새 앱이 묶음 목록을 보내면서 예치금을 뺀다 → 예치금 묶음 삭제, 결제 연결 해제(행은 남음)
  await rpc(a.client, {
    p_contract_id: id,
    p_contract: contract,
    p_funds: [{ id: f[0].id, key: f[0].id, kind: 'deposit', label: '보증금', total_amount: null }],
    p_payments: after.map((p) => ({ id: p.id, ...pay({ label: p.label, direction: p.direction }) })),
  });
  expect((await funds(id)).map((x) => x.id)).toEqual([f[0].id]);
  expect((await payments(id))[2].fund_id).toBeNull();
  expect((await adminClient().from('fund_refunds').select('id').eq('fund_id', f[0].id)).data).toHaveLength(1);
});

test('제약: 계약 요약 보증금 묶음은 계약당 하나 · 다른 계약의 묶음 연결 불가 · 반환 기록·이름은 본인만', async () => {
  const a = await newUser('cf-db2');
  const b = await newUser('cf-db3');
  await expect(
    rpc(a.client, {
      p_contract: contract,
      p_funds: [
        { key: 'x', kind: 'deposit', total_amount: null },
        { key: 'y', kind: 'deposit', total_amount: null },
      ],
    }),
  ).rejects.toThrow(/duplicate|unique/);
  // 예치금은 총액이 있어야 한다
  await expect(rpc(a.client, { p_contract: contract, p_funds: [{ key: 'x', kind: 'escrow', total_amount: null }] })).rejects.toThrow(/check/);
  const id1 = await rpc(a.client, { p_contract: contract, p_funds: [{ key: 'd', kind: 'deposit' }] });
  const f1 = (await funds(id1))[0];
  // 다른 계약의 묶음 id를 fund_key로 → 거부
  await expect(rpc(a.client, { p_contract: contract, p_payments: [pay({ fund_key: f1.id })] })).rejects.toThrow(/fund not found/);

  // 반환 기록: 다른 계정은 보지도 넣지도 못함
  await a.client.from('fund_refunds').insert({ fund_id: f1.id, amount: 100, refunded_on: '2027-01-01' });
  expect((await b.client.from('fund_refunds').select('id')).data).toEqual([]);
  expect((await b.client.from('fund_refunds').insert({ fund_id: f1.id, amount: 1, refunded_on: '2027-01-01' })).error).not.toBeNull();
  expect((await b.client.from('contract_funds').select('id')).data).toEqual([]);
  expect((await a.client.from('fund_refunds').insert({ fund_id: f1.id, amount: 0, refunded_on: '2027-01-01' })).error).not.toBeNull();

  // 내 계약자 정보: 본인만 · 최대 5개 · 앞뒤 공백 없음
  const me = a.user.id;
  expect((await a.client.from('profiles').update({ contract_names: ['박지훈', 'Park Jihoon'] }).eq('id', me)).error).toBeNull();
  expect((await a.client.from('profiles').select('contract_names').eq('id', me).single()).data!.contract_names).toEqual(['박지훈', 'Park Jihoon']);
  expect((await a.client.from('profiles').update({ contract_names: ['a', 'b', 'c', 'd', 'e', 'f'] }).eq('id', me)).error).not.toBeNull();
  expect((await a.client.from('profiles').update({ contract_names: [' 박지훈'] }).eq('id', me)).error).not.toBeNull();
  expect((await b.client.from('profiles').select('contract_names').eq('id', me)).data).toEqual([]);
  // 관계 값 제한
  await expect(rpc(a.client, { p_contract: { ...contract, user_party_relation: 'friend' } })).rejects.toThrow(/check/);
});

test('저장소: 예전 계약(묶음 없음)의 보증금 반환 기록 → 묶음을 만들고 연결 · 결제 id·방향 그대로 · 반환 상태 계산 · 다시 저장해도 중복 없음', async () => {
  const a = await newUser('cf-repo');
  const repo = new SupabaseContractRepository(a.client, () => '2026-10-08');
  const P = { frequency: 'one_time' as const, dayOfMonth: null, monthOfYear: null, endsOn: null, installmentCount: null, isVariable: false, components: [], businessDayRule: 'none' as const, obligation: 'confirmed' as const, conditionNote: null };
  // 예전 앱처럼: 묶음·새 칸 없이 neutral 보증금 몫만
  const created = await repo.create({
    draft: {
      ...EMPTY_DRAFT,
      title: '예전 전세',
      contractKind: 'lease',
      contractType: 'lease',
      category: 'real_estate',
      startDate: '2026-10-20',
      endDate: '2028-10-19',
      depositAmount: 20_000_000,
      userPartyRole: 'lessee',
      payments: [
        { ...P, kind: 'down_payment', direction: 'neutral', label: '계약금', amount: 2_000_000, startsOn: '2026-10-08' },
        { ...P, kind: 'balance_payment', direction: 'neutral', label: '잔금', amount: 18_000_000, startsOn: '2026-10-20' },
      ],
    },
    source: 'manual',
    documents: [],
    aiChecks: [],
  });
  const before = created.payments.map((p) => [p.id, p.direction]);
  expect(created.funds).toEqual([]);
  expect(fundViews(created, '2026-10-08').map((v) => [v.key, v.total, v.userSide])).toEqual([['summary', 20_000_000, 'depositor']]);

  const r1 = await repo.addRefund(created.contract.id, 'summary', { amount: 5_000_000, refundedOn: '2028-10-19' });
  expect(r1.funds!.map((f) => [f.kind, f.totalAmount, f.refunds.map((x) => x.amount)])).toEqual([['deposit', null, [5_000_000]]]);
  expect(r1.payments.map((p) => [p.id, p.direction])).toEqual(before);
  expect(r1.payments.every((p) => p.fundId === r1.funds![0].id)).toBe(true);
  const v = fundViews(r1, '2028-10-20')[0];
  expect([v.status, v.remaining, v.refundDirection]).toEqual(['partial', 15_000_000, 'income']);
  expect(monthSpending([r1], { year: 2028, month: 10 }, '2028-10-20')).toMatchObject({ incomeTotal: 5_000_000, depositIn: 5_000_000 });

  // 두 번째 반환은 저장된 묶음 id로 · 다시 저장해도 묶음·반환 기록이 늘지 않음
  const r2 = await repo.addRefund(created.contract.id, r1.funds![0].id, { amount: 15_000_000, refundedOn: '2028-11-01' });
  const again = await repo.update(created.contract.id, recordToDraft(r2));
  expect(again.funds!.length).toBe(1);
  expect(again.funds![0].refunds.map((x) => x.amount)).toEqual([5_000_000, 15_000_000]);
  expect(fundViews(again, '2028-11-02')[0].status).toBe('returned');
  const r3 = await repo.removeRefund(created.contract.id, again.funds![0].refunds[1].id);
  expect(fundViews(r3, '2028-11-02')[0].status).toBe('partial');
});
