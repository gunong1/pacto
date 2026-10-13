/**
 * 실기기 테스트 재현 (2026-10-13) — 표 형식 계약서의 보증금 계약금·잔금이 일반 지출로 집계된 문제. 모든 값은 가짜다.
 *
 * 계약서 구조 (주택 월세 임대차계약서, 표):
 *   보증금 및 월세 ┬ 보증금 20,000,000원 (금 이천만원)
 *                 ├ 계약금  2,000,000원 (금 이백만원) – 계약 당일 지급
 *                 ├ 잔금   18,000,000원 (금 일천팔백만원) – 2026년 10월 20일 지급
 *                 ├ 월세      850,000원 · 관리비 100,000원 · 매월 20일
 * 표의 줄에는 "보증금"이라는 말이 계약금·잔금 줄에 없다 → 서버 R7의 의미 관계(이름·근거 문장)가 성립하지 않아 일반 지출로 남았다.
 * 같은 앱의 자동차 장기렌트 보증금 5,000,000원은 결제 한 건(kind=deposit)이라 정상 분류됐다.
 *
 * 원칙 (모든 계약 종류 공통 — 임대차 예외 처리 없음):
 *  - 몫이 어느 금액의 일부인지는 계약서가 보여 주는 관계로 정한다: 이름·근거 문장, 또는 AI가 계약서 구조(표의 묶음 등)로 답한 part_of
 *  - 합만 맞는 것은 근거가 아니다 (기존 원칙 유지) — 대신 "보증금의 일부인지 확인" 질문으로 사용자에게 보여 준다 (조용히 일반 지출로 단정하지 않음)
 *  - 보증금 총액은 별도 지급으로 더하지 않는다 (계약금 + 잔금 = 보증금 지급)
 */
import { draftToRecord } from '@/data/draft';
import { toReviewModel } from '@/features/registration/extraction';

import { toAppResult } from '../../../../supabase/functions/_shared/extraction.ts';
import { fundViews, withConfirmedRole } from '../../cashflow';
import { scheduleForRange } from '../../schedule';
import { monthSpending } from '../../spending';
import type { ContractRecord } from '../../types';
import { contract, pay } from './classificationFixtures';

const TODAY = '2026-10-08';
const q = (quote: string) => ({ evidence_quote: quote, evidence_page: 1, evidence_file: 1 });
const once = (p: Record<string, unknown>) => pay({ frequency: 'one_time', role: 'one_time_cashflow', day_of_month: null, ...p });

/** 실제 계약서 표의 줄 그대로 (계약금·잔금 줄에 "보증금" 없음) */
const ROW = {
  deposit: '보증금 20,000,000원 (금 이천만원)',
  down: '계약금 2,000,000원 (금 이백만원) – 계약 당일 지급',
  balance: '잔금 18,000,000원 (금 일천팔백만원) – 2026년 10월 20일 지급',
};

/** partOf: AI가 계약서 구조를 보고 답한 상위 금액 (null = 답하지 않음) */
function leaseTable(partOf: string | null) {
  return contract({
    cls: { kind: 'lease', subtype: 'housing', domains: ['real_estate'] },
    title: '주택 월세 임대차계약서',
    dates: [
      { date: '2026-10-08', meaning: 'contract_signed', label: '계약일', confidence: 'high', source_type: 'explicit', ...q('2026년 10월 8일') },
      { date: '2026-10-20', meaning: 'contract_start', label: '계약 시작일', confidence: 'high', source_type: 'explicit', ...q('2026년 10월 20일 ~ 2028년 10월 19일 (2년간)') },
      { date: '2028-10-19', meaning: 'contract_end', label: '계약 종료일', confidence: 'high', source_type: 'explicit', ...q('2026년 10월 20일 ~ 2028년 10월 19일 (2년간)') },
    ],
    payments: [
      once({ kind: 'deposit', role: 'deposit', direction: 'neutral', label: '보증금', amount: 20000000, ...q(ROW.deposit) }),
      once({ kind: 'down_payment', label: '계약금', amount: 2000000, date: '2026-10-08', date_source: 'contract_signed', part_of: partOf, ...q(ROW.down) }),
      once({ kind: 'balance_payment', label: '잔금', amount: 18000000, date: '2026-10-20', part_of: partOf, ...q(ROW.balance) }),
      pay({ kind: 'rent', label: '월세', amount: 850000, day_of_month: 20, ...q('월세 850,000원 (금 팔십오만원)') }),
      pay({ kind: 'maintenance_fee', label: '관리비', amount: 100000, day_of_month: 20, ...q('관리비 100,000원 (금 일십만원) (공용관리비 등)') }),
    ],
  });
}

