/**
 * 알림 중요도·출처 — 계약서 기준 / 입력한 계약 정보 기준 / PACTO 안내 / 직접 설정을 섞지 않는다. 법령 기준은 V1에서 만들지 않는다.
 * 중요도(priority)는 AI 신뢰도와 별개. 추정값·PACTO 기본값은 critical로 올리지 않는다.
 */
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import { contractFormSchema, draftToForm, formToDraft } from '@/features/contracts/form';

import { groupCalendarItems } from '../calendarGroups';
import { IMPORTANT_DISPLAY_WINDOW, importantSchedule } from '../importantSchedule';
import { nextAction } from '../nextAction';
import { getNotificationPriority, LEGAL_RULES, NOTIFICATION_SOURCE_LABEL } from '../notificationPriority';
import { groupReminders } from '../reminderGroups';
import { upcomingReminders } from '../reminders';
import { scheduleForRange } from '../schedule';
import type { AiCheck, ContractRecord } from '../types';

const TODAY = '2026-10-07';
type Pay = { kind: string; direction: 'expense' | 'income' | 'neutral'; label: string; amount: string; frequency: 'monthly' | 'one_time'; dayOfMonth?: string; startsOn?: string };

function record(id: string, o: { title: string; category: string; contractType: string; startDate: string; endDate: string; payments: Pay[]; autoRenewal?: boolean; notice?: string }): ContractRecord {
  const form = {
    ...draftToForm({ ...EMPTY_DRAFT, title: o.title, category: o.category as never, contractType: o.contractType as never }),
    startDate: o.startDate,
    endDate: o.endDate,
    payments: o.payments.map((p) => ({
      kind: p.kind as never, direction: p.direction, label: p.label, amount: p.amount, frequency: p.frequency, dayOfMonth: p.dayOfMonth ?? '', monthOfYear: '',
      startsOn: p.startsOn ?? '', endsOn: '', installmentCount: '', isVariable: false, components: [], businessDayRule: 'none' as const, obligation: 'confirmed' as const, conditionNote: '',
    })),
    autoRenewal: o.autoRenewal ?? false,
    renewalPeriodMonths: o.autoRenewal ? '12' : '',
    terminationNoticeDays: o.notice ?? '',
    noticeKind: 'termination_notice',
  };
  return draftToRecord(formToDraft(contractFormSchema.parse(form)), id, TODAY);
}

const RENT: Pay = { kind: 'recurring_fee', direction: 'expense', label: '월 렌탈료', amount: '29,900', frequency: 'monthly', dayOfMonth: '12' };
const SETUP: Pay = { kind: 'setup_fee', direction: 'expense', label: '설치비', amount: '20,000', frequency: 'one_time', startsOn: '2026-10-12' };
const RENEWAL_CHECK: AiCheck = {
  id: 'chk-renew', contractId: 'c-air', severity: 'caution', topic: 'auto_renewal', title: '자동갱신', description: '자동갱신 조건이 있습니다.',
  confidence: 'high', evidenceQuote: '계약 종료 30일 전까지 해지 의사를 표시하지 않으면 동일 조건으로 12개월 자동 연장됩니다.', evidencePage: 2,
  evidenceDocumentId: 'doc-1', suggestion: null, status: 'new',
};

/** 렌탈 — 업로드(PDF) 또는 직접 입력 */
function rental(source: 'upload' | 'manual', opts: { inferredEnd?: boolean } = {}) {
  const r = record('c-air', { title: '가정용 공기청정기 렌탈계약서', category: 'rental', contractType: 'recurring', startDate: '2026-10-12', endDate: '2029-10-11', payments: [RENT, SETUP], autoRenewal: true, notice: '30' });
  r.contract.source = source;
  if (source === 'upload') r.aiChecks = [RENEWAL_CHECK];
  if (opts.inferredEnd) r.contract.valueSources = { ...r.contract.valueSources, endDate: 'inferred' };
  return r;
}

