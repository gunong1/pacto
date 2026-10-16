/**
 * 홈 화면 묶음 (src/domain/homeView.ts) — 새 계산 없이 기존 결과를 고르고 묶기만
 * - 계약별 금액 줄의 합 = monthSpending 총액 (출금·입금 각각) · 3줄 + 외 N건
 * - 같은 계약의 보증금·일반 금액은 줄을 나눔 · 입금과 출금은 섞지 않음
 * - 다가오는 일정 = 캘린더와 같은 일정·묶음 · 가까운 순 3개 · 지급일 휴일 규칙 반영 날짜 그대로
 */
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import { createMockRecords } from '@/data/mock/mockContracts';
import type { ContractDraft, PaymentDraft } from '@/data/repository';

import { groupCalendarItems, itemsForView } from '../calendarGroups';
import { addDays } from '../dates';
import { flowCard, upcomingSchedule, upcomingTone } from '../homeView';
import { scheduleForRange } from '../schedule';
import { contractFlowLines, monthSpending } from '../spending';

const TODAY = '2026-10-16';
const pay = (p: Partial<PaymentDraft>): PaymentDraft => ({ kind: 'recurring_fee', direction: 'expense', directionBasis: 'user', label: '이용료', amount: 10_000, frequency: 'monthly', dayOfMonth: 20, monthOfYear: null, startsOn: null, endsOn: null, installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null, ...p });
const rec = (id: string, title: string, payments: PaymentDraft[], extra: Partial<ContractDraft> = {}, today = TODAY) =>
  draftToRecord({ ...EMPTY_DRAFT, title, contractType: 'recurring', startDate: '2026-01-01', payments, ...extra } as ContractDraft, id, today);

describe('계약별 금액 — 총액과 같은 항목', () => {
  test('mock 데이터: 출금·입금 각각 줄의 합 = 총액 · 큰 금액 순 · 3줄 + 외 N건(합계 포함)', () => {
    const records = createMockRecords();
    const s = monthSpending(records, { year: 2026, month: 10 }, TODAY);
    for (const [items, total] of [[s.items, s.total], [s.incomeItems, s.incomeTotal]] as const) {
      const card = flowCard(items);
      expect(card.total).toBe(total);
      expect(card.lines.reduce((x, l) => x + l.amount, 0)).toBe(total);
      expect(card.shown.reduce((x, l) => x + l.amount, 0) + card.rest.amount).toBe(total);
      expect(card.shown.length).toBe(Math.min(3, card.lines.length));
      expect(card.rest.count).toBe(Math.max(0, card.lines.length - 3));
      expect([...card.lines].sort((a, b) => b.amount - a.amount).map((l) => l.amount)).toEqual(card.lines.map((l) => l.amount));
    }
  });

  test('같은 이름 계약 2개도 따로 · 같은 계약의 보증금과 월세는 줄을 나눔 · 입금은 출금 카드에 없음', () => {
    const records = [
      rec('a', '헬스장', [pay({ amount: 30_000 })]),
      rec('b', '헬스장', [pay({ amount: 50_000 })]),
      rec('c', '원룸 임대차', [pay({ kind: 'rent', amount: 500_000, dayOfMonth: 25 }), pay({ kind: 'deposit', label: '보증금', amount: 10_000_000, frequency: 'one_time', dayOfMonth: null, startsOn: '2026-10-25', moneyNature: 'refundable_deposit' })]),
      rec('d', '과외', [pay({ kind: 'service_fee', direction: 'income', amount: 400_000, dayOfMonth: 28 })]),
    ];
    const s = monthSpending(records, { year: 2026, month: 10 }, TODAY);
    const out = contractFlowLines(s.items);
    expect(out.map((l) => [l.contractId, l.nature, l.amount])).toEqual([
      ['c', 'deposit', 10_000_000],
      ['c', 'ordinary', 500_000],
      ['b', 'ordinary', 50_000],
      ['a', 'ordinary', 30_000],
    ]);
    expect(out.reduce((x, l) => x + l.amount, 0)).toBe(s.total);
    expect(contractFlowLines(s.incomeItems).map((l) => [l.contractId, l.amount])).toEqual([['d', 400_000]]);
    expect(flowCard(s.items).rest).toEqual({ count: 1, amount: 30_000 });
  });

  test('항목이 없으면 빈 카드 (총액 0)', () => {
    expect(flowCard([])).toEqual({ total: 0, lines: [], shown: [], rest: { count: 0, amount: 0 } });
  });
});