/** 같은 앱의 자동차 장기렌트 (보증금 결제 한 건 — 정상 분류되던 쪽) */
const rental = contract({
  cls: { kind: 'rental', subtype: 'vehicle', domains: ['vehicle'] },
  title: '자동차 장기렌트 계약서',
  dates: [
    { date: '2026-10-10', meaning: 'contract_start', label: '렌탈 개시일', confidence: 'high', source_type: 'explicit', ...q('렌탈 개시일 2026년 10월 10일') },
    { date: '2029-10-09', meaning: 'contract_end', label: '렌탈 종료일', confidence: 'high', source_type: 'explicit', ...q('2029년 10월 9일까지') },
  ],
  payments: [
    once({ kind: 'deposit', role: 'deposit', direction: 'neutral', label: '보증금', amount: 5000000, date: '2026-10-10', ...q('보증금 5,000,000원은 차량 인도 시 납부') }),
    pay({ kind: 'recurring_fee', label: '월 대여료', amount: 769000, day_of_month: 25, ...q('월 대여료 769,000원 매월 25일') }),
  ],
});

const toRecord = (output: unknown, id: string, role: string | null) => {
  const result = toAppResult(output, 'openai');
  const model = toReviewModel(result, ['doc-1']);
  const record = draftToRecord(role ? withConfirmedRole(model.draft, role) : model.draft, id, TODAY);
  return { result, model, record };
};
const OCT = { year: 2026, month: 10 } as const;
const octSchedule = (records: ContractRecord[]) => scheduleForRange(records, { start: '2026-10-01', end: '2026-10-31' }, TODAY);
const parts = (r: ContractRecord) => r.payments.filter((p) => p.label === '계약금' || p.label === '잔금');

describe('표 형식 임대차계약서: AI가 계약금·잔금이 보증금의 일부라고 답함 (part_of)', () => {
  const lease = toRecord(leaseTable('보증금'), 'lease', 'lessee');
  const car = toRecord(rental, 'car', 'customer');

  test('계약금·잔금은 보증금의 몫 — 성격 보증금, 지급일 각각 유지, 보증금 총액은 별도 지급 아님', () => {
    expect(lease.record.contract.depositAmount).toBe(20000000);
    expect(lease.record.payments.some((p) => p.amount === 20000000)).toBe(false);
    expect(parts(lease.record).map((p) => [p.label, p.direction, p.moneyNature, p.startsOn])).toEqual([
      ['계약금', 'expense', 'refundable_deposit', '2026-10-08'],
      ['잔금', 'expense', 'refundable_deposit', '2026-10-20'],
    ]);
  });

  test('홈: 총 출금 26,719,000 = 일반 지출 1,719,000 + 보증금 지급 25,000,000 (실기기 기대값)', () => {
    const oct = monthSpending([lease.record, car.record], OCT, TODAY);
    expect([oct.total, oct.ordinaryExpense, oct.depositOut]).toEqual([26719000, 1719000, 25000000]);
    // 분야별(일반 지출만): 임대차 950,000 (월세+관리비) · 렌탈 769,000
    expect(oct.byCategory.reduce((s, c) => s + c.amount, 0)).toBe(1719000);
  });

  test('캘린더: 계약금(10-08)·잔금(10-20)은 보증금 지급으로 — 홈과 같은 항목', () => {
    const items = octSchedule([lease.record]).filter((i) => i.type === 'payment' && (i.title.includes('계약금') || i.title.includes('잔금')));
    expect(items.map((i) => [i.date, i.moneyNature])).toEqual([
      ['2026-10-08', 'deposit'],
      ['2026-10-20', 'deposit'],
    ]);
  });

  test('계약 상세: 보증금 20,000,000 = 계약금 + 잔금 (중복 없음)', () => {
    const [fund] = fundViews(lease.record, TODAY);
    expect(fund.total).toBe(20000000);
    expect(fund.members.map((p) => p.amount).sort((a, b) => a - b)).toEqual([2000000, 18000000]);
  });
});

