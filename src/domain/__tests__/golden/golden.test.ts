/**
 * Golden 테스트 — 대표 계약 7종의 "정답" (모든 값은 가짜). 분석 규칙 리팩터링의 기준.
 *
 * 각 계약마다: 유형·분야 / 확정 금액(방향·주기·결제일) / 시작·종료 / 주요 날짜 / 계약 체크 / 참고·면제 금액 /
 * 자동갱신·통보기한 / 홈(그 달 합계) / 캘린더 일정을 고정한다.
 *
 * `test.failing` = 리팩터링 전 코드가 아직 정답과 다른 항목. 주석에 "리팩터링 전" 결과를 남긴다.
 * 리팩터링으로 고치면 jest가 "failing인데 통과함"으로 알려주므로 일반 test로 바꾼다 — 기대값을 바꿔서 통과시키지 않는다.
 */
import * as F from './fixtures';
import { calendarCards, month, observe, schedule } from './harness';

const pay = (label: string, amount: number | null, direction: string, frequency: string, day: number | null, extra: { obligation?: string; components?: string[] } = {}) => ({
  label,
  amount,
  direction,
  frequency,
  day,
  obligation: extra.obligation ?? 'confirmed',
  components: extra.components ?? [],
});

describe('1. 렌탈 — 월 렌탈료 31,900원 (같은 문장에 할인전·연체 시) + 등록비·설치비 면제 + 위약금·연체료', () => {
  const o = observe(F.rental());
  test('유형·분야', () => expect([o.type, o.category]).toEqual(['recurring', 'rental']));
  // 리팩터링 전: 금액 섹션 비어 있음 — "연체 시" 때문에 조건부, "할인전" 때문에 금액 비워짐
  test.failing('확정 금액: 월 렌탈료 31,900원 매월 15일 지출 1건', () => {
    expect(o.payments).toEqual([pay('월 렌탈료', 31900, 'expense', 'monthly', 15)]);
  });
  // 리팩터링 전: 월 렌탈료·중도해지 위약금이 조건부 결제로 저장
  test.failing('조건부·참고 금액은 결제로 저장하지 않음', () => expect(o.nonCashPayments).toEqual([]));
  test('시작·종료', () => expect([o.startDate, o.endDate]).toEqual(['2026-10-12', '2029-10-11']));
  test('주요 날짜: 설치일 (시작일과 같은 날이어도 의미는 보존)', () => expect(o.keyDates).toEqual([{ kind: 'installation', label: '설치일', date: '2026-10-12' }]));
  // 리팩터링 전: 위약금 금액이 체크에 없음 (조건부 결제로 따로 저장)
  test.failing('계약 체크: 자동갱신 · 중도해지 위약금(200,000원) · 연체료 · 면제된 금액', () => {
    expect(o.checks).toEqual([
      { topic: 'auto_renewal', title: '자동갱신', amount: null },
      { topic: 'early_termination', title: '중도해지 위약금', amount: 200000 },
      { topic: 'overdue', title: '연체료', amount: null },
      { topic: 'discount_terms', title: '면제된 금액', amount: null },
    ]);
  });
  // 리팩터링 전: 할인전 금액·등록비가 "참고"(reference)로 — 할인 전·면제 구분 없음
  test.failing('참고·면제 금액: 할인 전 45,900원 · 등록비 100,000원 면제 · 설치비 30,000원 면제', () => {
    expect(o.references).toEqual([
      { label: '월 렌탈료(할인전)', amount: 45900, role: 'before_discount' },
      { label: '등록비', amount: 100000, role: 'waived' },
      { label: '설치비', amount: 30000, role: 'waived' },
    ]);
  });
  test('자동갱신·통보기한: 자동갱신 · 종료 30일 전', () => expect([o.autoRenewal, o.terminationNoticeDays]).toEqual([true, 30]));
  // 리팩터링 전: AI가 채운 중도해지·위약금 글이 계약 체크와 중복 저장
  test.failing('중도해지·위약금 글은 자동으로 채우지 않음 (계약 체크에만)', () => expect(o.terms).toEqual({ early: null, penalty: null }));
  // 리팩터링 전: 11월 지출 0원
  test.failing('홈: 11월 지출 31,900원', () => expect(month(o, 2026, 11)).toEqual({ expense: 31900, income: 0, neutral: 0 }));
  // 리팩터링 전: 시작·설치일만 (결제 일정 없음)
  test.failing('캘린더: 10/12 이용 시작·설치 · 10/15·11/15 렌탈료 31,900원', () => {
    expect(schedule(o, '2026-10-01', '2026-11-30')).toEqual([
      '2026-10-12 contract_start 이용 시작',
      '2026-10-12 key_date 설치일',
      '2026-10-15 payment 월 렌탈료 31900',
      '2026-11-15 payment 월 렌탈료 31900',
    ]);
  });
  test('캘린더 카드: 10/12 같은 계약·같은 날은 카드 하나 "이용 시작"', () => expect(calendarCards(o, '2026-10-12')).toEqual(['이용 시작']));
  test.todo('회차 면제(예: 1·13·25회차 무료)를 캘린더·지출에 반영 — 이번 리팩터링 범위 밖(보류)');
});

