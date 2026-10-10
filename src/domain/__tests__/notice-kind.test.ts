/**
 * 통보기한의 의미 (notice_kind) — 숫자만으로 해지 통보·갱신 통지·갱신 협의를 같은 것으로 다루지 않는다.
 * A 협의 → renewal_decision(important) · B 해지 의사 통지 → termination_notice(critical)
 * C "갱신을 원하지 않으면 통보" → 문맥에 따른 모델 판단을 유지 · D 불확실 → unknown(important + 확인 필요)
 * E 기존 계약 → unknown (자동 재분류 없음) · 알림 설정: 갱신 통보기한은 해지·종료 설정을 이어받고, 갱신 여부 확인은 PACTO 기본값
 */
import * as fs from 'fs';
import * as path from 'path';

import { toAppResult } from '../../../supabase/functions/_shared/extraction.ts';
import { draftToRecord } from '@/data/draft';
import { toRecord } from '@/data/supabase/rowMapping';
import { toReviewModel } from '@/features/registration/extraction';

import { formatDateKo } from '../dates';
import { importantSchedule } from '../importantSchedule';
import { actionCandidates } from '../nextAction';
import { getEffectiveNotificationPreferences, planNotifications, toReminderRules } from '../notifications';
import { upcomingReminders } from '../reminders';
import { contractSchedule } from '../schedule';

const TODAY = '2026-10-08';
const ev = (quote: string | null) => ({ evidence_quote: quote, evidence_page: 1, evidence_file: 1 });
const field = (key: string, v: { text?: string | null; num?: number | null; bool?: boolean | null }, confidence: string, quote: string | null) => ({
  key, text_value: v.text ?? null, number_value: v.num ?? null, boolean_value: v.bool ?? null, confidence, ...ev(quote),
});

/** 주택 임대차 2026-10-20 ~ 2028-10-19 · 종료 60일 전 = 2028-08-20 */
function lease(quote: string, kind: string | null, kindConfidence = 'high', contractType = 'lease') {
  return {
    category: { value: contractType === 'lease' ? 'real_estate' : 'rental', confidence: 'high', alternatives: [], reason: '' },
    contract_type: { value: contractType, confidence: 'high', alternatives: [], reason: '' },
    fields: [
      field('autoRenewal', { bool: false }, 'high', null),
      field('terminationNoticeDays', { num: 60 }, 'high', quote),
      ...(kind === null ? [] : [field('noticeKind', { text: kind }, kindConfidence, quote)]),
    ],
    dates: [
      { date: '2026-10-20', meaning: 'contract_start', label: '계약기간 시작', confidence: 'high', source_type: 'explicit', ...ev('2026년 10월 20일 ~ 2028년 10월 19일') },
      { date: '2028-10-19', meaning: 'contract_end', label: '계약기간 종료', confidence: 'high', source_type: 'explicit', ...ev('2026년 10월 20일 ~ 2028년 10월 19일') },
    ],
    payments: [],
    details: [],
    checks: [{ severity: 'check', topic: 'renewal_terms', title: '갱신 조건', description: '갱신 관련 조항이 있어요.', confidence: 'high', behavior: 'info', condition: null, action: null, offset_days: null, related_date: null, ...ev(quote) }],
  };
}

function analyze(raw: ReturnType<typeof lease>) {
  const result = toAppResult(raw, 'openai');
  const model = toReviewModel(result, ['doc-1']);
  const record = draftToRecord(model.draft, 'c1', TODAY);
  record.contract.source = 'upload';
  record.aiChecks = model.checks.map((c, i) => ({ ...c, id: `chk-${i}`, contractId: 'c1', status: 'new' as const }));
  return { result, model, record };
}

const noticeItem = (r: ReturnType<typeof analyze>['record']) =>
  contractSchedule(r, { start: TODAY, end: '2030-12-31' }, TODAY).find((i) => i.type === 'termination_notice')!;

