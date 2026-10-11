/**
 * 계약 정보 ↔ PACTO 계약 체크 역할 분리 — 계약 정보 = 사실 / 계약 체크 = 그 사실 때문에 해야 할 일·주의할 위험.
 * 의미 판단은 의미 키(semantic key)로 한다 (문장 비교 아님). 정책 표는 레지스트리 SEMANTIC_KEY_DEFS 한 곳.
 *
 * 규칙 S1 assignSemanticKeys — 체크 주제 → 의미 키. 통보기한 주제는 통보기한의 의미(noticeKind)로
 *   (갱신 협의 → renewal_decision, 해지·갱신 통보 → termination_notice). 조건부 규칙은 기한 키로 묶지 않는다
 * 규칙 S2 mergeSameMeaning — 레지스트리에 정의된 의미 키는 하나로 합친다 (문장이 달라도). 심각도는 높은 쪽, 금액·조건은 비어 있으면 채움
 * 규칙 S3 dropPlainFacts — 정책 none(사실)인데 행동·금액·위험·날짜가 없고 같은 사실이 계약 정보(facts)에 있으면 체크를 만들지 않는다
 *   예) 관리비 월 100,000원(결제에 있음) → 체크 없음 / 보증금 반환 조건(속성에 있음) → 체크 없음
 *   계약 정보에 그 사실이 없으면 정보가 사라지지 않도록 남긴다
 * 규칙 S4 deadlineChecks — 기한 정책(deadline): 통보기한 일수와 종료일이 있으면 "할 일" 체크 하나로 (없으면 파생, derivedFrom 기록)
 *   제목은 할 일, 설명은 짧은 이유 (원문 조항 반복 없음 — 원문은 근거 문장으로만)
 *   자동갱신 + 통보기한이면 자동갱신 체크는 통보 체크 하나로 합친다 (놓치면 자동 연장된다는 이유를 함께)
 * 테스트: golden/checkScope.test.ts
 */
import { NOTICE_SEMANTIC_KEY, semanticKeyDef, SEMANTIC_KEY_DEFS } from '../contractRegistry.ts';
import type { Extracted, ExtractedCheck, ExtractedDate, ExtractedDetail, ExtractedPayment } from './types.ts';

const SEVERITY_RANK: Record<string, number> = { info: 0, check: 1, caution: 2 };
const TOPIC_KEY = new Map(SEMANTIC_KEY_DEFS.flatMap((d) => d.topics.map((t) => [t, d.key] as const)));

export function assignSemanticKeys(checks: ExtractedCheck[], noticeKind: string | null): void {
  for (const c of checks) {
    let key = c.topic === 'notice_deadline' ? (NOTICE_SEMANTIC_KEY[noticeKind ?? 'unknown'] ?? 'termination_notice') : (TOPIC_KEY.get(c.topic) ?? c.topic);
    // 조건부 의무("…하려면 30일 전 통보")는 종료일 기준 기한과 다른 의미 — 기한 체크와 합치지 않는다
    if (c.behavior === 'conditional_rule' && semanticKeyDef(key)?.policy === 'deadline') key = c.topic === 'notice_deadline' ? 'early_termination' : c.topic;
    c.semanticKey = key;
  }
}

export function mergeSameMeaning(checks: ExtractedCheck[]): ExtractedCheck[] {
  const out: ExtractedCheck[] = [];
  for (const c of checks) {
    const same = semanticKeyDef(c.semanticKey) ? out.find((x) => x.semanticKey === c.semanticKey) : undefined;
    if (!same) {
      out.push(c);
      continue;
    }
    if ((SEVERITY_RANK[c.severity] ?? 0) > (SEVERITY_RANK[same.severity] ?? 0)) same.severity = c.severity;
    same.amount ??= c.amount;
    same.amountNote ??= c.amountNote;
    same.rule ??= c.rule;
    same.relatedDate ??= c.relatedDate;
    same.userAction ??= c.userAction;
    if (!same.evidenceQuote && c.evidenceQuote) {
      same.evidenceQuote = c.evidenceQuote;
      same.evidencePage = c.evidencePage;
      same.evidenceFileIndex = c.evidenceFileIndex;
    }
  }
  return out;
}

