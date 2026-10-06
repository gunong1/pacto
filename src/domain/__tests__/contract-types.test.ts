/**
 * 계약 유형별 일정·지출 시나리오 (7종).
 * 유형은 이름·화면 구성을 고를 뿐이고, 일정·지출은 각 계약에 실제로 입력된 결제 목록과 날짜에서 만들어진다.
 */
import { draftToRecord, EMPTY_DRAFT, recordToDraft } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';
import { DETAIL_SCHEMAS, cleanDetails, detailsFromDb, detailsToDb } from '@/domain/contractTypes';
import { coreInfo } from '@/domain/coreInfo';
import { monthRange } from '@/domain/dates';
import { actionCandidates, nextAction } from '@/domain/nextAction';
import { scheduleForRange, type ScheduleItem } from '@/domain/schedule';
import { contractMonthlyEquivalent, monthSpending, monthlyAverage } from '@/domain/spending';
import type { ContractRecord } from '@/domain/types';

const TODAY = '2026-10-06';

const pay = (p: Partial<PaymentDraft> & Pick<PaymentDraft, 'kind' | 'label' | 'amount' | 'frequency'>): PaymentDraft => ({
  dayOfMonth: null,
  monthOfYear: null,
  startsOn: null,
  endsOn: null,
  installmentCount: null,
  isVariable: false,
  ...p,
});

const build = (id: string, d: Partial<ContractDraft>): ContractRecord => draftToRecord({ ...EMPTY_DRAFT, ...d }, id, TODAY);

const on = (r: ContractRecord, date: string): ScheduleItem[] => scheduleForRange([r], { start: date, end: date }, TODAY);
const titles = (items: ScheduleItem[]) => items.map((i) => i.title).sort();
const spend = (r: ContractRecord, year: number, month: number) => monthSpending([r], { year, month }).total;
const core = (r: ContractRecord, today = TODAY) => Object.fromEntries(coreInfo(r, today).map((x) => [x.label, x.value]));
const monthItems = (r: ContractRecord, year: number, month: number) => scheduleForRange([r], monthRange({ year, month }), TODAY);

describe('1. 렌탈 (월 납입형): 월 렌탈료 + 초기 설치비', () => {
  const r = build('rental', {
    title: '공기청정기 렌탈',
    category: 'rental',
    contractType: 'recurring',
    contractDate: '2026-10-05',
    startDate: '2026-10-12',
    endDate: '2029-10-11',
    autoRenewal: true,
    renewalPeriodMonths: 12,
    terminationNoticeDays: 30,
    details: { commitmentMonths: 36, ownershipTransferTerms: '계약 종료 후 전액 납부 완료 시 이전' },
    payments: [
      pay({ kind: 'recurring_fee', label: '월 렌탈료', amount: 29_900, frequency: 'monthly', dayOfMonth: 12 }),
      pay({ kind: 'setup_fee', label: '초기 설치비', amount: 20_000, frequency: 'one_time' }),
    ],
  });

  test('10/12: 이용 시작 + 월 렌탈료 + 초기 설치비 (설치비 날짜가 없으면 시작일)', () => {
    expect(titles(on(r, '2026-10-12'))).toEqual(['월 렌탈료', '이용 시작', '초기 설치비'].sort());
  });
  test('체결일(10/5)은 캘린더에 표시하지 않음', () => {
    expect(on(r, '2026-10-05')).toEqual([]);
  });
  test('10월 지출 49,900원, 11월 29,900원', () => {
    expect(spend(r, 2026, 10)).toBe(49_900);
    expect(spend(r, 2026, 11)).toBe(29_900);
  });
  test('해지 통보기한 2029-09-11, 종료 2029-10-11', () => {
    expect(titles(on(r, '2029-09-11'))).toContain('해지 통보기한');
    expect(titles(on(r, '2029-10-11'))).toContain('이용 종료 (자동갱신 조건)');
  });
  test('월평균은 보조 지표 — 설치비(일시불) 제외한 월 환산', () => {
    expect(contractMonthlyEquivalent(r)).toBe(29_900);
  });
});

