/*
 * 구버전 앱(APK) 회귀 — 새 앱이 저장한 계약을 예전 앱이 수정·저장해도 새 정보가 유실·중복되지 않는지 (save_contract). 모든 값은 가짜
 * 예전 앱이 실제로 보내던 저장 형식 그대로 재현한다 (git 기록의 SupabaseContractRepository.contractPayload/paymentsPayload)
 *   A. 3단계 앱 (90149f4): parties·user_party_role은 보내고, money_nature·fund·user_party_relation은 모름. 결제 id 보냄
 *   B. 당사자 이전 앱 (cc2c80b ~ 90149f4 이전): parties 키 없음, 결제 id 보냄
 *   C. 금액 변경 이력 이전 앱 (cc2c80b 이전): 결제 id를 보내지 않음 → 서버가 결제를 지우고 새로 만들면 성격·묶음 연결·변경 이력이 사라진다
 * 수정(20261026000002): C처럼 지울 결제에 예전 앱이 다시 만들 수 없는 정보가 있으면 저장 전체를 멈춘다 (부분 반영 없음)
 * 확인: money_nature · direction_basis · payer/payee · fund 연결 · parties · 내 역할·관계 · 결제 id(지급 일정) · 금액 변경 이력 · 묶음 · 반환 기록 · 행 수(중복)
 */
import { execFileSync } from 'node:child_process';

import { adminClient, newUser } from './helpers';

jest.setTimeout(120_000);

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };
const save = async (c: unknown, args: Record<string, unknown>) => {
  const r = await (c as Rpc).rpc('save_contract', args);
  if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
  return r.data as string;
};

const PAY_COLS = 'id, kind, direction, label, amount, frequency, day_of_month, month_of_year, starts_on, ends_on, installment_count, is_variable, components, business_day_rule, obligation, condition_note, money_nature, direction_basis, payer_role, payee_role, fund_id';
type PayRow = Record<string, unknown> & { id: string; label: string };
const state = async (id: string) => {
  const db = adminClient();
  const c = (await db.from('contracts').select('parties, user_party_role, user_party_relation').eq('id', id).single()).data!;
  const payments = ((await db.from('contract_payments').select(PAY_COLS).eq('contract_id', id).order('sort_order')).data ?? []) as PayRow[];
  const funds = (await db.from('contract_funds').select('id, kind, total_amount').eq('contract_id', id)).data ?? [];
  const refunds = (await db.from('fund_refunds').select('id, amount').in('fund_id', funds.map((f) => f.id))).data ?? [];
  const changes = (await db.from('contract_payment_changes').select('id, payment_id, amount').in('payment_id', payments.map((p) => p.id))).data ?? [];
  return { c, payments, funds, refunds, changes };
};

/** 새 앱으로 저장한 임차인 임대차 (보증금 묶음 + 반환 기록 + 월세 금액 변경 이력) */
async function seed(prefix: string) {
  const a = await newUser(prefix);
  const id = await save(a.client, {
    p_contract: {
      title: '주택 임대차', category: 'real_estate', contract_kind: 'lease', contract_type: 'lease', deposit_amount: 20_000_000,
      start_date: '2026-10-20', end_date: '2028-10-19',
      parties: [{ role: 'lessor', name: '김민수' }, { role: 'lessee', name: '박지훈' }],
      user_party_role: 'lessee', user_party_relation: 'self',
    },
    p_funds: [{ key: 'dep', kind: 'deposit', label: '보증금', total_amount: null }],
    p_payments: [
      { kind: 'down_payment', direction: 'expense', label: '계약금', amount: 2_000_000, frequency: 'one_time', starts_on: '2026-10-08', money_nature: 'refundable_deposit', direction_basis: 'role', fund_key: 'dep' },
      { kind: 'balance_payment', direction: 'expense', label: '잔금', amount: 18_000_000, frequency: 'one_time', starts_on: '2026-10-20', money_nature: 'refundable_deposit', direction_basis: 'role', fund_key: 'dep' },
      { kind: 'rent', direction: 'expense', label: '월세', amount: 850_000, frequency: 'monthly', day_of_month: 20, starts_on: '2026-10-20', money_nature: 'ordinary', direction_basis: 'role', payer_role: 'lessee', payee_role: 'lessor' },
    ],
  });
  const s0 = await state(id);
  const rent = s0.payments.find((p) => p.label === '월세')!;
  await save(a.client, { p_contract_id: id, p_contract: { title: '주택 임대차', category: 'real_estate', contract_type: 'lease', deposit_amount: 20_000_000, start_date: '2026-10-20', end_date: '2028-10-19' }, p_amount_changes: [{ op: 'add', payment_id: rent.id, effective_from: '2027-10-20', amount: 900_000 }] });
  expect((await a.client.from('fund_refunds').insert({ fund_id: s0.funds[0].id, amount: 5_000_000, refunded_on: '2028-10-19' })).error).toBeNull();
  return { a, id, before: await state(id) };
}

