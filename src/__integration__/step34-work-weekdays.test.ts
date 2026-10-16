/*
 * 근무 요일 키 (migration 20261101000001_work_weekdays) — 로컬 Supabase. 모든 값은 가짜
 * - 근무 요일 없는 기존 근로계약: 조회·수정·다시 저장해도 상세 값 그대로, 첫 달은 월평균 추정 안내
 * - 근무 요일 저장·다시 열기 → 첫 급여 832,000 (10/13 입사 · 시급 13,000 · 4시간 · 월~금)
 * - 예전 앱(근무 요일 키를 모름)이 같은 계약을 저장하면 근무 요일만 빠지고 나머지는 그대로 → 새 앱은 월평균 추정으로 돌아감
 */
import { EMPTY_DRAFT, recordToDraft } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { withConfirmedRole } from '@/domain/cashflow';
import { prorationPlan } from '@/domain/payroll';
import { scheduleForRange } from '@/domain/schedule';

import { adminClient, newUser } from './helpers';

jest.setTimeout(120_000);

const TODAY = '2026-10-16';
const salary: PaymentDraft = { kind: 'salary', direction: 'income', directionBasis: 'user', label: '급여', amount: 1_355_714, frequency: 'monthly', dayOfMonth: 10, monthOfYear: null, startsOn: null, endsOn: null, installmentCount: null, isVariable: true, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null, moneyNature: 'ordinary' };
const legacyDetails = { payBasis: 'hourly', hourlyWage: 13_000, dailyWorkHours: 4, weeklyWorkDays: 5, weeklyHolidayPay: 'included', payTiming: 'next_month' } as ContractDraft['details'];

test('기존 근로계약(근무 요일 없음) 조회·수정·저장 → 근무 요일 저장 → 예전 앱 저장', async () => {
  const a = await newUser('weekdays');
  const repo = new SupabaseContractRepository(a.client, () => TODAY);
  const draft: ContractDraft = withConfirmedRole(
    { ...EMPTY_DRAFT, title: '카페 아르바이트', category: 'employment' as const, contractType: 'employment', contractKind: 'employment', startDate: '2026-10-13', details: legacyDetails, payments: [salary] },
    'employee',
  );
  const created = await repo.create({ draft, source: 'manual', documents: [], aiChecks: [] });
  const id = created.contract.id;
  const raw = async () => (await adminClient().from('contracts').select('contract_details').eq('id', id).single()).data!.contract_details as Record<string, unknown>;
  const before = await raw();
  expect(before).not.toHaveProperty('work_weekdays');

  // 조회: 근무 요일 없음 → 첫 회차는 월평균 추정 + 안내 (월~금으로 가정하지 않음)
  const read = await repo.get(id);
  expect(read!.contract.details.workWeekdays).toBeUndefined();
  expect(prorationPlan(read!, read!.payments[0])).toMatchObject({ status: 'needs_rules' });
  const first = scheduleForRange([read!], { start: '2026-10-01', end: '2026-11-30' }, TODAY).find((i) => i.type === 'payment')!;
  expect(first.amount).toBe(1_355_714);

  // 수정·다시 저장: 메모만 바꿈 → 상세 값 그대로, 결제 id 그대로
  const resaved = await repo.update(id, { ...recordToDraft(read!), memo: '메모' });
  expect(await raw()).toEqual(before);
  expect(resaved.payments[0].id).toBe(created.payments[0].id);

  // 새 앱: 근무 요일 저장 → 다시 열면 그대로 · 첫 급여 832,000
  const withDays = await repo.update(id, { ...recordToDraft(resaved), details: { ...resaved.contract.details, workWeekdays: '1,2,3,4,5' } });
  expect(await raw()).toEqual({ ...before, work_weekdays: '1,2,3,4,5' });
  const reread = await repo.get(id);
  expect(reread!.contract.details.workWeekdays).toBe('1,2,3,4,5');
  const plan = prorationPlan(reread!, reread!.payments[0]);
  expect(plan.status === 'ready' && plan.first?.total).toBe(832_000);
  expect(withDays.payments[0].id).toBe(created.payments[0].id);

  // 예전 앱(근무 요일 키를 모름): 읽을 때 키를 버리고 저장 → 근무 요일만 빠짐, 나머지 상세 값 그대로
  const { workWeekdays: _w, ...oldAppDetails } = reread!.contract.details;
  await repo.update(id, { ...recordToDraft(reread!), details: oldAppDetails });
  expect(await raw()).toEqual(before);
});
