/**
 * 통보기한·자동갱신 서버 규칙 (analysisRules/notices.ts · renewal.ts) — 모든 값은 가짜
 * - 같은 숫자(30일)라는 이유만으로 진짜 통보기한을 지우지 않는다 (같은 문장일 때만)
 * - 확인이 필요하면 계약 체크에 "N일 전 넣기" 제안(needsConfirm), 확정이면 자동
 * - 자동갱신 여부는 AI 필드만 (체크 주제로 추론하지 않음)
 */
import { toAppResult } from '../../../supabase/functions/_shared/extraction.ts';
import * as F from './golden/fixtures';

const q = (quote: string | null) => ({ evidence_quote: quote, evidence_page: quote ? 1 : null, evidence_file: quote ? 1 : null });
const field = (value: unknown, confidence = 'high', quote: string | null = null) => ({ value, confidence, ...q(quote) });
const check = (c: Record<string, unknown>) => ({ severity: 'check', confidence: 'high', behavior: 'info', condition: null, action: null, offset_days: null, related_date: null, evidence_page: 1, evidence_file: 1, ...c });

const END_NOTICE = '계약 만료 30일 전까지 서면으로 해지 의사를 통지하여야 한다.';
const RESIGN = '근로자가 퇴직하고자 하는 경우 30일 전에 통보하여야 한다.';

const withNotice = (fields: Record<string, unknown>, checks: unknown[]) => {
  const base = F.lease();
  return toAppResult({ ...base, fields: { ...base.fields, ...fields }, checks }, 'openai');
};
const noticeSuggestion = (r: ReturnType<typeof toAppResult>) => r.checks.map((c) => c.suggestion).find((s) => s?.kind === 'set_termination_notice');

test('같은 30일이어도 다른 조항(종료일 기준 vs 퇴직 통보)이면 통보기한을 지우지 않고 확정', () => {
  const r = withNotice(
    { terminationNoticeDays: field(30, 'high', END_NOTICE), noticeKind: field('termination_notice', 'high', END_NOTICE) },
    [check({ topic: 'notice_deadline', title: '해지 통보', evidence_quote: END_NOTICE }), check({ topic: 'resignation_notice', title: '퇴직 통보', behavior: 'conditional_rule', offset_days: 30, evidence_quote: RESIGN })],
  );
  expect(r.fields.terminationNoticeDays.value).toBe(30);
  expect(noticeSuggestion(r)).toMatchObject({ terminationNoticeDays: 30, needsConfirm: false });
});

test('같은 문장의 조건부 통보(퇴직 30일 전)를 통보기한으로 잘못 옮긴 값 → 지움 (자동갱신 아님)', () => {
  const r = withNotice({ terminationNoticeDays: field(30, 'high', RESIGN) }, [check({ topic: 'resignation_notice', title: '퇴직 통보', behavior: 'conditional_rule', offset_days: 30, evidence_quote: RESIGN })]);
  expect(r.fields.terminationNoticeDays.value).toBeNull();
});

test('같은 일수의 조건부 통보가 있는데 근거 문장이 없어 같은 조항인지 모르면 → 지우지 않고 확인 필요("30일 전 넣기")', () => {
  const r = withNotice(
    { terminationNoticeDays: field(30, 'high', null) },
    [check({ topic: 'notice_deadline', title: '통보기한', evidence_quote: END_NOTICE }), check({ topic: 'early_termination', title: '중도해지 통보', behavior: 'conditional_rule', offset_days: 30, evidence_quote: null })],
  );
  expect(r.fields.terminationNoticeDays).toMatchObject({ value: 30, confidence: 'low' });
  expect(noticeSuggestion(r)).toMatchObject({ terminationNoticeDays: 30, needsConfirm: true });
});

test('통보기한 날짜만 있으면 서버가 종료일과의 차이로 일수 계산 → 확인 필요', () => {
  const base = F.lease();
  const r = toAppResult(
    {
      ...base,
      dates: [...base.dates, { date: '2027-12-30', meaning: 'notice_deadline', label: '해지 통보기한', confidence: 'high', source_type: 'explicit', ...q('2027년 12월 30일까지 해지 통보') }],
      checks: [check({ topic: 'notice_deadline', title: '해지 통보기한', evidence_quote: '2027년 12월 30일까지 해지 통보' })],
    },
    'openai',
  );
  expect(r.fields.terminationNoticeDays).toMatchObject({ value: 61, confidence: 'low' });
  expect(noticeSuggestion(r)).toMatchObject({ terminationNoticeDays: 61, needsConfirm: true });
});

test('자동갱신은 AI 필드만: 필드 false + 자동갱신 주제 체크("30일 전")여도 자동갱신으로 바꾸지 않음', () => {
  const r = withNotice(
    { autoRenewal: field(false, 'high', '갱신 여부는 협의한다.') },
    [check({ topic: 'auto_renewal', title: '갱신', behavior: 'conditional_rule', offset_days: 30, evidence_quote: '종료 30일 전까지 의사표시가 없으면 연장된다.' })],
  );
  expect(r.fields.autoRenewal.value).toBe(false);
  expect(noticeSuggestion(r)).toMatchObject({ terminationNoticeDays: 30, needsConfirm: true, autoRenewal: false });
});

test('확정된 통보기한(자동갱신 렌탈) → 자동갱신 체크에 "저장하면 캘린더·알림에 추가"(확인 필요 아님)', () => {
  const r = toAppResult(F.rental(), 'openai');
  expect(noticeSuggestion(r)).toMatchObject({ terminationNoticeDays: 30, autoRenewal: true, renewalPeriodMonths: 12, needsConfirm: false });
});