describe('2. 전세 (임대차): 계약금 + 잔금은 보증금 — 캘린더 표시, 지출 제외', () => {
  const r = build('jeonse', {
    title: '전세계약',
    category: 'real_estate',
    contractType: 'lease',
    contractDate: '2026-09-01',
    startDate: '2026-11-01',
    endDate: '2028-10-31',
    depositAmount: 200_000_000,
    details: { leaseKind: 'jeonse' },
    payments: [
      pay({ kind: 'deposit', label: '계약금', amount: 20_000_000, frequency: 'one_time', startsOn: '2026-09-01' }),
      pay({ kind: 'deposit', label: '잔금', amount: 180_000_000, frequency: 'one_time', startsOn: '2026-11-01' }),
    ],
    dates: [{ kind: 'move_in', label: '입주일', date: '2026-11-01' }],
  });

  test('11/1: 임대차 시작 + 잔금 + 입주일', () => {
    expect(titles(on(r, '2026-11-01'))).toEqual(['임대차 시작', '입주일', '잔금'].sort());
    expect(on(r, '2026-11-01').find((i) => i.title === '잔금')?.amount).toBe(180_000_000);
  });
  test('계약금은 9/1에 표시 (돈이 움직이는 날)', () => {
    expect(titles(on(r, '2026-09-01'))).toEqual(['계약금']);
  });
  test('전세는 월 지출 없음 (보증금은 지출 합계 제외, 따로 표시)', () => {
    expect(monthSpending([r], { year: 2026, month: 11 }).depositTotal).toBe(180_000_000);
    expect(spend(r, 2026, 9)).toBe(0);
    expect(spend(r, 2026, 11)).toBe(0);
    expect(spend(r, 2026, 12)).toBe(0);
  });
  test('갱신 여부 확인 시점(만기 60일 전)과 만기', () => {
    expect(titles(on(r, '2028-09-01'))).toEqual(['갱신 여부 확인']);
    expect(titles(on(r, '2028-10-31'))).toEqual(['계약 만기']);
  });
});

describe('3. 월세 (임대차): 보증금 + 월세 + 관리비', () => {
  const r = build('monthly-rent', {
    title: '월세계약',
    category: 'real_estate',
    contractType: 'lease',
    startDate: '2026-11-01',
    endDate: '2028-10-31',
    depositAmount: 10_000_000,
    details: { leaseKind: 'monthly' },
    payments: [
      pay({ kind: 'deposit', label: '보증금', amount: 10_000_000, frequency: 'one_time' }),
      pay({ kind: 'rent', label: '월세', amount: 800_000, frequency: 'monthly', dayOfMonth: 1 }),
      pay({ kind: 'maintenance_fee', label: '관리비', amount: 100_000, frequency: 'monthly', dayOfMonth: 25 }),
    ],
  });

  test('11월 지출 = 월세 + 관리비 (보증금 제외)', () => {
    expect(spend(r, 2026, 11)).toBe(900_000);
    const nov = monthItems(r, 2026, 11).filter((i) => i.type === 'payment');
    expect(nov.map((i) => i.title)).toEqual(['보증금', '월세', '관리비']);
  });
  test('만기 달까지 지출, 이후 없음', () => {
    expect(spend(r, 2028, 10)).toBe(900_000);
    expect(spend(r, 2028, 11)).toBe(0);
  });
});

