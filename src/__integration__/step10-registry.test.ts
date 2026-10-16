import {
  CATEGORY_DEFS,
  CONTRACT_TYPE_DEFS,
  DATE_KIND_DEFS,
  DETAIL_FIELD_DEFS,
  PAYMENT_KIND_DEFS,
} from '../../supabase/functions/_shared/contractRegistry';
import { EMPTY_DRAFT } from '@/data/draft';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { monthSpending } from '@/domain/spending';

import { adminClient, newUser } from './helpers';

const valueType = (i: string) => (i === 'amount' || i === 'integer' ? 'integer' : i === 'percent' || i === 'decimal' ? 'number' : i);

describe('Step 10 — 확장 가능한 계약 레지스트리', () => {
  test('DB 룩업 테이블 = 공용 레지스트리 (분야·유형·상세 속성·결제 의미·날짜 의미)', async () => {
    const admin = adminClient();
    const rows = async (t: string, cols: string) => {
      const { data, error } = await admin.from(t as never).select(cols);
      if (error) throw error;
      return data as unknown as Record<string, unknown>[];
    };
    const codes = (r: Record<string, unknown>[]) => r.map((x) => `${x.code}:${x.label}`).sort();
    expect(codes(await rows('contract_categories', 'code,label'))).toEqual(CATEGORY_DEFS.map((d) => `${d.code}:${d.label}`).sort());
    expect(codes(await rows('contract_type_defs', 'code,label'))).toEqual(CONTRACT_TYPE_DEFS.map((d) => `${d.code}:${d.label}`).sort());
    expect(codes(await rows('contract_date_kind_defs', 'code,label'))).toEqual(DATE_KIND_DEFS.map((d) => `${d.code}:${d.label}`).sort());
    expect((await rows('payment_kind_defs', 'code,default_direction')).map((x) => `${x.code}:${x.default_direction}`).sort()).toEqual(PAYMENT_KIND_DEFS.map((d) => `${d.code}:${d.direction}`).sort());
    expect((await rows('contract_detail_fields', 'contract_type,key,value_type,options')).map((x) => `${x.contract_type}.${x.key}:${x.value_type}:${(x.options as string[] | null)?.join('|') ?? ''}`).sort()).toEqual(
      DETAIL_FIELD_DEFS.map((d) => `${d.type}.${d.db}:${valueType(d.input)}:${d.options?.map((o) => o.value).join('|') ?? ''}`).sort(),
    );
  });

  test('근로계약 저장 → 급여는 수입, 유형별 속성 보존 · 잘못된 속성은 DB가 거부', async () => {
    const a = await newUser('employment');
    const repo = new SupabaseContractRepository(a.client, () => '2026-10-06');
    const saved = await repo.create({
      draft: {
        ...EMPTY_DRAFT,
        title: '근로계약서',
        category: 'employment',
        contractType: 'employment',
        counterparty: 'PACTO 주식회사',
        startDate: '2026-11-02',
        details: { employmentKind: 'permanent', probationMonths: 3, workHours: '09:00~18:00' },
        payments: [{ kind: 'salary', direction: 'income', label: '월 급여', amount: 3_500_000, frequency: 'monthly', dayOfMonth: 25, monthOfYear: null, startsOn: null, endsOn: null, installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null }],
        dates: [{ kind: 'hire', label: '입사일', date: '2026-11-02' }],
      },
      source: 'manual',
      documents: [],
      aiChecks: [],
    });
    expect(saved.contract).toMatchObject({ category: 'employment', contractType: 'employment', details: { employmentKind: 'permanent', probationMonths: 3, workHours: '09:00~18:00' } });
    expect(saved.payments[0]).toMatchObject({ kind: 'salary', direction: 'income' });
    expect(monthSpending([saved], { year: 2026, month: 11 })).toMatchObject({ total: 0, incomeTotal: 3_500_000 });

    const bad = await a.client.rpc('save_contract', { p_contract: { title: 'x', contract_type: 'employment', contract_details: { lease_kind: 'jeonse' } } });
    expect(bad.error?.code).toBe('23514');
  });

  test('급여 방식(시급제) 저장 → 시급·하루 근무시간(소수)·근무일수 그대로 · 급여는 예상 월 수입(변동) · 범위 밖 값은 DB가 거부', async () => {
    const a = await newUser('pay-basis');
    const repo = new SupabaseContractRepository(a.client, () => '2026-10-15');
    const saved = await repo.create({
      draft: {
        ...EMPTY_DRAFT,
        title: '카페 아르바이트',
        category: 'employment',
        contractType: 'employment',
        startDate: '2026-11-01',
        details: { employmentKind: 'part_time', payBasis: 'hourly', hourlyWage: 10_030, dailyWorkHours: 7.5, monthlyWorkDays: 20, weeklyWorkDays: 4.5, weeklyHolidayPay: 'included', workWeekdays: '1,2,3,4,5', payTiming: 'next_month', payPeriodStartDay: 26 },
        payments: [{ kind: 'salary', direction: 'income', label: '급여', amount: 1_504_500, frequency: 'monthly', dayOfMonth: 10, monthOfYear: null, startsOn: null, endsOn: null, installmentCount: null, isVariable: true, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null }],
        dates: [],
      },
      source: 'manual',
      documents: [],
      aiChecks: [],
    });
    expect(saved.contract.details).toEqual({ employmentKind: 'part_time', payBasis: 'hourly', hourlyWage: 10_030, dailyWorkHours: 7.5, monthlyWorkDays: 20, weeklyWorkDays: 4.5, weeklyHolidayPay: 'included', workWeekdays: '1,2,3,4,5', payTiming: 'next_month', payPeriodStartDay: 26 });
    expect(saved.payments[0]).toMatchObject({ kind: 'salary', amount: 1_504_500, isVariable: true });
    // 익월 지급 · 26일~다음 달 25일 산정: 12월 = 첫 급여 (11/2~25 평일 18일 × 7.5시간 × 10,030 = 1,354,050 + 주휴 3주 225,675) · 1월부터 월평균
    expect(monthSpending([saved], { year: 2026, month: 12 }, '2026-10-15')).toMatchObject({ incomeTotal: 1_579_725 });
    expect(monthSpending([saved], { year: 2027, month: 1 }, '2026-10-15')).toMatchObject({ incomeTotal: 1_504_500, incomeEstimated: 1_504_500 });
    for (const details of [{ daily_work_hours: 101 }, { pay_basis: 'weekly' }, { hourly_wage: 10.5 }, { weekly_holiday_pay: 'yes' }, { weekly_work_days: -1 }]) {
      const r = await a.client.rpc('save_contract', { p_contract: { title: 'x', contract_type: 'employment', contract_details: details } });
      expect(r.error?.code).toBe('23514');
    }
  });
});
