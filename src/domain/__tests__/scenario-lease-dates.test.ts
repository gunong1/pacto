/* 결제 날짜 해석 — "계약 당일 지급" 같은 기준 날짜 표현을 기준 필드로, 옆 줄 날짜를 옮기지 않는다 (사용자가 올린 주택 월세 샘플) */
import { anchorFromQuote, quoteHasDate, resolvePaymentDate, toAppResult } from '../../../supabase/functions/_shared/extraction.ts';
import { draftToRecord } from '@/data/draft';
import { toReviewModel } from '@/features/registration/extraction';
import { expandPayment } from '../schedule';

const TODAY = '2026-10-08';
const ev = (quote: string | null) => ({ evidence_quote: quote, evidence_page: 1, evidence_file: 1 });
const date = (d: string, meaning: string, label: string, quote: string) => ({ date: d, meaning, label, confidence: 'high', source_type: 'explicit', ...ev(quote) });
const pay = (p: Record<string, unknown>) => ({
  role: 'one_time_cashflow', part_of: null, kind: 'deposit', direction: 'neutral', day_of_month: null, date: null, date_source: 'explicit', end_date: null, installment_count: null,
  is_variable: false, payment_obligation: 'confirmed', condition: null, business_day_rule: 'none', confidence: 'high', source_type: 'explicit', ...ev(null), ...p,
});

const DEPOSIT_QUOTE = '2,000,000원 (금 이백만원) – 계약 당일 지급';

/** 주택 월세 임대차계약서 샘플 — 계약금 행의 날짜만 모델 응답별로 바꾼다 */
function lease(deposit: Record<string, unknown>, opts: { signed?: boolean } = {}) {
  return {
    category: { value: 'real_estate', confidence: 'high', alternatives: [], reason: '' },
    contract_type: { value: 'lease', confidence: 'high', alternatives: [], reason: '' },
    fields: [{ key: 'depositAmount', text_value: null, number_value: 20000000, boolean_value: null, confidence: 'high', ...ev('보증금 20,000,000원 (금 이천만원)') }],
    dates: [
      ...(opts.signed === false ? [] : [date('2026-10-08', 'contract_signed', '계약서 작성일', '2026년 10월 8일')]),
      date('2026-10-20', 'contract_start', '계약기간 시작', '2026년 10월 20일 ~ 2028년 10월 19일 (2년간)'),
      date('2028-10-19', 'contract_end', '계약기간 종료', '2026년 10월 20일 ~ 2028년 10월 19일 (2년간)'),
      date('2026-10-20', 'move_in', '입주일(잔금일)', '입주일(잔금일) 2026년 10월 20일'),
    ],
    payments: [
      pay({ label: '계약금', amount: 2000000, ...ev(DEPOSIT_QUOTE), ...deposit }),
      pay({ label: '잔금', amount: 18000000, date: '2026-10-20', ...ev('18,000,000원 (금 일천팔백만원) – 2026년 10월 20일 지급') }),
      pay({ role: 'recurring_cashflow', kind: 'rent', direction: 'expense', label: '월세', amount: 850000, frequency: 'monthly', day_of_month: 20, ...ev('월세 및 관리비 지급일 매월 20일') }),
      pay({ role: 'recurring_cashflow', kind: 'maintenance_fee', direction: 'expense', label: '관리비', amount: 100000, frequency: 'monthly', day_of_month: 20, ...ev('월세 및 관리비 지급일 매월 20일') }),
    ].map((p) => ({ frequency: 'one_time', ...p })),
    details: [],
    checks: [],
  };
}
const review = (deposit: Record<string, unknown>, opts?: { signed?: boolean }) => toReviewModel(toAppResult(lease(deposit, opts), 'openai'), ['doc-1']);
const byLabel = (m: ReturnType<typeof review>, label: string) => {
  const i = m.draft.payments.findIndex((p) => p.label === label);
  return { p: m.draft.payments[i], path: `payments.${i}` };
};

