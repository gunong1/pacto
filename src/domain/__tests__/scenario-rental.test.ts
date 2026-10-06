/**
 * 기준 시나리오: 공기청정기 렌탈
 * 체결 2026-10-05 / 시작 2026-10-12 / 종료 2029-10-11 / 매월 12일 29,900원 / 자동갱신 12개월 / 해지 통보 종료 30일 전
 */
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import { contractFormSchema, draftToForm, formToDraft } from '@/features/contracts/form';

import { normalizeDateInput } from '../dates';
import { nextAction } from '../nextAction';
import { contractSchedule, expandPayment, scheduleForRange } from '../schedule';
import { monthlyAverage, monthSpending } from '../spending';
import type { ContractPayment, ContractRecord } from '../types';

const TODAY = '2026-10-06';

/** 사용자가 날짜를 '-' 없이 입력한 그대로 폼 → 저장 데이터로 (월 납입형, 결제 1건) */
function rentalRecord(overrides: Partial<Record<string, string>> = {}): ContractRecord {
  const { paymentDay = '12', ...rest } = overrides;
  const form = {
    ...draftToForm({ ...EMPTY_DRAFT, title: '공기청정기 렌탈', category: 'rental', contractType: 'recurring' }),
    contractDate: '261005',
    startDate: '261012',
    endDate: '20291011',
    payments: [
      { kind: 'recurring_fee' as const, direction: 'expense' as const, label: '월 렌탈료', amount: '29,900', frequency: 'monthly' as const, dayOfMonth: paymentDay, monthOfYear: '', startsOn: '', endsOn: '', installmentCount: '', isVariable: false, components: [], businessDayRule: 'none' as const, obligation: 'confirmed' as const, conditionNote: '' },
    ],
    autoRenewal: true,
    renewalPeriodMonths: '12',
    terminationNoticeDays: '30',
    ...rest,
  };
  const draft = formToDraft(contractFormSchema.parse(form));
  return draftToRecord(draft, 'c-rental', TODAY);
}

const at = (r: ContractRecord, date: string) =>
  contractSchedule(r, { start: date, end: date }, TODAY).map((i) => `${i.type}:${i.title}${i.amount != null ? `:${i.amount}` : ''}`);

describe('날짜 입력 정규화', () => {
  test.each([
    ['261005', '2026-10-05'],
    ['261012', '2026-10-12'],
    ['20261012', '2026-10-12'],
    ['2026-10-12', '2026-10-12'],
    ['2026.10.12', '2026-10-12'],
    ['280229', '2028-02-29'],
  ])('%s → %s', (input, expected) => expect(normalizeDateInput(input)).toBe(expected));

  test.each(['261332', '260229', '20261301', '2610', 'abc', '2026-02-30'])('%s → 잘못된 날짜', (input) => {
    expect(normalizeDateInput(input)).toBeNull();
  });

  test('폼 검증: 숫자만 입력해도 저장값은 YYYY-MM-DD, 없는 날짜는 오류', () => {
    const r = rentalRecord();
    expect(r.contract).toMatchObject({ contractDate: '2026-10-05', startDate: '2026-10-12', endDate: '2029-10-11' });
    const bad = contractFormSchema.safeParse({ ...draftToForm({ ...EMPTY_DRAFT, title: 'x' }), startDate: '260229' });
    expect(bad.success).toBe(false);
  });
});