/** 예전 앱이 읽어 다시 보내는 결제 (예전 앱이 알던 칸만). 금액 변경 이력 이후 앱은 id 키를 늘 보낸다 (새 결제는 null) */
const oldPayment = (p: PayRow, withId: boolean) => ({
  ...(withId ? { id: p.id } : {}),
  kind: p.kind, direction: p.direction, label: p.label, amount: p.amount, frequency: p.frequency, day_of_month: p.day_of_month, month_of_year: p.month_of_year,
  starts_on: p.starts_on, ends_on: p.ends_on, installment_count: p.installment_count, is_variable: p.is_variable, components: p.components,
  business_day_rule: p.business_day_rule, obligation: p.obligation, condition_note: p.condition_note,
});
const oldContract = (extra: Record<string, unknown> = {}) => ({ title: '주택 임대차 (예전 앱에서 수정)', category: 'real_estate', contract_type: 'lease', counterparty: null, deposit_amount: 20_000_000, start_date: '2026-10-20', end_date: '2028-10-19', memo: '예전 앱 메모', ...extra });

const expectPreserved = (before: Awaited<ReturnType<typeof state>>, after: Awaited<ReturnType<typeof state>>) => {
  // 결제 id(지급 일정) · 성격 · 근거 · 지급자 · 묶음 연결 그대로, 행 수 그대로(중복 없음)
  expect(after.payments.map((p) => [p.id, p.label, p.direction, p.money_nature, p.direction_basis, p.payer_role, p.payee_role, p.fund_id])).toEqual(
    before.payments.map((p) => [p.id, p.label, p.direction, p.money_nature, p.direction_basis, p.payer_role, p.payee_role, p.fund_id]),
  );
  expect(after.funds).toEqual(before.funds);
  expect(after.refunds).toEqual(before.refunds);
  expect(after.changes).toEqual(before.changes);
  expect([after.c.user_party_role, after.c.user_party_relation]).toEqual(['lessee', 'self']);
};

test('A. 3단계 앱(parties 보냄, 새 칸 모름): 수정·저장해도 성격·묶음·반환 기록·변경 이력 유지 · 중복 없음 · 당사자 그대로', async () => {
  const { a, id, before } = await seed('oldapk-a');
  await save(a.client, {
    p_contract_id: id,
    p_contract: oldContract({ contract_kind: 'lease', parties: before.c.parties, user_party_role: 'lessee' }),
    p_payments: before.payments.map((p) => oldPayment(p, true)),
    p_dates: [],
    p_amount_changes: [],
  });
  const after = await state(id);
  expectPreserved(before, after);
  expect(after.c.parties).toEqual(before.c.parties);
});

test('B. 당사자 이전 앱(parties 키 없음): 당사자·내 역할 그대로 · 나머지 유지', async () => {
  const { a, id, before } = await seed('oldapk-b');
  await save(a.client, { p_contract_id: id, p_contract: oldContract(), p_payments: before.payments.map((p) => oldPayment(p, true)), p_dates: [], p_amount_changes: [] });
  const after = await state(id);
  expectPreserved(before, after);
  expect(after.c.parties).toEqual(before.c.parties);
});

test('B2. 예전 앱이 결제 하나를 지우고 하나를 추가: 남은 결제는 그대로 · 새 결제는 성격 없음(예전 데이터처럼) · 묶음·반환 기록 유지', async () => {
  const { a, id, before } = await seed('oldapk-b2');
  const kept = before.payments.filter((p) => p.label !== '월세');
  await save(a.client, {
    p_contract_id: id,
    p_contract: oldContract(),
    p_payments: [...kept.map((p) => oldPayment(p, true)), { id: null, kind: 'maintenance_fee', direction: 'expense', label: '관리비', amount: 100_000, frequency: 'monthly', day_of_month: 20, starts_on: '2026-10-20' }],
  });
  const after = await state(id);
  expect(after.payments.map((p) => [p.label, p.money_nature, p.fund_id])).toEqual([
    ['계약금', 'refundable_deposit', before.funds[0].id],
    ['잔금', 'refundable_deposit', before.funds[0].id],
    ['관리비', null, null],
  ]);
  expect([after.funds.length, after.refunds.length]).toEqual([1, 1]);
});

