/**
 * 총액(aggregate) ≠ 실제 지급 — 보증금 20,000,000 = 계약금 2,000,000 + 잔금 18,000,000 (주택 월세 샘플)
 * 원인: 총액 행이 결제로 저장되면(이전 서버 결과, 또는 모델이 총액·몫의 방향을 다르게 답해 안전장치를 비켜 간 경우)
 * 날짜 없는 총액이 계약 시작일(10/20)로 채워져 잔금과 같은 날 38,000,000원으로 합쳐 보였다.
 * A 구성 합계 = 20,000,000, 별도 20,000,000 결제 없음 / B 잔금일 18,000,000 · 지출 합계 제외 (38,000,000 금지)
 * C 같은 날 월세·관리비(지출)와 보증금 잔금(중립) 분리 / D 용역 10,000,000 = 3M + 3M + 4M → 20M 아님
 */
import { toAppResult } from '../../../supabase/functions/_shared/extraction.ts';
import { findAggregateTotals } from '../../../supabase/functions/_shared/paymentAggregate';
import { draftToRecord } from '@/data/draft';
import { toRecord } from '@/data/supabase/rowMapping';
import { toReviewModel } from '@/features/registration/extraction';

import { summarizeCashflows } from '../calendarGroups';
import { coreInfo, extraCosts } from '../coreInfo';
import { scheduleForRange } from '../schedule';
import { monthSpending } from '../spending';
import type { ContractRecord } from '../types';

const TODAY = '2026-10-08';
const ev = (quote: string) => ({ evidence_quote: quote, evidence_page: 1, evidence_file: 1 });
const pay = (p: Record<string, unknown>) => ({
  role: 'one_time_cashflow', part_of: null, kind: 'deposit', direction: 'neutral', frequency: 'one_time', day_of_month: null, date: null, date_source: 'explicit', end_date: null,
  installment_count: null, is_variable: false, payment_obligation: 'confirmed', condition: null, business_day_rule: 'none', confidence: 'high', source_type: 'explicit', ...ev(''), ...p,
});
const leaseRaw = (deposit: Record<string, unknown>[]) => ({
  category: { value: 'real_estate', confidence: 'high', alternatives: [], reason: '' },
  contract_type: { value: 'lease', confidence: 'high', alternatives: [], reason: '' },
  fields: [{ key: 'depositAmount', text_value: null, number_value: 20000000, boolean_value: null, confidence: 'high', ...ev('보증금 20,000,000원 (금 이천만원)') }],
  dates: [
    { date: '2026-10-08', meaning: 'contract_signed', label: '계약서 작성일', confidence: 'high', source_type: 'explicit', ...ev('2026년 10월 8일') },
    { date: '2026-10-20', meaning: 'contract_start', label: '계약기간 시작', confidence: 'high', source_type: 'explicit', ...ev('2026년 10월 20일 ~ 2028년 10월 19일') },
    { date: '2028-10-19', meaning: 'contract_end', label: '계약기간 종료', confidence: 'high', source_type: 'explicit', ...ev('2026년 10월 20일 ~ 2028년 10월 19일') },
  ],
  payments: [
    ...deposit,
    pay({ label: '계약금', amount: 2000000, date: '2026-10-08', date_source: 'contract_date', ...ev('2,000,000원 (금 이백만원) – 계약 당일 지급') }),
    pay({ label: '잔금', amount: 18000000, date: '2026-10-20', ...ev('18,000,000원 (금 일천팔백만원) – 2026년 10월 20일 지급') }),
    pay({ role: 'recurring_cashflow', kind: 'rent', direction: 'expense', frequency: 'monthly', label: '월세', amount: 850000, day_of_month: 20, ...ev('월세 및 관리비 지급일 매월 20일') }),
    pay({ role: 'recurring_cashflow', kind: 'maintenance_fee', direction: 'expense', frequency: 'monthly', label: '관리비', amount: 100000, day_of_month: 20, ...ev('월세 및 관리비 지급일 매월 20일') }),
  ],
  details: [],
  checks: [],
});
const TOTAL = pay({ label: '보증금', amount: 20000000, ...ev('보증금 20,000,000원 (금 이천만원)') });