describe('다가오는 일정 — 캘린더와 같은 일정', () => {
  test('mock 데이터: 가까운 순 최대 3개 · 캘린더 핵심 일정 묶음의 앞 3개와 같음 · 오늘 이전 없음 · 중복 없음', () => {
    const records = createMockRecords();
    const up = upcomingSchedule(records, TODAY);
    expect(up.length).toBeLessThanOrEqual(3);
    const cal = groupCalendarItems(itemsForView(scheduleForRange(records, { start: TODAY, end: addDays(TODAY, 400) }, TODAY), 'core').shown, TODAY).filter((g) => g.date >= TODAY);
    expect(up.map((u) => u.key)).toEqual(cal.slice(0, 3).map((g) => g.key));
    expect(up.every((u, i) => u.date >= TODAY && (i === 0 || up[i - 1].date <= u.date))).toBe(true);
    expect(new Set(up.map((u) => u.key)).size).toBe(up.length);
  });

  test('지급일 휴일 규칙 반영: 추석(9/25) "휴일이면 직전 영업일" → 9/23 · D-3', () => {
    const today = '2026-09-20';
    const r = rec('s', '월급', [pay({ kind: 'salary', direction: 'income', label: '급여', amount: 2_000_000, dayOfMonth: 25, businessDayRule: 'previous' })], { contractType: 'employment', contractKind: 'employment' }, today);
    const [first] = upcomingSchedule([r], today, 1);
    expect(first).toMatchObject({ contractId: 's', date: '2026-09-23', days: 3 });
  });

  test('일정이 없으면 빈 목록 · 3개 이상이면 3개만', () => {
    expect(upcomingSchedule([], TODAY)).toEqual([]);
    const many = ['a', 'b', 'c', 'd'].map((id, i) => rec(id, `계약 ${id}`, [pay({ dayOfMonth: 20 + i })]));
    expect(upcomingSchedule(many, TODAY).map((u) => [u.contractTitle, u.date])).toEqual([
      ['계약 a', '2026-10-20'],
      ['계약 b', '2026-10-21'],
      ['계약 c', '2026-10-22'],
    ]);
  });
});

describe('다가오는 일정 D-day 색 — 확인할 시점이 가까운 계약 관리 일정만 강조', () => {
  test('색 규칙: 관리 일정 7일 이내 빨강(soon) · 8~30일 남색(near) · 31일 이상 기본 · 금융 일정은 날짜와 관계없이 기본', () => {
    expect([0, 7, 8, 30, 31].map((days) => upcomingTone({ management: true, days }))).toEqual(['soon', 'soon', 'near', 'near', 'plain']);
    expect([0, 3, 20].map((days) => upcomingTone({ management: false, days }))).toEqual(['plain', 'plain', 'plain']);
  });

  test('계약 종료(만료) = 관리 일정 · 월 결제·급여 = 금융 일정', () => {
    const end = rec('e', '시설 이용 계약', [], { startDate: '2026-01-01', endDate: '2026-10-25', autoRenewal: false });
    const phone = rec('p', '휴대폰', [pay({ dayOfMonth: 20 })]);
    const salary = rec('s', '급여', [pay({ kind: 'salary', direction: 'income', label: '급여', dayOfMonth: 23 })], { contractType: 'employment', contractKind: 'employment' });
    const up = upcomingSchedule([end, phone, salary], TODAY);
    const by = Object.fromEntries(up.map((u) => [u.contractId, [u.management, upcomingTone(u)]]));
    expect(by).toEqual({ p: [false, 'plain'], s: [false, 'plain'], e: [true, 'near'] }); // 10/25 = D-9
  });
});
