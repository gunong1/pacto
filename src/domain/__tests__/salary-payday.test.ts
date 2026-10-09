/**
 * 급여 지급일 — 근로 시작일 ≠ 급여 지급일 (테스트 근로계약서: 시작 2026-07-20, 월 1,270,000 = 기본급 1,200,000 + 직책수당 70,000)
 * A. 지급일 없음 → 20일 급여 일정 없음 · "지급일 확인 필요"
 * B. "급여는 매월 25일 지급" → 매월 25일
 * C. 시작일과 지급일 모두 20일로 명시 → 매월 20일 (같은 날이라서가 아니라 명시돼 있어서)
 * 서버 안전장치(AI가 시작일 날짜를 지급일로 넣은 경우) · 앱 변환 · 일정 계산 세 단계로 확인
 */
import { FIELDS, quoteHasPayDay, toAppResult } from '../../../supabase/functions/_shared/extraction.ts';
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft } from '@/data/repository';
import { coreInfo } from '@/domain/coreInfo';
import { isPaymentDayUnknown, nextPayment, scheduleForRange } from '@/domain/schedule';
import { monthSpending } from '@/domain/spending';
import { toReviewModel } from '@/features/registration/extraction';

const TODAY = '2026-10-09';
const START = '2026-07-20';

function modelOutput(salary: { day: number | null; quote: string }) {
  const fields: Record<string, unknown> = {};
  for (const k of Object.keys(FIELDS)) fields[k] = { value: null, confidence: 'low', evidence_quote: null };
  fields.title = { value: '근로계약서', confidence: 'high', evidence_quote: null };
  return {
    category: { value: 'employment', confidence: 'high', alternatives: [], reason: '' },
    contract_type: { value: 'employment', confidence: 'high', alternatives: [], reason: '' },
    fields,
    dates: [{ date: START, meaning: 'hire', label: '근로 시작일', confidence: 'high', evidence_quote: '근로계약기간은 2026년 7월 20일부터' }],
    payments: [
      {
        kind: 'salary', direction: 'income', label: '월급여', amount: 1_270_000, frequency: 'monthly', day_of_month: salary.day, date: null, date_source: null,
        end_date: null, installment_count: null, is_variable: false, confidence: 'high', role: 'payment', evidence_quote: salary.quote,
      },
      { kind: 'salary', direction: 'income', label: '기본급', amount: 1_200_000, frequency: 'monthly', role: 'component', part_of: '월급여', confidence: 'high', evidence_quote: null },
      { kind: 'salary', direction: 'income', label: '직책수당', amount: 70_000, frequency: 'monthly', role: 'component', part_of: '월급여', confidence: 'high', evidence_quote: null },
    ],
    details: [],
    checks: [],
  };
}
const review = (salary: { day: number | null; quote: string }) => toReviewModel(toAppResult(modelOutput(salary), 'openai'), ['doc-1']);
const salaryDates = (draft: ContractDraft, start: string, end: string) =>
  scheduleForRange([draftToRecord(draft, 'job', TODAY)], { start, end }, TODAY)
    .filter((i) => i.type === 'payment')
    .map((i) => i.date);

describe('서버 안전장치 — AI가 근로 시작일의 날짜(20일)를 지급일로 넣은 경우', () => {
  test('문구에 지급일이 없는데 day_of_month = 시작일의 일자(20) → null (추론으로 봄)', () => {
    const r = toAppResult(modelOutput({ day: 20, quote: '계(약) 1,270,000' }), 'openai');
    expect(r.payments[0]).toMatchObject({ label: '월급여', dayOfMonth: null, confidence: 'low' });
  });
  test('문구에 "매월 20일 지급"이 있으면 시작일과 같아도 유지 (C)', () => {
    const r = toAppResult(modelOutput({ day: 20, quote: '임금은 매월 20일 지급한다' }), 'openai');
    expect(r.payments[0].dayOfMonth).toBe(20);
  });
  test('시작일과 다른 명시 지급일(25일)은 그대로 (B)', () => {
    const r = toAppResult(modelOutput({ day: 25, quote: '급여는 매월 25일 지급한다' }), 'openai');
    expect(r.payments[0].dayOfMonth).toBe(25);
  });
  test('지급일 문구 판별: 숫자 경계·말일', () => {
    expect(quoteHasPayDay('매월 20일 지급', 20)).toBe(true);
    expect(quoteHasPayDay('매월 120일', 20)).toBe(false);
    expect(quoteHasPayDay('월 1,270,000원', 20)).toBe(false);
    expect(quoteHasPayDay('매월 말일 지급', 31)).toBe(true);
  });
});

