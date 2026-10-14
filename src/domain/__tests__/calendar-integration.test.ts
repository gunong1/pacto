/**
 * 캘린더 일정 통합·중요도 (calendarGroups.ts — 화면 전용). 원본 일정·금액·알림은 그대로. 모든 값은 가짜
 * 기준: 전세 (계약금 2026-11-03 2천만 · 잔금 2026-12-01 1억8천만 · 시작·인도 2026-12-01 · 갱신 여부 확인 2028-10-01 · 만기 2028-11-30 · 보증금 반환 확인)
 */
import { draftToRecord, EMPTY_DRAFT, recordToDraft } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';

import { groupCalendarItems, itemsForView, scheduleTier } from '../calendarGroups';
import { withConfirmedRole } from '../cashflow';
import { groupReminders } from '../reminderGroups';
import { upcomingReminders } from '../reminders';
import { scheduleForRange, type ScheduleItem } from '../schedule';
import { monthSpending } from '../spending';
import type { ContractRecord } from '../types';

const TODAY = '2026-10-14';
const once = (o: Partial<PaymentDraft>): PaymentDraft => ({ kind: 'deposit', direction: 'neutral', label: '결제', amount: 1, frequency: 'one_time', dayOfMonth: null, monthOfYear: null, startsOn: '2026-11-03', endsOn: null, installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null, moneyNature: 'refundable_deposit', ...o });

function jeonse(id: string, o: { handover?: string; start?: string; end?: string; returnDueOn?: string | null; extraDates?: ContractDraft['dates']; title?: string } = {}): ContractRecord {
  const start = o.start ?? '2026-12-01';
  const draft: ContractDraft = {
    ...EMPTY_DRAFT,
    title: o.title ?? '테스트 전세계약서',
    category: 'real_estate',
    contractType: 'lease',
    contractKind: 'lease',
    startDate: start,
    endDate: o.end ?? '2028-11-30',
    depositAmount: 200_000_000,
    parties: [
      { role: 'lessor', name: '김민수' },
      { role: 'lessee', name: '박지훈' },
    ],
    payments: [once({ label: '보증금 계약금', amount: 20_000_000, startsOn: '2026-11-03', fundKey: 'dep' }), once({ label: '보증금 잔금', amount: 180_000_000, startsOn: start, fundKey: 'dep' })],
    funds: [{ key: 'dep', kind: 'deposit', label: '보증금', totalAmount: null, returnDueOn: o.returnDueOn ?? null, depositorRole: null, holderRole: null }],
    // 갱신 여부 확인(2028-10-01)은 PACTO가 임대차 만기 2개월 전에 만든다 (계약서 날짜로 따로 넣지 않음)
    dates: [{ kind: 'handover', label: '목적물 인도일', date: o.handover ?? start }, ...(o.extraDates ?? [])],
  };
  return draftToRecord(withConfirmedRole(draft, 'lessee'), id, TODAY);
}
const on = (records: ContractRecord[], date: string, mode: 'core' | 'all' = 'core') => groupCalendarItems(itemsForView(scheduleForRange(records, { start: date, end: date }, TODAY), mode).shown, TODAY);
const range = (records: ContractRecord[], start = '2026-11-01', end = '2028-12-31') => scheduleForRange(records, { start, end }, TODAY);