/** 임대차 — 월세·보증금, 만기 2027-08-20, 계약서상 종료 통보 60일 전 (직접 입력) */
function lease() {
  return record('c-lease', {
    title: '주택 임대차계약', category: 'real_estate', contractType: 'lease', startDate: '2025-08-21', endDate: '2027-08-20', notice: '60',
    payments: [{ kind: 'rent', direction: 'expense', label: '월세', amount: '850,000', frequency: 'monthly', dayOfMonth: '20' }],
  });
}

const at = (r: ContractRecord, date: string) => scheduleForRange([r], { start: date, end: date }, TODAY);
const notice = (r: ContractRecord, today = '2029-08-01') => upcomingReminders([r], today, 60).filter((x) => x.kind === 'termination_notice');

describe('출처 구분 (UI 문구 · 데이터)', () => {
  test('문구 5종', () => {
    expect(NOTIFICATION_SOURCE_LABEL).toEqual({ contract: '계약서 기준', manual_entry: '입력한 계약 정보 기준', legal: '법령 기준', pacto: 'PACTO 안내', user_custom: '직접 설정' });
  });

  test('PDF 계약서에서 추출한 통보기한 → 계약서 기준 · critical · 관련 조항 근거 연결', () => {
    const r = rental('upload');
    const [item] = at(r, '2029-09-11').filter((i) => i.type === 'termination_notice');
    expect(item).toMatchObject({ source: 'contract', priority: 'critical', actionType: 'termination_notice', needsReview: false });
    const rs = notice(r);
    expect(rs.every((x) => x.source === 'contract' && x.priority === 'critical')).toBe(true);
    expect(rs[0].evidence).toMatchObject({ documentId: 'doc-1', page: 2, checkId: 'chk-renew' });
    const imp = importantSchedule([r], '2029-01-01').items.find((x) => x.item.type === 'termination_notice')!;
    expect(imp).toMatchObject({ sourceLabel: '계약서 기준', title: '해지 통보기한이 다가와요', badge: '중요', priority: 'critical' });
    expect(imp.evidence?.quote).toContain('30일 전까지 해지 의사');
  });

  test('직접 입력한 통보기한 → 입력한 계약 정보 기준 · 중요도는 낮추지 않음(critical) · 근거 없음', () => {
    const r = rental('manual');
    const [item] = at(r, '2029-09-11').filter((i) => i.type === 'termination_notice');
    expect(item).toMatchObject({ source: 'manual_entry', priority: 'critical' });
    expect(notice(r).every((x) => x.source === 'manual_entry' && x.evidence === null)).toBe(true);
    const imp = importantSchedule([r], '2029-01-01').items.find((x) => x.item.type === 'termination_notice')!;
    expect(imp.sourceLabel).toBe('입력한 계약 정보 기준');
    expect(nextAction(r, '2029-09-01')!.guidance).toMatch(/^입력한 계약 정보에 따라 /);
    expect(nextAction(r, '2029-09-01')!.guidance).not.toContain('계약서');
    expect(nextAction(rental('upload'), '2029-09-01')!.guidance).toMatch(/^계약서에 따라 /);
  });

  test('PACTO 기본 60일 사전 안내(임대차 갱신 여부 확인) → PACTO 안내 · critical로 올리지 않음 · 계약서·법령 기한 아님을 표시', () => {
    // 직접 입력한 임대차는 통보기한이 있으면 그 기한, 없으면 PACTO 기본 안내 — 여기서는 통보일수 없이 확인
    const r = record('c-lease2', { title: '주택 임대차계약', category: 'real_estate', contractType: 'lease', startDate: '2025-08-21', endDate: '2027-08-20', payments: [] });
    const [prep] = at(r, '2027-06-21').filter((i) => i.type === 'prepare');
    expect(prep).toMatchObject({ source: 'pacto', priority: 'important', actionType: 'prepare', title: '갱신 여부 확인' });
    const imp = importantSchedule([r], '2027-01-01').items.find((x) => x.item.type === 'prepare')!;
    expect(imp).toMatchObject({ sourceLabel: 'PACTO 안내', priority: 'important', badge: '확인' });
    expect(imp.policyNote).toBe('계약서나 법령에 정해진 기한이 아니라, 만기 60일 전에 PACTO가 미리 알려드리는 안내예요.');
    expect(nextAction(r, '2027-06-01')!.guidance).toContain('PACTO 안내 — 계약서나 법령에 정해진 기한은 아니에요');
    const [g] = groupCalendarItems(at(r, '2027-06-21'));
    expect(g.primary).toMatchObject({ label: '갱신 여부 확인', sourceLabel: 'PACTO 안내', priority: 'important' });
    // PACTO 기본값으로는 critical을 만들 수 없다
    expect(getNotificationPriority('termination_notice', { source: 'pacto' })).toBe('important');
  });

  test('캘린더: PACTO 안내가 통보기한과 같은 날 보조 줄로 들어가도 출처 표시 유지', () => {
    const [g] = groupCalendarItems(at(lease(), '2027-06-21'));
    expect(g.primary).toMatchObject({ label: '종료 통보기한', sourceLabel: '입력한 계약 정보 기준', priority: 'critical' });
    expect(g.secondaryLabels).toEqual(['갱신 여부 확인 (PACTO 안내)']);
  });

  test('사용자가 만든 커스텀 일정 → 직접 설정', () => {
    const r = rental('manual');
    r.events = [{ id: 'ev1', contractId: 'c-air', eventType: 'custom', title: '필터 교체 문의', eventDate: '2026-11-03', amount: null, source: 'user', notificationEnabled: true, completedAt: null } as never];
    const [item] = at(r, '2026-11-03');
    expect(item).toMatchObject({ source: 'user_custom', priority: 'normal' });
    expect(NOTIFICATION_SOURCE_LABEL[item.source]).toBe('직접 설정');
  });

  test('법령 기반 알림은 V1에서 생성되지 않음 (규칙 없음, 어떤 일정·알림에도 legal 없음)', () => {
    expect(LEGAL_RULES).toEqual([]);
    const records = [rental('upload'), rental('manual'), lease()];
    const items = records.flatMap((r) => scheduleForRange([r], { start: '2025-01-01', end: '2031-12-31' }, TODAY));
    const reminders = records.flatMap((r) => [...upcomingReminders([r], TODAY, 2000), ...upcomingReminders([r], '2029-08-01', 60)]);
    expect(items.length).toBeGreaterThan(0);
    expect([...items, ...reminders].some((x) => x.source === 'legal')).toBe(false);
  });
});