describe('2. 근로 — 월 급여 1,270,000 = 기본급 + 식대 (세 금액을 각각 실제 돈으로 답함)', () => {
  describe('지급일 언급 없음', () => {
    const o = observe(F.employment(null));
    test('유형·분야', () => expect([o.type, o.category]).toEqual(['employment', 'employment']));
    test('확정 금액: 월 급여 1건(기본급·식대는 구성항목) · 지급일 없음', () => {
      expect(o.payments).toEqual([pay('월 급여', 1270000, 'income', 'monthly', null, { components: ['기본급', '식대'] })]);
    });
    test('지급일 확인 필요', () => expect(o.flagged).toContain('payments.0.dayOfMonth'));
    test('시작일: 근로 시작일 · 종료일 없음', () => expect([o.startDate, o.endDate]).toEqual(['2026-07-20', null]));
    test('주요 날짜: 입사일 (근로 시작과 같은 날, 의미 보존)', () => expect(o.keyDates).toEqual([{ kind: 'hire', label: '입사일', date: '2026-07-20' }]));
    test('계약 체크: 퇴직 사전통보 (조건부 — 날짜 아님)', () => expect(o.checks).toEqual([{ topic: 'resignation_notice', title: '퇴직 사전통보', amount: null }]));
    test('참고·면제 금액 없음', () => expect(o.references).toEqual([]));
    test('자동갱신 없음 · 통보기한 없음 (퇴직 30일 전은 조건부)', () => expect([o.autoRenewal, o.terminationNoticeDays]).toEqual([false, null]));
    test('홈·캘린더: 지급일을 모르면 수입 일정 없음', () => {
      expect(schedule(o, '2026-10-01', '2026-11-30')).toEqual([]);
      expect(month(o, 2026, 11)).toEqual({ expense: 0, income: 0, neutral: 0 });
    });
  });
  describe('매월 25일 지급', () => {
    const o = observe(F.employment(25));
    test('확정 금액: 월 급여 1건 매월 25일 · 구성항목 기본급·식대', () => {
      expect(o.payments).toEqual([pay('월 급여', 1270000, 'income', 'monthly', 25, { components: ['기본급', '식대'] })]);
    });
    test('캘린더: 매월 25일 1,270,000원 (기본급·식대 따로 없음)', () => {
      expect(schedule(o, '2026-10-01', '2026-11-30')).toEqual(['2026-10-25 payment 월 급여 1270000', '2026-11-25 payment 월 급여 1270000']);
    });
    test('홈: 11월 수입 1,270,000원 (중복 없음)', () => expect(month(o, 2026, 11)).toEqual({ expense: 0, income: 1270000, neutral: 0 }));
  });
});

