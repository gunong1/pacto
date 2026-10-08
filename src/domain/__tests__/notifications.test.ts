/**
 * 실제 푸시 알림 계획 — 설정 병합(PACTO 기본 → 사용자 → 계약별), 시간대·알림 시각, 같은 계약·같은 시각 묶기,
 * 대표 문구(critical 우선), 미리보기(기본 간단히), 중복 방지 키, 출처(계약서/입력/PACTO), 법령 알림 없음.
 */
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import { contractFormSchema, draftToForm, formToDraft } from '@/features/contracts/form';

import {
  formatSendTime,
  getEffectiveNotificationPreferences,
  isPactoDefault,
  localDateIn,
  needsCriticalOffConfirm,
  PACTO_DEFAULT_CATEGORIES,
  planNotifications,
  zonedTimeToUtc,
  type PlanInput,
} from '../notifications';
import { LEGAL_RULES } from '../notificationPriority';
import { reminderPolicySummary } from '../reminders';
import { effectiveRulesSummary } from '../notifications';
import type { AiCheck, ContractRecord } from '../types';

const TODAY = '2026-10-08';
const NOW = new Date('2026-10-08T00:30:00Z'); // 한국 시간 10/8 09:30
type Pay = { kind: string; direction: 'expense' | 'income' | 'neutral'; label: string; amount: string; frequency: 'monthly' | 'one_time'; dayOfMonth?: string; startsOn?: string };

function record(id: string, o: { title: string; category: string; contractType: string; startDate: string; endDate: string; payments: Pay[]; autoRenewal?: boolean; notice?: string; source?: 'upload' | 'manual' }): ContractRecord {
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
  const r = draftToRecord(formToDraft(contractFormSchema.parse(form)), id, TODAY);
  r.contract.source = o.source ?? 'manual';
  return r;
}

/** 주택 월세: 월세 850,000 + 관리비 100,000 매월 20일 */
const lease = (id = 'c-lease', day = '20') =>
  record(id, {
    title: '주택 임대차계약', category: 'real_estate', contractType: 'lease', startDate: '2026-10-20', endDate: '2028-10-19', notice: '60',
    payments: [
      { kind: 'rent', direction: 'expense', label: '월세', amount: '850,000', frequency: 'monthly', dayOfMonth: day },
      { kind: 'maintenance_fee', direction: 'expense', label: '관리비', amount: '100,000', frequency: 'monthly', dayOfMonth: day },
    ],
  });

const RENEWAL_CHECK: AiCheck = {
  id: 'chk-renew', contractId: 'c-air', severity: 'caution', topic: 'auto_renewal', title: '자동갱신', description: '자동갱신 조건이 있습니다.',
  confidence: 'high', evidenceQuote: '계약 종료 30일 전까지 해지 의사를 표시하지 않으면 자동 연장됩니다.', evidencePage: 2, evidenceDocumentId: 'doc-1', suggestion: null, status: 'new',
};
/** 렌탈: 월 렌탈료 매월 12일, 종료 2026-11-11 · 자동갱신 · 해지 통보 30일 전(10/12) → 10/12에 통보기한 + 결제가 겹침 */
const rental = (source: 'upload' | 'manual' = 'upload') => {
  const r = record('c-air', {
    title: '공기청정기 렌탈', category: 'rental', contractType: 'recurring', startDate: '2025-11-12', endDate: '2026-11-11', autoRenewal: true, notice: '30', source,
    payments: [{ kind: 'recurring_fee', direction: 'expense', label: '월 렌탈료', amount: '29,900', frequency: 'monthly', dayOfMonth: '12' }],
  });
  if (source === 'upload') r.aiChecks = [RENEWAL_CHECK];
  return r;
};

const plan = (records: ContractRecord[], over: Partial<PlanInput> = {}) =>
  planNotifications({ userId: 'u1', records, preferences: null, overrides: new Map(), now: NOW, ...over });

