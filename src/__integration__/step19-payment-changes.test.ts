/*
 * 반복 금액 변경 이력 (로컬 Supabase) — 모든 값은 가짜
 * - save_contract: 결제 id 유지 (UPDATE / 새 결제 INSERT / 빠진 결제만 DELETE)
 * - contract_payment_changes: 적용일부터 새 금액, 과거 일정은 그대로 / 정정 / 미래 변경만 취소 / 다른 사용자 접근 불가
 */
import { EMPTY_DRAFT, recordToDraft } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { monthSpending } from '@/domain/spending';

import { adminClient, newUser } from './helpers';

jest.setTimeout(120_000);

const TODAY = '2026-10-15';
const loanPay: PaymentDraft = { kind: 'loan_repayment', direction: 'expense', label: '월 상환금', amount: 500_000, frequency: 'monthly', dayOfMonth: 12, monthOfYear: null, startsOn: '2026-01-12', endsOn: null, installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null };
const loanDraft: ContractDraft = { ...EMPTY_DRAFT, title: '테스트 대출', category: 'finance', contractType: 'loan', startDate: '2026-01-12', endDate: '2036-01-11', payments: [loanPay] };
const month = (r: Parameters<typeof monthSpending>[0][number], m: number) => monthSpending([r], { year: 2026, month: m }).total;

test('결제 id 유지 + 적용일 기준 금액 변경 + 정정 + 미래 변경만 취소 + 다른 사용자 차단', async () => {
  const a = await newUser('pay-change');
  const repo = new SupabaseContractRepository(a.client, () => TODAY);
  const created = await repo.create({ draft: loanDraft, source: 'manual', documents: [] , aiChecks: [] });
  const id = created.contract.id;
  const pid = created.payments[0].id;

  // 1) 다른 항목만 수정 → 결제 id 그대로
  const r1 = await repo.update(id, { ...recordToDraft(created), title: '테스트 대출 (수정)' });
  expect(r1.payments.map((p) => p.id)).toEqual([pid]);

  // 2) 결제 추가 → 기존 id 유지 + 새 id / 추가한 결제 삭제 → 그 결제만 삭제
  const r2 = await repo.update(id, { ...recordToDraft(r1), payments: [...recordToDraft(r1).payments, { ...loanPay, id: null, label: '보증료', amount: 10_000 }] });
  expect(r2.payments[0].id).toBe(pid);
  expect(r2.payments).toHaveLength(2);
  const r3 = await repo.update(id, { ...recordToDraft(r2), payments: recordToDraft(r2).payments.slice(0, 1) });
  expect(r3.payments.map((p) => p.id)).toEqual([pid]);

  // 3) 2026-11-12부터 550,000 (최초 금액 500,000 유지) → 9·10월 500,000 / 11·12월 550,000
  const r4 = await repo.update(id, recordToDraft(r3), [{ op: 'add', paymentId: pid, effectiveFrom: '2026-11-12', amount: 550_000 }]);
  expect(r4.payments[0]).toMatchObject({ id: pid, amount: 500_000 });
  expect(r4.payments[0].amountChanges?.map((c) => [c.effectiveFrom, c.amount])).toEqual([['2026-11-12', 550_000]]);
  expect([9, 10, 11, 12].map((m) => month(r4, m))).toEqual([500_000, 500_000, 550_000, 550_000]);

  // 4) 다른 수정을 해도 변경 이력은 그대로 (전부 지우고 다시 넣지 않음)
  const r5 = await repo.update(id, { ...recordToDraft(r4), memo: '메모' });
  expect(r5.payments[0].amountChanges).toHaveLength(1);
  const changeId = r5.payments[0].amountChanges![0].id;

  // 5) 변경 금액 정정 (입력 실수) — 적용일은 그대로
  const r6 = await repo.update(id, recordToDraft(r5), [{ op: 'correct', changeId, amount: 555_000 }]);
  expect(r6.payments[0].amountChanges?.map((c) => [c.id, c.effectiveFrom, c.amount])).toEqual([[changeId, '2026-11-12', 555_000]]);
  // 적용일·결제 연결은 바꿀 수 없다
  const moved = await a.client.from('contract_payment_changes').update({ effective_from: '2026-12-01' }).eq('id', changeId);
  expect(moved.error).not.toBeNull();

  // 6) 잘못된 변경: 결제 시작일 이전·당일 / 다른 계약의 결제
  await expect(repo.update(id, recordToDraft(r6), [{ op: 'add', paymentId: pid, effectiveFrom: '2026-01-12', amount: 1 }])).rejects.toThrow();
  const other = await repo.create({ draft: { ...loanDraft, title: '다른 계약' }, source: 'manual', documents: [], aiChecks: [] });
  await expect(repo.update(id, recordToDraft(r6), [{ op: 'add', paymentId: other.payments[0].id, effectiveFrom: '2026-11-01', amount: 1 }])).rejects.toThrow();
  // 다른 계약의 결제 id로 저장 시도 → 오류 (다른 계약 결제를 덮어쓰지 않음)
  await expect(repo.update(id, { ...recordToDraft(r6), payments: [{ ...recordToDraft(other).payments[0] }] })).rejects.toThrow();
  expect((await repo.get(other.contract.id))!.payments[0].amount).toBe(500_000);

  // 7) 취소: 이미 적용이 시작된 변경은 불가, 아직 적용 전인 변경만 가능 (DB 기준 오늘 — 과거 2026-03-01 / 미래 2099-01-01)
  const r7 = await repo.update(id, recordToDraft(r6), [
    { op: 'add', paymentId: pid, effectiveFrom: '2026-03-01', amount: 520_000 },
    { op: 'add', paymentId: pid, effectiveFrom: '2099-01-01', amount: 900_000 },
  ]);
  const past = r7.payments[0].amountChanges!.find((c) => c.effectiveFrom === '2026-03-01')!;
  const future = r7.payments[0].amountChanges!.find((c) => c.effectiveFrom === '2099-01-01')!;
  await expect(repo.cancelAmountChange(id, past.id)).rejects.toThrow();
  const direct = await a.client.from('contract_payment_changes').delete().eq('id', past.id).select('id');
  expect(direct.data ?? []).toEqual([]); // RLS: 지난 변경은 삭제되지 않음
  const r8 = await repo.cancelAmountChange(id, future.id);
  expect(r8.payments[0].amountChanges!.map((c) => c.effectiveFrom)).toEqual(['2026-03-01', '2026-11-12']);

  // 8) 다른 사용자: 읽기·추가·취소 불가
  const b = await newUser('pay-change-b');
  expect((await b.client.from('contract_payment_changes').select('id')).data).toEqual([]);
  const ins = await b.client.from('contract_payment_changes').insert({ payment_id: pid, effective_from: '2099-02-01', amount: 1 });
  expect(ins.error).not.toBeNull();
  await expect(new SupabaseContractRepository(b.client, () => TODAY).cancelAmountChange(id, changeId)).rejects.toThrow();

  // 9) 결제를 삭제하면 그 결제의 변경 이력도 함께 삭제
  await repo.update(id, { ...recordToDraft(r8), payments: [] });
  const left = await adminClient().from('contract_payment_changes').select('id').eq('payment_id', pid);
  expect(left.data).toEqual([]);
});