describe('공기청정기 렌탈 — 캘린더 이벤트 매핑', () => {
  const r = rentalRecord();

  test('체결일·시작일·결제일·종료일은 분리 저장', () => {
    expect(r.contract.contractDate).toBe('2026-10-05');
    expect(r.contract.startDate).toBe('2026-10-12');
    expect(r.contract.endDate).toBe('2029-10-11');
    expect(r.payments[0]).toMatchObject({ dayOfMonth: 12, amount: 29_900, frequency: 'monthly', startsOn: '2026-10-12' });
  });

  test('체결일(10/5)은 캘린더 이벤트가 아니다', () => {
    expect(at(r, '2026-10-05')).toEqual([]);
  });

  test('10/12: 이용 시작 + 월 렌탈료가 같은 날 함께 존재', () => {
    expect(at(r, '2026-10-12').sort()).toEqual(['contract_start:이용 시작', 'payment:월 렌탈료:29900']);
  });

  test('11/12, 12/12: 월 렌탈료만', () => {
    expect(at(r, '2026-11-12')).toEqual(['payment:월 렌탈료:29900']);
    expect(at(r, '2026-12-12')).toEqual(['payment:월 렌탈료:29900']);
  });

  test('2029-09-11 해지 통보기한, 2029-10-11 이용 종료(자동갱신 조건), 다음 날 자동갱신 예정', () => {
    expect(at(r, '2029-09-11')).toEqual(['termination_notice:해지 통보기한']);
    expect(at(r, '2029-10-11')).toEqual(['contract_end:이용 종료 (자동갱신 조건)']);
    expect(at(r, '2029-10-12')).toContain('renewal:자동갱신 예정');
  });

  test('10월 지출: 같은 날 이벤트가 2개여도 결제 29,900원만 한 번', () => {
    const oct = monthSpending([r], { year: 2026, month: 10 });
    expect(oct.total).toBe(29_900);
    expect(oct.items).toHaveLength(1);
    expect(monthSpending([r], { year: 2026, month: 9 }).total).toBe(0); // 시작 전
  });

  test('다음 행동은 결제가 아닌 해지 통보기한', () => {
    expect(nextAction(r, TODAY)).toMatchObject({ kind: 'termination_notice', date: '2029-09-11' });
  });
});

describe('수정 시 일정 재계산 (시스템 일정은 저장하지 않고 계약 정보에서 계산)', () => {
  test('시작일 변경 → 이용 시작 이벤트가 새 날짜로', () => {
    const r = rentalRecord({ startDate: '261015' });
    expect(at(r, '2026-10-12')).toEqual([]); // 시작 전이라 결제도 없음
    expect(at(r, '2026-10-15')).toEqual(['contract_start:이용 시작']);
    expect(at(r, '2026-11-12')).toEqual(['payment:월 렌탈료:29900']);
  });

  test('결제일 변경 → 결제 일정 재계산', () => {
    const r = rentalRecord({ paymentDay: '25' });
    expect(at(r, '2026-10-12')).toEqual(['contract_start:이용 시작']);
    expect(at(r, '2026-10-25')).toEqual(['payment:월 렌탈료:29900']);
  });

  test('종료일·해지 통보일수·자동갱신 변경 반영', () => {
    const r = rentalRecord({ endDate: '271011', terminationNoticeDays: '60' });
    // 2027-10-11 − 60일 = 2027-08-12 (마침 결제일 12일과 겹침 → 두 이벤트 모두)
    expect(at(r, '2027-08-12').sort()).toEqual(['payment:월 렌탈료:29900', 'termination_notice:해지 통보기한']);
    const noAuto = rentalRecord({ terminationNoticeDays: '' });
    noAuto.contract.autoRenewal = false;
    expect(at(noAuto, '2029-10-11')).toEqual(['contract_end:이용 종료']);
    expect(scheduleForRange([noAuto], { start: '2029-09-01', end: '2029-12-31' }, TODAY).some((i) => i.type === 'renewal' || i.type === 'termination_notice')).toBe(false);
  });
});

describe('결제 주기별 실제 지출 (월평균과 분리)', () => {
  const base = rentalRecord();
  const pay = (over: Partial<ContractPayment>): ContractRecord => ({ ...base, payments: [{ ...base.payments[0], ...over }] });
  const months = (r: ContractRecord) =>
    Array.from({ length: 12 }, (_, i) => monthSpending([r], { year: 2027, month: i + 1 }).total);

  test('분기납: 시작 월 기준 3개월마다만', () => {
    const r = pay({ frequency: 'quarterly', amount: 90_000 });
    expect(months(r)).toEqual([90_000, 0, 0, 90_000, 0, 0, 90_000, 0, 0, 90_000, 0, 0]);
  });

  test('반기납: 6개월마다만', () => {
    expect(months(pay({ frequency: 'semiannual', amount: 180_000 }))).toEqual([0, 0, 0, 180_000, 0, 0, 0, 0, 0, 180_000, 0, 0]);
  });

  test('연납: 납부 월에 연간 금액 전체, 월평균은 별도 지표', () => {
    const r = pay({ frequency: 'yearly', amount: 1_368_000 });
    expect(months(r)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1_368_000, 0, 0]);
    expect(monthlyAverage([r], '2027-01-01')).toBe(114_000);
  });

  test('일회성: 해당 결제일에만', () => {
    const r = pay({ frequency: 'one_time', amount: 50_000 });
    expect(expandPayment(r.payments[0], r.contract, { start: '2026-01-01', end: '2030-12-31' }).map((o) => o.date)).toEqual(['2026-10-12']);
  });
});