describe('A. "갱신 여부를 협의" → 갱신 여부 확인 (important)', () => {
  const QUOTE = '임대인과 임차인은 계약 만료 2개월 전까지 갱신 여부를 협의한다.';

  test.each([['renewal_decision'], ['termination_notice'], ['renewal_notice']])('모델이 %s로 답해도 원문이 협의면 renewal_decision (강하게 바꾸지 않음)', (kind) => {
    const { result, model, record } = analyze(lease(QUOTE, kind));
    expect(result.fields.noticeKind.value).toBe('renewal_decision');
    expect(model.draft.noticeKind).toBe('renewal_decision');
    const item = noticeItem(record);
    expect(item).toMatchObject({ date: '2028-08-20', title: '갱신 여부 확인', actionType: 'renewal_decision', priority: 'important' });
  });

  test('문구: "갱신 여부 확인까지 682일 남았습니다." / 계약서에 따라 … 협의 / "갱신 여부 확인 · 2028. 8. 20." · [원문 보기] 근거 연결', () => {
    const { record } = analyze(lease(QUOTE, 'renewal_decision'));
    const a = actionCandidates(record, TODAY).find((x) => x.date === '2028-08-20')!;
    expect(a.headline).toBe('갱신 여부 확인까지 682일 남았습니다.');
    expect(a.guidance).toBe('계약서에 따라 2028년 8월 20일까지 갱신 여부를 상대방과 협의해주세요.');
    expect(`${a.label} · ${formatDateKo(a.date)}`).toBe('갱신 여부 확인 · 2028. 8. 20.');
    // 같은 날 PACTO 기본 안내(갱신 여부 확인)를 따로 만들지 않는다
    expect(contractSchedule(record, { start: TODAY, end: '2030-12-31' }, TODAY).filter((i) => i.date === '2028-08-20')).toHaveLength(1);
    const imp = importantSchedule([record], '2028-08-01').items.find((i) => i.item.date === '2028-08-20')!; // D-19 (알림 30일 전 구간)
    expect(imp).toMatchObject({ priority: 'important', badge: '확인', sourceLabel: '계약서 기준' });
    expect(imp.evidence).toMatchObject({ documentId: 'doc-1', page: 1, quote: QUOTE });
  });

  test('알림: 갱신 여부 확인 시점(PACTO 기본 30·7일 전) · important · 협의 권유 문구', () => {
    const { record } = analyze(lease(QUOTE, 'renewal_decision'));
    const rs = upcomingReminders([record], '2028-07-01', 60).filter((r) => r.kind === 'termination_notice');
    expect(rs.map((r) => r.daysBefore)).toEqual([30, 7]);
    expect(rs.every((r) => r.priority === 'important' && r.actionType === 'renewal_decision')).toBe(true);
    expect(rs[0].message).toBe('갱신 여부 확인까지 30일 남았어요. 갱신 여부를 상대방과 협의해보세요.');
    const p = planNotifications({ userId: 'u', records: [record], preferences: { showDetails: true }, overrides: new Map(), now: new Date('2028-07-20T00:00:00Z') }).find((x) => x.eventType === 'renewal_decision')!;
    expect(p).toMatchObject({ priority: 'important', eventDate: '2028-08-20' });
    expect(p.push.body).toBe('갱신 여부를 상대방과 협의해보세요.');
  });
});

describe('B. "해지 의사를 통지" → 해지 통보기한 (critical)', () => {
  const QUOTE = '임차인은 계약 만료 2개월 전까지 해지 의사를 서면으로 통지하여야 한다.';
  test('termination_notice · critical · "해지 통보기한까지 N일 남았습니다."', () => {
    const { result, record } = analyze(lease(QUOTE, 'termination_notice', 'high', 'recurring'));
    expect(result.fields.noticeKind.value).toBe('termination_notice');
    expect(noticeItem(record)).toMatchObject({ title: '해지 통보기한', actionType: 'termination_notice', priority: 'critical', needsReview: false });
    const a = actionCandidates(record, '2028-07-21').find((x) => x.date === '2028-08-20')!;
    expect(a.headline).toBe('해지 통보기한까지 30일 남았습니다.');
  });
  test('같은 원문에 "통지"가 있으면 협의·확인 단어가 있어도 renewal_decision으로 낮추지 않는다', () => {
    const { result } = analyze(lease('계약 만료 2개월 전까지 해지 의사를 서면으로 통지하고 정산 내역을 확인한다.', 'termination_notice'));
    expect(result.fields.noticeKind.value).toBe('termination_notice');
  });
});

describe('C. "갱신을 원하지 않으면 통보" → 문맥에 따른 판단을 그대로 (critical)', () => {
  const QUOTE = '갱신을 원하지 않는 경우 계약 만료 2개월 전까지 상대방에게 통보하여야 한다.';
  test.each([
    ['renewal_notice', '갱신 통보기한', '갱신 통보기한까지 30일 남았습니다.'],
    ['termination_notice', '종료 통보기한', '종료 통보기한까지 30일 남았습니다.'],
  ])('모델 %s → 그대로 · critical', (kind, title, headline) => {
    const { result, record } = analyze(lease(QUOTE, kind));
    expect(result.fields.noticeKind.value).toBe(kind);
    expect(noticeItem(record)).toMatchObject({ title, actionType: kind, priority: 'critical' });
    expect(actionCandidates(record, '2028-07-21').find((x) => x.date === '2028-08-20')!.headline).toBe(headline);
  });
});