describe('기준 사례: 원본 일정은 그대로, 날짜별 묶음으로', () => {
  const r = jeonse('j');
  test('원본 일정 7개(계약금·잔금·시작·인도·갱신 확인·만기·반환 확인) → 날짜 묶음 4개', () => {
    const items = range([r]);
    expect(items.map((i) => [i.date, i.title])).toEqual(
      expect.arrayContaining([
        ['2026-11-03', '보증금 계약금'],
        ['2026-12-01', '보증금 잔금'],
        ['2026-12-01', '목적물 인도일'],
        ['2028-10-01', '갱신 여부 확인'],
        ['2028-11-30', '보증금 반환 확인'],
      ]),
    );
    expect(items).toHaveLength(7);
    const groups = groupCalendarItems(items, TODAY);
    expect(groups.map((g) => [g.date, g.title, g.items.length])).toEqual([
      ['2026-11-03', '보증금 계약금 지급', 1],
      ['2026-12-01', '입주·잔금일', 3],
      ['2028-10-01', '갱신 여부 확인', 1],
      ['2028-11-30', '만기·보증금 반환 확인', 2],
    ]);
    expect(groups.reduce((s, g) => s + g.items.length, 0)).toBe(items.length); // 하나도 빠지지 않음
  });

  test('16. 금액은 원본 지급 항목만 (보증금 총액 2억을 더하지 않음): 12/1 카드 = 잔금 1억8천만, 반환 확인 카드는 금액 없음', () => {
    const [dec] = on([r], '2026-12-01');
    expect(dec.cashflows.map((c) => [c.total, c.headline])).toEqual([[180_000_000, '180,000,000원 보증금 지급 예정']]);
    expect(on([r], '2028-11-30')[0].cashflows).toEqual([]);
  });
});

describe('같은 날짜·다른 날짜 규칙', () => {
  test('1·3. 시작일 = 인도일 = 잔금일 → 카드 1장 "입주·잔금일" (관련 일정 3개)', () => {
    const gs = on([jeonse('a')], '2026-12-01');
    expect(gs.map((g) => [g.title, g.items.length])).toEqual([['입주·잔금일', 3]]);
  });

  test('2. 인도일이 시작일과 다르면 날짜별로 따로 (서로 다른 날짜를 묶지 않음)', () => {
    const r = jeonse('b', { handover: '2026-11-28' });
    expect(on([r], '2026-11-28').map((g) => g.title)).toEqual(['목적물 인도일']);
    expect(on([r], '2026-12-01').map((g) => [g.title, g.items.length])).toEqual([['시작·잔금일', 2]]);
  });

  test('4. 만기일 = 반환 확인 기준일 → "만기·보증금 반환 확인" (반환 완료로 보지 않음 · 합계 제외)', () => {
    const r = jeonse('c');
    const [g] = on([r], '2028-11-30');
    expect(g.title).toBe('만기·보증금 반환 확인');
    expect(monthSpending([r], { year: 2028, month: 11 }, TODAY).incomeTotal).toBe(0);
  });

  test('5. 계약서 반환 예정일(12/15)이 만기와 다르면 각각의 날짜 · 반환 예정은 보증금 입금 예정으로만', () => {
    const r = jeonse('d', { returnDueOn: '2028-12-15' });
    expect(on([r], '2028-11-30').map((g) => g.title)).toEqual(['계약 만기']);
    const [due] = on([r], '2028-12-15');
    expect([due.title, due.cashflows[0].headline]).toEqual(['보증금 반환 예정', '+200,000,000원 보증금 입금 예정']);
    const dec = monthSpending([r], { year: 2028, month: 12 }, TODAY);
    expect([dec.depositIn, dec.ordinaryIncome]).toEqual([200_000_000, 0]);
  });

  test('6. 같은 날짜에 다른 계약 → 계약별로 따로', () => {
    const gs = on([jeonse('e1'), jeonse('e2', { title: '다른 전세계약서' })], '2026-12-01');
    expect(gs.map((g) => [g.contractId, g.items.length])).toEqual([
      ['e2', 3],
      ['e1', 3],
    ].sort((a, b) => (a[0] === 'e1' ? 1 : -1) - (b[0] === 'e1' ? 1 : -1)) as never);
    expect(new Set(gs.map((g) => g.contractId))).toEqual(new Set(['e1', 'e2']));
  });

  test('7. 하루에 일정 5개 이상 → 카드 1장 · 모두 보존 · 제목은 앞 3개 + 외 N', () => {
    const r = jeonse('f', {
      extraDates: [
        { kind: 'move_in', label: '입주일', date: '2026-12-01' },
        { kind: 'inspection', label: '시설 점검일', date: '2026-12-01' },
        { kind: 'delivery', label: '열쇠 인계', date: '2026-12-01' },
      ],
    });
    const [g] = on([r], '2026-12-01');
    expect(g.items.length).toBeGreaterThanOrEqual(5);
    expect(g.title).toMatch(/외 \d+$/);
    expect(on([r], '2026-12-01').length).toBe(1);
  });

  test('7-1. 같은 날 결제가 여럿이면 제목은 "결제"로 묶고, 각 금액은 원본 그대로', () => {
    const base = jeonse('pay2');
    const d = recordToDraft(base);
    const r = draftToRecord({ ...d, payments: [...d.payments, once({ kind: 'other', label: '관리비 예치금', amount: 300_000, startsOn: '2026-12-01', direction: 'expense', moneyNature: 'ordinary', fundKey: undefined })] }, 'pay2', TODAY);
    const [g] = on([r], '2026-12-01');
    expect(g.title).toBe('입주·결제일');
    expect(g.items.filter((i) => i.type === 'payment').map((i) => i.amount).sort()).toEqual([180_000_000, 300_000].sort());
  });

  test('7-2. 묶음 카드에서도 PACTO 기본 안내 출처가 보임 (계약서 기한으로 오해 방지)', () => {
    const r = jeonse('guide', { extraDates: [{ kind: 'inspection', label: '시설 점검일', date: '2028-10-01' }] });
    const [g] = on([r], '2028-10-01');
    expect(g.items.length).toBe(2);
    expect([g.primary?.sourceLabel, ...g.guideLabels].join(' ')).toContain('PACTO 안내');
  });
});

