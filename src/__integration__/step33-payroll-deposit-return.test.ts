/*
 * 급여 규정·구성항목 저장 + 결제로 저장된 보증금 반환 정리 (로컬 Supabase · migration 20261028000001). 모든 값은 가짜
 * - 근로 상세 4개 키 저장 (DB 레지스트리) · 잘못된 값은 DB가 거부
 * - 구성항목 선택 칸(지급 유형·최대·조건·상태·일할)이 저장·다시 저장 후에도 그대로
 * - 조건부 항목 지급 확정 → 1회 수입 결제 추가 (기존 결제 id 그대로)
 * - 보증금 반환 정리: 그 결제만 지우고 다른 결제 id·보증금 연결 유지 · 반환 기록 가능
 */
import { confirmComponentPay, EMPTY_DRAFT, fixDepositReturn, recordToDraft } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { fundViews, withConfirmedRole } from '@/domain/cashflow';
import { prorationPlan } from '@/domain/payroll';
import { monthSpending } from '@/domain/spending';

import { newUser } from './helpers';

jest.setTimeout(120_000);

const TODAY = '2026-10-13';
const base: Omit<PaymentDraft, 'kind' | 'label' | 'amount'> = { direction: 'neutral', frequency: 'monthly', dayOfMonth: 10, monthOfYear: null, startsOn: '2026-10-25', endsOn: null, installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null, moneyNature: 'ordinary' };

test('근로: 급여 규정·구성항목 저장 → 첫 급여 722,581 · 성과급 지급 확정', async () => {
  const a = await newUser('payroll');
  const repo = new SupabaseContractRepository(a.client, () => TODAY);
  const comps = [
    { label: '기본급', amount: 2_800_000, pay: 'fixed' as const, amountKind: 'exact' as const },
    { label: '고정 직무수당', amount: 400_000, pay: 'fixed' as const, amountKind: 'exact' as const, prorate: 'full' as const },
    { label: '성과급', amount: 1_000_000, pay: 'conditional' as const, amountKind: 'max' as const, condition: '분기 목표 달성 시', status: 'pending' as const },
  ];
  const draft: ContractDraft = withConfirmedRole(
    {
      ...EMPTY_DRAFT,
      title: '테스트 근로계약',
      category: 'employment' as const,
      contractType: 'employment',
      contractKind: 'employment',
      startDate: '2026-10-25',
      parties: [
        { role: 'employer', name: '가상회사' },
        { role: 'employee', name: '홍길동' },
      ],
      details: { payPeriodStartDay: 1, payTiming: 'next_month', prorationBasis: 'calendar_days' } as ContractDraft['details'],
      payments: [{ ...base, kind: 'salary', label: '월 급여', amount: 3_200_000, components: comps }],
    },
    'employee',
  );
  const created = await repo.create({ draft, source: 'manual', documents: [], aiChecks: [] });
  expect(created.contract.details).toMatchObject({ payPeriodStartDay: 1, payTiming: 'next_month', prorationBasis: 'calendar_days' });
  expect(created.payments[0].components).toEqual(comps);
  const plan = prorationPlan(created, created.payments[0]);
  expect(plan.status === 'ready' && plan.first?.total).toBe(632_258 + 400_000);

  // 다시 저장해도 칸 유지
  const resaved = await repo.update(created.contract.id, { ...recordToDraft(created), memo: '메모' });
  expect(resaved.payments[0].components).toEqual(comps);

  // 성과급 지급 확정 → 12/31 800,000 수입 1건 · 급여 결제 id 그대로
  const salaryId = resaved.payments[0].id;
  const confirmed = await repo.update(created.contract.id, confirmComponentPay(resaved, salaryId, 2, { date: '2026-12-31', amount: 800_000 }));
  expect(confirmed.payments[0].id).toBe(salaryId);
  expect(confirmed.payments[0].components[2].status).toBe('confirmed');
  expect(monthSpending([confirmed], { year: 2026, month: 12 }, TODAY).incomeTotal).toBe(3_200_000 + 800_000);

  // DB가 잘못된 규정 값을 거부
  await expect(repo.update(created.contract.id, { ...recordToDraft(confirmed), details: { ...confirmed.contract.details, payTiming: 'sometimes' } as ContractDraft['details'] })).rejects.toThrow();
});

test('임대차: 결제로 저장된 보증금 반환 정리 — 그 결제만 삭제 · 다른 결제 id·보증금 연결 유지 · 반환 기록', async () => {
  const a = await newUser('deposit-return');
  const repo = new SupabaseContractRepository(a.client, () => TODAY);
  const one = (o: Partial<PaymentDraft>): PaymentDraft => ({ ...base, frequency: 'one_time', dayOfMonth: null, ...o }) as PaymentDraft;
  const draft: ContractDraft = withConfirmedRole(
    {
      ...EMPTY_DRAFT,
      title: '테스트 전세',
      category: 'real_estate' as const,
      contractType: 'lease',
      contractKind: 'lease',
      startDate: '2026-11-30',
      endDate: '2028-11-29',
      depositAmount: 200_000_000,
      parties: [
        { role: 'lessor', name: '김민수' },
        { role: 'lessee', name: '박지훈' },
      ],
      payments: [
        one({ kind: 'deposit', label: '계약금', amount: 20_000_000, startsOn: '2026-10-10', moneyNature: 'refundable_deposit' }),
        one({ kind: 'deposit', label: '잔금', amount: 180_000_000, startsOn: '2026-11-30', moneyNature: 'refundable_deposit' }),
        // 실기기와 같은 잘못된 저장: 기타 결제 · 확정 · 일반 · 출금
        one({ kind: 'other', label: '보증금 반환 예정', amount: 200_000_000, startsOn: '2028-11-30', direction: 'expense', directionBasis: 'user', moneyNature: 'ordinary' }),
      ],
    },
    'lessee',
  );
  const created = await repo.create({ draft, source: 'manual', documents: [], aiChecks: [] });
  expect(monthSpending([created], { year: 2028, month: 11 }, TODAY).ordinaryExpense).toBe(200_000_000);
  const keep = created.payments.filter((p) => p.label !== '보증금 반환 예정').map((p) => p.id);
  const wrong = created.payments.find((p) => p.label === '보증금 반환 예정')!;

  const fixed = await repo.update(created.contract.id, fixDepositReturn(created, wrong.id, false));
  expect(fixed.payments.map((p) => p.id)).toEqual(keep);
  const [fund] = fundViews(fixed, TODAY);
  expect([fund.total, fund.checkBasis, fund.refundDirection]).toEqual([200_000_000, 'contract_end', 'income']);
  expect(monthSpending([fixed], { year: 2028, month: 11 }, TODAY).ordinaryExpense).toBe(0);

  const refunded = await repo.addRefund(created.contract.id, fund.key, { amount: 50_000_000, refundedOn: '2028-11-30' });
  const after = fundViews(refunded, '2028-12-01')[0];
  expect([after.status, after.remaining]).toEqual(['partial', 150_000_000]);
  expect(refunded.payments.map((p) => p.id)).toEqual(keep);
});