describe('표 형식인데 AI가 관계를 답하지 않음 — 합만 맞는 것은 근거가 아니므로 단정하지 않고 확인을 요청', () => {
  const lease = toRecord(leaseTable(null), 'lease', 'lessee');

  test('성격은 바꾸지 않음 (기존 원칙: 합계는 보조 조건)', () => {
    expect(parts(lease.record).map((p) => p.moneyNature)).toEqual(['ordinary', 'ordinary']);
  });

  test('등록 확인 화면에서 "보증금의 일부인지" 확인 필요로 표시 (조용히 일반 지출로 단정하지 않음)', () => {
    const idx = lease.model.draft.payments.map((p, i) => [p.label, i] as const).filter(([l]) => l === '계약금' || l === '잔금').map(([, i]) => i);
    for (const i of idx) {
      expect(lease.model.flagged.has(`payments.${i}.moneyNature`)).toBe(true);
      expect(lease.model.notes[`payments.${i}.moneyNature`]).toContain('보증금');
    }
  });

  test('사용자가 "보증금"으로 고르면 홈·캘린더·상세가 기대값과 일치', () => {
    const chosen = {
      ...lease.model.draft,
      payments: lease.model.draft.payments.map((p) => (p.label === '계약금' || p.label === '잔금' ? { ...p, moneyNature: 'refundable_deposit' as const } : p)),
    };
    const record = draftToRecord(withConfirmedRole(chosen, 'lessee'), 'lease', TODAY);
    const car = toRecord(rental, 'car', 'customer').record;
    const oct = monthSpending([record, car], OCT, TODAY);
    expect([oct.total, oct.ordinaryExpense, oct.depositOut]).toEqual([26719000, 1719000, 25000000]);
    expect(fundViews(record, TODAY)[0].total).toBe(20000000);
  });
});

describe('이미 등록된 계약의 정정 — 결제 id·변경 이력·묶음 연결은 그대로, 성격만 바꾼다', () => {
  test('저장된 계약금·잔금(일반)의 성격을 보증금으로 바꾸면 홈 기대값과 일치하고 다른 값은 그대로', () => {
    const saved = toRecord(leaseTable(null), 'lease', 'lessee').record;
    const before = parts(saved).map((p) => ({ id: p.id, amount: p.amount, startsOn: p.startsOn, direction: p.direction, fundId: p.fundId ?? null }));
    const fixed: ContractRecord = { ...saved, payments: saved.payments.map((p) => (p.label === '계약금' || p.label === '잔금' ? { ...p, moneyNature: 'refundable_deposit' } : p)) };
    expect(parts(fixed).map((p) => ({ id: p.id, amount: p.amount, startsOn: p.startsOn, direction: p.direction, fundId: p.fundId ?? null }))).toEqual(before);
    const car = toRecord(rental, 'car', 'customer').record;
    const oct = monthSpending([fixed, car], OCT, TODAY);
    expect([oct.total, oct.ordinaryExpense, oct.depositOut]).toEqual([26719000, 1719000, 25000000]);
  });
});