describe('중요도·보기 (핵심 일정 / 전체 보기)', () => {
  test('등급: 금전·만기·반환 확인 = 필수 · 시작·인도·갱신 확인 = 관리', () => {
    const tiers = Object.fromEntries(range([jeonse('t')]).map((i) => [i.title, scheduleTier(i)]));
    expect(tiers).toMatchObject({ '보증금 계약금': 'primary', '보증금 잔금': 'primary', '보증금 반환 확인': 'primary', '목적물 인도일': 'secondary', '갱신 여부 확인': 'secondary' });
  });

  test('9. 참고 일정(기타 날짜): 핵심 일정에서는 숨김 · 전체 보기에서 보임 · 숨긴 개수 안내', () => {
    const r = jeonse('g', { extraDates: [{ kind: 'other', label: '계약서 작성일', date: '2026-11-03' }] });
    const items = scheduleForRange([r], { start: '2026-11-03', end: '2026-11-03' }, TODAY);
    expect(itemsForView(items, 'core')).toMatchObject({ hidden: 1 });
    expect(on([r], '2026-11-03', 'core')[0].items.map((i) => i.title)).toEqual(['보증금 계약금']);
    expect(on([r], '2026-11-03', 'all')[0].items.map((i) => i.title).sort()).toEqual(['계약서 작성일', '보증금 계약금']);
  });

  test('9-1. 계약 조건에서 계산한 일정(수습기간 종료 등, 날짜 종류 없음)은 관리 — 핵심 일정에서도 보임', () => {
    expect(scheduleTier({ type: 'key_date', dateKind: undefined, priority: 'normal', needsReview: false, eventId: null, actionType: null } as never)).toBe('secondary');
    expect(scheduleTier({ type: 'key_date', dateKind: 'other', priority: 'normal', needsReview: false, eventId: null, actionType: null } as never)).toBe('reference');
  });

  test('8. 사용자가 직접 추가한 일정은 핵심 일정에서도 표시', () => {
    const r = jeonse('h');
    const withEvent: ContractRecord = { ...r, events: [{ id: 'ev1', contractId: 'h', title: '이삿짐 예약', eventDate: '2026-11-20', eventType: 'custom', completed: false } as never] };
    const items = scheduleForRange([withEvent], { start: '2026-11-20', end: '2026-11-20' }, TODAY);
    expect(items.map((i) => [i.title, scheduleTier(i)])).toEqual([['이삿짐 예약', 'primary']]);
    expect(itemsForView(items, 'core').shown).toHaveLength(1);
  });

  test('17. 보기와 묶음은 월 합계와 무관 — 핵심/전체 모두 금액 합 = monthSpending', () => {
    const r = jeonse('k');
    const dec = monthSpending([r], { year: 2026, month: 12 }, TODAY);
    for (const mode of ['core', 'all'] as const) {
      const gs = groupCalendarItems(itemsForView(scheduleForRange([r], { start: '2026-12-01', end: '2026-12-31' }, TODAY), mode).shown, TODAY);
      expect(gs.flatMap((g) => g.cashflows).filter((c) => c.direction === 'expense').reduce((s, c) => s + c.total, 0)).toBe(dec.total);
    }
  });
});

