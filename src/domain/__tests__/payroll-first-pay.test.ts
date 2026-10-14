/**
 * 근로계약 첫 급여·마지막 급여 (중도 입사·퇴사) 공통 규칙 + 일할 표시 문구 + 근거 대조. 모든 값은 가짜
 * 특정 계약서 숫자를 하드코딩하지 않고, 입사일·월 급여·산정기간·지급 시기만 바꿔 같은 규칙을 검증한다.
 */
import { draftToRecord, EMPTY_DRAFT, recordToDraft } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';

import { assignDateUses, cleanDates } from '../../../supabase/functions/_shared/analysisRules/dates.ts';
import { amountsInText, datesInText, quoteContradictsAmount, quoteContradictsDate } from '../../../supabase/functions/_shared/analysisRules/evidenceCheck.ts';
import { groupCalendarItems } from '../calendarGroups';
import { withConfirmedRole } from '../cashflow';
import { prorationPlan } from '../payroll';
import { scheduleForRange } from '../schedule';
import { monthSpending } from '../spending';
import type { ContractRecord, PaymentComponent } from '../types';

const TODAY = '2026-10-14';
const RULES = { payPeriodStartDay: 1, payTiming: 'next_month', prorationBasis: 'calendar_days', payRounding: 'round_1' };
const salary = (o: Partial<PaymentDraft> = {}): PaymentDraft => ({
  kind: 'salary', direction: 'neutral', label: '월 기본급', amount: 3_100_000, frequency: 'monthly', dayOfMonth: 10, monthOfYear: null, startsOn: '2026-10-15', endsOn: null,
  installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null, moneyNature: 'ordinary', ...o,
});
const job = (start: string, o: { amount?: number; end?: string | null; payment?: Partial<PaymentDraft>; today?: string } = {}): ContractRecord => {
  const draft: ContractDraft = {
    ...EMPTY_DRAFT,
    title: '근로계약서',
    category: 'employment',
    contractType: 'employment',
    contractKind: 'employment',
    startDate: start,
    endDate: o.end ?? null,
    details: RULES as unknown as ContractDraft['details'],
    parties: [
      { role: 'employer', name: '가상회사' },
      { role: 'employee', name: '홍길동' },
    ],
    payments: [salary({ amount: o.amount ?? 3_100_000, startsOn: start, ...o.payment })],
  };
  return draftToRecord(withConfirmedRole(draft, 'employee'), 'job', o.today ?? TODAY);
};
const pays = (r: ContractRecord, start: string, end: string, today = TODAY) => scheduleForRange([r], { start, end }, today).filter((i) => i.type === 'payment');
const income = (r: ContractRecord, year: number, month: number, today = TODAY) => monthSpending([r], { year, month }, today).incomeTotal;
const fixed = (label: string, amount: number): PaymentComponent => ({ label, amount, pay: 'fixed', amountKind: 'exact' });

describe('첫 급여 (중도 입사) — 입력 → 계산 → 일정 → 표시', () => {
  test('1. 10/15 입사 · 월 310만 · 익월 10일 → 11/10 1,700,000 (17일분) · 12/10 3,100,000 · 10월 입금 0', () => {
    const r = job('2026-10-15');
    const [first] = pays(r, '2026-11-01', '2026-11-30');
    expect([first.date, first.amount]).toEqual(['2026-11-10', 1_700_000]);
    expect(first.title).toBe('첫 급여 · 10월 15일~31일 근무분');
    expect(first.detail).toBe('10월 총 31일 중 17일분 일할 계산 · 세전');
    expect(first.title + first.detail).not.toMatch(/\d+\/\d+/); // 분수 표기 없음
    expect(pays(r, '2026-12-01', '2026-12-31').map((p) => [p.date, p.amount])).toEqual([['2026-12-10', 3_100_000]]);
    expect([income(r, 2026, 10), income(r, 2026, 11), income(r, 2026, 12)]).toEqual([0, 1_700_000, 3_100_000]);
  });

  test('2. 10/25 입사 · 월 320만 → 11/10 722,581 (7일분, 원 미만 반올림)', () => {
    const [first] = pays(job('2026-10-25', { amount: 3_200_000 }), '2026-11-01', '2026-11-30');
    expect([first.amount, first.title, first.detail]).toEqual([722_581, '첫 급여 · 10월 25일~31일 근무분', '10월 총 31일 중 7일분 일할 계산 · 세전']);
  });

  test('3. 10/1 입사 → 첫 달 전액 (일할 아님)', () => {
    const [first] = pays(job('2026-10-01'), '2026-11-01', '2026-11-30');
    expect([first.amount, first.detail ?? null]).toEqual([3_100_000, null]);
  });

  test('4. 10/31 입사 → 1일분 100,000', () => {
    const [first] = pays(job('2026-10-31'), '2026-11-01', '2026-11-30');
    expect([first.amount, first.title]).toEqual([100_000, '첫 급여 · 10월 31일 근무분']);
  });

  test('5. 2월 중도 입사: 윤년 29일 / 평년 28일', () => {
    const leap = pays(job('2028-02-15', { today: '2028-02-01' }), '2028-03-01', '2028-03-31', '2028-02-01')[0];
    expect([leap.date, leap.amount, leap.detail]).toEqual(['2028-03-10', 1_603_448, '2월 총 29일 중 15일분 일할 계산 · 세전']);
    const normal = pays(job('2027-02-15', { today: '2027-02-01' }), '2027-03-01', '2027-03-31', '2027-02-01')[0];
    expect([normal.amount, normal.detail]).toEqual([1_550_000, '2월 총 28일 중 14일분 일할 계산 · 세전']);
  });

  test('6. 중도 퇴사(3/20) → 마지막 급여 4/10 2,000,000 (3월 20일분) · 그 뒤 급여 없음', () => {
    const r = job('2026-10-01', { end: '2027-03-20' });
    const [last] = pays(r, '2027-04-01', '2027-04-30');
    expect([last.date, last.amount, last.title, last.detail]).toEqual(['2027-04-10', 2_000_000, '마지막 급여 · 3월 1일~20일 근무분', '3월 총 31일 중 20일분 일할 계산 · 세전']);
    expect(pays(r, '2027-05-01', '2027-06-30')).toEqual([]);
  });
});