describe('4. 자동차 할부: 선수금 + 월 할부금 36회', () => {
  const details = { vehicleName: '아반떼', vehiclePrice: 28_000_000, advancePayment: 5_000_000, principal: 23_000_000, interestRate: 4.9, totalInstallments: 36 };
  const r = build('car', {
    title: '자동차 할부',
    category: 'vehicle',
    contractType: 'auto_installment',
    startDate: '2026-10-20',
    endDate: '2029-10-25',
    details,
    payments: [
      pay({ kind: 'advance_payment', label: '선수금', amount: 5_000_000, frequency: 'one_time', startsOn: '2026-10-20' }),
      pay({ kind: 'installment', label: '할부금', amount: 683_000, frequency: 'monthly', dayOfMonth: 25, startsOn: '2026-11-25', installmentCount: 36 }),
    ],
  });

  test('상세 속성은 유형 스키마로 검증된다', () => {
    expect(DETAIL_SCHEMAS.auto_installment.safeParse(details).success).toBe(true);
    expect(DETAIL_SCHEMAS.auto_installment.safeParse({ ...details, leaseKind: 'jeonse' }).success).toBe(false);
    expect(DETAIL_SCHEMAS.auto_installment.safeParse({ ...details, interestRate: '4.9%' }).success).toBe(false);
    expect(detailsFromDb('auto_installment', detailsToDb('auto_installment', details))).toEqual(details);
  });
  test('10월: 선수금, 11월부터 할부금 회차 표시', () => {
    expect(spend(r, 2026, 10)).toBe(5_000_000);
    expect(titles(on(r, '2026-11-25'))).toEqual(['할부금 1/36회']);
    expect(titles(on(r, '2029-10-25'))).toEqual(['할부 만기', '할부금 36/36회'].sort());
  });
  test('마지막 회차 이후 지출 없음', () => {
    expect(spend(r, 2029, 10)).toBe(683_000);
    expect(spend(r, 2029, 11)).toBe(0);
  });
});

describe('5. 대출: 월 원리금 60회', () => {
  const r = build('loan', {
    title: '신용대출',
    category: 'finance',
    contractType: 'loan',
    startDate: '2026-10-15',
    endDate: '2031-10-15',
    details: { principal: 50_000_000, interestRate: 5.2, repaymentMethod: 'equal_payment', prepaymentFeeTerms: '3년 이내 상환 시 1.2%' },
    payments: [pay({ kind: 'loan_repayment', label: '월 상환액', amount: 948_000, frequency: 'monthly', dayOfMonth: 15, startsOn: '2026-11-15', installmentCount: 60 })],
  });

  test('실행일·첫 상환·만기', () => {
    expect(titles(on(r, '2026-10-15'))).toEqual(['대출 실행']);
    expect(titles(on(r, '2026-11-15'))).toEqual(['월 상환액 1/60회']);
    expect(titles(on(r, '2031-10-15'))).toEqual(['대출 만기', '월 상환액 60/60회'].sort());
  });
  test('지출: 실행 달 0, 이후 월 상환액', () => {
    expect(spend(r, 2026, 10)).toBe(0);
    expect(spend(r, 2026, 11)).toBe(948_000);
    expect(spend(r, 2031, 11)).toBe(0);
  });
  test('다음 행동: 만기가 멀면 다음 상환(결제), 90일 이내면 대출 만기', () => {
    expect(nextAction(r, TODAY)).toMatchObject({ kind: 'payment', label: '다음 결제', date: '2026-11-15' });
  });
  test('다음 행동: 대출 만기 문구', () => {
    const near = build('loan2', { ...r.contract, contractType: 'loan', startDate: '2026-01-01', endDate: '2026-10-20', payments: [], dates: [] });
    expect(actionCandidates(near, TODAY)[0].label).toBe('대출 만기');
  });
});

