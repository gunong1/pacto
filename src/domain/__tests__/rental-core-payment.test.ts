/**
 * 렌탈 계약: 실제 월 렌탈료는 반드시 결제로 (모든 값은 가짜)
 * 월 렌탈료 31,900원 + 설치비·등록비 면제 + 중도해지 위약금 + 연체료
 * → 금액: 월 렌탈료 31,900원 매월 1건 / 면제·위약금·연체료는 결제 일정 아님 / "금액 정보를 찾지 못했어요" 없음
 * 모델이 반복 납입금을 참고 금액(reference·total)·참고/발생 가능 의무로 답하거나 주기를 빠뜨려도 되살린다 (금액 후보를 먼저 버리지 않음)
 */
import { rentalDiscountOutput } from '../../../supabase/functions/_shared/ai/mockFixtures';
import { isCoreRecurring, toAppResult } from '../../../supabase/functions/_shared/extraction.ts';
import { draftToRecord } from '@/data/draft';
import { toReviewModel } from '@/features/registration/extraction';

import { scheduleForRange } from '../schedule';
import { monthSpending } from '../spending';

const base = rentalDiscountOutput('정수기 렌탈');
const template = base.payments[0];
const q = (quote: string) => ({ evidence_quote: quote, evidence_page: 1, evidence_file: 1 });
const pay = (over: Record<string, unknown>) => ({ ...template, price_basis: 'actual', payment_obligation: 'confirmed', role: 'recurring_cashflow', ...over });

/** 월 렌탈료 31,900원 + 면제 2건 + 위약금 + 연체료 (모델이 월 렌탈료를 어떻게 답했는지만 바꿔 본다) */
function output(rent: Record<string, unknown>) {
  return {
    ...base,
    payments: [
      pay({ label: '월 렌탈료', amount: 31900, frequency: 'monthly', day_of_month: 15, ...q('월 렌탈료 : 31,900원 / 결제일 : 15일'), ...rent }),
      pay({ role: 'reference', kind: 'setup_fee', label: '설치비', amount: 30000, frequency: 'one_time', ...q('면제 : 등록비(100,000원), 설치비(30,000원)') }),
      pay({ role: 'one_time_cashflow', kind: 'setup_fee', label: '등록비', amount: 100000, frequency: 'one_time', ...q('면제 : 등록비(100,000원), 설치비(30,000원)') }),
      pay({ kind: 'other', label: '중도해지 위약금', amount: 200000, frequency: 'one_time', ...q('의무사용기간 내 중도해지 시 잔여 렌탈료의 10%를 위약금으로 청구합니다.') }),
      pay({ kind: 'other', label: '연체료', amount: 1000, frequency: 'monthly', ...q('렌탈료 연체 시 연체료가 부과됩니다.') }),
    ],
    checks: [
      ...base.checks,
    ],
  };
}

const check = (rent: Record<string, unknown>) => {
  const result = toAppResult(output(rent), 'openai');
  const m = toReviewModel(result, ['doc-1']);
  return { result, m };
};

describe.each([
  ['모델이 정상으로 답함', {}],
  ['참고 금액(reference)으로 답함', { role: 'reference' }],
  ['합계(total)로 답함', { role: 'total' }],
  ['참고(informational) 의무로 답함', { payment_obligation: 'informational' }],
  ['발생 가능(potential)으로 답함', { payment_obligation: 'potential' }],
  ['주기를 빠뜨림', { frequency: null }],
])('월 렌탈료 31,900원 — %s', (_name, rent) => {
  test('금액: 월 렌탈료 31,900원 매월 확정 1건 · "금액 정보를 찾지 못했어요" 없음', () => {
    const { m } = check(rent);
    const confirmed = m.draft.payments.filter((p) => p.obligation === 'confirmed');
    expect(confirmed.map((p) => [p.label, p.amount, p.frequency])).toEqual([['월 렌탈료', 31900, 'monthly']]);
    expect(m.notes.payments ?? '').not.toContain('금액 정보를 찾지 못했어요');
    expect(m.flagged.has('payments')).toBe(false);
  });
  test('캘린더: 31,900원만 매월 반복 (면제·위약금·연체료 일정 없음)', () => {
    const { m } = check(rent);
    const r = draftToRecord(m.draft, 'c1', '2026-03-01');
    const items = scheduleForRange([r], { start: '2026-03-01', end: '2026-06-30' }, '2026-03-01').filter((i) => i.type === 'payment');
    expect(new Set(items.map((i) => i.amount))).toEqual(new Set([31900]));
    expect(items.length).toBe(4);
    expect(monthSpending([r], { year: 2026, month: 4 }).total).toBe(31900);
  });
});

test('면제(설치비·등록비)는 참고 금액(면제), 위약금·연체료는 조건부 — 결제 일정이 아님', () => {
  const { result, m } = check({});
  expect(result.references.filter((x) => x.role === 'waived').map((x) => x.label).sort()).toEqual(['등록비', '설치비']);
  const extra = m.draft.payments.filter((p) => p.obligation !== 'confirmed').map((p) => [p.label, p.obligation]);
  expect(extra).toEqual(expect.arrayContaining([['중도해지 위약금', 'conditional'], ['연체료', 'conditional']]));
});

test('할인전 월 렌탈료를 참고 금액으로 답해도 결제로 되살림 → 금액 확인 필요(할인 적용 금액) 상태, 금액 없음 메시지 없음', () => {
  const { m } = check({ role: 'reference', amount: 45900, price_basis: 'before_discount', ...q('월 렌탈료 : 45,900원(할인전)') });
  expect(m.draft.payments.filter((p) => p.obligation === 'confirmed').map((p) => p.label)).toEqual(['월 렌탈료']);
  expect(m.blankAmounts).toHaveLength(1);
  expect(m.notes.payments ?? '').not.toContain('금액 정보를 찾지 못했어요');
});

test('반복 납입금 이름 판별: 렌탈료·이용료·보험료·월세·상환금·급여 / 면제·할인액·위약금·연체료·선택은 아님', () => {
  for (const l of ['월 렌탈료', '월 이용료', '월 납입금', '월 보험료', '월 통신요금', '월 구독료', '월세', '대출 상환금', '월 급여', '월급']) expect(isCoreRecurring(l, l)).toBe(true);
  expect(isCoreRecurring('설치비', '설치비 면제')).toBe(false);
  expect(isCoreRecurring('월 렌탈료', '월 렌탈료 첫 3개월 무료')).toBe(false);
  expect(isCoreRecurring('렌탈료 할인', '렌탈료 할인')).toBe(false);
  expect(isCoreRecurring('연체료', '연체료')).toBe(false);
  expect(isCoreRecurring('중도해지 위약금', '위약금')).toBe(false);
  expect(isCoreRecurring('필터 교체 이용료 (선택)', '(선택) 필터 교체')).toBe(false);
});