describe('A. 시작일 7월 20일 / 월급 127만원 / 지급일 없음', () => {
  const m = review({ day: null, quote: '계(약) 1,270,000' });
  test('앱 변환: 지급일 null(시작일로 채우지 않음) · "확인 필요" 표시 · 금액·구성은 그대로', () => {
    const p = m.draft.payments.find((x) => x.label === '월급여')!;
    expect(p).toMatchObject({ amount: 1_270_000, dayOfMonth: null, direction: 'income' });
    expect(p.components).toEqual([{ label: '기본급', amount: 1_200_000 }, { label: '직책수당', amount: 70_000 }]);
    expect(m.flagged.has('payments.0.dayOfMonth')).toBe(true);
    expect(m.notes['payments.0.dayOfMonth']).toContain('지급일이 없어요');
  });
  test('캘린더: 20일 급여 일정 없음 (1년 동안 급여 일정 0건) · 다음 지급 없음 · 월 수입 합계에도 넣지 않음', () => {
    expect(salaryDates(m.draft, '2026-07-01', '2027-07-31')).toEqual([]);
    const rec = draftToRecord(m.draft, 'job', TODAY);
    expect(nextPayment(rec, TODAY)).toBeNull();
    expect(monthSpending([rec], { year: 2026, month: 10 }).incomeTotal).toBe(0);
  });
  test('계약 상세: "매월 · 지급일 확인 필요"', () => {
    const rec = draftToRecord(m.draft, 'job', TODAY);
    expect(isPaymentDayUnknown(rec.payments[0])).toBe(true);
    expect(coreInfo(rec, TODAY).find((r) => r.label === '월급여')?.value).toBe('+1,270,000원 · 매월 · 지급일 확인 필요');
  });
});

describe('B. 시작일 7월 20일 / 월급 127만원 / "매월 25일 지급"', () => {
  const m = review({ day: 25, quote: '급여는 매월 25일 지급한다' });
  test('매월 25일 급여 일정 (20일 아님)', () => {
    const ds = salaryDates(m.draft, '2026-07-01', '2026-12-31');
    expect(ds.length).toBeGreaterThanOrEqual(5);
    expect(ds.every((d) => d.endsWith('-25'))).toBe(true);
    expect(ds[0]).toBe('2026-07-25');
  });
});

describe('C. 시작일과 급여일 모두 20일로 명시', () => {
  const m = review({ day: 20, quote: '임금은 매월 20일 지급한다' });
  test('매월 20일 급여 일정 — 계약서에 명시돼 있어서 생성', () => {
    expect(salaryDates(m.draft, '2026-07-01', '2026-12-31')).toEqual(['2026-07-20', '2026-08-20', '2026-09-20', '2026-10-20', '2026-11-20', '2026-12-20']);
  });
});

describe('사용자가 지급일을 직접 입력 (user_confirmed)', () => {
  test('지급일 없는 급여에 사용자가 25일을 넣으면 매월 25일', () => {
    const draft: ContractDraft = {
      ...EMPTY_DRAFT, title: '근로계약서', category: 'employment', contractType: 'employment', startDate: START,
      payments: [{ kind: 'salary', direction: 'income', label: '월급여', amount: 1_270_000, frequency: 'monthly', dayOfMonth: 25, monthOfYear: null, startsOn: null, endsOn: null, installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null }],
    };
    expect(salaryDates(draft, '2026-10-01', '2026-10-31')).toEqual(['2026-10-25']);
  });
  test('지출(월 결제)은 기존대로 — 지급일 확인 대상이 아님', () => {
    expect(isPaymentDayUnknown({ frequency: 'monthly', direction: 'expense', dayOfMonth: null })).toBe(false);
  });
});
