/*
 * 급여 총액과 구성항목 (로컬 Supabase) — 모든 값은 가짜
 * 저장된 데이터에 기본급·식대·수당·급여가 따로 결제로 있어도: 읽을 때 급여 한 건 + 구성항목, 다시 저장하면 그대로 정리
 */
import { EMPTY_DRAFT, recordToDraft } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { monthSpending } from '@/domain/spending';

import { adminClient, newUser } from './helpers';

jest.setTimeout(120_000);

const pay = (label: string, amount: number, dayOfMonth: number | null, kind: PaymentDraft['kind'] = 'salary'): PaymentDraft => ({
  kind, direction: 'income', label, amount, frequency: 'monthly', dayOfMonth, monthOfYear: null, startsOn: '2026-08-01', endsOn: null,
  installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null,
});

test('기본급 1,200,000 + 식대·수당 70,000 + 급여 1,270,000 → 급여 한 건(구성항목 2개), 10월 수입 1,270,000', async () => {
  const a = await newUser('salary-components');
  const repo = new SupabaseContractRepository(a.client, () => '2026-10-15');
  const draft: ContractDraft = { ...EMPTY_DRAFT, title: '근로계약서', category: 'employment', contractType: 'employment', startDate: '2026-08-01', payments: [pay('기본급', 1_200_000, null), pay('식대·수당', 70_000, null, 'bonus'), pay('급여', 1_270_000, 31)] };
  const created = await repo.create({ draft, source: 'upload', documents: [], aiChecks: [] });

  // DB에는 3건이 그대로 있어도, 읽으면 급여 한 건 + 구성항목
  expect((await adminClient().from('contract_payments').select('id').eq('contract_id', created.contract.id)).data).toHaveLength(3);
  expect(created.payments).toHaveLength(1);
  expect(created.payments[0]).toMatchObject({ label: '급여', amount: 1_270_000, components: [{ label: '기본급', amount: 1_200_000 }, { label: '식대·수당', amount: 70_000 }] });
  expect(monthSpending([created], { year: 2026, month: 10 }).incomeTotal).toBe(1_270_000);

  // 수정 화면에서 그대로 저장 → 구성항목은 급여의 components로, 따로 있던 결제 2건은 정리 (급여 결제 id는 유지)
  const saved = await repo.update(created.contract.id, recordToDraft(created));
  const rows = (await adminClient().from('contract_payments').select('id, label, components').eq('contract_id', created.contract.id)).data!;
  expect(rows.map((r) => r.label)).toEqual(['급여']);
  expect(rows[0].id).toBe(created.payments[0].id);
  expect(rows[0].components).toEqual([{ label: '기본급', amount: 1_200_000 }, { label: '식대·수당', amount: 70_000 }]);
  expect(monthSpending([saved], { year: 2026, month: 10 }).incomeTotal).toBe(1_270_000);
});
