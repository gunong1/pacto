/**
 * 보증금·예치금 반환 확인 알림 — 모든 이름·금액은 가짜다.
 * 규칙: src/domain/reminders.ts (depositReminders) — 계약 종료(상태)와 반환 완료(정산)를 따로 본다.
 */
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft, FundDraft, PaymentDraft } from '@/data/repository';

import { applyDirectionChanges, roleDirectionChanges } from '../cashflow';
import { buildNotificationMessage, planNotifications, reminderCategory, scheduleItemCategory } from '../notifications';
import { groupReminders } from '../reminderGroups';
import { DEPOSIT_FOLLOW_UP_DAYS, REMINDER_RULES, upcomingReminders } from '../reminders';
import type { ContractRecord, FundRefund } from '../types';

const P = (o: Partial<PaymentDraft>): PaymentDraft => ({
  kind: 'other',
  direction: 'neutral',
  label: '납부금',
  amount: 0,
  frequency: 'one_time',
  dayOfMonth: null,
  monthOfYear: null,
  startsOn: null,
  endsOn: null,
  installmentCount: null,
  isVariable: false,
  components: [],
  businessDayRule: 'none',
  obligation: 'confirmed',
  conditionNote: null,
  ...o,
});
const FUND = (o: Partial<FundDraft> = {}): FundDraft => ({ key: 'dep', kind: 'deposit', label: '보증금', totalAmount: null, returnDueOn: null, depositorRole: null, holderRole: null, ...o });
const base = (o: Partial<ContractDraft> = {}): ContractDraft => ({
  ...EMPTY_DRAFT,
  title: '주택 월세 임대차',
  contractKind: 'lease',
  contractType: 'lease',
  category: 'real_estate',
  startDate: '2026-10-20',
  endDate: '2028-10-19',
  depositAmount: 20_000_000,
  parties: [
    { role: 'lessor', name: '김민수' },
    { role: 'lessee', name: '박지훈' },
  ],
  funds: [FUND()],
  payments: [
    P({ kind: 'down_payment', label: '보증금 계약금', amount: 2_000_000, startsOn: '2026-10-08', moneyNature: 'refundable_deposit', fundKey: 'dep' }),
    P({ kind: 'balance_payment', label: '보증금 잔금', amount: 18_000_000, startsOn: '2026-10-20', moneyNature: 'refundable_deposit', fundKey: 'dep' }),
    P({ kind: 'rent', label: '월세', amount: 850_000, frequency: 'monthly', dayOfMonth: 20, moneyNature: 'ordinary' }),
  ],
  ...o,
});
const as = (d: ContractDraft, role: string | null): ContractDraft => {
  const next = { ...d, userPartyRole: role, userPartyRelation: role ? ('self' as const) : ('unknown' as const) };
  return { ...next, payments: applyDirectionChanges(next.payments, roleDirectionChanges({ ...next }, next.payments)) };
};
const rec = (d: ContractDraft, refunds: FundRefund[] = []): ContractRecord => {
  const r = draftToRecord(d, 'c1', '2026-10-08');
  r.funds = (r.funds ?? []).map((f) => ({ ...f, refunds: refunds.filter((x) => x.fundId === f.id) }));
  return r;
};
const refund = (amount: number, refundedOn: string): FundRefund => ({ id: `r-${refundedOn}-${amount}`, fundId: 'dep', amount, refundedOn, note: null });
const deposits = (records: ContractRecord[], today: string, horizon = 120, rules = REMINDER_RULES) =>
  upcomingReminders(records, today, horizon, { rulesFor: () => rules }).filter((r) => r.kind === 'deposit_return');
const tenant = () => as(base(), 'lessee');
/** 금지 표현: 반환이 확정된 것처럼 ("입금됩니다", "받을 예정", "결제일") */
const FORBIDDEN = /입금됩니다|입금 예정|받을 예정|수령 예정|결제일|돌려받습니다/;

describe('기준일 전 — 계약 종료일 기준 (확정 반환일 아님)', () => {
  test('30·7일 전과 당일 · 금액은 합계에 넣지 않음(null) · 받을 쪽은 "돌려받으면 기록"', () => {
    const xs = deposits([rec(tenant())], '2028-09-01', 60);
    expect(xs.map((r) => [r.fireOn, r.daysBefore])).toEqual([
      ['2028-09-19', 30],
      ['2028-10-12', 7],
      ['2028-10-19', 0],
      ['2028-10-26', -7],
    ]);
    expect(xs.every((r) => r.amount === null && r.direction === null && r.targetDate === '2028-10-19')).toBe(true);
    expect(xs[0].message).toBe('보증금 반환 확인 기준일(계약 종료일)까지 30일 남았어요.');
    expect(xs[2].message).toBe('오늘이 보증금 반환 확인 기준일(계약 종료일)이에요.');
    expect(xs[0].hint).toBe('돌려받으면 반환 기록을 남겨주세요.');
    expect(xs.every((r) => !FORBIDDEN.test(`${r.message} ${r.hint}`))).toBe(true);
    expect(reminderCategory(xs[0])).toBe('deposit_return');
  });

  test('계약서에 반환 예정일이 있으면 그 날 기준 ("계약서에 적힌 … 반환 예정일")', () => {
    const xs = deposits([rec({ ...tenant(), funds: [FUND({ returnDueOn: '2028-10-25' })] })], '2028-10-01', 60);
    expect(xs.map((r) => r.fireOn)).toEqual(['2028-10-18', '2028-10-25', '2028-11-01', '2028-11-24']);
    expect(xs[0].message).toBe('계약서에 적힌 보증금 반환 예정일까지 7일 남았어요.');
    expect(xs.every((r) => r.targetDate === '2028-10-25')).toBe(true);
  });
});