test('C. 금액 변경 이력 이전 앱(결제 id 없이 보냄): 새 정보가 있는 계약은 저장을 막고 업데이트 안내 · 아무것도 바뀌지 않음', async () => {
  const { a, id, before } = await seed('oldapk-c');
  await expect(save(a.client, { p_contract_id: id, p_contract: oldContract(), p_payments: before.payments.map((p) => oldPayment(p, false)), p_dates: [] })).rejects.toThrow(/앱을 최신 버전으로 업데이트/);
  const after = await state(id);
  expectPreserved(before, after);
  expect((await adminClient().from('contracts').select('title').eq('id', id).single()).data!.title).toBe('주택 임대차');
});

test('C2. 같은 예전 앱이라도 새 정보가 없는 예전 계약·새 계약은 지금처럼 저장된다 (막지 않음)', async () => {
  const a = await newUser('oldapk-c2');
  const id = await save(a.client, { p_contract: oldContract(), p_payments: [{ kind: 'rent', direction: 'expense', label: '월세', amount: 700_000, frequency: 'monthly', day_of_month: 5, starts_on: '2026-11-05' }] });
  const s = await state(id);
  await save(a.client, { p_contract_id: id, p_contract: oldContract({ memo: '수정' }), p_payments: s.payments.map((p) => ({ ...oldPayment(p, false), amount: 750_000 })) });
  expect((await state(id)).payments.map((p) => [p.label, p.amount])).toEqual([['월세', 750_000]]);
});

test('C3. 금액 변경 이력만 있는 예전 계약(새 칸 없음)도 결제 id 없는 저장은 차단 — 이력 보존', async () => {
  const a = await newUser('oldapk-c3');
  const id = await save(a.client, { p_contract: oldContract(), p_payments: [{ kind: 'rent', direction: 'expense', label: '월세', amount: 700_000, frequency: 'monthly', day_of_month: 5, starts_on: '2026-11-05' }] });
  const rent = (await state(id)).payments[0];
  await save(a.client, { p_contract_id: id, p_contract: oldContract(), p_amount_changes: [{ op: 'add', payment_id: rent.id, effective_from: '2027-11-05', amount: 750_000 }] });
  const before = await state(id);
  await expect(save(a.client, { p_contract_id: id, p_contract: oldContract(), p_payments: before.payments.map((p) => oldPayment(p, false)) })).rejects.toThrow(/업데이트/);
  const after = await state(id);
  expect([after.payments.map((p) => p.id), after.changes]).toEqual([before.payments.map((p) => p.id), before.changes]);
});

test('검사 범위 고정: 결제 행의 모든 칸·결제를 가리키는 모든 참조가 "예전 앱이 보내는 칸" 또는 차단 조건에 들어 있다', () => {
  const psql = (sql: string) =>
    execFileSync('docker', ['exec', 'supabase_db_pacto', 'psql', '-U', 'postgres', '-At', '-c', sql], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
  // 예전 앱(결제 id 없음)이 보내거나 서버가 다시 채우는 칸
  const oldClient = ['id', 'contract_id', 'user_id', 'kind', 'direction', 'label', 'amount', 'currency', 'frequency', 'day_of_month', 'month_of_year', 'starts_on', 'ends_on', 'installment_count', 'is_variable', 'components', 'business_day_rule', 'obligation', 'condition_note', 'sort_order', 'created_at', 'updated_at'];
  // save_contract 차단 조건이 검사하는 칸 (20261026000002)
  const guarded = ['money_nature', 'direction_basis', 'payer_role', 'payee_role', 'fund_id'];
  expect(psql("select column_name from information_schema.columns where table_schema='public' and table_name='contract_payments'")).toEqual([...oldClient, ...guarded].sort());
  // 결제를 가리키는 외래키 — 차단 조건이 검사하는 참조 (금액 변경 이력)
  expect(psql("select conrelid::regclass::text from pg_constraint where contype='f' and confrelid='public.contract_payments'::regclass")).toEqual(['contract_payment_changes']);
});