describe('6. 연납 보험: 결제 달에 연간 보험료 전액', () => {
  const r = build('insurance', {
    title: '자동차보험',
    category: 'insurance',
    contractType: 'insurance',
    startDate: '2026-12-01',
    endDate: '2027-11-30',
    details: { renewable: true, renewalCycleYears: 1 },
    payments: [pay({ kind: 'premium', label: '연간 보험료', amount: 1_200_000, frequency: 'yearly' })],
    dates: [{ kind: 'renewal', label: '갱신일', date: '2027-12-01' }],
  });

  test('12월 지출 = 연간 보험료 전액, 1월은 0', () => {
    expect(spend(r, 2026, 12)).toBe(1_200_000);
    expect(spend(r, 2027, 1)).toBe(0);
  });
  test('월평균(보조 지표)은 실제 월 지출과 별도: 100,000원', () => {
    expect(contractMonthlyEquivalent(r)).toBe(100_000);
    expect(monthlyAverage([r], TODAY)).toBe(100_000);
  });
  test('보험 시작·만기·갱신일', () => {
    expect(titles(on(r, '2026-12-01'))).toEqual(['보험 시작', '연간 보험료'].sort());
    expect(titles(on(r, '2027-11-30'))).toEqual(['보험 만기']);
    expect(titles(on(r, '2027-12-01'))).toEqual(['갱신일']);
  });
});

describe('7. 일회성 계약: 계약금 · 중도금 · 잔금', () => {
  const r = build('one-time', {
    title: '인테리어 공사',
    category: 'business',
    contractType: 'one_time',
    contractDate: '2026-10-08',
    startDate: '2026-10-10',
    endDate: '2026-12-20',
    details: { subject: '아파트 인테리어' },
    payments: [
      pay({ kind: 'down_payment', label: '계약금', amount: 3_000_000, frequency: 'one_time', startsOn: '2026-10-10' }),
      pay({ kind: 'interim_payment', label: '중도금', amount: 5_000_000, frequency: 'one_time', startsOn: '2026-11-15' }),
      pay({ kind: 'balance_payment', label: '잔금', amount: 2_000_000, frequency: 'one_time', startsOn: '2026-12-20' }),
    ],
  });

  test('각 날짜에 각 금액', () => {
    expect(spend(r, 2026, 10)).toBe(3_000_000);
    expect(spend(r, 2026, 11)).toBe(5_000_000);
    expect(spend(r, 2026, 12)).toBe(2_000_000);
    expect(spend(r, 2027, 1)).toBe(0);
  });
  test('완료일에 계약 완료 + 잔금, 시작·체결일은 일정 없음', () => {
    expect(titles(on(r, '2026-12-20'))).toEqual(['계약 완료', '잔금'].sort());
    expect(titles(on(r, '2026-10-10'))).toEqual(['계약금']);
    expect(on(r, '2026-10-08')).toEqual([]);
  });
});

describe('공통', () => {
  test('cleanDetails: 유형에 없는 키·형식 오류 값은 버린다', () => {
    expect(cleanDetails('loan', { principal: 1000, vehiclePrice: 5, interestRate: '5%', repaymentMethod: 'bullet' })).toEqual({ principal: 1000, repaymentMethod: 'bullet' });
  });
  test('결제가 없으면 지출 0, 일정은 기간에서만', () => {
    const r = build('other', { title: '기타', contractType: 'other', startDate: '2026-11-01', endDate: '2027-10-31' });
    expect(spend(r, 2026, 11)).toBe(0);
    expect(titles(on(r, '2026-11-01'))).toEqual(['계약 시작']);
  });
});