describe('3. 월세 — 보증금 = 계약금 + 잔금, 월세 + 관리비("수도 등 포함"), 입주일 = 시작일', () => {
  const o = observe(F.lease());
  test('유형·분야', () => expect([o.type, o.category]).toEqual(['lease', 'real_estate']));
  // 리팩터링 전: 관리비가 "포함" 단어 때문에 월세의 구성항목으로 합쳐짐
  test.failing('확정 금액: 계약금·잔금(중립) + 월세 700,000 + 관리비 70,000 (각각 매월 5일)', () => {
    expect(o.payments).toEqual([
      pay('계약금', 10000000, 'neutral', 'one_time', null),
      pay('잔금', 40000000, 'neutral', 'one_time', null),
      pay('월세', 700000, 'expense', 'monthly', 5),
      pay('관리비', 70000, 'expense', 'monthly', 5),
    ]);
  });
  test('총액(보증금)은 결제가 아니라 참고 금액', () => {
    expect(o.references).toEqual([{ label: '보증금', amount: 50000000, role: 'total' }]);
    expect(o.nonCashPayments).toEqual([]);
  });
  test('시작·종료', () => expect([o.startDate, o.endDate]).toEqual(['2026-03-01', '2028-02-29']));
  test('주요 날짜: 입주일만 (잔금일은 잔금 결제와 같은 날, 월세 지급일은 결제일)', () => expect(o.keyDates).toEqual([{ kind: 'move_in', label: '입주일', date: '2026-03-01' }]));
  test('계약 체크: 갱신 협의 · 원상복구', () => expect(o.checks.map((c) => c.title)).toEqual(['갱신 협의', '원상복구']));
  test('자동갱신 아님 · 통보기한 없음', () => expect([o.autoRenewal, o.terminationNoticeDays]).toEqual([false, null]));
  // 리팩터링 전: 11월 지출 700,000원 (관리비 빠짐)
  test.failing('홈: 11월 지출 770,000원 (월세 + 관리비)', () => expect(month(o, 2026, 11)).toEqual({ expense: 770000, income: 0, neutral: 0 }));
  // 리팩터링 전: 월세만
  test.failing('캘린더: 11/5 월세 · 관리비', () => {
    expect(schedule(o, '2026-11-01', '2026-11-30')).toEqual(['2026-11-05 payment 월세 700000', '2026-11-05 payment 관리비 70000']);
  });
  test('캘린더 카드: 3/1 "임대차 시작 · 입주" 하나', () => expect(calendarCards(o, '2026-03-01')).toEqual(['임대차 시작 · 입주']));
  test('홈: 3월 중립(잔금) 40,000,000원 — 지출 합계와 분리, 보증금 총액은 더하지 않음', () => expect(month(o, 2026, 3).neutral).toBe(40000000));
});

describe('4. 자동차보험 — 연 보험료 1,200,000원 일시납 (특약 포함) — 모델이 매월로 답함', () => {
  const o = observe(F.carInsurance());
  test('유형·분야', () => expect([o.type, o.category]).toEqual(['insurance', 'insurance']));
  // 리팩터링 전: 보험료가 "특약" 단어 때문에 선택형
  test.failing('확정 금액: 보험료 1,200,000원 1회 (월할 아님) + 선택 특약 50,000원', () => {
    expect(o.payments).toEqual([
      pay('보험료', 1200000, 'expense', 'one_time', null),
      pay('렌터카 비용 지원 특약', 50000, 'expense', 'one_time', null, { obligation: 'optional' }),
    ]);
  });
  test('시작·종료', () => expect([o.startDate, o.endDate]).toEqual(['2026-10-20', '2027-10-20']));
  test('주요 날짜 없음', () => expect(o.keyDates).toEqual([]));
  test('계약 체크: 보상하지 않는 손해', () => expect(o.checks.map((c) => c.title)).toEqual(['보상하지 않는 손해']));
  test('자동갱신 아님', () => expect([o.autoRenewal, o.terminationNoticeDays]).toEqual([false, null]));
  // 리팩터링 전: 10월 지출 0원
  test.failing('홈: 결제한 달(10월)에 1,200,000원 전체, 11월은 0원', () => {
    expect(month(o, 2026, 10).expense).toBe(1200000);
    expect(month(o, 2026, 11).expense).toBe(0);
  });
  test.failing('캘린더: 10/20 보험 시작 · 보험료 1,200,000원', () => {
    expect(schedule(o, '2026-10-01', '2026-12-31')).toEqual(['2026-10-20 contract_start 보험 시작', '2026-10-20 payment 보험료 1200000']);
  });
});

describe('5. 대출 — 월 원리금 312,000원 36회 (같은 문장에 "연체 시"), 대출금액은 참고', () => {
  const o = observe(F.loan());
  test('유형·분야', () => expect([o.type, o.category]).toEqual(['loan', 'finance']));
  // 리팩터링 전: 월 원리금이 "연체 시" 때문에 조건부
  test.failing('확정 금액: 월 원리금 312,000원 매월 25일', () => expect(o.payments).toEqual([pay('월 원리금 상환', 312000, 'expense', 'monthly', 25)]));
  test('참고 금액: 대출금액 10,000,000원', () => expect(o.references).toEqual([{ label: '대출금액', amount: 10000000, role: 'reference' }]));
  test('시작·만기', () => expect([o.startDate, o.endDate]).toEqual(['2026-09-25', '2029-09-25']));
  test('계약 체크: 중도상환수수료 · 연체 지연배상금 (조건부)', () => expect(o.checks.map((c) => c.topic)).toEqual(['prepayment', 'overdue']));
  test.failing('캘린더: 10/25 1회차 · 11/25 2회차 312,000원', () => {
    expect(schedule(o, '2026-10-01', '2026-11-30')).toEqual(['2026-10-25 payment 월 원리금 상환 1/36회 312000', '2026-11-25 payment 월 원리금 상환 2/36회 312000']);
  });
  test.failing('홈: 11월 지출 312,000원', () => expect(month(o, 2026, 11).expense).toBe(312000));
});

