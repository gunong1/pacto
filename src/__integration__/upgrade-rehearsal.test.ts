/**
 * 운영 업그레이드 리허설 2단계 — 마이그레이션 4개 적용 후 검증 (REHEARSAL_SEED 가 있을 때만 실행. 일반 통합 테스트에서는 건너뜀)
 * 확인: 기존 계약·결제 id·금액·방향·금액 변경 이력 보존 · 새 칸은 비어 있음 · RLS · 예전 앱 저장 호환 · 새 앱 읽기/합계 · 보증금 묶음 연결
 * 사용: scripts/upgrade-rehearsal/README.md
 */
import fs from 'node:fs';

import { recordToDraft, withSummaryFund } from '@/data/draft';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { monthSpending } from '@/domain/spending';

import { adminClient, anonClient } from './helpers';

const SEED = process.env.REHEARSAL_SEED;
const d = SEED ? describe : describe.skip;
jest.setTimeout(60_000);

d('업그레이드 리허설 (예전 스키마 데이터 → 마이그레이션 4개 → 새 앱)', () => {
  const seed = SEED ? JSON.parse(fs.readFileSync(SEED, 'utf8')) : null;
  const ids = seed ? [seed.c1, seed.c2, seed.c3, seed.cb] : [];
  const login = async (userId: string) => {
    const { data } = await adminClient().auth.admin.getUserById(userId);
    const c = anonClient();
    const s = await c.auth.signInWithPassword({ email: data.user!.email!, password: 'rehearsal-password-1' });
    if (s.error) throw s.error;
    return c;
  };

  test('1. 기존 계약·결제 id·금액·방향·금액 변경 이력 그대로 · 새 칸은 비어 있음', async () => {
    const db = adminClient();
    const contracts = (await db.from('contracts').select('id, title, user_id, source, deposit_amount, parties, user_party_role, user_party_relation').in('id', ids).order('title')).data!;
    expect(contracts.map(({ user_party_relation: _r, ...c }) => c)).toEqual(seed.before.contracts);
    expect(contracts.every((c) => c.user_party_relation === null)).toBe(true);
    const payments = (await db.from('contract_payments').select('id, contract_id, label, amount, direction, frequency, day_of_month, starts_on, money_nature, direction_basis, payer_role, payee_role, fund_id').in('contract_id', ids).order('id')).data!;
    expect(payments.map(({ money_nature: _a, direction_basis: _b, payer_role: _c, payee_role: _d, fund_id: _e, ...p }) => p)).toEqual(seed.before.payments);
    expect(payments.every((p) => p.money_nature === null && p.direction_basis === null && p.payer_role === null && p.fund_id === null)).toBe(true);
    expect((await db.from('contract_payment_changes').select('id, payment_id, effective_from, amount, change_reason').order('id')).data).toEqual(seed.before.changes);
    expect((await db.from('contract_funds').select('id', { count: 'exact', head: true })).count).toBe(0);
    expect((await db.from('notification_preferences').select('categories').eq('user_id', seed.userA).single()).data).toEqual(seed.prefs);
  });

  test('2. 새 앱 읽기: 예전 값 그대로 해석 — 예전 출금은 합계 유지(계약서 등록분은 자동 판단 표시), 보증금 몫 neutral은 확인 필요', async () => {
    const repo = new SupabaseContractRepository(await login(seed.userA), () => '2026-10-12');
    const list = await repo.list();
    expect(list.map((r) => r.contract.title).sort()).toEqual(['음악 구독 (직접 입력)', '정수기 렌탈 (예전 앱)', '주택 임대차 (예전 앱)']);
    const oct = monthSpending(list, { year: 2026, month: 10 }, '2026-10-12');
    // 월세 850,000(자동 판단) + 렌탈 29,900(자동 판단) + 구독 10,900(직접 입력) · 보증금 몫 20,000,000은 역할 확인 전이라 제외
    expect(oct).toMatchObject({ total: 890_800, autoExpense: 879_900, undeterminedTotal: 20_000_000 });
    // 금액 변경 이력 반영 (2027-10부터 900,000)
    expect(monthSpending(list, { year: 2027, month: 11 }, '2026-10-12').items.find((i) => i.label === '월세')?.amount).toBe(900_000);
  });

  test('3. RLS: 다른 사용자는 계약·결제·보증금 묶음·반환 기록을 읽거나 쓸 수 없음', async () => {
    const a = await login(seed.userA);
    const b = await login(seed.userB);
    const repoA = new SupabaseContractRepository(a, () => '2026-10-12');
    const withFund = await repoA.update(seed.c1, withSummaryFund(recordToDraft((await repoA.get(seed.c1))!)));
    const fundId = withFund.funds![0].id;
    expect((await b.from('contracts').select('id').eq('id', seed.c1)).data).toEqual([]);
    expect((await b.from('contract_payments').select('id').eq('contract_id', seed.c1)).data).toEqual([]);
    expect((await b.from('contract_funds').select('id').eq('id', fundId)).data).toEqual([]);
    expect((await b.from('fund_refunds').insert({ fund_id: fundId, amount: 1, refunded_on: '2027-01-01' })).error).not.toBeNull();
    expect((await anonClient().from('contract_funds').select('id')).data ?? []).toEqual([]);
  });

  test('4. 보증금 묶음 연결 후 결제 id·금액 변경 이력 그대로 · 예전 앱(결제 id 보냄)이 다시 저장해도 연결 유지', async () => {
    const a = await login(seed.userA);
    const db = adminClient();
    const before = (await db.from('contract_payments').select('id, fund_id').eq('contract_id', seed.c1).order('id')).data!;
    expect(before.filter((p) => p.fund_id).length).toBe(2); // 계약금·잔금이 보증금 묶음에 연결 (3번 테스트에서)
    const r = await a.rpc('save_contract', {
      p_contract_id: seed.c1,
      p_contract: { title: '주택 임대차 (예전 앱)', category: 'real_estate', contract_type: 'lease', contract_kind: 'lease', start_date: '2026-10-20', end_date: '2028-10-19', deposit_amount: 20_000_000 },
      p_payments: seed.before.payments.filter((p: { contract_id: string }) => p.contract_id === seed.c1).map((p: Record<string, unknown>) => ({ id: p.id, kind: 'other', label: p.label, amount: p.amount, direction: p.direction, frequency: p.frequency, day_of_month: p.day_of_month, starts_on: p.starts_on, is_variable: false, business_day_rule: 'none', obligation: 'confirmed' })),
    });
    expect(r.error).toBeNull();
    const after = (await db.from('contract_payments').select('id, fund_id').eq('contract_id', seed.c1).order('id')).data!;
    expect(after).toEqual(before);
    expect((await db.from('contract_payment_changes').select('id').order('id')).data!.map((c) => c.id)).toEqual(seed.before.changes.map((c: { id: string }) => c.id));
  });

  test('5. 결제 id 없이 저장하는 아주 예전 앱: 금액 변경 이력이 있는 계약은 저장 전체 중단(데이터 유지) · 이력 없는 계약은 그대로 저장', async () => {
    const a = await login(seed.userA);
    const legacy = (title: string, label: string, amount: number) => ({ p_contract: { title, category: 'rental', contract_type: 'recurring' }, p_payments: [{ kind: 'recurring_fee', label, amount, direction: 'expense', frequency: 'monthly', day_of_month: 10, starts_on: '2026-10-10' }] });
    const blocked = await a.rpc('save_contract', { p_contract_id: seed.c1, ...legacy('주택 임대차 (예전 앱)', '월세', 850_000) });
    expect(blocked.error?.message ?? '').toContain('old_client_payment_rewrite');
    expect((await adminClient().from('contract_payment_changes').select('id')).data!.length).toBe(seed.before.changes.length);
    const ok = await a.rpc('save_contract', { p_contract_id: seed.c2, ...legacy('정수기 렌탈 (예전 앱)', '월 렌탈료', 29_900) });
    expect(ok.error).toBeNull();
  });
});