describe('상세 화면 핵심 정보 — 유형별로 다른 항목', () => {
  test('렌탈: 월 렌탈료·설치비·이용 기간·자동갱신·해지 통보기한·의무 사용기간', () => {
    const r = build('rental', {
      contractType: 'recurring', startDate: '2026-10-12', endDate: '2029-10-11', autoRenewal: true, renewalPeriodMonths: 12, terminationNoticeDays: 30,
      details: { commitmentMonths: 36 },
      payments: [pay({ kind: 'recurring_fee', label: '월 렌탈료', amount: 29_900, frequency: 'monthly', dayOfMonth: 12 }), pay({ kind: 'setup_fee', label: '초기 설치비', amount: 20_000, frequency: 'one_time' })],
    });
    expect(core(r)).toEqual({
      '월 렌탈료': '29,900원 · 매월 12일',
      '초기 설치비': '20,000원 · 일시불 · 2026. 10. 12.',
      '이용 기간': '2026. 10. 12. ~ 2029. 10. 11.',
      자동갱신: '있음 · 12개월 단위',
      '해지 통보기한': '종료 30일 전까지 (2029. 9. 11.)',
      '의무 사용기간': '36개월',
    });
  });

  test('전세: 보증금·계약금·잔금·입주일·임대차 기간 (월 지출 항목 없음)', () => {
    const r = build('jeonse', {
      contractType: 'lease', startDate: '2026-11-01', endDate: '2028-10-31', depositAmount: 200_000_000, details: { leaseKind: 'jeonse' },
      payments: [pay({ kind: 'deposit', label: '계약금', amount: 20_000_000, frequency: 'one_time', startsOn: '2026-09-01' }), pay({ kind: 'deposit', label: '잔금', amount: 180_000_000, frequency: 'one_time', startsOn: '2026-11-01' })],
      dates: [{ kind: 'move_in', label: '입주일', date: '2026-11-01' }],
    });
    expect(core(r)).toMatchObject({ '임대 형태': '전세', 보증금: '2억원', 계약금: '2,000만원 · 2026. 9. 1.', 잔금: '1억 8,000만원 · 2026. 11. 1.', 입주일: '2026. 11. 1.', '임대차 기간': '2026. 11. 1. ~ 2028. 10. 31.' });
  });

  test('월세: 보증금·월세·관리비', () => {
    const r = build('rent', {
      contractType: 'lease', startDate: '2026-11-01', endDate: '2028-10-31', depositAmount: 10_000_000, details: { leaseKind: 'monthly' },
      payments: [pay({ kind: 'rent', label: '월세', amount: 800_000, frequency: 'monthly', dayOfMonth: 1 }), pay({ kind: 'maintenance_fee', label: '관리비', amount: 100_000, frequency: 'monthly', dayOfMonth: 25 })],
    });
    expect(core(r)).toMatchObject({ '임대 형태': '월세', 보증금: '1,000만원', 월세: '800,000원 · 매월 1일', 관리비: '100,000원 · 매월 25일' });
  });

  test('자동차 할부: 할부원금·월 납입액·남은 회차·만기', () => {
    const r = build('car', {
      contractType: 'auto_installment', startDate: '2026-10-20', endDate: '2029-10-25',
      details: { vehicleName: '아반떼', principal: 23_000_000, interestRate: 4.9 },
      payments: [pay({ kind: 'installment', label: '할부금', amount: 683_000, frequency: 'monthly', dayOfMonth: 25, startsOn: '2026-11-25', installmentCount: 36 })],
    });
    expect(core(r)).toMatchObject({ 차량: '아반떼', 할부원금: '23,000,000원', 금리: '연 4.9%', 할부금: '683,000원 · 매월 25일', '남은 회차': '36회 남음 (0/36회 납부)', 만기일: '2029. 10. 25.' });
    expect(core(r, '2027-03-01')['남은 회차']).toBe('32회 남음 (4/36회 납부)');
  });

  test('대출: 원금·금리·상환방식·월 상환액·남은 회차·만기', () => {
    const r = build('loan', {
      contractType: 'loan', startDate: '2026-10-15', endDate: '2031-10-15', details: { principal: 50_000_000, interestRate: 5.2, repaymentMethod: 'equal_payment' },
      payments: [pay({ kind: 'loan_repayment', label: '월 상환액', amount: 948_000, frequency: 'monthly', dayOfMonth: 15, startsOn: '2026-11-15', installmentCount: 60 })],
    });
    expect(core(r)).toMatchObject({ 대출원금: '50,000,000원', 금리: '연 5.2%', 상환방식: '원리금균등', '월 상환액': '948,000원 · 매월 15일', '남은 회차': '60회 남음 (0/60회 납부)', '대출 실행일': '2026. 10. 15.', 만기일: '2031. 10. 15.' });
  });

  test('연납 보험: 보험료·보험 기간·갱신형·갱신일', () => {
    const r = build('ins', {
      contractType: 'insurance', startDate: '2026-12-01', endDate: '2027-11-30', details: { renewable: true, renewalCycleYears: 1 },
      payments: [pay({ kind: 'premium', label: '연간 보험료', amount: 1_200_000, frequency: 'yearly' })],
      dates: [{ kind: 'renewal', label: '갱신일', date: '2027-12-01' }],
    });
    expect(core(r)).toMatchObject({ '연간 보험료': '1,200,000원 · 매년', '보험 기간': '2026. 12. 1. ~ 2027. 11. 30.', 갱신형: '갱신형 · 1년마다', 갱신일: '2027. 12. 1.' });
  });

  test('일회성: 계약금·중도금·잔금 각 날짜와 완료일', () => {
    const r = build('one', {
      contractType: 'one_time', startDate: '2026-10-10', endDate: '2026-12-20', details: { subject: '아파트 인테리어' },
      payments: [
        pay({ kind: 'down_payment', label: '계약금', amount: 3_000_000, frequency: 'one_time', startsOn: '2026-10-10' }),
        pay({ kind: 'interim_payment', label: '중도금', amount: 5_000_000, frequency: 'one_time', startsOn: '2026-11-15' }),
        pay({ kind: 'balance_payment', label: '잔금', amount: 2_000_000, frequency: 'one_time', startsOn: '2026-12-20' }),
      ],
    });
    expect(core(r)).toEqual({ '계약 대상': '아파트 인테리어', 계약금: '3,000,000원 · 2026. 10. 10.', 중도금: '5,000,000원 · 2026. 11. 15.', 잔금: '2,000,000원 · 2026. 12. 20.', '계약 완료일': '2026. 12. 20.' });
  });
});