describe('월급 구성·조건부 금액', () => {
  test('7. 월 급여 = 기본급 + 고정수당 → 수입은 월 급여 한 번만 (구성항목을 다시 더하지 않음)', () => {
    const r = job('2026-10-01', { amount: 3_200_000, payment: { components: [fixed('기본급', 2_800_000), fixed('고정 직무수당', 400_000)] } });
    expect(income(r, 2026, 12)).toBe(3_200_000);
  });

  test('8. 조건부 성과급(최대 100만)은 확정 수입에 포함하지 않음', () => {
    const bonus: PaymentComponent = { label: '성과급', amount: 1_000_000, pay: 'conditional', amountKind: 'max', condition: '목표 달성 시', status: 'pending' };
    const r = job('2026-10-01', { amount: 3_100_000, payment: { components: [fixed('기본급', 3_100_000), bonus] } });
    expect(income(r, 2026, 12)).toBe(3_100_000);
  });
});

describe('수정·화면 일치·영업일', () => {
  test('9. 근로 시작일 10/25 → 10/15로 수정하면 첫 급여 금액·문구가 함께 바뀜 (결제 id 유지)', () => {
    const before = job('2026-10-25');
    const d = recordToDraft(before);
    const after = draftToRecord({ ...d, startDate: '2026-10-15' }, 'job', TODAY);
    expect(after.payments[0].id).toBe(before.payments[0].id);
    const [first] = pays(after, '2026-11-01', '2026-11-30');
    expect([first.amount, first.title]).toEqual([1_700_000, '첫 급여 · 10월 15일~31일 근무분']);
  });

  test('10. 캘린더 카드·월 합계·급여 카드(일할 계산)가 같은 금액·날짜', () => {
    const r = job('2026-10-15');
    const items = scheduleForRange([r], { start: '2026-11-01', end: '2026-11-30' }, TODAY);
    const [g] = groupCalendarItems(items, TODAY);
    expect(g.title).toBe('첫 급여 · 10월 15일~31일 근무분');
    expect(g.cashflows[0].total).toBe(income(r, 2026, 11));
    const plan = prorationPlan(r, r.payments[0]);
    expect(plan.status === 'ready' && [plan.first?.payDate, plan.first?.total]).toEqual([g.date, g.cashflows[0].total]);
  });

  test('11. 지급일이 휴일이면 계약상 규칙대로: 2027-01-10(일) → 직전 영업일 1/8 · 다음 영업일 1/11', () => {
    const prev = pays(job('2026-10-01', { payment: { businessDayRule: 'previous' } }), '2027-01-01', '2027-01-31');
    const next = pays(job('2026-10-01', { payment: { businessDayRule: 'next' } }), '2027-01-01', '2027-01-31');
    expect([prev[0].date, next[0].date]).toEqual(['2027-01-08', '2027-01-11']);
  });

  test('12. 다른 계약 금전 계산 회귀: 렌탈 월 결제는 일할·문구 변경 없음 (전체 회귀는 golden·통합 테스트)', () => {
    const rental: ContractDraft = {
      ...EMPTY_DRAFT, title: '렌탈', category: 'rental', contractType: 'recurring', contractKind: 'rental', startDate: '2026-10-12',
      payments: [salary({ kind: 'recurring_fee', direction: 'expense', label: '월 렌탈료', amount: 29_900, dayOfMonth: 12, startsOn: '2026-10-12' })],
    };
    const rr = draftToRecord(rental, 'rent', TODAY);
    expect(monthSpending([rr], { year: 2026, month: 11 }, TODAY).ordinaryExpense).toBe(29_900);
    expect(pays(rr, '2026-11-01', '2026-11-30')[0].title).toBe('월 렌탈료');
  });
});