/** 행동·금액·위험·날짜가 있는 체크인가 (사실만이 아님) */
const hasAction = (c: ExtractedCheck) => !!c.userAction || c.amount != null || c.severity === 'caution' || c.behavior === 'conditional_rule' || !!c.relatedDate;

export function dropPlainFacts(checks: ExtractedCheck[], facts: { details: Record<string, ExtractedDetail>; payments: readonly ExtractedPayment[] }): ExtractedCheck[] {
  const present = (fact: string) => {
    const [where, key] = fact.split('.');
    if (where === 'details') return facts.details[key] != null && facts.details[key].value !== '' && facts.details[key].value != null;
    if (where === 'payments') return facts.payments.some((p) => p.kind === key);
    return false;
  };
  return checks.filter((c) => {
    const def = semanticKeyDef(c.semanticKey);
    if (!def || def.policy !== 'none' || hasAction(c)) return true;
    return !(def.facts ?? []).some(present);
  });
}

/** 기한 체크의 짧은 이유 (원문 조항이 아니라 왜 챙겨야 하는지) */
function deadlineReason(key: string, noticeKind: string | null, days: number, autoRenewal: boolean): string {
  if (key === 'renewal_decision') return `계약 종료 ${days}일 전까지 갱신 여부를 확인·협의해야 해요.`;
  const auto = autoRenewal ? ' 알리지 않으면 자동으로 연장돼요.' : '';
  if (noticeKind === 'renewal_notice') return `계약 종료 ${days}일 전까지 갱신 여부를 상대방에게 알려야 해요.${auto}`;
  if (noticeKind === 'unknown' || noticeKind == null) return `계약 종료 ${days}일 전까지의 기한이 있어요. 계약서에서 의미를 확인해주세요.${auto}`;
  return `계약을 끝내려면 종료 ${days}일 전까지 상대방에게 알려야 해요.${auto}`;
}

export function deadlineChecks(
  checks: ExtractedCheck[],
  ctx: { fields: Record<string, Extracted>; dates: readonly ExtractedDate[]; noticeDays: number | null },
): ExtractedCheck[] {
  const days = ctx.noticeDays;
  const end = ctx.dates.find((d) => d.use === 'end');
  if (days == null || !end) return checks;
  const noticeKind = (ctx.fields.noticeKind?.value as string | null) ?? null;
  const key = NOTICE_SEMANTIC_KEY[noticeKind ?? 'unknown'] ?? 'termination_notice';
  const def = semanticKeyDef(key)!;
  const autoRenewal = ctx.fields.autoRenewal?.value === true;
  let out = checks;
  let target = out.find((c) => c.semanticKey === key);
  // 자동갱신 + 해지 통보: AI가 만든 자동갱신 체크를 통보 체크로 바꿔 쓴다 (원문 근거·심각도 유지)
  if (!target && key === 'termination_notice') {
    target = out.find((c) => c.semanticKey === 'auto_renewal');
    if (target) target.semanticKey = key;
  }
  if (!target) {
    const ev = ctx.fields.terminationNoticeDays.evidence?.[0];
    target = {
      severity: 'check',
      topic: 'notice_deadline',
      title: def.action ?? def.label,
      description: '',
      confidence: ctx.fields.terminationNoticeDays.confidence,
      evidenceQuote: ev?.quote ?? null,
      evidencePage: ev?.page ?? null,
      evidenceFileIndex: ev?.file ? ev.file - 1 : null,
      behavior: 'fixed_event',
      semanticKey: key,
      derivedFrom: ['terminationNoticeDays', 'endDate'],
      userAction: null,
      rule: null,
      relatedDate: null,
      amount: null,
      amountNote: null,
      suggestion: null,
    };
    out = [target, ...out];
  }
  // 할 일 중심: 제목은 할 일, 설명은 짧은 이유. 통보기한 연결(noticeSuggestions)이 붙도록 주제는 통보기한으로
  target.topic = 'notice_deadline';
  target.title = def.action ?? def.label;
  target.description = deadlineReason(key, noticeKind, days, autoRenewal);
  if (target.behavior === 'info') target.behavior = 'fixed_event';
  // 자동갱신 + 통보기한 → 통보 체크 하나 (자동 연장된다는 이유가 위 설명에 포함됨)
  if (key === 'termination_notice') out = out.filter((c) => c.semanticKey !== 'auto_renewal');
  return out;
}