describe('계약 종료 ≠ 반환 완료', () => {
  test('계약이 끝났어도(종료일 지남) 반환 기록이 없으면 +7·30·60·90일에 계속 — 만료·결제 알림은 없음', () => {
    const all = upcomingReminders([rec(tenant())], '2028-10-20', 120);
    expect(all.every((r) => r.kind === 'deposit_return')).toBe(true);
    expect(all.map((r) => [r.fireOn, r.daysBefore])).toEqual([
      ['2028-10-26', -7],
      ['2028-11-18', -30],
      ['2028-12-18', -60],
      ['2029-01-17', -90],
    ]);
    expect(DEPOSIT_FOLLOW_UP_DAYS).toEqual([7, 30, 60, 90]);
    expect(all[0].message).toBe('보증금 반환 확인 기준일(계약 종료일)이 7일 지났는데 아직 반환 완료 기록이 없어요.');
  });

  test('해지 처리된 계약 → 처리일 기준으로 계속', () => {
    const r = rec(tenant());
    r.contract = { ...r.contract, lifecycle: 'ended', lifecycleChangedOn: '2027-05-31' };
    const xs = deposits([r], '2027-05-01', 60);
    expect(xs.map((r) => r.fireOn)).toEqual(['2027-05-01', '2027-05-24', '2027-05-31', '2027-06-07', '2027-06-30']);
  });

  test('반환 완료(전액 기록) → 알림 없음', () => {
    expect(deposits([rec(tenant(), [refund(20_000_000, '2028-10-19')])], '2028-09-01')).toHaveLength(0);
    expect(deposits([rec(tenant(), [refund(20_000_000, '2028-10-19')])], '2028-10-20')).toHaveLength(0);
  });

  test('일부 반환 → 남은 금액으로 안내 (일부 반환 2번도 합산)', () => {
    const xs = deposits([rec(tenant(), [refund(5_000_000, '2028-10-19'), refund(3_000_000, '2028-10-22')])], '2028-10-23');
    expect(xs.length).toBeGreaterThan(0);
    expect(xs[0].hint).toBe('일부 반환 후 남은 금액 12,000,000원을 돌려받으면 반환 기록을 남겨주세요.');
  });
});

describe('갱신·기준일 변경 · 설정', () => {
  test('계약 갱신(종료일 2028 → 2030) → 새 종료일 기준, 예전 날짜 알림 키 없음', () => {
    const before = deposits([rec(tenant())], '2028-09-01', 60).map((r) => r.key);
    const after = deposits([rec({ ...tenant(), endDate: '2030-10-19' })], '2028-09-01', 800);
    expect(after.filter((r) => r.daysBefore >= 0).map((r) => r.fireOn)).toEqual(['2030-09-19', '2030-10-12', '2030-10-19']);
    expect(after.every((r) => r.targetDate === '2030-10-19')).toBe(true);
    expect(after.some((r) => before.includes(r.key))).toBe(false);
  });

  test('반환 예정일 변경 → 새 날짜 기준 (키가 바뀌어 예전 예정 알림은 서버 계획에서 취소됨)', () => {
    const a = deposits([rec({ ...tenant(), funds: [FUND({ returnDueOn: '2028-10-25' })] })], '2028-10-01', 30).map((r) => r.key);
    const b = deposits([rec({ ...tenant(), funds: [FUND({ returnDueOn: '2028-11-05' })] })], '2028-10-01', 30);
    expect(b.every((r) => r.targetDate === '2028-11-05')).toBe(true);
    expect(b.some((r) => a.includes(r.key))).toBe(false);
  });

  test('자동갱신 중인 계약 — 기간 끝은 반환 시점이 아니므로 알림 없음 (계약서 반환 예정일이 있으면 알림)', () => {
    const auto = { ...tenant(), autoRenewal: true, renewalPeriodMonths: 24 };
    expect(deposits([rec(auto)], '2028-09-01')).toHaveLength(0);
    expect(deposits([rec({ ...auto, funds: [FUND({ returnDueOn: '2028-10-25' })] })], '2028-10-01', 30).length).toBeGreaterThan(0);
  });

  test('이 종류를 끄면 기준일 전·후 모두 없음 / 계약 알림 받기를 끄면 없음', () => {
    expect(deposits([rec(tenant())], '2028-10-20', 120, { ...REMINDER_RULES, depositReturn: [] })).toHaveLength(0);
    const r = rec(tenant());
    r.contract.notificationsEnabled = false;
    expect(deposits([r], '2028-10-20')).toHaveLength(0);
  });

  test('시점을 바꾸면 그 시점으로 (14일 전만)', () => {
    expect(deposits([rec(tenant())], '2028-09-01', 60, { ...REMINDER_RULES, depositReturn: [14] }).map((r) => r.fireOn)).toEqual(['2028-10-05', '2028-10-26']);
  });
});

