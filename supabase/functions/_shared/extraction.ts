// 계약서 분석 — 공급자와 무관한 진입점: 모델 출력(JSON) → 검증·정리된 앱 형식.
// 순수 TypeScript (Deno·Node 공용) — 앱 테스트(jest)에서도 같은 파일을 검증한다.
//
// 구조
//   extractionPrompt.ts   모델 스키마·지시문 (PROMPT_VERSION)
//   analysisRules/        의미별 정리 규칙 (각 파일 머리에 규칙 이름·목적·입력·출력·예·테스트)
//     vocabulary · values · keywords · classification · fields · dates · payments(paymentRoles · paymentObligation · paymentDates)
//     · checks · checkScope · notices · renewal
//   extraction.ts         규칙을 정해진 순서로 적용 (이 파일)
//
// 분석 순서: 1 계약 종류(본질) → 3·4 날짜 → 5·6 금액(종류와 독립) → 7 유형별 속성 → 8 종료·갱신·통보 → 9 계약 체크(행동·위험만)
// "무슨 계약인가"(classification)와 "돈이 어떻게 움직이는가"(payments)는 서로의 결과를 쓰지 않는다.
import { contractKindDef, mapRole } from './contractRegistry.ts';
import { cleanClassification, legacyClassifications } from './analysisRules/classification.ts';
import { assignSemanticKeys, conditionRisks, deadlineChecks, dropPlainFacts, mergeSameMeaning, splitRoles } from './analysisRules/checkScope.ts';
import { attachSuggestions, cleanChecks, conditionalCostsToChecks, waivedCheck } from './analysisRules/checks.ts';
import { assignDateUses, cleanDates } from './analysisRules/dates.ts';
import { buildDetails, cleanFields } from './analysisRules/fields.ts';
import { cleanParties } from './analysisRules/parties.ts';
import { noticeSuggestions, resolveNoticeDays, resolveNoticeKind } from './analysisRules/notices.ts';
import { buildPayments } from './analysisRules/payments.ts';
import { installmentParents, totalsToFields } from './analysisRules/paymentRoles.ts';
import { resolveMoneyFlow } from './analysisRules/moneyFlow.ts';
import type { AppExtractionResult } from './analysisRules/types.ts';
import { isObj } from './analysisRules/values.ts';
import { FIELDS } from './analysisRules/vocabulary.ts';
import { PROMPT_VERSION } from './extractionPrompt.ts';
import { maskSensitiveDeep } from './protection/sensitive.ts';

export { CATEGORY_CODES, CONTRACT_KIND_CODES, CONTRACT_TYPE_CODES, PAYMENT_KIND_CODES } from './contractRegistry.ts';
export { PROMPT_VERSION, extractionInstructions, extractionJsonSchema } from './extractionPrompt.ts';
export { BANNED_PHRASES, DATE_MEANINGS, DATE_SOURCES, FIELDS, FREQUENCIES, NOTICE_KIND_CODES, type DateSource } from './analysisRules/vocabulary.ts';
export { DATE_ANCHORS, isRecurringPaymentDay } from './analysisRules/dates.ts';
export { PRE_DISCOUNT, quoteHasDate, quoteHasPayDay } from './analysisRules/keywords.ts';
export { anchorFromQuote, resolvePaymentDate } from './analysisRules/paymentDates.ts';
export { resolveNoticeKind } from './analysisRules/notices.ts';
export { WAIVED_CHECK_TITLE } from './analysisRules/checks.ts';
export type * from './analysisRules/types.ts';

/**
 * v7 모델 출력의 공통 필드(목록) → key별 객체 (이전 형식·mock의 객체 형식은 그대로).
 * 쪽별 필터·앱 형식 변환 전에 먼저 적용한다.
 */
export function normalizeModelOutput(output: unknown): unknown {
  if (!isObj(output) || !Array.isArray(output.fields)) return output;
  const fields: Record<string, unknown> = {};
  for (const f of output.fields) {
    if (!isObj(f) || typeof f.key !== 'string' || !(f.key in FIELDS) || fields[f.key]) continue;
    const t = FIELDS[f.key].type;
    const value = t === 'integer' ? f.number_value : t === 'boolean' ? f.boolean_value : f.text_value;
    fields[f.key] = { value: value ?? null, confidence: f.confidence, evidence_quote: f.evidence_quote ?? null, evidence_page: f.evidence_page ?? null, evidence_file: f.evidence_file ?? null };
  }
  return { ...output, fields };
}