describe('AI 날짜·금액 근거 대조 (같은 계약서를 다시 분석해도 값이 달라질 수 있음 → 근거와 다르면 확인 필요)', () => {
  test('문장 속 날짜·금액 읽기', () => {
    expect(datesInText('2026년 10월 15일부터 (기간의 정함이 없음)').full).toEqual(['2026-10-15']);
    expect(datesInText('최초 급여 지급일: 2026.11.10').full).toEqual(['2026-11-10']);
    expect(datesInText('10월 15일 입사').md).toEqual(['10-15']);
    expect(amountsInText('월 기본급: 3,100,000원 (세전)')).toEqual([3_100_000]);
    expect(amountsInText('월 310만 원')).toEqual([3_100_000]);
  });

  test('근거 문장과 다른 날짜·금액은 모순으로 판단, 같거나 판단 근거가 없으면 아님', () => {
    expect(quoteContradictsDate('2026-10-25', '2026년 10월 15일부터 (기간의 정함이 없음)')).toBe(true);
    expect(quoteContradictsDate('2026-10-15', '2026년 10월 15일부터 (기간의 정함이 없음)')).toBe(false);
    expect(quoteContradictsDate('2026-10-15', '입사일부터')).toBe(false);
    expect(quoteContradictsAmount(3_200_000, '월 기본급: 3,100,000원 (세전)')).toBe(true);
    expect(quoteContradictsAmount(3_100_000, '월 기본급: 3,100,000원 (세전)')).toBe(false);
  });

  test('AI가 시작일을 근거와 다르게 답하면 값은 그대로 두고 신뢰도 낮춤 + 확인 사유 (자동으로 고치지 않음)', () => {
    const [d] = cleanDates([{ date: '2026-10-25', meaning: 'contract_start', label: '근로 시작일', confidence: 'high', source_type: 'explicit', evidence_quote: '2026년 10월 15일부터 (기간의 정함이 없음)', evidence_page: 1 }]);
    expect([d.date, d.confidence, d.check]).toEqual(['2026-10-25', 'low', 'evidence_mismatch']);
    const [ok] = cleanDates([{ date: '2026-10-15', meaning: 'contract_start', label: '근로 시작일', confidence: 'high', source_type: 'explicit', evidence_quote: '2026년 10월 15일부터', evidence_page: 1 }]);
    expect([ok.confidence, ok.check]).toEqual(['high', undefined]);
  });

  test('체결일(10/14)과 근로 시작일(10/15)을 따로 고름 · 시작 의미 날짜가 서로 다르면 확인 필요', () => {
    const dates = cleanDates([
      { date: '2026-10-14', meaning: 'contract_signed', label: '계약 체결일', confidence: 'high', source_type: 'explicit', evidence_quote: '2026년 10월 14일', evidence_page: 1 },
      { date: '2026-10-15', meaning: 'contract_start', label: '근로계약기간 시작', confidence: 'high', source_type: 'explicit', evidence_quote: '2026년 10월 15일부터', evidence_page: 1 },
    ]);
    assignDateUses(dates, 'employment', []);
    expect(dates.map((d) => [d.use, d.date, d.confidence])).toEqual([
      ['contract_date', '2026-10-14', 'high'],
      ['start', '2026-10-15', 'high'],
    ]);
    const conflict = cleanDates([
      { date: '2026-10-15', meaning: 'contract_start', label: '근로 시작', confidence: 'high', source_type: 'explicit', evidence_quote: null },
      { date: '2026-10-25', meaning: 'contract_start', label: '입사', confidence: 'high', source_type: 'explicit', evidence_quote: null },
    ]);
    assignDateUses(conflict, 'employment', []);
    const start = conflict.find((d) => d.use === 'start')!;
    expect([start.confidence, start.check]).toEqual(['low', 'conflict']);
  });
});
