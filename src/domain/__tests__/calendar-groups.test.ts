/**
 * 캘린더 요약 — 같은 계약·같은 날짜 일정을 카드 하나로 (화면 전용, 원본 일정·월 지출 합계는 그대로)
 * 기준: 공기청정기 렌탈 (시작·설치 2026-10-12, 매월 12일 29,900원, 설치비 20,000원 일시불)
 */
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import { contractFormSchema, draftToForm, formToDraft } from '@/features/contracts/form';

import { cashflowBreakdown, dayMarkers, groupCalendarItems } from '../calendarGroups';
import { scheduleForRange } from '../schedule';
import { monthSpending } from '../spending';
import type { ContractRecord } from '../types';

const TODAY = '2026-10-06';

type Pay = { kind: string; direction: 'expense' | 'income' | 'neutral'; label: string; amount: string; frequency: 'monthly' | 'one_time'; dayOfMonth?: string; startsOn?: string; obligation?: 'confirmed' | 'optional' | 'conditional' | 'potential' | 'informational' };

function record(id: string, o: { title: string; category?: string; contractType?: string; startDate?: string; endDate?: string; payments: Pay[]; dates?: { kind: string; label: string; date: string }[]; autoRenewal?: boolean; notice?: string }): ContractRecord {
  const form = {
    ...draftToForm({ ...EMPTY_DRAFT, title: o.title, category: (o.category ?? 'rental') as never, contractType: (o.contractType ?? 'recurring') as never }),
    startDate: o.startDate ?? '2026-10-12',
    endDate: o.endDate ?? '2029-10-11',
    payments: o.payments.map((p) => ({
      kind: p.kind as never, direction: p.direction, label: p.label, amount: p.amount, frequency: p.frequency, dayOfMonth: p.dayOfMonth ?? '', monthOfYear: '',
      startsOn: p.startsOn ?? '', endsOn: '', installmentCount: '', isVariable: false, components: [], businessDayRule: 'none' as const, obligation: p.obligation ?? 'confirmed', conditionNote: '',
    })),
    dates: (o.dates ?? []) as never,
    autoRenewal: o.autoRenewal ?? false,
    renewalPeriodMonths: o.autoRenewal ? '12' : '',
    terminationNoticeDays: o.notice ?? '',
  };
  return draftToRecord(formToDraft(contractFormSchema.parse(form)), id, TODAY);
}

const RENT: Pay = { kind: 'recurring_fee', direction: 'expense', label: '월 렌탈료', amount: '29,900', frequency: 'monthly', dayOfMonth: '12' };
const SETUP: Pay = { kind: 'setup_fee', direction: 'expense', label: '설치비', amount: '20,000', frequency: 'one_time', startsOn: '2026-10-12' };
const INSTALL = { kind: 'installation', label: '설치일 / 시작일', date: '2026-10-12' };

const groupsOn = (records: ContractRecord[], date: string) => groupCalendarItems(scheduleForRange(records, { start: date, end: date }, TODAY));

