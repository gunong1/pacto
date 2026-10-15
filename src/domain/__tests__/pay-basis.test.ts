/**
 * 근로계약 급여 방식 (월급제·시급제·일급제·연봉제) — src/domain/payBasis.ts
 * 입력 → 저장 → 수정 → 계약 상세 금액 → 월 수입 합계 → 캘린더가 같은 규칙을 쓰는지. 모든 값은 가짜
 */
import { toAppResult } from '../../../supabase/functions/_shared/extraction.ts';
import { extractionInstructions } from '../../../supabase/functions/_shared/extractionPrompt.ts';
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import { contractFormSchema, draftToForm, draftToQuickForm, formToDraft, quickDirectionAdvice, type ContractFormValues } from '@/features/contracts/form';
import { toReviewModel } from '@/features/registration/extraction';

import { detailSchema } from '../contractTypes';
import { applyPayBasis, monthlyPayEstimate, payAmountLabel, payBasisOf, payEstimateEdited } from '../payBasis';
import { prorationPlan } from '../payroll';
import { scheduleForRange } from '../schedule';
import { monthSpending } from '../spending';
import * as F from './golden/fixtures';

const TODAY = '2026-10-15';

/** 직접 입력 화면과 같은 값 — 근로 · 수입 · 매월 */
const form = (details: Record<string, string>, quick: Partial<NonNullable<ContractFormValues['quick']>> = {}, patch: Partial<ContractFormValues> = {}): ContractFormValues => {
  const v = draftToForm({ ...EMPTY_DRAFT, contractKind: 'employment', contractType: 'employment', title: '카페 아르바이트', startDate: '2026-10-01' });
  return {
    ...v,
    details: { ...v.details, ...details },
    quick: { amount: '', direction: quickDirectionAdvice('employment').direction, frequency: 'monthly', day: '10', nextDate: '', ...quick },
    ...patch,
  };
};
const save = (v: ContractFormValues) => formToDraft(contractFormSchema.parse(v), TODAY);

describe('예상 월 수입 계산 (세전 기본급 추정)', () => {
  test('시급제: 시급 × 하루 근무시간 × 월 예상 근무일수', () => {
    expect(monthlyPayEstimate({ payBasis: 'hourly', hourlyWage: 10_030, dailyWorkHours: 8, monthlyWorkDays: 22 })).toEqual({
      basis: 'hourly',
      amount: 1_765_280,
      formula: '시급 10,030원 × 하루 8시간 × 월 22일',
      missing: [],
    });
    // 소수 시간·일수 — 원 미만 반올림
    expect(monthlyPayEstimate({ payBasis: 'hourly', hourlyWage: 10_030, dailyWorkHours: 4.5, monthlyWorkDays: 21.5 })?.amount).toBe(970_403);
  });

  test('일급제: 일급 × 월 예상 근무일수 / 연봉제: 연봉 ÷ 12 (원 미만 버림)', () => {
    expect(monthlyPayEstimate({ payBasis: 'daily', dailyWage: 120_000, monthlyWorkDays: 20 })).toMatchObject({ amount: 2_400_000, formula: '일급 120,000원 × 월 20일' });
    expect(monthlyPayEstimate({ payBasis: 'annual', annualSalary: 40_000_000 })).toMatchObject({ amount: 3_333_333, formula: '연봉 40,000,000원 ÷ 12개월' });
  });

  test('입력이 모자라면 금액을 만들지 않고 필요한 칸을 알려준다', () => {
    expect(monthlyPayEstimate({ payBasis: 'hourly', hourlyWage: 10_030 })).toEqual({ basis: 'hourly', amount: null, formula: null, missing: ['하루 소정근로시간', '주 근무일수'] });
    expect(monthlyPayEstimate({ payBasis: 'daily', dailyWage: 0, monthlyWorkDays: 20 })?.missing).toEqual(['일급']);
  });

  test('월급제·급여 방식 없음(예전 계약)은 계산하지 않는다 — 급여 금액이 곧 월급', () => {
    expect(monthlyPayEstimate({ payBasis: 'monthly' })).toBeNull();
    expect(monthlyPayEstimate({})).toBeNull();
    expect(monthlyPayEstimate({ annualSalary: 36_000_000 })).toBeNull();
    expect(payBasisOf({ payBasis: 'weekly' })).toBeNull();
    expect(payAmountLabel(null)).toBe('월급');
    expect(payAmountLabel('hourly')).toBe('예상 월 수입');
  });

  test('하루 근무시간 0~24 · 월 근무일수 0~31만 저장 (DB number 범위 안)', () => {
    const s = detailSchema('employment');
    expect(s.safeParse({ dailyWorkHours: 7.5, monthlyWorkDays: 21.5 }).success).toBe(true);
    expect(s.safeParse({ dailyWorkHours: 25 }).success).toBe(false);
    expect(s.safeParse({ monthlyWorkDays: 32 }).success).toBe(false);
    expect(s.safeParse({ payBasis: 'weekly' }).success).toBe(false);
    const bad = contractFormSchema.safeParse(form({ payBasis: 'hourly', dailyWorkHours: '25' }));
    expect(bad.error!.issues.map((i) => [i.path.join('.'), i.message])).toContainEqual(['details.dailyWorkHours', '0~24 사이 숫자로 입력해주세요 (예: 7.5)']);
  });
});