describe('받을 쪽 / 줄 쪽 / 모름 — 확정되지 않은 반환을 입금처럼 말하지 않음', () => {
  test('임대인(줄 쪽) → "돌려줄 보증금의 반환·정산을 확인하고 기록"', () => {
    const [x] = deposits([rec(as(base(), 'lessor'))], '2028-09-01', 60);
    expect(x.hint).toBe('돌려줄 보증금의 반환·정산을 확인하고 기록해주세요.');
  });
  test('역할 모름 → 반환·정산 확인 + 역할을 정하라는 안내 (받을지 줄지 단정 안 함)', () => {
    const [x] = deposits([rec(as(base(), null))], '2028-09-01', 60);
    expect(x.hint).toBe('반환·정산 상황을 확인해주세요. 이 계약에서 내 역할을 정하면 받을 돈인지 줄 돈인지 구분해 알려드려요.');
    expect(FORBIDDEN.test(`${x.message} ${x.hint}`)).toBe(false);
  });
});

describe('발송 계획 (서버와 같은 코드)', () => {
  const now = new Date('2028-09-01T00:00:00Z'); // 한국 09:00
  const plan = (records: ContractRecord[], preferences: Parameters<typeof planNotifications>[0]['preferences'] = null, n = now) =>
    planNotifications({ userId: 'u1', records, preferences, overrides: new Map(), now: n, windowDays: 120 });

  test('반환 확인 알림 = event_type deposit_return · 잠금화면 기본은 계약명·금액 없이', () => {
    const xs = plan([rec(tenant())]).filter((p) => p.eventType === 'deposit_return');
    expect(xs.length).toBeGreaterThan(0);
    expect(xs.every((p) => p.push.title === 'PACTO' && !/보증금|원/.test(p.push.body))).toBe(true);
  });

  test('계약 만료 알림과 같은 날이면 푸시 하나로 묶고, 반환 확인 문장도 함께', () => {
    const xs = plan([rec(tenant())]).filter((p) => p.fireOn === '2028-09-19');
    expect(xs).toHaveLength(1);
    expect(xs[0].eventType).toBe('maturity'); // 임대차는 "만기"

    expect(xs[0].display.detail).toContain('보증금 반환 확인 기준일(계약 종료일)까지 30일 남았어요. 돌려받으면 반환 기록을 남겨주세요.');
  });

  test('기준일 뒤 알림: offsetDays 음수 · 미리보기를 켜면 해야 할 일 문장이 본문', () => {
    const after = new Date('2028-10-20T00:00:00Z');
    const xs = plan([rec(tenant())], { showDetails: true }, after);
    expect(xs.map((p) => p.offsetDays)).toEqual([-7, -30, -60, -90]);
    expect(xs[0].push).toEqual({ title: '주택 월세 임대차 · 보증금 반환 확인 기준일(계약 종료일)이 7일 지났는데 아직 반환 완료 기록이 없어요.', body: '돌려받으면 반환 기록을 남겨주세요.' });
    expect(xs[0].display.message).toBe('보증금 반환 확인 기준일(계약 종료일)이 7일 지났는데 아직 반환 완료 기록이 없어요. 돌려받으면 반환 기록을 남겨주세요.');
  });

  test('설정에서 끄면 발송 계획에서도 빠짐 (만료 알림은 그대로)', () => {
    const xs = plan([rec(tenant())], { categories: { deposit_return: { enabled: false, offsets: [30, 7, 0] } } });
    expect(xs.some((p) => p.eventType === 'deposit_return' || p.eventKey.startsWith('deposit'))).toBe(false);
    expect(xs.some((p) => p.eventType === 'maturity')).toBe(true);
  });

  test('캘린더의 반환 일정도 같은 알림 종류 (결제 알림으로 세지 않음)', () => {
    expect(scheduleItemCategory({ type: 'key_date', actionType: 'deposit_return' }, false)).toBe('deposit_return');
    expect(scheduleItemCategory({ type: 'payment', actionType: 'deposit_return' }, false)).toBe('deposit_return');
  });

  test('묶음 제목은 "보증금 반환 확인"', () => {
    const g = groupReminders(deposits([rec(tenant())], '2028-10-20'));
    expect(g[0].title).toBe('주택 월세 임대차 · 보증금 반환 확인');
    expect(buildNotificationMessage(g[0], { showDetails: false }).body).toBe('확인할 계약 기한이 있어요.');
  });
});