describe('원본 보존·재계산', () => {
  test('10·11. 묶음 안의 원본 일정은 key·결제·사용자 일정 id를 그대로 가짐 (개별 수정·완료 처리 대상 유지)', () => {
    const [g] = on([jeonse('m')], '2026-12-01');
    const keys = g.items.map((i: ScheduleItem) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(g.items.find((i) => i.title === '보증금 잔금')).toMatchObject({ type: 'payment', amount: 180_000_000, moneyNature: 'deposit' });
  });

  test('18. 계약 수정(잔금 삭제) → 묶음 다시 계산 · 19. 날짜 변경(인도일 12/5) → 기존 묶음 해제·새 묶음', () => {
    const r = jeonse('n');
    const d = recordToDraft(r);
    const noBalance = draftToRecord({ ...d, payments: d.payments.filter((p) => p.label !== '보증금 잔금') }, 'n', TODAY);
    expect(on([noBalance], '2026-12-01').map((g) => [g.title, g.items.length])).toEqual([['임대차 시작 · 인도', 2]]);
    expect(on([noBalance], '2026-12-01')[0].cashflows).toEqual([]);
    const moved = draftToRecord({ ...d, dates: d.dates.map((x) => (x.kind === 'handover' ? { ...x, date: '2026-12-05' } : x)) }, 'n', TODAY);
    expect(on([moved], '2026-12-01').map((g) => g.items.length)).toEqual([2]);
    expect(on([moved], '2026-12-05').map((g) => g.title)).toEqual(['목적물 인도일']);
  });

  test('20. 같은 데이터면 다시 계산해도 같은 묶음 (앱 재시작 후 동일 표시)', () => {
    const a = groupCalendarItems(range([jeonse('p')]), TODAY).map((g) => [g.key, g.title, g.items.map((i) => i.key)]);
    const b = groupCalendarItems(range([jeonse('p')]), TODAY).map((g) => [g.key, g.title, g.items.map((i) => i.key)]);
    expect(a).toEqual(b);
  });

  test('15. 계약 25개 · 2년치 일정 계산·묶기 < 1초', () => {
    const many = Array.from({ length: 25 }, (_, i) => jeonse(`perf-${i}`, { title: `전세 ${i}` }));
    const t0 = Date.now();
    const gs = groupCalendarItems(range(many), TODAY);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(gs.reduce((s, g) => s + g.items.length, 0)).toBe(25 * 7);
  });
});

describe('알림: 화면 묶음과 별개 · 원본 알림 보존 · 중복 없음', () => {
  const r = jeonse('q');
  const reminders = upcomingReminders([r], '2026-11-20', 30);

  test('12. 같은 계약·같은 알림 날짜 → 알림 1건(발송 단위) · 원본 알림은 그 안에 모두', () => {
    const groups = groupReminders(reminders);
    const keys = groups.map((g) => `${g.contractId}|${g.fireOn}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(groups.reduce((s, g) => s + g.reminders.length, 0)).toBe(reminders.length);
  });

  test('13. 알림 날짜가 다르면 따로 (예: 잔금 하루 전·당일 알림은 다른 알림)', () => {
    const fireDays = new Set(reminders.filter((x) => x.contractId === 'q').map((x) => x.fireOn));
    expect(groupReminders(reminders).length).toBe(fireDays.size);
  });

  test('14. 사용자가 계약별로 알림을 끄면 그 계약 알림 없음 (설정 보존)', () => {
    expect(upcomingReminders([{ ...r, contract: { ...r.contract, notificationsEnabled: false } }], '2026-11-20', 30)).toEqual([]);
  });
});
