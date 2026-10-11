/**
 * PACTO 계약 체크
 *
 * 규칙 C1 cleanChecks — 목적: 체크를 형식에 맞게 정리 (금지 표현 중립화, 근거 없으면 신뢰도 low, 최대 12개)
 *   - 조건부 주제(중도해지·연체·퇴직 통보·기한이익 상실·중도상환)나 conditional_rule은 날짜를 만들지 않는다
 *   예) topic "early_termination" + related_date → conditional_rule, related_date 제거
 * 규칙 C2 waivedCheck — 목적: 면제된 금액(등록비·설치비 면제 등)을 "면제된 금액" 체크 하나로 보관
 * 규칙 C3 attachSuggestions — 목적: 체크를 일정 관리로 연결 (통보기한 넣기 / 계약서에 명시된 날짜를 캘린더에 추가 제안)
 * 테스트: extraction.test.ts, notice-kind.test.ts, golden
 */
import { CHECK_BEHAVIORS, CHECK_TOPIC_CODES, CHECK_TOPIC_DEFS } from '../contractRegistry.ts';
import type { AppExtractionResult, ExtractedCheck, ExtractedDate } from './types.ts';
import { confidenceOf, isObj, neutralize, oneOf, text, toInt, validDate } from './values.ts';
import { SEVERITY } from './vocabulary.ts';

/** 면제된 금액을 모아 보여주는 체크 제목 */
export const WAIVED_CHECK_TITLE = '면제된 금액';

export function cleanChecks(raw: readonly unknown[]): ExtractedCheck[] {
  return raw
    .filter(isObj)
    .slice(0, 12)
    .map((c) => {
      const topic = oneOf(CHECK_TOPIC_CODES, c.topic) ?? 'other';
      const title = neutralize(text(c.title, 40) ?? '확인할 조항', '확인할 조항');
      const description = neutralize(text(c.description, 300) ?? '', '계약서의 해당 조항을 확인해주세요.') || '계약서의 해당 조항을 확인해주세요.';
      const evidenceQuote = text(c.evidence_quote, 200);
      const fileNo = toInt(c.evidence_file, 1, 50);
      const offsetDays = toInt(c.offset_days, 0, 365);
      const conditional = CHECK_TOPIC_DEFS.find((t) => t.code === topic)?.conditional === true || c.behavior === 'conditional_rule';
      const behavior: ExtractedCheck['behavior'] = conditional ? 'conditional_rule' : (oneOf(CHECK_BEHAVIORS, c.behavior) ?? 'info');
      // 조건부 의무는 날짜를 만들지 않는다
      const relatedDate = !conditional && validDate(c.related_date) ? c.related_date.trim() : null;
      return {
        severity: oneOf(SEVERITY, c.severity) ?? 'info',
        topic,
        title,
        description,
        confidence: evidenceQuote ? confidenceOf(c.confidence) : 'low',
        evidenceQuote,
        evidencePage: typeof c.evidence_page === 'number' && c.evidence_page >= 1 ? Math.round(c.evidence_page) : null,
        evidenceFileIndex: fileNo === null ? null : fileNo - 1,
        behavior,
        rule: conditional
          ? { condition: neutralize(text(c.condition, 100) ?? title, title), action: neutralize(text(c.action, 150) ?? description, description), offsetDays }
          : null,
        relatedDate,
        suggestion: null as ExtractedCheck['suggestion'],
      };
    });
}

export function waivedCheck(checks: ExtractedCheck[], references: AppExtractionResult['references']): void {
  const waived = references.filter((r) => r.role === 'waived');
  if (waived.length === 0 || checks.some((c) => c.title === WAIVED_CHECK_TITLE)) return;
  checks.push({
    severity: 'info',
    topic: 'discount_terms',
    title: WAIVED_CHECK_TITLE,
    description: `${waived.map((r) => `${r.label} ${r.amount.toLocaleString('ko-KR')}원`).join(', ')} — 계약서에 면제로 적혀 있어 결제 일정에 넣지 않았어요.`,
    confidence: 'medium',
    evidenceQuote: null,
    evidencePage: null,
    evidenceFileIndex: null,
    behavior: 'info',
    rule: null,
    relatedDate: null,
    suggestion: null,
  });
}

/**
 * 관리로 연결: 자동갱신·통보기한 → 해지 통보기한 일정, 계약서에 명시된 (다른 데서 이미 관리하지 않는) 날짜 → 캘린더 일정 제안
 * @param notice 서버가 확정한 종료일 기준 통보기한 (없으면 null)
 */
export function attachSuggestions(checks: ExtractedCheck[], dates: readonly ExtractedDate[], notice: number | null, auto: boolean | null, months: number | null): void {
  const knownDates = new Set(dates.map((d) => d.date));
  for (const c of checks) {
    if (c.behavior === 'conditional_rule') continue;
    if ((c.topic === 'auto_renewal' || c.topic === 'notice_deadline') && notice !== null) {
      c.behavior = 'fixed_event';
      c.suggestion = { kind: 'set_termination_notice', terminationNoticeDays: notice, autoRenewal: auto ?? c.topic === 'auto_renewal', renewalPeriodMonths: months };
    } else if (c.relatedDate && !knownDates.has(c.relatedDate)) {
      c.behavior = 'fixed_event';
      c.suggestion = { kind: 'add_event', eventType: 'custom', title: c.title, eventDate: c.relatedDate };
    }
  }
}