describe('중요도', () => {
  test('렌탈(§22): 렌탈료·설치비 normal · 종료 important · 해지 통보기한 critical', () => {
    const r = rental('upload');
    const types = Object.fromEntries(scheduleForRange([r], { start: '2026-10-01', end: '2029-12-31' }, TODAY).map((i) => [i.title, i.priority]));
    expect(types['월 렌탈료']).toBe('normal');
    expect(types['설치비']).toBe('normal');
    expect(types['이용 종료 (자동갱신 조건)']).toBe('important');
    expect(types['해지 통보기한']).toBe('critical');
  });

  test('임대차(§21): 월세 normal · 만기 important · 계약상 종료 통보기한 critical · 법령 기한은 만들지 않음', () => {
    const r = lease();
    const items = scheduleForRange([r], { start: TODAY, end: '2027-12-31' }, TODAY);
    expect(items.find((i) => i.title === '월세')!.priority).toBe('normal');
    expect(items.find((i) => i.type === 'contract_end')).toMatchObject({ priority: 'important', actionType: 'maturity' });
    expect(items.find((i) => i.type === 'termination_notice')).toMatchObject({ priority: 'critical', date: '2027-06-21', source: 'manual_entry' });
    expect(items.some((i) => i.source === 'legal')).toBe(false);
  });

  test('AI 추정 종료일에서 나온 통보기한 → critical 아님(important + 확인 필요)', () => {
    const r = rental('upload', { inferredEnd: true });
    const [item] = at(r, '2029-09-11').filter((i) => i.type === 'termination_notice');
    expect(item).toMatchObject({ priority: 'important', needsReview: true });
    const imp = importantSchedule([r], '2029-01-01').items.find((x) => x.item.type === 'termination_notice')!;
    expect(imp.badge).toBe('확인 필요');
  });
});