describe('A. 같은 계약·같은 날 결제 → 푸시 1개', () => {
  test('월세 850,000 + 관리비 100,000 (20일) → 19일 오전 9시 1개, 950,000원', () => {
    const ps = plan([lease()]);
    const pay = ps.filter((p) => p.fireOn === '2026-10-19');
    expect(pay).toHaveLength(1);
    expect(pay[0].scheduledAt).toBe('2026-10-19T00:00:00.000Z'); // 한국 시간 09:00
    expect(pay[0].priority).toBe('normal');
    expect(pay[0].display.message).toBe('내일 950,000원 결제 예정이에요.');
    expect(pay[0].display.detail).toBe('월세 850,000원 · 관리비 100,000원');
  });

  test('미리보기 기본 꺼짐: 잠금화면 문구에 계약명·금액 없음', () => {
    const p = plan([lease()]).find((x) => x.fireOn === '2026-10-19')!;
    expect(p.push).toEqual({ title: 'PACTO', body: '확인할 계약 일정이 있어요.' });
    expect(JSON.stringify(p.push)).not.toMatch(/950|임대차|월세/);
  });

  test('"알림에 계약 상세 표시"를 켠 사용자만 상세 문구', () => {
    const p = plan([lease()], { preferences: { showDetails: true } }).find((x) => x.fireOn === '2026-10-19')!;
    expect(p.push).toEqual({ title: '주택 임대차계약', body: '내일 950,000원 결제 예정이에요.\n월세 850,000원 · 관리비 100,000원' });
  });

  test('반복 결제는 35일 안의 것만 (몇 년치를 만들지 않음)', () => {
    const ps = plan([lease()]).filter((p) => p.eventType === 'payment');
    expect(ps.map((p) => p.fireOn)).toEqual(['2026-10-19']);
    expect(plan([lease()], { now: new Date('2026-11-01T00:00:00Z') }).filter((p) => p.eventType === 'payment').map((p) => p.fireOn)).toEqual(['2026-11-19']);
  });
});

describe('B. 결제 + 해지 통보기한이 같은 날 → 푸시 1개, critical이 대표', () => {
  test('10/11 알림: 통보기한(10/12) 1일 전 + 렌탈료(10/12) 1일 전 → 1개', () => {
    const ps = plan([rental()], { preferences: { showDetails: true } }).filter((p) => p.fireOn === '2026-10-11');
    expect(ps).toHaveLength(1);
    expect(ps[0].priority).toBe('critical');
    expect(ps[0].eventType).toBe('termination_notice');
    expect(ps[0].push.title).toBe('공기청정기 렌탈 · 내일이 해지 통보기한이에요.');
    expect(ps[0].push.body).toBe('월 렌탈료 29,900원 결제도 예정되어 있어요.');
  });
  test('간단 표시에서도 critical은 "기한"으로 구분 (계약명·금액 없음)', () => {
    const p = plan([rental()]).find((x) => x.fireOn === '2026-10-11')!;
    expect(p.push).toEqual({ title: 'PACTO', body: '확인할 계약 기한이 있어요.' });
  });
  test('critical 7일 전 문구 + 확인 권유 (판단하지 않음)', () => {
    const p = plan([rental()], { preferences: { showDetails: true }, now: new Date('2026-09-30T00:00:00Z') }).find((x) => x.fireOn === '2026-10-05')!;
    expect(p.push.title).toBe('공기청정기 렌탈 · 해지 통보기한까지 7일 남았어요.');
    expect(p.push.body).toBe('계약을 끝내려면 계약 내용을 확인해보세요.');
  });
  test('Deep Link: 계약 상세 + 관련 계약 체크', () => {
    const p = plan([rental()]).find((x) => x.fireOn === '2026-10-11')!;
    expect(p.data).toMatchObject({ contractId: 'c-air', eventType: 'termination_notice', checkId: 'chk-renew' });
    expect(p.data.url).toBe('/contract/c-air?from=push&event=termination_notice&check=chk-renew');
  });
});

