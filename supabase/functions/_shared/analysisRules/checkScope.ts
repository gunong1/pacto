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
 * 규칙 S5 splitRoles — 계약 정보의 조건 문장(DETAIL role=condition)과 같은 의미의 체크가 같은 문장을 반복하면,
 *   체크 설명은 짧은 이유(SEMANTIC_KEY_DEFS.reason)로 바꾼다. 원문은 근거(evidence)로만 — 계약 정보: 무슨 조건 / 체크: 무엇을 해야 하나
 *   예) 계약 정보 "중도상환수수료 1.5%" · 체크 "조기 상환 전 수수료 발생 조건 확인 — 미리 갚으면 수수료가 생길 수 있어요."
 * 규칙 S6 conditionRisks — 조건 문장 안에 행동·위험이 있으면(COST_TOPICS: 원상복구·위약·연체·중도상환·손해배상) 그 의미의 체크가 없을 때 주의 체크를 만든다
 *   예) 보증금 반환 조건 "퇴거 시 통상적 사용을 초과한 훼손에 대하여 원상복구를 부담" → 원상복구 주의 체크 (단순 "종료 시 반환"은 체크 없음)
 *   모든 조건을 체크로 옮기지 않는다 — 위험·행동이 있는 문장만
 * 테스트: golden/checkScope.test.ts, golden/infoCheckRoles.test.ts
 */
import { DETAIL_FIELD_DEFS, NOTICE_SEMANTIC_KEY, semanticKeyDef, SEMANTIC_KEY_DEFS } from '../contractRegistry.ts';
import { COST_TOPICS } from './checks.ts';
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

const norm = (x: string | null | undefined) => (x ?? '').replace(/[\s.,·:;"'“”‘’()\[\]-]/g, '');
/** 두 문장이 사실상 같은 내용인가 (한쪽이 다른 쪽을 거의 그대로 담음) */
function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = norm(a), y = norm(b);
  if (x.length < 6 || y.length < 6) return false;
  return x === y || (x.includes(y) && y.length >= x.length * 0.6) || (y.includes(x) && x.length >= y.length * 0.6);
}
const conditionDefs = DETAIL_FIELD_DEFS.filter((d) => d.role === 'condition');
const conditionDef = (db: string) => conditionDefs.find((d) => d.db === db);

export function splitRoles(checks: ExtractedCheck[], details: Record<string, ExtractedDetail>): void {
  for (const c of checks) {
    const def = semanticKeyDef(c.semanticKey);
    if (!def?.reason) continue;
    for (const [db, d] of Object.entries(details)) {
      const cd = conditionDef(db);
      // 같은 의미 키이거나, 다른 칸에 들어온 같은 조항(예: 보증금 반환 조건 칸의 원상복구 문장)이어도 문장이 같으면 역할을 나눈다
      if (!cd || typeof d.value !== 'string') continue;
      if (cd.semanticKey !== c.semanticKey && !sameText(c.description, d.value)) continue;
      if (sameText(c.description, d.value) || sameText(c.description, c.evidenceQuote)) {
        c.description = def.reason;
        if (sameText(c.title, d.value) && def.action) c.title = def.action;
      }
    }
  }
}

export function conditionRisks(checks: ExtractedCheck[], details: Record<string, ExtractedDetail>): ExtractedCheck[] {
  const out = [...checks];
  for (const [db, d] of Object.entries(details)) {
    if (!conditionDef(db) || typeof d.value !== 'string') continue;
    const said = [d.value, ...(d.evidence ?? []).map((e) => e.quote)].join(' ');
    const topic = COST_TOPICS.find(([re]) => re.test(said))?.[1];
    if (!topic) continue;
    const key = TOPIC_KEY.get(topic) ?? topic;
    const def = semanticKeyDef(key);
    if (!def || def.policy === 'none' || out.some((c) => c.semanticKey === key || c.topic === topic)) continue;
    const ev = d.evidence?.[0];
    out.push({
      severity: 'caution',
      topic,
      title: def.action ?? def.label,
      description: def.reason ?? def.label,
      confidence: d.confidence,
      evidenceQuote: ev?.quote ?? null,
      evidencePage: ev?.page ?? null,
      evidenceFileIndex: ev?.file ? ev.file - 1 : null,
      behavior: def.policy === 'conditional' ? 'conditional_rule' : 'info',
      semanticKey: key,
      derivedFrom: [`details.${db}`],
      userAction: null,
      rule: def.policy === 'conditional' ? { condition: '해당 상황이 생기는 경우', action: def.action ?? def.label, offsetDays: null } : null,
      relatedDate: null,
      amount: null,
      amountNote: null,
      suggestion: null,
    });
  }
  return out;
}