describe('통보기한 사전 알림 (PACTO 알림 정책 30·7·1·0일 전 — 기한 자체는 그대로)', () => {
  test('기한 2029-09-11 하나에서 알림 4개, 단계별 문구, 기한 날짜(targetDate)는 모두 같음', () => {
    const rs = upcomingReminders([rental('upload')], '2029-08-01', 60).filter((x) => x.kind === 'termination_notice');
    expect(rs.map((x) => [x.fireOn, x.targetDate, x.daysBefore])).toEqual([
      ['2029-08-12', '2029-09-11', 30],
      ['2029-09-04', '2029-09-11', 7],
      ['2029-09-10', '2029-09-11', 1],
      ['2029-09-11', '2029-09-11', 0],
    ]);
    expect(rs.map((x) => x.message)).toEqual([
      '해지 통보기한까지 30일 남았어요. 해지·갱신 여부를 미리 확인해보세요.',
      '해지 통보기한이 7일 남았어요.',
      '내일이 해지 통보기한이에요. 갱신을 원하지 않으면 미리 의사를 알려주세요.',
      '오늘이 해지 통보기한입니다. 갱신을 원하지 않으면 오늘까지 의사를 알려주세요.',
    ]);
  });

  test('카드: 날짜 출처(계약서 기준)와 실제 기한 날짜 — 언제 알려줄지(사용자 설정)는 카드에 적지 않음', () => {
    const imp = importantSchedule([rental('upload')], '2029-09-05').items.find((x) => x.item.type === 'termination_notice')!;
    expect(imp.sourceLabel).toBe('계약서 기준');
    expect(imp.item.date).toBe('2029-09-11');
    expect(imp.policyNote).toBeNull();
    expect(imp.badge).toBe('기한 임박');
  });

  test('알림 묶음: 통보기한 알림은 중요 표시 + 날짜 출처, 결제만 있는 알림은 출처 문구 없음', () => {
    const groups = groupReminders(upcomingReminders([rental('upload')], '2029-08-01', 60));
    const n = groups.find((g) => g.fireOn === '2029-09-04')!;
    expect(n).toMatchObject({ priority: 'critical', sourceLabel: '계약서 기준', title: '가정용 공기청정기 렌탈계약서 · 해지 통보기한' });
    const pay = groups.find((g) => g.kind === 'payment')!;
    expect(pay).toMatchObject({ priority: 'normal', sourceLabel: null });
  });
});

describe('중요한 계약 일정 조회 (화면 표시 범위 12개월 · 5개)', () => {
  test('12개월 밖 중요 일정은 화면에 없지만 일정 계산에는 그대로 있음', () => {
    const r = rental('upload');
    expect(IMPORTANT_DISPLAY_WINDOW).toEqual({ months: 12, limit: 5 });
    expect(importantSchedule([r], TODAY).items).toEqual([]); // 2029년 기한 → 지금은 표시 범위 밖
    expect(scheduleForRange([r], { start: '2029-09-11', end: '2029-09-11' }, TODAY).some((i) => i.priority === 'critical')).toBe(true);
  });

  test('최대 5개, critical 먼저, 남은 개수(total) 제공', () => {
    const many = Array.from({ length: 7 }, (_, k) => {
      const r = record(`c-${k}`, { title: `렌탈 ${k}`, category: 'rental', contractType: 'recurring', startDate: '2025-01-01', endDate: `2027-0${(k % 7) + 1}-15`, payments: [], autoRenewal: true, notice: '30' });
      return r;
    });
    const { items, total } = importantSchedule(many, TODAY);
    expect(items).toHaveLength(5);
    expect(total).toBeGreaterThan(5);
    const firstImportant = items.findIndex((x) => x.priority === 'important');
    expect(firstImportant === -1 || items.slice(firstImportant).every((x) => x.priority === 'important')).toBe(true);
  });
});
