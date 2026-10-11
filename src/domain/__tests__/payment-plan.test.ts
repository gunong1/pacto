/*
 * 결제 일정 요약 — 총 회차·진행·남은 회차·마지막 결제일을 계산으로 (모든 값은 가짜)
 */
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';

import { paymentPlan, planSummary } from '../paymentPlan';
import { scheduleForRange } from '../schedule';
import type { ContractRecord } from '../types';

const pay = (over: Partial<PaymentDraft> = {}): PaymentDraft => ({
  kind: 'installment',
  direction: 'expense',
  label: '할부금',
  amount: 300_000,
  frequency: 'monthly',
  dayOfMonth: 15,
  monthOfYear: null,
  startsOn: '2026-01-15',
  endsOn: null,
  installmentCount: null,
  isVariable: false,
  components: [],
  businessDayRule: 'none',
  obligation: 'confirmed',
  conditionNote: null,
  ...over,
});
const rec = (draft: Partial<ContractDraft>, p: Partial<PaymentDraft> = {}): ContractRecord =>
  draftToRecord({ ...EMPTY_DRAFT, title: '테스트', contractType: 'installment', startDate: '2026-01-15', ...draft, payments: [pay(p)] }, 'c1', '2026-01-01');
const plan = (r: ContractRecord, today: string) => paymentPlan(r.payments[0], r, today)!;

describe('계산 우선순위', () => {
  test('1. 첫 결제일 + 계약 종료일 + 매월 → 총 24회 · 마지막 2027-12-15 (10회 진행 · 14회 남음)', () => {
    const p = plan(rec({ endDate: '2027-12-15' }), '2026-10-20');
    expect(p).toMatchObject({ first: '2026-01-15', last: '2027-12-15', total: 24, done: 10, remaining: 14, basis: 'end_date', conflict: null });
    expect(planSummary(p)).toBe('총 24회 · 10회 진행 · 14회 남음');
  });
  test('2. 종료일 없이 계약서 총 회차만 → 첫 결제일 + 회차로 마지막 결제일', () => {
    const p = plan(rec({}, { installmentCount: 12 }), '2026-03-20');
    expect(p).toMatchObject({ last: '2026-12-15', total: 12, done: 3, remaining: 9, basis: 'installments' });
  });
  test('3. 종료일·회차 모두 없음 → 무기한 (총 회차 없음, 진행 회차만)', () => {
    const p = plan(rec({}), '2026-03-20');
    expect(p).toMatchObject({ total: null, last: null, remaining: null, done: 3, basis: 'open' });
    expect(planSummary(p)).toBe('3회 진행 · 종료일 없이 반복');
  });
  test('자동갱신 계약은 종료일이 있어도 무기한 반복', () => {
    expect(plan(rec({ endDate: '2027-12-15', autoRenewal: true }), '2026-03-20').total).toBeNull();
  });
  test('결제의 마지막 결제일(납입기간)이 계약 종료일보다 먼저면 그날까지', () => {
    expect(plan(rec({ endDate: '2030-12-31' }, { endsOn: '2026-06-15' }), '2026-03-20')).toMatchObject({ total: 6, last: '2026-06-15' });
  });
  test('종료일과 계약서 회차가 다르면 더 이른 쪽에서 끝내고 확인 필요로 알림', () => {
    const p = plan(rec({ endDate: '2027-12-15' }, { installmentCount: 36 }), '2026-03-20');
    expect(p).toMatchObject({ total: 24, conflict: { installments: 36, byDate: 24 } });
    expect(plan(rec({ endDate: '2027-12-15' }, { installmentCount: 24 }), '2026-03-20').conflict).toBeNull();
  });
});