describe('수정 시 일정 재계산', () => {
  test('결제일이 시작일과 같으면 수정 폼에서 비워 두어 시작일 변경을 따라간다', () => {
    const before = build('r', {
      contractType: 'recurring', startDate: '2026-10-12', endDate: '2029-10-11',
      payments: [pay({ kind: 'recurring_fee', label: '월 렌탈료', amount: 29_900, frequency: 'monthly', dayOfMonth: 12 }), pay({ kind: 'setup_fee', label: '초기 설치비', amount: 20_000, frequency: 'one_time' })],
    });
    expect(before.payments.map((p) => p.startsOn)).toEqual(['2026-10-12', '2026-10-12']);
    const draft = recordToDraft(before);
    expect(draft.payments.map((p) => p.startsOn)).toEqual([null, null]);
    const after = draftToRecord({ ...draft, startDate: '2026-10-15' }, 'r', TODAY);
    expect(on(after, '2026-10-12')).toEqual([]);
    expect(titles(on(after, '2026-10-15'))).toEqual(['이용 시작', '초기 설치비'].sort());
    expect(spend(after, 2026, 10)).toBe(20_000);
    expect(titles(on(after, '2026-11-12'))).toEqual(['월 렌탈료']);
  });

  test('직접 정한 결제일은 시작일을 바꿔도 유지', () => {
    const before = build('r2', { contractType: 'one_time', startDate: '2026-10-10', payments: [pay({ kind: 'balance_payment', label: '잔금', amount: 1, frequency: 'one_time', startsOn: '2026-12-20' })] });
    const after = draftToRecord({ ...recordToDraft(before), startDate: '2026-10-20' }, 'r2', TODAY);
    expect(after.payments[0].startsOn).toBe('2026-12-20');
  });
});
