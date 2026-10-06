import { createMockRecords } from '@/data/mock/mockContracts';

import { statusSummary, upcomingEnds } from '../actions';
import { findBannedPhrases } from '../aiCopy';
import { addMonths, dateInMonth, diffDays, isValidISODate, todayInSeoul } from '../dates';
import { dDayLabel, formatDDay } from '../dday';
import { attentionItems, nextAction } from '../nextAction';
import { formatKRW, formatWon, formatWonCompact, parseAmount } from '../money';
import { upcomingReminders } from '../reminders';
import { contractSchedule, expandPayment, nextPayment } from '../schedule';
import { annualForecast, contractMonthlyEquivalent, monthlyAverage, monthSpending } from '../spending';
import { currentTerm, deriveStatus, terminationNoticeDeadline } from '../status';
import type { Contract, ContractPayment, ContractRecord } from '../types';

const TODAY = '2026-10-05';

function rec(id: string): ContractRecord {
  const r = createMockRecords().find((x) => x.contract.id === id);
  if (!r) throw new Error(id);
  return r;
}

function makeContract(over: Partial<Contract>): Contract {
  return { ...rec('c-car-insurance').contract, id: 'x', autoRenewal: false, renewalPeriodMonths: null, terminationNoticeDays: null, ...over };
}

describe('dates', () => {
  test('말일 보정과 윤년', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 2)).toBe('2027-02-15');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(dateInMonth(2026, 4, 31)).toBe('2026-04-30');
  });

  test('diffDays / 유효성', () => {
    expect(diffDays('2026-10-05', '2026-12-31')).toBe(87);
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2028-02-29')).toBe(true);
    expect(isValidISODate('2026-13-01')).toBe(false);
  });

  test('한국 시간 기준 오늘', () => {
    // UTC 10/4 15:30 = KST 10/5 00:30
    expect(todayInSeoul(new Date('2026-10-04T15:30:00Z'))).toBe('2026-10-05');
    expect(todayInSeoul(new Date('2026-10-04T14:59:00Z'))).toBe('2026-10-04');
  });
});

describe('D-Day', () => {
  test('표기', () => {
    expect(formatDDay(0)).toBe('D-Day');
    expect(formatDDay(7)).toBe('D-7');
    expect(formatDDay(-3)).toBe('D+3');
  });

  test('요구사항 mock 값 (2026-10-05 기준)', () => {
    expect(dDayLabel(rec('c-car-insurance').contract.endDate!, TODAY)).toBe('D-87');
    expect(dDayLabel(rec('c-internet').contract.endDate!, TODAY)).toBe('D-268');
    const gymNotice = terminationNoticeDeadline(rec('c-gym').contract, TODAY);
    expect(gymNotice).toEqual({ date: '2026-12-01', passed: false });
    expect(dDayLabel(gymNotice!.date, TODAY)).toBe('D-57');
  });
});

describe('status', () => {
  test('저장 상태 + 날짜 계산 상태', () => {
    expect(deriveStatus(makeContract({ endDate: '2026-10-25' }), TODAY)).toBe('ending_soon');
    expect(deriveStatus(makeContract({ endDate: '2026-10-25', autoRenewal: true, renewalPeriodMonths: 12 }), TODAY)).toBe('renewal_due');
    expect(deriveStatus(makeContract({ endDate: '2026-12-31' }), TODAY)).toBe('active');
    expect(deriveStatus(makeContract({ endDate: '2026-09-30' }), TODAY)).toBe('ended');
    expect(deriveStatus(makeContract({ endDate: null }), TODAY)).toBe('active');
    expect(deriveStatus(makeContract({ lifecycle: 'cancelled' }), TODAY)).toBe('cancelled');
    expect(deriveStatus(makeContract({ endDate: TODAY }), TODAY)).toBe('ending_soon');
  });

  test('자동갱신 계약이 종료일을 지나면 갱신 회차로 계산하고 추정 표시', () => {
    const c = makeContract({ endDate: '2025-06-30', autoRenewal: true, renewalPeriodMonths: 12 });
    expect(currentTerm(c, TODAY)).toEqual({ termEnd: '2027-06-30', isEstimatedRenewal: true, renewalCount: 2 });
    expect(deriveStatus(c, TODAY)).toBe('active');
  });

  test('해지 통보기한은 현재 회차 기준, 지난 경우 passed', () => {
    const c = makeContract({ endDate: '2026-10-20', autoRenewal: true, renewalPeriodMonths: 12, terminationNoticeDays: 30 });
    expect(terminationNoticeDeadline(c, TODAY)).toEqual({ date: '2026-09-20', passed: true });
    expect(terminationNoticeDeadline({ ...c, lifecycle: 'cancelled' }, TODAY)).toBeNull();
  });
});

