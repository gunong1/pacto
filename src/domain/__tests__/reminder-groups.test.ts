/**
 * 알림 묶기 — 같은 계약 + 같은 알림 날짜는 알림 하나, 반복 결제 알림은 가장 가까운 것만 펼침
 * 기준 계약(사용자 원본 조건): 시작·설치 2026-10-12, 매월 12일 29,900원, 설치비 20,000원 1회, 종료 2029-10-11, 해지 통보 종료 30일 전
 */
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import { contractFormSchema, draftToForm, formToDraft } from '@/features/contracts/form';

import { groupReminders, reminderDigest } from '../reminderGroups';
import { upcomingReminders } from '../reminders';
import type { ContractRecord } from '../types';

const TODAY = '2026-10-07';

type Pay = { kind: string; direction: 'expense' | 'income'; label: string; amount: string; frequency: 'monthly' | 'one_time'; dayOfMonth?: string; startsOn?: string };
function record(id: string, o: { title: string; category?: string; contractType?: string; startDate?: string; endDate?: string; payments: Pay[]; autoRenewal?: boolean; notice?: string }): ContractRecord {
  const form = {
    ...draftToForm({ ...EMPTY_DRAFT, title: o.title, category: (o.category ?? 'rental') as never, contractType: (o.contractType ?? 'recurring') as never }),
    startDate: o.startDate ?? '2026-10-12',
    endDate: o.endDate ?? '2029-10-11',
    payments: o.payments.map((p) => ({
      kind: p.kind as never, direction: p.direction, label: p.label, amount: p.amount, frequency: p.frequency, dayOfMonth: p.dayOfMonth ?? '', monthOfYear: '',
      startsOn: p.startsOn ?? '', endsOn: '', installmentCount: '', isVariable: false, components: [], businessDayRule: 'none' as const, obligation: 'confirmed' as const, conditionNote: '',
    })),
    dates: [{ kind: 'installation', label: '설치일', date: '2026-10-12' }] as never,
    autoRenewal: o.autoRenewal ?? false,
    renewalPeriodMonths: o.autoRenewal ? '12' : '',
    terminationNoticeDays: o.notice ?? '',
  };
  return draftToRecord(formToDraft(contractFormSchema.parse(form)), id, TODAY);
}

const RENT: Pay = { kind: 'recurring_fee', direction: 'expense', label: '월 렌탈료', amount: '29,900', frequency: 'monthly', dayOfMonth: '12' };
const SETUP: Pay = { kind: 'setup_fee', direction: 'expense', label: '설치비', amount: '20,000', frequency: 'one_time', startsOn: '2026-10-12' };
const rental = (autoRenewal: boolean) => record('c-air', { title: '가정용 공기청정기 렌탈계약서', payments: [RENT, SETUP], autoRenewal, notice: '30' });

describe('현재 데이터 점검 (원본 조건 그대로)', () => {
  for (const autoRenewal of [true, false]) {
    test(`자동갱신 ${autoRenewal ? '있음' : '없음'}: 60일 안 원본 알림 = 10/11 렌탈료·설치비, 11/11 렌탈료 — 알림 날짜(fireOn)와 결제일(targetDate) 분리, 해지 통보기한 없음`, () => {
      const rs = upcomingReminders([rental(autoRenewal)], TODAY, 60);
      expect(rs.map((r) => [r.kind, r.fireOn, r.targetDate, r.label, r.amount])).toEqual([
        ['payment', '2026-10-11', '2026-10-12', '월 렌탈료', 29_900],
        ['payment', '2026-10-11', '2026-10-12', '설치비', 20_000],
        ['payment', '2026-11-11', '2026-11-12', '월 렌탈료', 29_900],
      ]);
      expect(rs.some((r) => r.kind === 'termination_notice')).toBe(false);
    });
  }

  test('해지 통보기한 알림은 2029년 종료 기준 (2029-09-11 기한 → 7일 전·전날·당일)', () => {
    const rs = upcomingReminders([rental(true)], '2029-08-20', 60).filter((r) => r.kind === 'termination_notice');
    expect(rs.map((r) => [r.fireOn, r.targetDate])).toEqual([
      ['2029-09-04', '2029-09-11'],
      ['2029-09-10', '2029-09-11'],
      ['2029-09-11', '2029-09-11'],
    ]);
  });
});