describe('D. 의미가 불확실 → unknown · important · 확인 필요', () => {
  test.each([
    ['모델이 unknown', lease('계약 만료 2개월 전까지 갱신에 관하여 상대방에게 알린다.', 'unknown')],
    ['모델이 답하지 않음 (v8 이전 결과 형식)', lease('계약 만료 60일 전', null)],
    ['확신이 낮음', lease('만료 60일 전까지 의사를 밝힌다.', 'termination_notice', 'low')],
    ['근거 문장 없음', lease(null as unknown as string, 'termination_notice')],
  ])('%s', (_name, raw) => {
    const { result, model, record } = analyze(raw);
    expect(result.fields.noticeKind.value).toBe('unknown');
    expect(model.draft.noticeKind).toBe('unknown');
    expect(model.flagged.has('noticeKind')).toBe(true);
    expect(noticeItem(record)).toMatchObject({ title: '통보·갱신 관련 기한', actionType: 'notice_unknown', priority: 'important', needsReview: true });
    const a = actionCandidates(record, TODAY).find((x) => x.date === '2028-08-20')!;
    expect(a.headline).toBe('통보·갱신 관련 기한이 있어요.');
    expect(a.guidance).toBe('이 일정의 의미를 확인해주세요.');
    const imp = importantSchedule([record], '2028-08-01').items[0];
    expect(imp).toMatchObject({ priority: 'important', badge: '확인 필요', title: '통보·갱신 관련 기한이 있어요' });
    // 알림은 놓치지 않도록 해지·종료 통보기한 시점(30·7·1·당일)으로, 중요도는 important
    const rs = upcomingReminders([record], '2028-07-01', 60).filter((r) => r.kind === 'termination_notice');
    expect(rs.map((r) => r.daysBefore)).toEqual([30, 7, 1, 0]);
    expect(rs.every((r) => r.priority === 'important' && r.needsReview)).toBe(true);
  });
  test('통보기한 일수가 없으면 의미도 없음 (확인 필요 표시 안 함)', () => {
    const raw = lease('계약 만료 2개월 전까지 갱신 여부를 협의한다.', 'renewal_decision');
    raw.fields = raw.fields.filter((f) => f.key !== 'terminationNoticeDays');
    const { result, model } = analyze(raw);
    expect(result.fields.noticeKind.value).toBeNull();
    expect(model.flagged.has('noticeKind')).toBe(false);
  });
});

describe('E. 기존 계약 = unknown (자동 재분류 없음)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../../supabase/migrations/20261013000001_notice_kind.sql'), 'utf8');
  test('migration: 기본값 unknown · 4개 값만 · 기존 행을 다른 값으로 바꾸는 update 없음', () => {
    expect(sql).toMatch(/add column notice_kind text not null default 'unknown'/);
    expect(sql).toMatch(/check \(notice_kind in \('termination_notice', 'renewal_notice', 'renewal_decision', 'unknown'\)\)/);
    expect(sql).not.toMatch(/update\s+public\.contracts\s+set\s+notice_kind/i);
    // 수정 저장 시 값이 없으면 기존 값 유지
    expect(sql).toMatch(/notice_kind = coalesce\(p_contract ->> 'notice_kind', notice_kind\)/);
  });
  test('앱이 모르는 값·빈 값 → unknown', () => {
    const row = (notice_kind: unknown) =>
      toRecord({
        id: 'x', title: 't', category: 'other', contract_type: 'other', contract_details: {}, value_sources: {}, notice_kind, termination_notice_days: 30,
        contract_payments: [], contract_dates: [], contract_events: [], contract_documents: [], ai_checks: [],
      } as never).contract.noticeKind;
    expect(row('renewal_decision')).toBe('renewal_decision');
    expect(row('something_new')).toBe('unknown');
    expect(row(undefined)).toBe('unknown');
  });
});

describe('알림 설정 — 종류별 키 따로, 기존 설정 이어받기', () => {
  test('기존 해지·종료 통보기한 설정 → 갱신 통보기한도 같은 값, 갱신 여부 확인은 PACTO 기본값(30·7일 전)', () => {
    const eff = getEffectiveNotificationPreferences({ categories: { termination_notice: { enabled: true, offsets: [14, 1] } } });
    expect(eff.categories.termination_notice).toEqual({ enabled: true, offsets: [14, 1] });
    expect(eff.categories.renewal_notice).toEqual({ enabled: true, offsets: [14, 1] });
    expect(eff.categories.renewal_decision).toEqual({ enabled: true, offsets: [30, 7] });
    expect(eff.origin).toMatchObject({ termination_notice: 'user', renewal_notice: 'user', renewal_decision: 'pacto' });
  });
  test('갱신 통보기한을 따로 저장하면 그 값 · 계약별 설정도 같은 규칙', () => {
    const eff = getEffectiveNotificationPreferences(
      { categories: { termination_notice: { enabled: true, offsets: [14] }, renewal_notice: { enabled: true, offsets: [60] } } },
      { termination_notice: { enabled: false, offsets: [] } },
    );
    expect(eff.categories.renewal_notice).toEqual({ enabled: false, offsets: [] });
    expect(toReminderRules(getEffectiveNotificationPreferences({ categories: { renewal_notice: { enabled: true, offsets: [60] } } })).renewalNotice).toEqual([60]);
  });
});
