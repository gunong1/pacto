/**
 * 통보기한 (계약 종료일 기준 해지·갱신 통보)
 *
 * 규칙 N1 resolveNoticeDays — 목적: 종료일 기준 통보기한만 남긴다. 조건부 통보(자진 퇴직 30일 전 등)를 옮긴 값은 지운다
 *   입력: fields.terminationNoticeDays · 자동갱신 · 체크 / 출력: 통보기한 일수 또는 null
 *   예) 자동갱신 아님 + "퇴직하려면 30일 전 통보"(조건부 체크, 30일) + 통보기한 30 → null
 * 규칙 N2 resolveNoticeKind — 목적: 통보기한의 의미를 원문보다 강하게 해석하지 않는다
 *   - 일수가 없으면 의미도 없음(null)
 *   - 근거 문장이 "협의·확인"만 말하면(통지 표현 없음) renewal_decision
 *   - 모델이 답하지 않았거나 확신이 낮거나 근거 문장이 없으면 unknown
 * 테스트: notice-kind.test.ts, extraction.test.ts
 */
import { DECISION_WORDS, NOTIFY_WORDS } from './keywords.ts';
import type { Extracted, ExtractedCheck } from './types.ts';
import { oneOf } from './values.ts';
import { NOTICE_KIND_CODES } from './vocabulary.ts';

export function resolveNoticeDays(fields: Record<string, Extracted>, checks: readonly ExtractedCheck[]): number | null {
  const auto = fields.autoRenewal.value as boolean | null;
  const notice = fields.terminationNoticeDays.value as number | null;
  const noticeQuote = fields.terminationNoticeDays.evidence?.[0]?.quote ?? '';
  const sameClause = (c: ExtractedCheck) => c.rule?.offsetDays === notice || (!!noticeQuote && !!c.evidenceQuote && (c.evidenceQuote.includes(noticeQuote) || noticeQuote.includes(c.evidenceQuote)));
  if (notice !== null && auto !== true && checks.some((c) => c.behavior === 'conditional_rule' && sameClause(c))) {
    fields.terminationNoticeDays = { value: null, confidence: 'low' };
    return null;
  }
  return notice;
}

export function resolveNoticeKind(notice: number | null, kind: Extracted | undefined, days: Extracted | undefined): Extracted {
  if (notice === null) return { value: null, confidence: 'low' };
  const quotes = [...(days?.evidence ?? []), ...(kind?.evidence ?? [])].map((e) => e.quote).join(' ');
  const evidence = kind?.evidence?.length ? kind.evidence : days?.evidence;
  if (quotes && DECISION_WORDS.test(quotes) && !NOTIFY_WORDS.test(quotes)) {
    return { value: 'renewal_decision', confidence: kind?.value === 'renewal_decision' ? kind.confidence : 'medium', ...(evidence ? { evidence } : {}) };
  }
  const v = oneOf(NOTICE_KIND_CODES, kind?.value);
  if (!v || v === 'unknown' || !quotes || kind?.confidence === 'low') return { value: 'unknown', confidence: 'low', ...(evidence ? { evidence } : {}) };
  return { value: v, confidence: kind!.confidence, ...(evidence ? { evidence } : {}) };
}
