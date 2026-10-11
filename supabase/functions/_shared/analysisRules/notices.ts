/**
 * 통보기한 (계약 종료일 기준 해지·갱신 통보) — 판단은 서버 한 곳에서 확정한다. 앱·화면은 결과를 보여주고 사용자 선택만 반영한다.
 *
 * 원칙: 자동으로 일정을 만드는 통보기한은 "계약 종료일 기준"의 명확한 기한만 (예: "계약 종료 30일 전까지 해지 통지" → 종료일 − 30일).
 *       조건부 통보("퇴사하려면 30일 전 통보")는 고정 기한이 아니라 계약 체크다.
 *
 * 규칙 N1 resolveNoticeDays — 입력: fields(통보기한·자동갱신) · 체크 · 날짜 / 출력: { days, needsConfirm }
 *   - 조건부 체크와 "같은 조항"(근거 문장이 겹침)이고 자동갱신이 아니면 조건부 통보를 잘못 옮긴 값 → 지운다
 *     같은 숫자(30일)라는 이유만으로 지우지 않는다: 근거 문장이 없거나 다르면 남기고 "확인 필요"로
 *     예) 통보기한 30 + 근거 "근로자가 퇴직하고자 하는 경우 30일 전 통보" + 같은 문장의 조건부 체크 → 지움
 *         통보기한 30 + 근거 "계약 만료 30일 전까지 통지" + 다른 문장의 "중도해지 30일 전 통보" 체크 → 유지
 *   - 일수 없이 통보기한 날짜만 있으면 종료일과의 차이로 계산 (확인 필요)
 *   - 같은 일수의 조건부 통보가 있는데 근거 문장이 없어 같은 조항인지 알 수 없으면 → 확인 필요
 *   - 확인 필요(needsConfirm): 일수 없음 · 신뢰도 low · 날짜로 계산함 · 같은 조항인지 알 수 없음
 * 규칙 N2 resolveNoticeKind — 통보기한의 의미를 원문보다 강하게 해석하지 않는다
 *   - 일수가 없으면 의미도 없음(null) / 근거가 "협의·확인"만 말하면 renewal_decision / 확신이 낮거나 근거가 없으면 unknown
 * 규칙 N3 noticeSuggestions — 계약 체크를 통보기한 관리로 연결
 *   - 확정된 기한: 자동갱신·통보기한 체크에 "저장하면 캘린더와 알림에 추가" (needsConfirm=false)
 *   - 확인이 필요하거나 못 찾은 기한: 관련 체크(자동갱신·통보기한·갱신 조건)에 "N일 전 넣기" 제안 (needsConfirm=true).
 *     사용자가 넣기를 고르기 전에는 저장하지 않는다
 *   - 자동갱신 여부는 AI의 autoRenewal 필드만 쓴다 (체크 주제로 추론하지 않음 — renewal.ts)
 * 테스트: notices-rules.test.ts, notice-kind.test.ts, golden
 */
import { DECISION_WORDS, NOTIFY_WORDS } from './keywords.ts';
import { autoRenewalOf } from './renewal.ts';
import type { Extracted, ExtractedCheck, ExtractedDate } from './types.ts';
import { oneOf } from './values.ts';
import { NOTICE_KIND_CODES } from './vocabulary.ts';

export interface NoticeDecision {
  days: number | null;
  /** 사용자 확인 없이 일정으로 만들면 안 되는 값 (확인 필요) */
  needsConfirm: boolean;
}

const dayNo = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

export function resolveNoticeDays(fields: Record<string, Extracted>, checks: readonly ExtractedCheck[], dates: readonly ExtractedDate[]): NoticeDecision {
  const auto = autoRenewalOf(fields);
  let notice = fields.terminationNoticeDays.value as number | null;
  const noticeQuote = fields.terminationNoticeDays.evidence?.[0]?.quote ?? '';
  const sameClause = (c: ExtractedCheck) => !!noticeQuote && !!c.evidenceQuote && (c.evidenceQuote.includes(noticeQuote) || noticeQuote.includes(c.evidenceQuote));
  if (notice !== null && auto !== true && checks.some((c) => c.behavior === 'conditional_rule' && sameClause(c))) {
    fields.terminationNoticeDays = { value: null, confidence: 'low' };
    notice = null;
  }
  // 일수 없이 통보기한 날짜만 있으면 종료일과의 차이로 (확인 필요)
  const noticeDate = dates.find((d) => d.use === 'notice');
  const end = dates.find((d) => d.use === 'end');
  if (notice === null && noticeDate && end && noticeDate.date <= end.date) {
    notice = dayNo(end.date) - dayNo(noticeDate.date);
    fields.terminationNoticeDays = { value: notice, confidence: 'low', ...(noticeDate.evidence ? { evidence: noticeDate.evidence } : {}) };
  }
  // 같은 일수의 조건부 통보가 있는데 근거 문장으로 같은 조항인지 확인할 수 없으면 → 지우지도, 확정하지도 않고 확인 필요
  const ambiguous = notice !== null && auto !== true && checks.some((c) => c.behavior === 'conditional_rule' && c.rule?.offsetDays === notice && (!noticeQuote || !c.evidenceQuote));
  if (ambiguous) fields.terminationNoticeDays = { ...fields.terminationNoticeDays, confidence: 'low' };
  return { days: notice, needsConfirm: notice === null || fields.terminationNoticeDays.confidence === 'low' };
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

/** 통보기한을 넣을 수 있는 체크 주제 */
const NOTICE_TOPICS: ReadonlySet<string> = new Set(['notice_deadline', 'auto_renewal', 'renewal_terms']);

export function noticeSuggestions(checks: ExtractedCheck[], decision: NoticeDecision, fields: Record<string, Extracted>): void {
  const autoRenewal = autoRenewalOf(fields) === true;
  const months = fields.renewalPeriodMonths.value as number | null;
  for (const c of checks) {
    if (!NOTICE_TOPICS.has(c.topic)) continue;
    if (decision.days !== null && !decision.needsConfirm) {
      if (c.behavior === 'conditional_rule' || c.topic === 'renewal_terms') continue;
      c.behavior = 'fixed_event';
      c.suggestion = { kind: 'set_termination_notice', terminationNoticeDays: decision.days, autoRenewal, renewalPeriodMonths: months, needsConfirm: false };
      continue;
    }
    // 확인 필요 / 못 찾음: 확인이 필요한 일수, 없으면 그 조항의 "며칠 전"
    const days = decision.days ?? (c.rule?.offsetDays != null && c.rule.offsetDays > 0 ? c.rule.offsetDays : null);
    if (days === null) continue;
    c.suggestion = { kind: 'set_termination_notice', terminationNoticeDays: days, autoRenewal, renewalPeriodMonths: months, needsConfirm: true };
  }
}