describe('C·D. 설정 병합: PACTO 기본 → 사용자 → 계약별', () => {
  test('C. 결제 알림 1일 전 → 3일 전 + 당일: 다른 발송 시각·다른 키', () => {
    const before = plan([lease()]).filter((p) => p.eventType === 'payment');
    const after = plan([lease()], { preferences: { categories: { payment: { enabled: true, offsets: [3, 0] } } } }).filter((p) => p.eventType === 'payment');
    expect(before.map((p) => p.fireOn)).toEqual(['2026-10-19']);
    expect(after.map((p) => p.fireOn)).toEqual(['2026-10-17', '2026-10-20']);
    expect(after.map((p) => p.display.message)).toEqual(['3일 뒤 950,000원 결제 예정이에요.', '오늘 950,000원 결제 예정이에요.']);
    expect(after.some((a) => before.some((b) => b.dedupeKey === a.dedupeKey))).toBe(false);
  });

  test('D. 특정 계약만 override — 다른 계약은 사용자 기본값', () => {
    const prefs = { categories: { payment: { enabled: true, offsets: [1] } } };
    const ps = plan([lease('a'), lease('b')], { preferences: prefs, overrides: new Map([['b', { payment: { enabled: true, offsets: [7] } }]]) });
    expect(ps.filter((p) => p.contractId === 'a').map((p) => p.fireOn)).toEqual(['2026-10-19']);
    expect(ps.filter((p) => p.contractId === 'b').map((p) => p.fireOn)).toEqual(['2026-10-13']);
    const eff = getEffectiveNotificationPreferences(prefs, { contract_end: { enabled: true, offsets: [180, 90, 30] } });
    expect(eff.categories.contract_end.offsets).toEqual([180, 90, 30]);
    expect(eff.origin).toEqual({ payment: 'user', termination_notice: 'pacto', renewal_notice: 'pacto', renewal_decision: 'pacto', contract_end: 'contract', renewal: 'pacto' });
  });

  test('종류를 끄면 그 종류 알림 없음 / 전체를 끄면 아무 알림 없음 / 계약별 알림 끔', () => {
    expect(plan([lease()], { preferences: { categories: { payment: { enabled: false, offsets: [1] } } } }).filter((p) => p.eventType === 'payment')).toHaveLength(0);
    expect(plan([lease()], { preferences: { enabled: false } })).toHaveLength(0);
    const off = lease();
    off.contract.notificationsEnabled = false;
    expect(plan([off])).toHaveLength(0);
  });

  test('PACTO 기본값 = 결제 1일 전 · 통보기한 30·7·1·당일 · 만료 90·30·7 · 자동갱신 30·7', () => {
    expect(PACTO_DEFAULT_CATEGORIES).toEqual({
      payment: { enabled: true, offsets: [1] },
      termination_notice: { enabled: true, offsets: [30, 7, 1, 0] },
      renewal_notice: { enabled: true, offsets: [30, 7, 1, 0] },
      renewal_decision: { enabled: true, offsets: [30, 7] },
      contract_end: { enabled: true, offsets: [90, 30, 7] },
      renewal: { enabled: true, offsets: [30, 7] },
    });
    expect(isPactoDefault({})).toBe(true);
    expect(isPactoDefault({ payment: { enabled: true, offsets: [3] } })).toBe(false);
    expect(reminderPolicySummary(effectiveRulesSummary({ categories: { payment: { enabled: true, offsets: [3, 0] }, renewal: { enabled: false, offsets: [30] } } }))).toEqual([
      { label: '결제·입금', when: '3일 전과 당일' },
      { label: '해지·갱신 통보기한', when: '30·7·1일 전과 당일' },
      { label: '갱신 여부 확인', when: '30·7일 전' },
      { label: '계약 만료', when: '90·30·7일 전' },
      { label: '자동갱신 예정일', when: '꺼짐' },
    ]);
  });

  test('저장값이 이상하면 버리고 기본값 (허용되지 않은 며칠 전, 형식 오류)', () => {
    const eff = getEffectiveNotificationPreferences({ timeOfDay: '25:00', timezone: 'Mars/Base', categories: { payment: { enabled: true, offsets: [1, 2, 999] } } as never });
    expect(eff.timeOfDay).toBe('09:00');
    expect(eff.timezone).toBe('Asia/Seoul');
    expect(eff.categories.payment.offsets).toEqual([1]);
  });
});

describe('E. 계약 날짜 변경 → 새 날짜 기준 (기존 알림 키와 다름)', () => {
  test('월세 지급일 20일 → 25일: 19일 알림 대신 24일 알림', () => {
    const before = plan([lease('c', '20')]).filter((p) => p.eventType === 'payment');
    const after = plan([lease('c', '25')]).filter((p) => p.eventType === 'payment');
    expect(before.map((p) => p.fireOn)).toEqual(['2026-10-19']);
    expect(after.map((p) => p.fireOn)).toEqual(['2026-10-24']);
    expect(after[0].dedupeKey).not.toBe(before[0].dedupeKey);
  });
  test('같은 입력이면 항상 같은 키 (두 번 계산해도 중복 없음)', () => {
    expect(plan([lease()]).map((p) => p.dedupeKey)).toEqual(plan([lease()]).map((p) => p.dedupeKey));
  });
});