/** 10/20 캘린더 금액 요약 */
const on1020 = (r: ContractRecord) => summarizeCashflows(scheduleForRange([r], { start: '2026-10-20', end: '2026-10-20' }, TODAY));

function expectFixed(r: ContractRecord) {
  // A. 실제로 오가는 보증금 = 계약금 + 잔금 = 20,000,000 · 별도 20,000,000 결제 없음
  const occ = scheduleForRange([r], { start: '2026-10-01', end: '2026-10-31' }, TODAY).filter((i) => i.type === 'payment' && i.direction === 'neutral');
  expect(occ.map((i) => [i.title, i.amount])).toEqual([['계약금', 2000000], ['잔금', 18000000]]);
  expect(occ.reduce((s, i) => s + i.amount!, 0)).toBe(20000000);
  // B·C. 10/20: 950,000원 결제 예정(월세·관리비) / 18,000,000원 · 지출 합계 제외 (잔금)
  const day = on1020(r);
  expect(day.map((c) => c.headline)).toEqual(['950,000원 결제 예정', '18,000,000원 · 지출 합계 제외']);
  expect(day[1].items).toEqual([{ label: '잔금', amount: 18000000, estimated: false }]);
  expect(JSON.stringify(day)).not.toContain('38,000,000');
  // 10월 지출: 월세·관리비만 (보증금 계약금·잔금은 합계 제외)
  expect(monthSpending([r], { year: 2026, month: 10 }).total).toBe(950000);
}

describe('서버 분석 결과', () => {
  test.each([
    ['총액과 몫의 방향이 같음', TOTAL],
    // 이전 안전장치는 방향이 같을 때만 합계로 봤다 — 모델이 보증금 neutral·계약금/잔금 expense처럼 다르게 답하면 그대로 결제로 남았다
    ['총액 방향이 다름 (보증금 expense)', { ...TOTAL, direction: 'expense' }],
  ])('%s → 보증금 20,000,000은 합계(참고), 결제는 계약금·잔금만', (_n, total) => {
    const result = toAppResult(leaseRaw([total]), 'openai');
    expect(result.payments.map((p) => p.label)).toEqual(['계약금', '잔금', '월세', '관리비']);
    expect(result.references).toContainEqual({ label: '보증금', amount: 20000000, role: 'total' });
    const r = draftToRecord(toReviewModel(result, ['doc-1']).draft, 'lease', TODAY);
    expectFixed(r);
  });

  test('이전 버전 서버 결과(총액이 결제에 남아 있음)도 앱 확인 화면에서 합계로', () => {
    const result = toAppResult(leaseRaw([]), 'openai');
    result.payments.unshift({ ...result.payments[0], label: '보증금', amount: 20000000, date: null });
    const m = toReviewModel(result, ['doc-1']);
    expect(m.draft.payments.map((p) => p.label)).toEqual(['계약금', '잔금', '월세', '관리비']);
    expect(m.references).toContainEqual({ label: '보증금', amount: 20000000, role: 'total' });
    expectFixed(draftToRecord(m.draft, 'lease', TODAY));
  });
});

