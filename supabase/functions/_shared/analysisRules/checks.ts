/**
 * PACTO 계약 체크
 *
 * 규칙 C1 cleanChecks — 목적: 체크를 형식에 맞게 정리 (금지 표현 중립화, 근거 없으면 신뢰도 low, 최대 12개)
 *   - 조건부 주제(중도해지·연체·퇴직 통보·기한이익 상실·중도상환)나 conditional_rule은 날짜를 만들지 않는다
 *   예) topic "early_termination" + related_date → conditional_rule, related_date 제거
 * 규칙 C2 waivedCheck — 목적: 면제된 금액(등록비·설치비 면제 등)을 "면제된 금액" 체크 하나로 보관
 * 규칙 C3 attachSuggestions — 목적: 계약서에 명시된 날짜를 캘린더에 추가 제안 (통보기한 연결은 notices.ts)
 * 규칙 C4 conditionalCostsToChecks — 목적: 조건부 비용(위약금·연체료·배상금·양도 수수료 …)은 결제가 아니라 계약 체크 하나에
 *   금액·조건·근거 문장과 함께 보관한다. 같은 주제의 체크가 있으면 그 체크에 금액을 붙이고, 없으면 새 체크를 만든다
 *   예) 결제 "중도해지 위약금 200,000원(조건부)" + 체크 "중도해지 위약금" → 체크 하나(금액 200,000원), 결제 없음
 *       결제 "회원권 양도 수수료 30,000원" → 새 체크(기타) "회원권 양도 수수료" 30,000원
 *   홈·캘린더·금액 섹션에 넣지 않는다. 실제로 생기면 사용자가 상세 화면에서 "발생했어요"로 1회 결제를 만든다
 * 테스트: extraction.test.ts, notice-kind.test.ts, golden
 */
import { CHECK_BEHAVIORS, CHECK_TOPIC_CODES, CHECK_TOPIC_DEFS } from '../contractRegistry.ts';
import type { AppExtractionResult, ExtractedCheck, ExtractedDate, ExtractedPayment } from './types.ts';
import { confidenceOf, isObj, MAX_AMOUNT, neutralize, oneOf, text, toInt, validDate } from './values.ts';
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
      const amount = toInt(c.amount, 1, MAX_AMOUNT);
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
        amount,
        amountNote: neutralize(text(c.amount_basis, 100) ?? '', '') || null,
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
    amount: null,
    amountNote: null,
    suggestion: null,
  });
}

/** 조건부 비용의 주제 (이름·조건으로) — 맞는 주제가 없으면 기타 */
const COST_TOPICS: [RegExp, string][] = [
  [/위약|중도\s*해지|해지\s*수수료/, 'early_termination'],
  [/중도\s*상환/, 'prepayment'],
  [/연체|지연\s*(?:손해|이자|배상|료)/, 'overdue'],
  [/원상\s*복구/, 'restoration'],
  [/손해\s*배상|파손|분실|훼손|손상|미반환/, 'damages'],
];

export function conditionalCostsToChecks(payments: ExtractedPayment[], checks: ExtractedCheck[]): void {
  for (const p of [...payments]) {
    if (p.obligation !== 'conditional' && p.obligation !== 'potential') continue;
    payments.splice(payments.indexOf(p), 1);
    const text = `${p.label} ${p.conditionNote ?? ''}`;
    const topic = COST_TOPICS.find(([re]) => re.test(text))?.[1] ?? 'other';
    const same = topic !== 'other' ? checks.find((c) => c.topic === topic && c.amount == null) : undefined;
    if (same) {
      same.amount = p.amount;
      continue;
    }
    const quote = p.evidence?.[0];
    const won = `${p.amount.toLocaleString('ko-KR')}원`;
    checks.push({
      severity: 'check',
      topic,
      title: p.label,
      description: `${p.conditionNote ? `${p.conditionNote} ` : ''}${p.label} ${won}이 부과되는 것으로 기재되어 있습니다.`,
      confidence: p.confidence,
      evidenceQuote: quote?.quote ?? null,
      evidencePage: quote?.page ?? null,
      evidenceFileIndex: quote?.file ? quote.file - 1 : null,
      behavior: 'conditional_rule',
      rule: { condition: p.conditionNote ?? '해당 상황이 생기는 경우', action: `${p.label} ${won}`, offsetDays: null },
      relatedDate: null,
      amount: p.amount,
      amountNote: null,
      suggestion: null,
    });
  }
}

/** 관리로 연결: 계약서에 명시된 (다른 데서 이미 관리하지 않는) 날짜 → 캘린더 일정 제안. 통보기한 연결은 notices.ts(N3) */
export function attachSuggestions(checks: ExtractedCheck[], dates: readonly ExtractedDate[]): void {
  const knownDates = new Set(dates.map((d) => d.date));
  for (const c of checks) {
    if (c.behavior === 'conditional_rule' || c.suggestion) continue;
    if (c.relatedDate && !knownDates.has(c.relatedDate)) {
      c.behavior = 'fixed_event';
      c.suggestion = { kind: 'add_event', eventType: 'custom', title: c.title, eventDate: c.relatedDate };
    }
  }
}
