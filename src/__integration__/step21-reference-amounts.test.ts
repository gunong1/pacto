/*
 * 참고 금액(결제가 아닌 금액) 저장 — 분석 규칙 리팩터링 C (로컬 Supabase). 모든 값은 가짜
 * - 참고·면제·할인 전 금액은 contract_payments가 아니라 contracts.reference_amounts에만 저장 → 홈·캘린더 계산에 없음
 * - 이전 버전의 "참고 금액(informational)" 결제 행 일회성 정리: 총액은 요약 칸(보증금), 나머지는 참고 금액 목록, 결제 행 삭제
 */
import { EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { monthSpending } from '@/domain/spending';

import { adminClient, newUser } from './helpers';

jest.setTimeout(120_000);

const rent: PaymentDraft = {
  kind: 'recurring_fee', direction: 'expense', label: '월 렌탈료', amount: 31_900, frequency: 'monthly', dayOfMonth: 15, monthOfYear: null, startsOn: '2026-10-12', endsOn: null,
  installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null,
};

test('참고·면제·할인 전 금액은 참고 금액 목록에만 저장되고 지출 계산에 들어가지 않음 (수정해도 유지)', async () => {
  const a = await newUser('reference-amounts');
  const repo = new SupabaseContractRepository(a.client, () => '2026-10-11');
  const draft: ContractDraft = {
    ...EMPTY_DRAFT, title: '정수기 렌탈', category: 'rental', contractType: 'recurring', startDate: '2026-10-12', payments: [rent],
    referenceAmounts: [
      { label: '월 렌탈료(할인전)', amount: 45_900, role: 'before_discount' },
      { label: '등록비', amount: 100_000, role: 'waived' },
    ],
  };
  const created = await repo.create({ draft, source: 'upload', documents: [], aiChecks: [] });
  expect(created.contract.referenceAmounts).toEqual(draft.referenceAmounts);
  const rows = (await adminClient().from('contract_payments').select('label').eq('contract_id', created.contract.id)).data!;
  expect(rows.map((r) => r.label)).toEqual(['월 렌탈료']);
  expect(monthSpending([created], { year: 2026, month: 11 }).total).toBe(31_900);

  const updated = await repo.update(created.contract.id, { ...draft, title: '정수기 렌탈 (수정)' });
  expect(updated.contract.referenceAmounts).toEqual(draft.referenceAmounts);
});

test('이전 버전 참고 금액 결제 행 정리: 보증금 총액 → 요약 칸, 차량가 → 참고 금액 목록, 결제 행 삭제', async () => {
  const a = await newUser('reference-migrate');
  const admin = adminClient();
  const c = (await admin.from('contracts').insert({ user_id: a.user.id, title: '기존 계약', contract_type: 'lease', category: 'real_estate' }).select('id').single()).data!;
  const row = (label: string, amount: number, kind: string, obligation: string, note: string | null, sort: number) => ({
    user_id: a.user.id, contract_id: c.id, kind, direction: 'neutral', label, amount, frequency: 'one_time' as const, starts_on: '2026-03-01', obligation, condition_note: note, sort_order: sort,
  });
  const ins = await admin.from('contract_payments').insert([
    row('보증금', 50_000_000, 'deposit', 'informational', '총액 — 계약금·잔금 등으로 나눠 지급', 0),
    row('계약금', 10_000_000, 'deposit', 'confirmed', null, 1),
    row('차량가', 35_000_000, 'other', 'informational', null, 2),
  ]);
  expect(ins.error).toBeNull();
  const { error } = await admin.rpc('migrate_informational_payments' as never);
  expect(error).toBeNull();
  const after = (await admin.from('contracts').select('deposit_amount, reference_amounts').eq('id', c.id).single()).data!;
  expect(after.deposit_amount).toBe(50_000_000);
  expect(after.reference_amounts).toEqual([{ label: '차량가', amount: 35_000_000, role: 'reference' }]);
  const left = (await admin.from('contract_payments').select('label').eq('contract_id', c.id)).data!;
  expect(left.map((r) => r.label)).toEqual(['계약금']);
});

test('정리 함수는 서버 전용 (사용자 권한으로 실행 불가)', async () => {
  const a = await newUser('reference-guard');
  const { error } = await a.client.rpc('migrate_informational_payments' as never);
  expect(error).not.toBeNull();
});

test('결제일 없는 기존 정기 지출 → 이전에 보이던 날짜(결제 시작일의 일)로 결제일 채움 · 수입은 그대로', async () => {
  const a = await newUser('payday-backfill');
  const admin = adminClient();
  const c = (await admin.from('contracts').insert({ user_id: a.user.id, title: '기존 계약', contract_type: 'recurring', category: 'rental' }).select('id').single()).data!;
  const row = (label: string, direction: string, sort: number) => ({
    user_id: a.user.id, contract_id: c.id, kind: direction === 'income' ? 'salary' : 'recurring_fee', direction, label, amount: 10_000, frequency: 'monthly' as const, starts_on: '2026-03-12', day_of_month: null, sort_order: sort,
  });
  expect((await admin.from('contract_payments').insert([row('월 렌탈료', 'expense', 0), row('급여', 'income', 1)])).error).toBeNull();
  expect((await admin.rpc('backfill_payment_days' as never)).error).toBeNull();
  const rows = (await admin.from('contract_payments').select('label, day_of_month').eq('contract_id', c.id).order('sort_order')).data!;
  expect(rows).toEqual([{ label: '월 렌탈료', day_of_month: 12 }, { label: '급여', day_of_month: null }]);
});

// 리팩터링 G: 읽을 때 다시 판단하던 "총액 결제 행"을 일회성 정리 함수(fold_one_time_totals)로 한 번 정리
test('이미 저장된 보증금·계약금·잔금 3행(모두 확정) → 보증금은 요약 칸으로, 결제 행은 계약금·잔금만', async () => {
  const a = await newUser('fold-one-time-totals');
  const repo = new SupabaseContractRepository(a.client, () => '2026-10-11');
  const one = (label: string, amount: number, startsOn: string): PaymentDraft => ({ ...rent, kind: 'deposit', direction: 'neutral', label, amount, frequency: 'one_time', dayOfMonth: null, startsOn });
  const draft: ContractDraft = {
    ...EMPTY_DRAFT, title: '주택 월세 임대차계약서', category: 'real_estate', contractType: 'lease', startDate: '2026-10-20',
    payments: [one('보증금', 20_000_000, '2026-10-20'), one('계약금', 2_000_000, '2026-10-08'), one('잔금', 18_000_000, '2026-10-20'), { ...rent, kind: 'rent', label: '월세', amount: 850_000, dayOfMonth: 20, startsOn: '2026-10-20' }],
  };
  const created = await repo.create({ draft, source: 'upload', documents: [], aiChecks: [] });
  expect(created.payments).toHaveLength(4); // 읽기는 저장된 그대로

  expect((await adminClient().rpc('fold_one_time_totals' as never)).error).toBeNull();
  const after = (await repo.get(created.contract.id))!;
  expect(after.payments.map((p) => p.label)).toEqual(['계약금', '잔금', '월세']);
  expect(after.contract.depositAmount).toBe(20_000_000);
  expect(after.contract.referenceAmounts).toEqual([]);
});