describe('저장 · 수정 — 원래 의미(급여 방식·단가)를 그대로 보관', () => {
  test('시급제 직접 입력 → 상세에 시급·근무시간·근무일수, 급여 결제 = 예상 월 수입(변동 금액)', () => {
    const d = save(form({ payBasis: 'hourly', hourlyWage: '10,030', dailyWorkHours: '8', monthlyWorkDays: '22' }, { amount: '1,765,280' }));
    expect(d.details).toMatchObject({ payBasis: 'hourly', hourlyWage: 10_030, dailyWorkHours: 8, monthlyWorkDays: 22 });
    expect(d.payments).toHaveLength(1);
    expect(d.payments[0]).toMatchObject({ kind: 'salary', direction: 'income', frequency: 'monthly', amount: 1_765_280, dayOfMonth: 10, isVariable: true });
  });

  test('사용자가 고친 예상액은 그대로 저장되고 "직접 고친 금액"으로 구분된다', () => {
    const d = save(form({ payBasis: 'hourly', hourlyWage: '10,030', dailyWorkHours: '8', monthlyWorkDays: '22' }, { amount: '1,700,000' }));
    expect(d.payments[0].amount).toBe(1_700_000);
    expect(payEstimateEdited(d.details, d.payments[0].amount)).toBe(true);
    expect(payEstimateEdited(d.details, 1_765_280)).toBe(false);
  });

  test('일급제 · 연봉제 — 일급제는 변동(예상), 연봉제·월급제는 고정 금액', () => {
    expect(save(form({ payBasis: 'daily', dailyWage: '120,000', monthlyWorkDays: '20' }, { amount: '2,400,000' })).payments[0]).toMatchObject({ amount: 2_400_000, isVariable: true });
    const annual = save(form({ payBasis: 'annual', annualSalary: '36,000,000' }, { amount: '3,000,000' }));
    expect(annual.details).toMatchObject({ payBasis: 'annual', annualSalary: 36_000_000 });
    expect(annual.payments[0]).toMatchObject({ amount: 3_000_000, isVariable: false });
    expect(save(form({ payBasis: 'monthly' }, { amount: '2,500,000' })).payments[0]).toMatchObject({ amount: 2_500_000, isVariable: false });
  });

  test('수정: 저장된 시급제 계약을 다시 열면 같은 값 · 월급제로 바꾸면 고정 금액 (단가는 지우지 않음)', () => {
    const saved = save(form({ payBasis: 'hourly', hourlyWage: '10,030', dailyWorkHours: '8', monthlyWorkDays: '22' }, { amount: '1,765,280' }));
    const edit = draftToQuickForm({ ...saved, payments: saved.payments.map((p, i) => ({ ...p, id: `p${i}` })) });
    expect(edit.details).toMatchObject({ payBasis: 'hourly', hourlyWage: '10,030', dailyWorkHours: '8', monthlyWorkDays: '22' });
    expect(edit.quick).toMatchObject({ amount: '1,765,280', day: '10' });
    const again = formToDraft(contractFormSchema.parse(edit), TODAY);
    expect(again.details).toEqual(saved.details);
    expect(again.payments[0]).toMatchObject({ id: 'p0', amount: 1_765_280, isVariable: true });
    const monthly = formToDraft(contractFormSchema.parse({ ...edit, details: { ...edit.details, payBasis: 'monthly' }, quick: { ...edit.quick!, amount: '2,000,000' } }), TODAY);
    expect(monthly.payments[0]).toMatchObject({ id: 'p0', amount: 2_000_000, isVariable: false });
    expect(monthly.details).toMatchObject({ payBasis: 'monthly', hourlyWage: 10_030 });
  });

  test('예전 월급 계약(급여 방식 없음)은 수정해도 급여 방식·변동 여부를 바꾸지 않는다', () => {
    const legacy = { ...EMPTY_DRAFT, contractKind: 'employment', contractType: 'employment' as const, title: '근로계약', details: { annualSalary: 36_000_000 }, payments: [{ ...save(form({}, { amount: '3,000,000' })).payments[0], id: 'old', isVariable: false }] };
    const v = draftToQuickForm(legacy);
    const d = formToDraft(contractFormSchema.parse(v), TODAY);
    expect(d.details).toEqual({ annualSalary: 36_000_000 });
    expect(d.payments[0]).toMatchObject({ id: 'old', amount: 3_000_000, isVariable: false });
    // 급여 방식이 없으면 결제는 그대로 (AI 결과의 변동 여부 보존)
    expect(applyPayBasis([{ kind: 'salary', frequency: 'monthly', isVariable: true }], {})).toEqual([{ kind: 'salary', frequency: 'monthly', isVariable: true }]);
  });
});