describe('6. 구독·회원권 — 월 이용료("이용 시 매월 10일") + 락커(선택, 결제일 없음) + 가입비 면제 + 양도 수수료', () => {
  const o = observe(F.membership());
  test('유형·분야', () => expect([o.type, o.category]).toEqual(['recurring', 'membership']));
  // 리팩터링 전: 락커 이용료가 월 이용료의 결제일(10일)을 빌려옴
  test.failing('확정 금액: 월 이용료 59,000원 매월 10일 + 락커 이용료(선택, 결제일 없음)', () => {
    expect(o.payments).toEqual([pay('월 이용료', 59000, 'expense', 'monthly', 10), pay('락커 이용료', 5000, 'expense', 'monthly', null, { obligation: 'optional' })]);
  });
  // 리팩터링 전: 양도 수수료가 "발생 가능(potential)" 결제로 저장
  test.failing('조건부 비용(양도 수수료)은 결제가 아니라 계약 체크', () => {
    expect(o.nonCashPayments).toEqual([]);
    expect(o.checks).toContainEqual({ topic: 'other', title: '회원권 양도 수수료', amount: 30000 });
  });
  test('면제 금액: 가입비 30,000원', () => expect(o.references).toEqual([{ label: '가입비', amount: 30000, role: 'waived' }]));
  test('시작일 · 자동갱신(매월 자동 결제)', () => expect([o.startDate, o.autoRenewal]).toEqual(['2026-10-01', true]));
  test('캘린더: 10/1 이용 시작 · 매월 10일 59,000원 (락커는 이용 시작 전이라 없음)', () => {
    expect(schedule(o, '2026-10-01', '2026-11-30')).toEqual(['2026-10-01 contract_start 이용 시작', '2026-10-10 payment 월 이용료 59000', '2026-11-10 payment 월 이용료 59000']);
  });
  test('홈: 11월 지출 59,000원', () => expect(month(o, 2026, 11).expense).toBe(59000));
});

describe('7. 서비스(용역) — 총 계약금액(실제 돈으로 답함) = 착수금 + 잔금 (받는 돈), 납품일', () => {
  const o = observe(F.service());
  test('유형·분야', () => expect([o.type, o.category]).toEqual(['service', 'service']));
  test('확정 금액: 착수금 3,000,000 · 잔금 6,000,000 (수입, 1회씩)', () => {
    expect(o.payments).toEqual([pay('착수금', 3000000, 'income', 'one_time', null), pay('잔금', 6000000, 'income', 'one_time', null)]);
  });
  test('총액은 참고 금액 (중복 계산 없음)', () => expect(o.references).toEqual([{ label: '총 계약금액', amount: 9000000, role: 'total' }]));
  test('시작·종료', () => expect([o.startDate, o.endDate]).toEqual(['2026-10-15', '2026-12-31']));
  test('주요 날짜: 납품일', () => expect(o.keyDates).toEqual([{ kind: 'delivery', label: '납품일', date: '2026-12-15' }]));
  test('계약 체크: 검수 · 저작권 귀속', () => expect(o.checks.map((c) => c.title)).toEqual(['검수', '저작권 귀속']));
  test('캘린더: 착수금 10/15 · 납품일 12/15 · 잔금 12/31', () => {
    expect(schedule(o, '2026-10-01', '2026-12-31')).toEqual([
      '2026-10-15 contract_start 업무 시작',
      '2026-10-15 payment 착수금 3000000',
      '2026-12-15 key_date 납품일',
      '2026-12-31 contract_end 업무 종료',
      '2026-12-31 payment 잔금 6000000',
    ]);
  });
  test('홈: 12월 수입 6,000,000원 (총액 9,000,000원 중복 없음)', () => expect(month(o, 2026, 12)).toEqual({ expense: 0, income: 6000000, neutral: 0 }));
});