describe('주택 월세 샘플 — 계약금은 "계약 당일" = 계약일(2026-10-08)', () => {
  // 수정 전에는 두 경우 모두 계약금이 2026-10-20으로 저장됐다:
  //  (가) 모델이 날짜를 비우면(null) 저장할 때 계약 시작일(10/20)로 채움  (나) 모델이 옆 줄 잔금 날짜(10/20)를 옮겨 적음
  const cases: [string, Record<string, unknown>][] = [
    ['모델이 기준 날짜로 답함 (contract_date, 2026-10-08)', { date: '2026-10-08', date_source: 'contract_date' }],
    ['모델이 기준만 답하고 날짜는 비움', { date: null, date_source: 'contract_date' }],
    ['모델이 옆 줄 날짜를 옮겨 explicit로 답함 (2026-10-20)', { date: '2026-10-20', date_source: 'explicit' }],
    ['모델이 기준을 contract_date로 하고 날짜는 옆 줄 날짜로 잘못 적음', { date: '2026-10-20', date_source: 'contract_date' }],
    ['이전 형식(v7, date_source 없음) + 옆 줄 날짜', { date: '2026-10-20', date_source: undefined }],
    ['이전 형식(v7, date_source 없음) + 날짜 없음', { date: null, date_source: undefined }],
  ];
  test.each(cases)('%s', (_name, deposit) => {
    const m = review(deposit);
    const record = draftToRecord(m.draft, 'lease', TODAY);
    const saved = (label: string) => record.payments.find((p) => p.label === label)!;

    // 계약금 2,000,000 → 2026-10-08 (10월 20일로 상속되지 않음)
    const dep = byLabel(m, '계약금');
    expect(dep.p.amount).toBe(2000000);
    expect(dep.p.startsOn).toBe('2026-10-08');
    expect(saved('계약금').startsOn).toBe('2026-10-08');
    expect(saved('계약금').startsOn).not.toBe('2026-10-20');
    expect(m.notes[`${dep.path}.startsOn`]).toBe("계약서에 '계약 당일'로 적혀 있어 계약일(2026. 10. 8.)로 넣었어요.");

    // 잔금 18,000,000 → 2026-10-20 (계약서에 직접 적힌 날짜)
    expect(saved('잔금').amount).toBe(18000000);
    expect(saved('잔금').startsOn).toBe('2026-10-20');
    expect(m.flagged.has(`${byLabel(m, '잔금').path}.startsOn`)).toBe(false);

    // 월세 850,000 · 관리비 100,000 → 매월 20일
    for (const [label, amount] of [['월세', 850000], ['관리비', 100000]] as const) {
      const p = saved(label);
      expect(p.amount).toBe(amount);
      expect(p.frequency).toBe('monthly');
      expect(p.dayOfMonth).toBe(20);
      expect(expandPayment(p, record.contract, { start: '2026-10-01', end: '2026-12-31' }).map((o) => o.date)).toEqual(['2026-10-20', '2026-11-20', '2026-12-20']);
    }
    expect(m.draft.contractDate).toBe('2026-10-08');
    expect(m.draft.startDate).toBe('2026-10-20');
  });

  test('계약서에 계약일(작성일)이 없으면 다른 날짜로 채우지 않고 "확인 필요" (비워두면 저장 시 계약 시작일이라고 안내)', () => {
    const m = review({ date: '2026-10-20', date_source: 'explicit' }, { signed: false });
    const dep = byLabel(m, '계약금');
    expect(dep.p.startsOn).toBeNull();
    expect(m.flagged.has(`${dep.path}.startsOn`)).toBe(true);
    expect(m.notes[`${dep.path}.startsOn`]).toContain('계약일이 계약서에 없어요');
  });
});

describe('기준 날짜 해석 규칙', () => {
  const dates = [
    { date: '2026-10-08', meaning: 'contract_signed' },
    { date: '2026-10-20', meaning: 'contract_start' },
    { date: '2026-10-21', meaning: 'move_in' },
    { date: '2026-10-22', meaning: 'balance_due' },
    { date: '2028-10-19', meaning: 'contract_end' },
  ];
  test.each([
    ['계약금은 계약 당일 지급', 'contract_date', '2026-10-08'],
    ['계약 체결 시 지급한다', 'contract_date', '2026-10-08'],
    ['계약시 1,000,000원', 'contract_date', '2026-10-08'],
    ['중도금은 잔금일에 지급', 'balance_date', '2026-10-22'],
    ['입주일에 지급한다', 'move_in_date', '2026-10-21'],
    ['계약 시작일에 지급', 'start_date', '2026-10-20'],
    ['계약 종료일에 반환한다', 'end_date', '2028-10-19'],
  ])('"%s" → %s', (quote, source, expected) => {
    expect(anchorFromQuote(quote)).toBe(source);
    expect(resolvePaymentDate(null, 'explicit', quote, dates)).toEqual({ date: expected, dateSource: source });
  });

  test('"계약 시작일"은 "계약 시"가 아니다', () => {
    expect(anchorFromQuote('계약 시작일에 지급')).toBe('start_date');
  });

  test('날짜가 직접 적힌 금액은 그대로 (explicit)', () => {
    expect(resolvePaymentDate('2026-10-20', 'explicit', '잔금 18,000,000원 – 2026년 10월 20일 지급', dates)).toEqual({ date: '2026-10-20', dateSource: 'explicit' });
    expect(quoteHasDate('2026.10.20 지급', '2026-10-20')).toBe(true);
    expect(quoteHasDate('26-10-20', '2026-10-20')).toBe(true);
    expect(quoteHasDate('10월 20일에 지급', '2026-10-20')).toBe(true);
    expect(quoteHasDate('매월 20일', '2026-10-20')).toBe(false);
    expect(quoteHasDate('2026년 10월 2일', '2026-10-20')).toBe(false);
  });

  test('explicit인데 그 금액의 문구에 날짜가 없고 기준 표현도 없으면 추정(inferred)으로 낮춤 — 날짜는 두고 "확인 필요"', () => {
    expect(resolvePaymentDate('2026-10-20', 'explicit', '설치비 20,000원 (1회)', dates)).toEqual({ date: '2026-10-20', dateSource: 'inferred' });
  });

  test('기준 날짜가 계약서에 없으면 다른 날짜로 대신하지 않음', () => {
    expect(resolvePaymentDate('2026-10-20', 'contract_date', DEPOSIT_QUOTE, dates.filter((d) => d.meaning !== 'contract_signed'))).toEqual({ date: null, dateSource: 'contract_date' });
  });

  test('계산·추정 날짜는 그대로 두고 확인 화면에서 "확인 필요"', () => {
    expect(resolvePaymentDate('2026-10-15', 'calculated', '계약일로부터 7일 이내 지급', dates)).toEqual({ date: '2026-10-15', dateSource: 'calculated' });
    const m = review({ label: '계약금', date: '2026-10-15', date_source: 'calculated', ...ev('계약일로부터 7일 이내 지급') });
    const dep = byLabel(m, '계약금');
    expect(dep.p.startsOn).toBe('2026-10-15');
    expect(m.flagged.has(`${dep.path}.startsOn`)).toBe(true);
  });
});