describe('이미 저장된 계약 (보증금·계약금·잔금 3행이 모두 확정 결제)', () => {
  const row = (id: string, label: string, amount: number, starts: string, o: Record<string, unknown> = {}) => ({
    id, contract_id: 'c1', kind: 'deposit', direction: 'neutral', label, amount, frequency: 'one_time', day_of_month: null, month_of_year: null, starts_on: starts, ends_on: null,
    installment_count: null, is_variable: false, components: [], business_day_rule: 'none', obligation: 'confirmed', condition_note: null, sort_order: Number(id.slice(1)), ...o,
  });
  const stored = (rows: ReturnType<typeof row>[]) =>
    toRecord({
      id: 'c1', title: '주택 월세 임대차계약서', category: 'real_estate', contract_type: 'lease', contract_details: {}, value_sources: {}, lifecycle: 'active', lifecycle_changed_on: null,
      contract_date: '2026-10-08', start_date: '2026-10-20', end_date: '2028-10-19', total_amount: null, auto_renewal: false, renewal_period_months: null, termination_notice_days: null,
      notice_kind: 'unknown', early_termination_terms: null, penalty_terms: null, deposit_amount: 20000000, memo: null, source: 'upload', notifications_enabled: true,
      created_at: '', updated_at: '', ai_checks: [], contract_dates: [], contract_events: [], contract_documents: [],
      contract_payments: rows,
    } as never);
  const rows = [
    row('p0', '보증금', 20000000, '2026-10-20'), // 날짜가 없던 총액 → 계약 시작일로 저장됨 (잔금과 같은 날)
    row('p1', '계약금', 2000000, '2026-10-08'),
    row('p2', '잔금', 18000000, '2026-10-20'),
    row('p3', '월세', 850000, '2026-10-20', { kind: 'rent', direction: 'expense', frequency: 'monthly', day_of_month: 20 }),
    row('p4', '관리비', 100000, '2026-10-20', { kind: 'maintenance_fee', direction: 'expense', frequency: 'monthly', day_of_month: 20 }),
  ];

  test('원인 재현: 총액을 결제로 세면 10/20에 38,000,000원', () => {
    const r = stored(rows);
    r.payments = r.payments.map((p) => ({ ...p, obligation: 'confirmed' as const })); // 정리 전 상태
    expect(on1020(r).map((c) => c.headline)).toContain('38,000,000원 · 지출 합계 제외');
  });

  test('읽을 때 총액은 참고 금액 → A·B·C 기대값, 핵심 정보에는 보증금 20,000,000원 (추가 비용 목록에는 없음)', () => {
    const r = stored(rows);
    expect(r.payments.find((p) => p.label === '보증금')).toMatchObject({ obligation: 'informational', amount: 20000000 });
    expectFixed(r);
    expect(coreInfo(r, TODAY).find((x) => x.key === 'deposit')?.value).toMatch(/2,000만원|20,000,000원/);
    expect(coreInfo(r, TODAY).some((x) => x.key.startsWith('info:'))).toBe(false); // 같은 금액을 두 번 보여주지 않음
    expect(extraCosts(r)).toEqual([]);
  });

  test('몫이 하나뿐이거나 합이 맞지 않으면 건드리지 않음', () => {
    expect(findAggregateTotals([{ label: '보증금', amount: 20000000, frequency: 'one_time' }, { label: '잔금', amount: 18000000, frequency: 'one_time' }])).toEqual([]);
    expect(findAggregateTotals([{ label: '보증금', amount: 20000000, frequency: 'one_time' }, { label: '계약금', amount: 2000000, frequency: 'one_time' }, { label: '잔금', amount: 17000000, frequency: 'one_time' }])).toEqual([]);
  });
});

describe('D. 다른 계약에도 같은 원칙', () => {
  test('용역 총 계약금액 10,000,000 = 착수금 3M + 중도금 3M + 잔금 4M → 합계 1건만, 현금 흐름 10M', () => {
    const ps = [
      { label: '총 계약금액', amount: 10000000, frequency: 'one_time' },
      { label: '착수금', amount: 3000000, frequency: 'one_time' },
      { label: '중도금', amount: 3000000, frequency: 'one_time' },
      { label: '잔금', amount: 4000000, frequency: 'one_time' },
    ];
    const totals = findAggregateTotals(ps);
    expect(totals.map((p) => p.label)).toEqual(['총 계약금액']);
    expect(ps.filter((p) => !totals.includes(p)).reduce((s, p) => s + p.amount, 0)).toBe(10000000);
  });
  test('매매대금 = 계약금 + 중도금 + 잔금 (선택형·정기 결제는 몫으로 보지 않음)', () => {
    const ps = [
      { label: '매매대금', amount: 300000000, frequency: 'one_time' },
      { label: '계약금', amount: 30000000, frequency: 'one_time' },
      { label: '중도금', amount: 70000000, frequency: 'one_time' },
      { label: '잔금', amount: 200000000, frequency: 'one_time' },
      { label: '관리비 잔금', amount: 5000, frequency: 'monthly' },
      { label: '중개 수수료 잔금', amount: 1000, frequency: 'one_time', obligation: 'optional' },
    ];
    expect(findAggregateTotals(ps).map((p) => p.label)).toEqual(['매매대금']);
  });
});
