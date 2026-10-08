/**
 * 알림 화면 = 중요한 계약 일정(critical·important)만 — 일반 결제·입금은 캘린더와 푸시가 맡는다.
 * A 일반 월세만 → 중요 일정 없음 / 푸시는 예약 / 캘린더에 표시
 * B 계약 종료(important) 표시 · C 해지 통보기한(critical) 상단 · D 7개 → 5개 (critical 먼저, 같은 중요도는 날짜순)
 */
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import { contractFormSchema, draftToForm, formToDraft } from '@/features/contracts/form';

import { importantSchedule } from '../importantSchedule';
import { planNotifications } from '../notifications';
import { scheduleForRange } from '../schedule';
import type { ContractRecord } from '../types';

const TODAY = '2026-10-08';
const NOW = new Date('2026-10-08T00:30:00Z');

function record(id: string, o: { title: string; type?: string; start: string; end: string; autoRenewal?: boolean; notice?: string; rentDay?: string }): ContractRecord {
  const form = {
    ...draftToForm({ ...EMPTY_DRAFT, title: o.title, category: 'real_estate' as never, contractType: (o.type ?? 'lease') as never }),
    startDate: o.start,
    endDate: o.end,
    payments: o.rentDay
      ? [{ kind: 'rent' as never, direction: 'expense' as const, label: '월세', amount: '600,000', frequency: 'monthly' as const, dayOfMonth: o.rentDay, monthOfYear: '', startsOn: '', endsOn: '', installmentCount: '', isVariable: false, components: [], businessDayRule: 'none' as const, obligation: 'confirmed' as const, conditionNote: '' }]
      : [],
    autoRenewal: o.autoRenewal ?? false,
    renewalPeriodMonths: o.autoRenewal ? '12' : '',
    terminationNoticeDays: o.notice ?? '',
  };
  const r = draftToRecord(formToDraft(contractFormSchema.parse(form)), id, TODAY);
  r.contract.source = 'manual';
  return r;
}

test('A. 일반 월세만 있는 계약 → 중요한 계약 일정에는 없음, 푸시는 예약, 캘린더에는 표시', () => {
  const r = record('rent', { title: '월세', start: '2026-01-09', end: '2028-01-08', rentDay: '9' });
  expect(importantSchedule([r], TODAY).items).toEqual([]);
  expect(planNotifications({ userId: 'u', records: [r], preferences: null, overrides: new Map(), now: NOW }).some((p) => p.eventType === 'payment' && p.fireOn === '2026-11-08')).toBe(true);
  expect(scheduleForRange([r], { start: '2026-11-09', end: '2026-11-09' }, TODAY).some((i) => i.type === 'payment')).toBe(true);
});

test('B·C. 계약 종료(important)는 표시, 해지 통보기한(critical)은 날짜가 더 멀어도 위에', () => {
  const ending = record('end', { title: '월세', start: '2025-11-12', end: '2026-11-11' }); // 종료 D-34
  const notice = record('notice', { title: '렌탈', type: 'recurring', start: '2025-12-31', end: '2026-12-31', autoRenewal: true, notice: '30' }); // 통보기한 12/1 (D-54)
  const { items } = importantSchedule([ending, notice], TODAY);
  expect(items.map((i) => [i.item.contractId, i.priority])).toEqual([
    ['notice', 'critical'], // 해지 통보기한 12/1 — 더 멀어도 맨 위
    ['end', 'important'], // 계약 종료 11/11
    ['notice', 'important'], // 같은 렌탈의 자동갱신 예정일 12/31
  ]);
  expect(items[1]).toMatchObject({ title: expect.stringContaining('다가와요'), sourceLabel: '입력한 계약 정보 기준', daysLeft: 34 });
  expect(items[1].item.date).toBe('2026-11-11'); // 실제 계약 일정 날짜 (발송 시각 아님)
});

test('D. 중요 일정 7개 → 최대 5개, critical 먼저 · 같은 중요도는 가까운 날짜순 · total로 나머지 개수', () => {
  const recs = Array.from({ length: 7 }, (_, i) => record(`c${i}`, { title: `계약${i}`, start: '2025-12-01', end: `2026-${String(11 + (i % 2)).padStart(2, '0')}-${String(10 + i).padStart(2, '0')}` }));
  const { items, total } = importantSchedule(recs, TODAY);
  expect(items).toHaveLength(5);
  expect(total).toBeGreaterThanOrEqual(7);
  const dates = items.map((i) => i.item.date);
  expect([...dates].sort()).toEqual(dates);
  expect(items.every((i) => i.priority !== ('normal' as string))).toBe(true);
});