describe('알림 묶기', () => {
  test('같은 날 결제 알림 2건 → 알림 1개: "내일 49,900원 결제 예정이에요." + 세부 내역 + 실제 결제일', () => {
    const groups = groupReminders(upcomingReminders([rental(false)], TODAY, 60));
    expect(groups).toHaveLength(2); // 10/11 (합침), 11/11
    expect(groups[0]).toMatchObject({
      fireOn: '2026-10-11',
      title: '가정용 공기청정기 렌탈계약서 · 결제',
      message: '내일 49,900원 결제 예정이에요.',
      detail: '월 렌탈료 29,900원 · 설치비 20,000원',
      eventLines: ['10월 12일 월 렌탈료 · 설치비 결제'],
    });
    expect(groups[0].reminders).toHaveLength(2); // 원본은 그대로
    expect(groups[1]).toMatchObject({ fireOn: '2026-11-11', message: '내일 29,900원 결제 예정이에요.', detail: '월 렌탈료', eventLines: ['11월 12일 월 렌탈료 결제'] });
  });

  test('화면: 반복 결제 알림은 가장 가까운 것만, 이후는 "이후 매월 11일 알림 예정"', () => {
    const items = reminderDigest(groupReminders(upcomingReminders([rental(false)], TODAY, 60)));
    expect(items).toHaveLength(1);
    expect(items[0].group.fireOn).toBe('2026-10-11');
    expect(items[0].followUp).toMatchObject({ count: 1, text: '이후 매월 11일 알림 예정' });
  });

  test('다른 계약은 같은 날이어도 따로', () => {
    const other = record('c-water', { title: '정수기 렌탈', payments: [{ ...RENT, label: '월 렌탈료', amount: '32,000' }] });
    const groups = groupReminders(upcomingReminders([rental(false), other], TODAY, 60)).filter((g) => g.fireOn === '2026-10-11');
    expect(groups.map((g) => g.contractId).sort()).toEqual(['c-air', 'c-water']);
  });

  test('해지 통보기한 + 자동갱신 30일 전 + 결제가 같은 날 → 알림 1개, 통보기한이 대표, 나머지는 함께 표시, 줄이지 않음', () => {
    // 2029-09-11: 통보기한 당일 = 갱신(10/11) 30일 전 = 9/12 결제 전날
    const groups = groupReminders(upcomingReminders([rental(true)], '2029-08-20', 60));
    const g = groups.find((x) => x.fireOn === '2029-09-11')!;
    expect(g.kind).toBe('termination_notice');
    expect(g.title).toBe('가정용 공기청정기 렌탈계약서 · 해지 통보기한');
    expect(g.reminders).toHaveLength(3);
    expect(g.detail).toBe('자동갱신 예정일까지 30일 남았습니다.\n내일 29,900원 결제 예정 · 월 렌탈료');
    expect(g.eventLines).toEqual(['9월 11일 해지 통보기한', '10월 11일 자동갱신 예정일', '9월 12일 월 렌탈료 결제']);
    const digest = reminderDigest(groups);
    expect(digest.filter((i) => i.group.kind === 'termination_notice')).toHaveLength(3);
  });

  test('수입은 "입금 예정" (결제와 섞지 않음)', () => {
    const job = record('c-job', { title: '근로계약서', category: 'employment', contractType: 'employment', startDate: '2026-10-01', endDate: '2027-09-30', payments: [{ kind: 'salary', direction: 'income', label: '급여', amount: '3,600,000', frequency: 'monthly', dayOfMonth: '25' }] });
    const g = groupReminders(upcomingReminders([job], TODAY, 60))[0];
    expect(g.message).toBe('내일 +3,600,000원 입금 예정이에요.');
    expect(g.eventLines).toEqual(['10월 25일 급여 입금']);
  });
});