describe('계약 상세 · 월 수입 합계 · 캘린더', () => {
  const hourly = () => draftToRecord(save(form({ payBasis: 'hourly', hourlyWage: '10,030', dailyWorkHours: '8', monthlyWorkDays: '22' }, { amount: '1,765,280' })), 'h', TODAY);

  test('월 수입 합계에 예상 월 수입이 들어가고, 그중 예상 금액을 따로 알려준다', () => {
    const s = monthSpending([hourly()], { year: 2026, month: 11 }, TODAY);
    expect(s).toMatchObject({ incomeTotal: 1_765_280, incomeEstimated: 1_765_280, total: 0 });
    // 월급제는 예상 금액이 아니다
    const monthly = draftToRecord(save(form({ payBasis: 'monthly' }, { amount: '2,500,000' })), 'm', TODAY);
    expect(monthSpending([monthly], { year: 2026, month: 11 }, TODAY)).toMatchObject({ incomeTotal: 2_500_000, incomeEstimated: 0 });
  });

  test('캘린더: 매월 10일 "(예상)" 급여 + "시급제 · 세전 기본급 추정" 안내', () => {
    const items = scheduleForRange([hourly()], { start: '2026-11-01', end: '2026-11-30' }, TODAY).filter((i) => i.type === 'payment');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ date: '2026-11-10', amount: 1_765_280, estimated: true, direction: 'income', detail: '시급제 · 세전 기본급 추정 (실제 수령액과 달라요)' });
  });

  test('시급·일급제는 월급 일할 계산(첫·마지막 급여)을 하지 않는다 — 근무일수로 이미 계산한 예상액', () => {
    const rules = { payPeriodStartDay: 1, payTiming: 'next_month', prorationBasis: 'calendar_days' };
    const r = hourly();
    const withRules = { ...r, contract: { ...r.contract, details: { ...r.contract.details, ...rules } } };
    expect(prorationPlan(withRules, withRules.payments[0]).status).toBe('not_applicable');
    const monthly = { ...withRules, contract: { ...withRules.contract, details: { ...withRules.contract.details, payBasis: 'monthly' } } };
    expect(prorationPlan(monthly, monthly.payments[0]).status).not.toBe('not_applicable');
  });
});

describe('AI 분석 결과와의 호환', () => {
  test('급여 방식 칸은 AI 지시문에 넣지 않고, AI가 답해도 받지 않는다 (사용자 입력 칸)', () => {
    const prompt = extractionInstructions(TODAY);
    for (const k of ['pay_basis', 'hourly_wage', 'daily_work_hours', 'daily_wage', 'monthly_work_days']) expect(prompt).not.toContain(k);
    expect(prompt).toContain('annual_salary');
    const base = F.employment(25);
    const detail = (key: string, v: string | number) => ({ key, text_value: typeof v === 'string' ? v : null, number_value: typeof v === 'number' ? v : null, boolean_value: null, confidence: 'high', source_type: 'explicit', evidence_quote: null, evidence_page: null, evidence_file: null });
    const r = toAppResult({ ...base, details: [detail('pay_basis', 'hourly'), detail('hourly_wage', 10_030)] }, 'openai');
    const draft = toReviewModel(r as never, ['doc-1']).draft;
    expect(draft.details.payBasis).toBeUndefined();
    expect(draft.details.hourlyWage).toBeUndefined();
    // 기존 월급 결과는 그대로 — 급여 1,270,000원
    expect(draft.payments.find((p) => p.kind === 'salary')).toMatchObject({ amount: 1_270_000, frequency: 'monthly' });
  });
});