describe('캘린더 요약 카드', () => {
  const rental = record('c-rental', { title: '가정용 공기청정기 렌탈계약서', payments: [RENT, SETUP], dates: [INSTALL] });

  test('기준 사례: 원본 4건(이용 시작·설치일·월 렌탈료·설치비) → 카드 1개, 이용 시작 + 49,900원 결제 예정', () => {
    const items = scheduleForRange([rental], { start: '2026-10-12', end: '2026-10-12' }, TODAY);
    expect(items).toHaveLength(4); // 원본 일정은 그대로
    const [g] = groupsOn([rental], '2026-10-12');
    expect(groupsOn([rental], '2026-10-12')).toHaveLength(1);
    expect(g.items).toHaveLength(4);
    expect(g.primary).toEqual({ type: 'contract_start', label: '이용 시작', action: false });
    expect(g.secondaryLabels).toEqual([]);
    expect(g.cashflows.map((c) => c.headline)).toEqual(['49,900원 결제 예정']);
    expect(cashflowBreakdown(g.cashflows[0])).toBe('월 렌탈료 29,900원 · 설치비 20,000원');
  });

  test('A. 시작 + 설치(같은 의미) → 카드 1개, 대표 시작 문구 1개', () => {
    const r = record('a', { title: '렌탈 A', payments: [], dates: [INSTALL] });
    const gs = groupsOn([r], '2026-10-12');
    expect(gs).toHaveLength(1);
    expect(gs[0].primary?.label).toBe('이용 시작');
    expect(gs[0].secondaryLabels).toEqual([]);
    expect(gs[0].cashflows).toEqual([]);
  });

  test('A-3. 날짜 종류별 대표 문구: 통신 개통 → "개통", 임대차 입주 → "임대차 시작 · 입주" (문구 하나)', () => {
    const tel = record('tel', { title: '휴대폰', category: 'telecom', payments: [], dates: [{ kind: 'activation', label: '개통일', date: '2026-10-12' }] });
    expect(groupsOn([tel], '2026-10-12')[0]).toMatchObject({ primary: { label: '개통' }, secondaryLabels: [] });
    const lease = record('lease', { title: '전세', category: 'real_estate', contractType: 'lease', payments: [], dates: [{ kind: 'move_in', label: '입주일', date: '2026-10-12' }] });
    expect(groupsOn([lease], '2026-10-12')[0]).toMatchObject({ primary: { label: '임대차 시작 · 입주' }, secondaryLabels: [] });
  });

  test('A-2. 시작 일정이 없는 유형(할부)은 인도일을 대표로', () => {
    const r = record('a2', { title: '차량 할부', category: 'vehicle', contractType: 'installment', payments: [], dates: [{ kind: 'handover', label: '차량 인도일', date: '2026-10-12' }] });
    expect(groupsOn([r], '2026-10-12')[0].primary?.label).toBe('인도');
  });

  test('B. 결제 2건 → 카드 1개, 합계 49,900원, 세부 2건', () => {
    const r = record('b', { title: '렌탈 B', startDate: '2026-10-01', payments: [RENT, SETUP] });
    const gs = groupsOn([r], '2026-10-12');
    expect(gs).toHaveLength(1);
    expect(gs[0].primary).toBeNull();
    expect(gs[0].cashflows).toHaveLength(1);
    expect(gs[0].cashflows[0]).toMatchObject({ direction: 'expense', total: 49_900 });
    expect(gs[0].cashflows[0].items).toHaveLength(2);
  });

  test('C. 같은 날 서로 다른 계약 2개 → 카드 2개 (같은 이름이어도 계약이 다르면 따로)', () => {
    const kt1 = record('kt-phone', { title: 'KT 계약', category: 'telecom', payments: [RENT] });
    const kt2 = record('kt-internet', { title: 'KT 계약', category: 'telecom', payments: [SETUP] });
    const gs = groupsOn([kt1, kt2], '2026-10-12');
    expect(gs).toHaveLength(2);
    expect(gs.map((g) => g.contractId).sort()).toEqual(['kt-internet', 'kt-phone']);
  });

  test('D. 결제 + 해지 통보기한 → 카드 1개, 통보기한이 대표, 결제도 카드 안에', () => {
    // 종료 2029-10-11, 통보 30일 전 = 2029-09-11, 결제일 11일
    const r = record('d', { title: '정수기 렌탈계약', payments: [{ ...RENT, label: '월 렌탈료', amount: '32,000', dayOfMonth: '11' }], autoRenewal: true, notice: '30' });
    const gs = groupsOn([r], '2029-09-11');
    expect(gs).toHaveLength(1);
    expect(gs[0].primary).toEqual({ type: 'termination_notice', label: '해지 통보기한', action: true });
    expect(gs[0].cashflows.map((c) => c.headline)).toEqual(['32,000원 결제 예정']);
  });

  test('E. 조건부 위약금은 합산하지 않음 (월 렌탈료 29,900원만)', () => {
    const r = record('e', { title: '렌탈 E', startDate: '2026-10-01', payments: [RENT, { kind: 'other', direction: 'expense', label: '중도해지 위약금', amount: '100,000', frequency: 'one_time', startsOn: '2026-10-12', obligation: 'conditional' }] });
    const [g] = groupsOn([r], '2026-10-12');
    expect(g.cashflows[0].total).toBe(29_900);
    expect(g.items.some((i) => i.title.includes('위약금'))).toBe(false);
  });

  test('F. 선택형 락커비는 합산하지 않음', () => {
    const r = record('f', { title: '헬스장', category: 'membership', startDate: '2026-10-01', payments: [{ kind: 'recurring_fee', direction: 'expense', label: '이용료', amount: '55,000', frequency: 'monthly', dayOfMonth: '12' }, { kind: 'other', direction: 'expense', label: '락커비', amount: '10,000', frequency: 'monthly', dayOfMonth: '12', obligation: 'optional' }] });
    const [g] = groupsOn([r], '2026-10-12');
    expect(g.cashflows[0]).toMatchObject({ total: 55_000, items: [{ label: '이용료', amount: 55_000, estimated: false }] });
  });

  test('G. 시작 + 결제가 한 카드여도 월 지출은 결제만 (묶기 전후 합계 동일, 시작 일정은 금액 없음)', () => {
    const before = monthSpending([rental], { year: 2026, month: 10 }).total;
    const [g] = groupsOn([rental], '2026-10-12');
    expect(before).toBe(49_900);
    expect(g.cashflows.reduce((s, c) => s + c.total, 0)).toBe(49_900);
    expect(g.items.filter((i) => i.type !== 'payment').every((i) => i.amount == null)).toBe(true);
    // 한 달 전체로 봐도 카드 금액 합 = 월 지출
    const month = groupCalendarItems(scheduleForRange([rental], { start: '2026-10-01', end: '2026-10-31' }, TODAY));
    expect(month.flatMap((x) => x.cashflows).filter((c) => c.direction === 'expense').reduce((s, c) => s + c.total, 0)).toBe(before);
  });

  test('수입: 급여는 "급여 예정", 지출과 섞지 않음', () => {
    const r = record('w', { title: '근로계약서', category: 'employment', contractType: 'employment', startDate: '2026-10-01', endDate: '2027-09-30', payments: [{ kind: 'salary', direction: 'income', label: '급여', amount: '3,600,000', frequency: 'monthly', dayOfMonth: '25' }] });
    const [g] = groupsOn([r], '2026-10-23').concat(groupsOn([r], '2026-10-25'));
    expect(g.cashflows).toHaveLength(1);
    expect(g.cashflows[0]).toMatchObject({ direction: 'income', total: 3_600_000 });
    expect(g.cashflows[0].headline).toBe('+3,600,000원 급여 예정');
  });

  test('날짜 점: 계약 4건 일정이어도 종류별로만 (행 수만큼 찍지 않음)', () => {
    const markers = dayMarkers(groupsOn([rental], '2026-10-12'));
    expect([...markers.get('2026-10-12')!].sort()).toEqual(['contract_start', 'key_date', 'payment']);
  });

  test('세부 내역이 많으면 앞 3건 + "외 n건"', () => {
    const many = record('m', { title: '통신', category: 'telecom', startDate: '2026-10-01', payments: ['요금', '할부', '부가', '보험', '기타'].map((l, k) => ({ kind: 'other', direction: 'expense' as const, label: l, amount: `${(k + 1) * 1000}`, frequency: 'monthly' as const, dayOfMonth: '12' })) });
    const [g] = groupsOn([many], '2026-10-12');
    expect(g.cashflows[0].total).toBe(15_000);
    expect(cashflowBreakdown(g.cashflows[0])).toBe('요금 1,000원 · 할부 2,000원 · 부가 3,000원 외 2건');
  });
});