/** 모델 출력(JSON) → 검증된 앱 형식. 구조가 틀리면 예외. 형식이 틀린 항목은 버리거나 low로 낮춘다. */
export function toAppResult(raw: unknown, provider: string): AppExtractionResult {
  const output = normalizeModelOutput(raw);
  if (!isObj(output) || !isObj(output.fields) || !Array.isArray(output.checks) || !isObj(output.classification)) throw new Error('invalid_output_shape');

  // 1) 계약 종류 — AI가 본질로 판단한 값을 형식·명백한 모순만 검증 (결제·단어로 다시 판단하지 않음)
  const classification = cleanClassification(output.classification);
  const { category, contractType } = legacyClassifications(classification);
  /** 관리 프로필 (화면 이름·날짜 우선순위 묶음) — 결제 방식이 아님 */
  const profile = contractKindDef(classification.kind)!.profile;
  // 8) 공통 필드
  const fields = cleanFields(output.fields as Record<string, unknown>);
  // 3·4) 날짜
  const dates = cleanDates(output.dates);
  // 5·6) 금액 — 결제 + 결제가 아닌 금액(참고·면제·할인·할인 전) + 총액(계약 요약 칸으로)
  // (보증금 반환은 결제가 아니다 — buildPayments가 묶음의 반환(문구에 적힌 반환일만)으로 따로 넘긴다)
  const { payments, references, totals, depositReturns } = buildPayments(output.payments, dates);
  totalsToFields(totals, fields, references);
  // 계약금·잔금 등 몫의 성격은 상위 금액(보증금·매매대금·용역대금)을 따른다 (R7)
  installmentParents(payments, totals, fields.depositAmount?.value);
  // 7) 유형별 속성
  const details = buildDetails(output.details, payments);
  // 7-1) 계약 당사자 — 계약서에 이름이 있는 쪽만. 계약서 용어(임대인)는 계약 종류의 자리(렌탈회사)로 연결 (사용자 쪽은 추측하지 않음)
  const { parties, roleMap } = cleanParties(output.parties, classification.kind, details, profile);
  // 계약서가 밝힌 지급자·수령자도 같은 자리로 (임차인이 낸다 → 고객이 낸다). 다른 사람이 내는 예외(보증인 등)는 그대로
  for (const p of payments) {
    p.payerRole = mapRole(roleMap, p.payerRole);
    p.payeeRole = mapRole(roleMap, p.payeeRole);
  }
  // 돈의 성격·방향 (F1) — 사용자 역할을 알아야 정할 수 있는 금액은 방향 확인 필요(neutral). 역할 확정은 앱에서 사용자가
  resolveMoneyFlow(payments, classification.kind);
  // 3·4) 날짜의 쓰임 (체결·시작·종료·통보·주요 날짜·결제 정보) — 서버가 정하고 앱은 옮기기만
  assignDateUses(dates, profile, payments);
  // 9) 계약 체크
  let checks = cleanChecks(output.checks as unknown[]);
  // 조건부 비용(위약금·연체료 …)은 결제가 아니라 계약 체크로
  conditionalCostsToChecks(payments, checks);
  waivedCheck(checks, references);
  // 8) 종료일 기준 통보기한과 그 의미 — 서버가 확정하거나 "확인 필요"로 (자동갱신은 AI 필드만)
  const notice = resolveNoticeDays(fields, checks, dates);
  fields.noticeKind = resolveNoticeKind(notice.days, fields.noticeKind, fields.terminationNoticeDays);
  // 9) 계약 정보(사실) ↔ 계약 체크(할 일·위험) — 의미 키로 묶고, 사실만 있는 체크는 빼고, 기한은 할 일 체크 하나로
  assignSemanticKeys(checks, (fields.noticeKind.value as string | null) ?? null);
  checks = mergeSameMeaning(checks);
  checks = dropPlainFacts(checks, { details, payments });
  // 조건 문장 안의 위험은 체크로 (모든 조건을 옮기지 않음), 같은 조항은 정보(조건)와 체크(할 일·이유)로 역할을 나눔
  checks = conditionRisks(checks, details);
  checks = deadlineChecks(checks, { fields, dates, noticeDays: notice.days });
  splitRoles(checks, details);
  noticeSuggestions(checks, notice, fields);
  // 체크 → 캘린더 일정 제안 (계약서에 명시된 날짜)
  attachSuggestions(checks, dates);

  // 민감정보(Level 1 + 2: 주민·외국인·카드·계좌·전화·이메일) 원문이 인용문·설명·값에 남지 않도록 저장·반환 전에 가린다 (의미는 유지)
  // 보안 판단은 AI가 아니라 공통 탐지기·가림 정책(protection/sensitive.ts)이 한다
  return maskSensitiveDeep({ classification, category, contractType, fields, dates, payments, references, details, parties, checks, ...(depositReturns.length ? { depositReturns } : {}), provider, promptVersion: PROMPT_VERSION });
}