describe('진행 회차가 틀어지지 않는 경우', () => {
  test('금액 변경 이력이 있어도 회차는 그대로', () => {
    const r = rec({ endDate: '2027-12-15' });
    r.payments[0].amountChanges = [{ id: 'ch', paymentId: r.payments[0].id, effectiveFrom: '2026-06-01', amount: 350_000, changeReason: null, sourceDocumentId: null, createdAt: '' }];
    expect(plan(r, '2026-10-20')).toMatchObject({ total: 24, done: 10, remaining: 14 });
  });
  test('휴일 조정으로 결제일이 당겨져도 회차 수는 같다', () => {
    expect(plan(rec({ endDate: '2027-12-15' }, { businessDayRule: 'previous' }), '2026-10-20').total).toBe(24);
  });
  test('분기납: 2026-01-15 ~ 2027-12-15 → 8회', () => {
    expect(plan(rec({ endDate: '2027-12-15' }, { frequency: 'quarterly' }), '2026-10-20')).toMatchObject({ total: 8, done: 4, last: '2027-10-15' });
  });
  test('해지 처리하면 해지일까지만', () => {
    const r = rec({ endDate: '2027-12-15' });
    r.contract.lifecycle = 'cancelled';
    r.contract.lifecycleChangedOn = '2026-05-01';
    expect(plan(r, '2026-10-20')).toMatchObject({ total: 4, done: 4, remaining: 0, last: '2026-04-15' });
  });
  test('일시불·선택형 결제는 대상 아님', () => {
    expect(paymentPlan(rec({}, { frequency: 'one_time' }).payments[0], rec({}), '2026-03-01')).toBeNull();
    expect(paymentPlan(rec({}, { obligation: 'optional' }).payments[0], rec({}), '2026-03-01')).toBeNull();
  });
});

describe('캘린더·알림 제목의 회차 (사용자가 총 회차를 입력하지 않아도)', () => {
  const titles = (r: ContractRecord, start: string, end: string) => scheduleForRange([r], { start, end }, '2026-01-01').filter((i) => i.type === 'payment').map((i) => i.title);
  test('할부금: 종료일 기준 총 24회 → "할부금 1/24회" … "할부금 24/24회"', () => {
    const r = rec({ endDate: '2027-12-15' });
    expect(titles(r, '2026-01-01', '2026-02-28')).toEqual(['할부금 1/24회', '할부금 2/24회']);
    expect(titles(r, '2027-12-01', '2027-12-31')).toEqual(['할부금 24/24회']);
  });
  test('월세·급여 등은 제목에 회차를 붙이지 않음 (상세에서만 총/진행/남은 회차)', () => {
    const r = rec({ contractType: 'lease', endDate: '2027-12-15' }, { kind: 'rent', label: '월세' });
    expect(titles(r, '2026-01-01', '2026-01-31')).toEqual(['월세']);
    expect(plan(r, '2026-10-20').total).toBe(24);
  });
});

describe('첫 지급일 확인 필요 (급여: 당월/익월 지급을 임의로 정하지 않음)', () => {
  const salary = (startsOn: string | null, startDate: string | null = '2026-07-20') =>
    draftToRecord({ ...EMPTY_DRAFT, title: '근로', contractType: 'employment', startDate, payments: [pay({ kind: 'salary', direction: 'income', label: '월 급여', dayOfMonth: 10, startsOn })] }, 'c1', '2026-07-01');
  test('근로 시작 2026-07-20 · 지급일 10일 · 첫 지급일 미지정 → 첫 지급 2026-08-10(예상) · 확인 필요, 첫 회차 제목에 표시', () => {
    const r = salary(null);
    expect(plan(r, '2026-07-21')).toMatchObject({ first: '2026-08-10', firstNeedsCheck: true });
    const titles = scheduleForRange([r], { start: '2026-08-01', end: '2026-09-30' }, '2026-07-21').filter((i) => i.type === 'payment').map((i) => i.title);
    expect(titles).toEqual(['월 급여 (첫 지급일 확인 필요)', '월 급여']);
  });
  test('첫 지급일을 직접 지정(익월 2026-09-10) → 확인 필요 아님, 그 날짜부터', () => {
    const r = salary('2026-09-10');
    expect(plan(r, '2026-07-21')).toMatchObject({ first: '2026-09-10', firstNeedsCheck: false });
  });
  test('시작일이 없으면 확인 필요 / 급여가 아닌 결제는 해당 없음', () => {
    expect(plan(salary(null, null), '2026-07-21').firstNeedsCheck).toBe(true);
    expect(plan(rec({}), '2026-07-21').firstNeedsCheck).toBe(false);
  });
});