describe('schedule', () => {
  const base = rec('c-water-purifier').contract;
  const p = (over: Partial<ContractPayment>): ContractPayment => ({
    id: 'p', contractId: base.id, kind: 'recurring_fee', direction: 'expense', label: 'x', amount: 1000, frequency: 'monthly', dayOfMonth: null, monthOfYear: null, startsOn: '2026-01-31', endsOn: null, installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', ...over,
  });

  test('31일 결제는 짧은 달에 말일로', () => {
    const dates = expandPayment(p({}), base, { start: '2026-01-01', end: '2026-04-30' }).map((o) => o.date);
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  test('연납은 기준 월에만, 분기납은 3개월 간격', () => {
    const yearly = expandPayment(p({ frequency: 'yearly', monthOfYear: 3, dayOfMonth: 10, startsOn: '2026-01-01' }), base, { start: '2026-01-01', end: '2027-12-31' });
    expect(yearly.map((o) => o.date)).toEqual(['2026-03-10', '2027-03-10']);
    const quarterly = expandPayment(p({ frequency: 'quarterly', dayOfMonth: 1, startsOn: '2026-02-01' }), base, { start: '2026-06-01', end: '2026-12-31' });
    expect(quarterly.map((o) => o.date)).toEqual(['2026-08-01', '2026-11-01']);
  });

  test('계약 시작 전/종료 후 결제는 없음, 해지 처리일 이후 제외', () => {
    const end = makeContract({ id: base.id, endDate: '2026-03-15' });
    expect(expandPayment(p({ dayOfMonth: 20, startsOn: '2026-02-01' }), end, { start: '2026-01-01', end: '2026-12-31' }).map((o) => o.date)).toEqual(['2026-02-20']);
    const cancelled = makeContract({ id: base.id, endDate: null, lifecycle: 'cancelled', lifecycleChangedOn: '2026-05-01' });
    expect(expandPayment(p({ dayOfMonth: 1, startsOn: '2026-03-01' }), cancelled, { start: '2026-01-01', end: '2026-12-31' }).map((o) => o.date)).toEqual(['2026-03-01', '2026-04-01', '2026-05-01']);
  });

  test('일시불', () => {
    expect(expandPayment(p({ frequency: 'one_time', startsOn: '2026-10-07' }), base, { start: '2026-10-01', end: '2026-10-31' }).map((o) => o.date)).toEqual(['2026-10-07']);
  });

  test('헬스장 12월 일정: 해지 통보기한, 만료, 자동갱신, 결제', () => {
    const items = contractSchedule(rec('c-gym'), { start: '2026-12-01', end: '2027-01-31' }, TODAY);
    const types = items.map((i) => `${i.date}:${i.type}`).sort();
    expect(types).toEqual([
      '2026-12-01:termination_notice',
      '2026-12-05:payment',
      '2026-12-31:contract_end',
      '2027-01-01:renewal',
      '2027-01-05:payment',
    ]);
  });

  test('다음 결제일', () => {
    expect(nextPayment(rec('c-water-purifier'), TODAY)?.date).toBe('2026-10-25');
    expect(nextPayment(rec('c-gym'), TODAY)?.date).toBe('2026-10-05');
    expect(nextPayment(rec('c-jeonse'), TODAY)).toBeNull();
  });
});

describe('spending', () => {
  const records = createMockRecords();

  test('이번 달 실제 결제 예정액 — 연납 보험료는 결제 월에만', () => {
    const oct = monthSpending(records, { year: 2026, month: 10 });
    expect(oct.total).toBe(39_900 + 38_500 + 55_000 + 683_000 + 79_000 + 17_000);
    expect(oct.items.some((i) => i.contractId === 'c-car-insurance')).toBe(false);
    expect(oct.byCategory[0]).toEqual({ category: 'vehicle', amount: 683_000 });
    expect(oct.byCategory.find((c) => c.category === 'telecom')?.amount).toBe(38_500 + 79_000);
    expect(oct.hasEstimated).toBe(true);

    const jan = monthSpending(records, { year: 2026, month: 1 });
    expect(jan.items.some((i) => i.contractId === 'c-car-insurance' && i.amount === 1_368_000)).toBe(true);
  });

  test('연간 예상/월평균 — 종료되는 계약은 이후 제외', () => {
    // 정수기12 + 인터넷12 + 헬스장12(자동갱신) + 할부12 + 휴대폰5(2027-02 종료) + 넷플릭스12, 보험 0(12/31 종료)
    const expected = 39_900 * 12 + 38_500 * 12 + 55_000 * 12 + 683_000 * 12 + 79_000 * 5 + 17_000 * 12;
    expect(annualForecast(records, TODAY)).toBe(expected);
    expect(monthlyAverage(records, TODAY)).toBe(Math.round(expected / 12));
  });
});

describe('월 환산액', () => {
  test('연납 보험료 월환산 114,000원 (요구사항 예시), 종료 임박 계약도 규칙 기준', () => {
    expect(contractMonthlyEquivalent(rec('c-car-insurance'))).toBe(114_000);
    expect(contractMonthlyEquivalent(rec('c-mobile'))).toBe(79_000);
    expect(contractMonthlyEquivalent(rec('c-jeonse'))).toBe(0);
  });
});

describe('홈: 처리할 계약 / 곧 종료 / 상태 요약', () => {
  const records = createMockRecords();

  test('지금 확인이 필요한 계약 (기본 30일, 계약당 1건)', () => {
    const items = attentionItems(records, TODAY);
    expect(items.map((i) => `${i.contractId}:${i.kind}:${i.days}`)).toEqual(['c-jeonse:custom:25']);
    // 종류별 기간 설정: 해지 통보기한만 60일로 늘리면 헬스장 포함
    const wide = attentionItems(records, TODAY, { termination_notice: 60, custom: 30, prepare: 30, renewal: 30, contract_end: 30 });
    expect(wide.map((i) => i.contractId)).toEqual(['c-jeonse', 'c-gym']);
    const later = attentionItems(records, '2026-11-25');
    expect(later[0]).toMatchObject({ contractId: 'c-gym', kind: 'termination_notice', days: 6 });
  });

  test('곧 종료/갱신 (180일)', () => {
    const ends = upcomingEnds(records, TODAY);
    expect(ends.map((e) => `${e.contractId}:${e.days}`)).toEqual([
      'c-car-insurance:87',
      'c-gym:87',
      'c-jeonse:117',
      'c-mobile:146',
    ]);
  });

  test('상태 요약', () => {
    expect(statusSummary(records, TODAY)).toEqual({ live: 8, endingSoon: 0, renewalDue: 0, closed: 0 });
    expect(statusSummary(records, '2026-12-15')).toMatchObject({ endingSoon: 1, renewalDue: 1 });
  });
});

describe('다음 행동', () => {
  test('계약 종류·조건별 다음 행동', () => {
    const gym = nextAction(rec('c-gym'), TODAY)!;
    expect(gym).toMatchObject({ kind: 'termination_notice', date: '2026-12-01', days: 57, headline: '해지 통보기한이 57일 남았습니다.' });
    expect(gym.guidance).toContain('12월 1일까지 해지 의사를 전달해야');

    expect(nextAction(rec('c-car-insurance'), TODAY)).toMatchObject({ kind: 'contract_end', label: '보험 만기', days: 87 });
    expect(nextAction(rec('c-internet'), TODAY)).toMatchObject({ kind: 'renewal', label: '자동갱신 예정', days: 268 });
    expect(nextAction(rec('c-mobile'), TODAY)).toMatchObject({ label: '약정 종료', days: 146 });
    // 종료가 180일보다 멀면 아직 행동할 일이 아니라 다음 결제를 보여준다
    expect(nextAction(rec('c-water-purifier'), TODAY)).toMatchObject({ label: '다음 결제' });
    // 종료일 없는 구독 → 다음 결제
    expect(nextAction(rec('c-ott'), TODAY)).toMatchObject({ kind: 'payment', date: '2026-10-12' });
  });

  test('전세: 사용자 일정 → 갱신 여부 확인 시점(만기 60일 전) → 만기', () => {
    const r = rec('c-jeonse');
    expect(nextAction(r, TODAY)).toMatchObject({ kind: 'custom', days: 25 });
    r.events[0].completedAt = '2026-10-06T00:00:00Z';
    expect(nextAction(r, TODAY)).toMatchObject({ kind: 'prepare', label: '갱신 여부 확인', date: '2026-12-01' });
    expect(nextAction(r, '2026-12-02')).toMatchObject({ kind: 'contract_end', label: '계약 만기' });
  });

  test('해지/종료된 계약은 다음 행동 없음', () => {
    const r = rec('c-gym');
    r.contract.lifecycle = 'cancelled';
    expect(nextAction(r, TODAY)).toBeNull();
  });

  test('다음 행동 문구에 금지 표현 없음', () => {
    for (const r of createMockRecords()) {
      const a = nextAction(r, TODAY);
      if (a) expect(findBannedPhrases(a.headline + a.guidance)).toEqual([]);
    }
  });
});

describe('알림 예정', () => {
  test('해지 통보기한/만료/결제 알림 생성, 계약별 off 반영', () => {
    const records = createMockRecords();
    const reminders = upcomingReminders(records, TODAY, 60);
    const gym = reminders.filter((r) => r.contractId === 'c-gym' && r.kind === 'termination_notice').map((r) => r.fireOn);
    expect(gym).toEqual(['2026-11-24', '2026-11-30', '2026-12-01']);
    expect(reminders.some((r) => r.contractId === 'c-car-insurance' && r.fireOn === '2026-12-01')).toBe(true);
    expect(reminders.some((r) => r.kind === 'payment' && r.contractId === 'c-water-purifier' && r.fireOn === '2026-10-24')).toBe(true);

    records.find((r) => r.contract.id === 'c-gym')!.contract.notificationsEnabled = false;
    expect(upcomingReminders(records, TODAY, 60).some((r) => r.contractId === 'c-gym')).toBe(false);
  });
});

describe('money', () => {
  test('형식', () => {
    expect(formatKRW(1_250_300)).toBe('₩1,250,300');
    expect(formatWon(39_900)).toBe('39,900원');
    expect(formatWonCompact(300_000_000)).toBe('3억원');
    expect(formatWonCompact(350_000_000)).toBe('3억 5,000만원');
    expect(parseAmount('1,250,300원')).toBe(1_250_300);
    expect(parseAmount('')).toBeNull();
  });
});

describe('AI 문구 규칙', () => {
  test('mock AI 체크 문구에 금지 표현 없음', () => {
    for (const r of createMockRecords()) {
      for (const c of r.aiChecks) expect(findBannedPhrases(`${c.title} ${c.description}`)).toEqual([]);
    }
    expect(findBannedPhrases('이 조항은 무효입니다')).toEqual(['무효']);
  });
});
