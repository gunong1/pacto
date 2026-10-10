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
    noticeKind: 'termination_notice',
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

test('B·C. 알림 구간에 들어온 일정만: 종료 D-34(만료 알림 90일 전 구간)는 표시, 통보기한 D-54(30일 전 구간 밖)는 아직 없음', () => {
  const ending = record('end', { title: '월세', start: '2025-11-12', end: '2026-11-11' }); // 종료 D-34
  const notice = record('notice', { title: '렌탈', type: 'recurring', start: '2025-12-31', end: '2026-12-31', autoRenewal: true, notice: '30' }); // 통보기한 12/1 (D-54)
  const { items } = importantSchedule([ending, notice], TODAY);
  expect(items.map((i) => [i.item.contractId, i.priority])).toEqual([['end', 'important']]);
  expect(items[0]).toMatchObject({ title: expect.stringContaining('다가와요'), sourceLabel: '입력한 계약 정보 기준', daysLeft: 34 });
  expect(items[0].item.date).toBe('2026-11-11'); // 실제 계약 일정 날짜 (발송 시각 아님)
  // 11/5: 통보기한 D-26 → 구간 진입, critical이 날짜가 더 멀어도 위에
  const later = importantSchedule([ending, notice], '2026-11-05').items;
  expect(later.map((i) => [i.item.contractId, i.priority])).toEqual([
    ['notice', 'critical'],
    ['end', 'important'],
  ]);
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

describe('E. 알림 화면 노출 = Push와 같은 알림 규칙 (먼 미래 일정은 캘린더에서만)', () => {
  // 보험처럼 종료일이 있는 계약 (자동갱신 아님) · 종료 2027-06-22
  const insurance = () => record('ins', { title: '자동차보험', type: 'insurance', start: '2026-06-23', end: '2027-06-22' });
  const shown = (today: string, rules?: Parameters<typeof importantSchedule>[2]) => importantSchedule([insurance()], today, rules).items.filter((i) => i.item.type === 'contract_end');
  const pushDays = (prefs: Parameters<typeof planNotifications>[0]['preferences'], overrides = new Map()) =>
    planNotifications({ userId: 'u', records: [insurance()], preferences: prefs, overrides, now: new Date('2027-03-01T00:00:00Z'), windowDays: 200 })
      .filter((p) => p.eventType === 'contract_end' || p.eventType === 'maturity')
      .map((p) => p.fireOn);

  test('만료 알림 90·30·7일 전 (기본): D-254 표시 안 함 → D-91 안 함 → D-90부터 표시 → D-30·D-7', () => {
    expect(shown('2026-10-11')).toEqual([]); // D-254 (화면 예시)
    expect(shown('2027-03-23')).toEqual([]); // D-91
    expect(shown('2027-03-24').map((i) => i.daysLeft)).toEqual([90]);
    expect(shown('2027-05-23').map((i) => i.daysLeft)).toEqual([30]);
    const d7 = shown('2027-06-15');
    expect(d7.map((i) => i.daysLeft)).toEqual([7]);
    expect(d7[0].title).toContain('다가와요');
    // 캘린더에는 D-254에도 그대로
    expect(scheduleForRange([insurance()], { start: '2027-06-22', end: '2027-06-22' }, '2026-10-11').some((i) => i.type === 'contract_end')).toBe(true);
  });

  test('Push 첫 알림일 = 알림 화면 노출 시작일 (같은 규칙)', () => {
    const first = pushDays(null)[0];
    expect(first).toBe('2027-03-24');
    expect(shown(first)).toHaveLength(1);
    expect(shown('2027-03-23')).toEqual([]);
  });

  test('내 설정을 바꾸면 화면도 같이: 만료 알림 7일 전만 → D-8 안 함 · D-7부터 / 만료 알림 끔 → 표시 안 함 / 전체 끄기 → 발송만 멈춤', () => {
    const only7 = { preferences: { categories: { contract_end: { enabled: true, offsets: [7] } } } } as Parameters<typeof importantSchedule>[2];
    expect(shown('2027-06-14', only7)).toEqual([]);
    expect(shown('2027-06-15', only7)).toHaveLength(1);
    expect(pushDays(only7!.preferences)).toEqual(['2027-06-15']);
    const off = { preferences: { categories: { contract_end: { enabled: false, offsets: [90, 30, 7] } } } } as Parameters<typeof importantSchedule>[2];
    expect(shown('2027-06-20', off)).toEqual([]);
    expect(pushDays(off!.preferences)).toEqual([]);
    // 전체 알림 끄기는 Push 발송만 멈춤 — 알림 화면은 같은 시점 기준으로 계속 표시 (종류별 끄기와 다름)
    expect(shown('2027-06-20', { preferences: { enabled: false } })).toHaveLength(1);
    expect(shown('2026-10-11', { preferences: { enabled: false } })).toEqual([]);
    expect(pushDays({ enabled: false })).toEqual([]);
  });

  test('계약별 알림 설정(180일 전)도 같이 적용', () => {
    const overrides = new Map([['ins', { contract_end: { enabled: true, offsets: [180] } }]]);
    expect(shown('2026-12-23', { preferences: null, overrides })).toEqual([]); // D-181
    expect(shown('2026-12-24', { preferences: null, overrides })).toHaveLength(1); // D-180
  });
});