describe('시간대 · 알림 받는 시간', () => {
  test('알림 기준 시간대(기본 Asia/Seoul)와 시각으로 UTC 계산 — 기기 시간대와 무관', () => {
    expect(zonedTimeToUtc('2026-10-19', '09:00', 'Asia/Seoul').toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(zonedTimeToUtc('2026-07-01', '09:00', 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z'); // 서머타임
    expect(zonedTimeToUtc('2026-12-01', '09:00', 'America/New_York').toISOString()).toBe('2026-12-01T14:00:00.000Z');
    expect(localDateIn(new Date('2026-10-07T16:00:00Z'), 'Asia/Seoul')).toBe('2026-10-08');
    const p = plan([lease()], { preferences: { timeOfDay: '20:30', timezone: 'America/New_York' } }).find((x) => x.eventType === 'payment')!;
    expect(p.scheduledAt).toBe('2026-10-20T00:30:00.000Z');
    expect(formatSendTime(p.scheduledAt, 'America/New_York')).toBe('10월 19일 오후 8:30');
    expect(formatSendTime('2026-10-19T00:00:00.000Z', 'Asia/Seoul')).toBe('10월 19일 오전 9:00');
  });
  test('오늘 알림이라도 발송 시각이 이미 지났으면 만들지 않음 (늦게 보내지 않음)', () => {
    const late = plan([lease()], { now: new Date('2026-10-19T01:00:00Z') });
    expect(late.some((p) => p.fireOn === '2026-10-19')).toBe(false);
  });
});

describe('K. 중요 알림 끄기 확인', () => {
  test('해지 통보기한을 끄거나 시점을 모두 빼면 확인 / 결제는 확인 없이', () => {
    expect(needsCriticalOffConfirm('termination_notice', { enabled: false, offsets: [30] })).toBe(true);
    expect(needsCriticalOffConfirm('termination_notice', { enabled: true, offsets: [] })).toBe(true);
    expect(needsCriticalOffConfirm('termination_notice', { enabled: true, offsets: [7] })).toBe(false);
    expect(needsCriticalOffConfirm('payment', { enabled: false, offsets: [1] })).toBe(false);
  });
  test('확인 후 끄면 그대로 꺼짐 (다시 켜지 않음)', () => {
    const ps = plan([rental()], { preferences: { categories: { termination_notice: { enabled: false, offsets: [30, 7, 1, 0] } } } });
    expect(ps.some((p) => p.eventType === 'termination_notice')).toBe(false);
  });
});

describe('L·M·N·O. 출처', () => {
  test('L. 직접 입력 계약 → 입력한 계약 정보 기준', () => {
    const p = plan([rental('manual')]).find((x) => x.eventType === 'termination_notice')!;
    expect(p.source).toBe('manual_entry');
    expect(p.display.sourceLabel).toBe('입력한 계약 정보 기준');
    expect(p.data.checkId).toBeNull();
  });
  test('M. 계약서에서 추출한 기한 → 계약서 기준', () => {
    const p = plan([rental('upload')]).find((x) => x.eventType === 'termination_notice')!;
    expect(p.source).toBe('contract');
    expect(p.display.sourceLabel).toBe('계약서 기준');
  });
  test('N. 출처가 PACTO 안내이면 critical로 올리지 않음 / 알림 시점(30·7·1·0)은 기한의 출처를 바꾸지 않음', () => {
    for (const p of plan([rental('upload')], { now: new Date('2026-09-01T00:00:00Z') }).filter((x) => x.eventType === 'termination_notice')) {
      expect(p.source).toBe('contract');
    }
  });
  test('O. 법령 알림은 만들지 않음', () => {
    expect(LEGAL_RULES).toHaveLength(0);
    const all = [...plan([lease(), rental()]), ...plan([lease(), rental()], { now: new Date('2026-09-01T00:00:00Z') })];
    expect(all.some((p) => p.source === 'legal')).toBe(false);
  });
});
