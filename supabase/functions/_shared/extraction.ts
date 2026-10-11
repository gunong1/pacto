// 계약서 분석 — 공급자와 무관한 진입점: 모델 출력(JSON) → 검증·정리된 앱 형식.
// 순수 TypeScript (Deno·Node 공용) — 앱 테스트(jest)에서도 같은 파일을 검증한다.
//
// 구조
//   extractionPrompt.ts   모델 스키마·지시문 (PROMPT_VERSION)
//   analysisRules/        의미별 정리 규칙 (각 파일 머리에 규칙 이름·목적·입력·출력·예·테스트)
//     vocabulary · values · keywords · fields · dates · payments(paymentRoles · paymentObligation · paymentDates) · checks · notices
//   extraction.ts         규칙을 정해진 순서로 적용 (이 파일)
//
// 분석 순서: 1 분야 → 2 구조 → 3·4 날짜 → 5·6 금액 → 7 유형별 속성 → 8 종료·갱신·통보 → 9 계약 체크
import { CATEGORY_CODES, CONTRACT_TYPE_CODES } from './contractRegistry.ts';
import { attachSuggestions, cleanChecks, conditionalCostsToChecks, waivedCheck } from './analysisRules/checks.ts';
import { cleanDates } from './analysisRules/dates.ts';
import { buildDetails, cleanFields } from './analysisRules/fields.ts';
import { resolveNoticeDays, resolveNoticeKind } from './analysisRules/notices.ts';
import { buildPayments } from './analysisRules/payments.ts';
import { totalsToFields } from './analysisRules/paymentRoles.ts';
import type { AppExtractionResult } from './analysisRules/types.ts';
import { classify, isObj } from './analysisRules/values.ts';
import { FIELDS } from './analysisRules/vocabulary.ts';
import { PROMPT_VERSION } from './extractionPrompt.ts';
import { maskLevel1Deep } from './protection/sensitive.ts';

export { CATEGORY_CODES, CONTRACT_TYPE_CODES, PAYMENT_KIND_CODES } from './contractRegistry.ts';
export { PROMPT_VERSION, extractionInstructions, extractionJsonSchema } from './extractionPrompt.ts';
export { BANNED_PHRASES, DATE_MEANINGS, DATE_SOURCES, FIELDS, FREQUENCIES, NOTICE_KIND_CODES, type DateSource } from './analysisRules/vocabulary.ts';
export { DATE_ANCHORS } from './analysisRules/dates.ts';
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
  if (!isObj(output) || !isObj(output.fields) || !Array.isArray(output.checks) || !isObj(output.contract_type)) throw new Error('invalid_output_shape');

  // 1·2) 분야·유형
  const category = classify(output.category, CATEGORY_CODES, 'other');
  const contractType = classify(output.contract_type, CONTRACT_TYPE_CODES, 'other');
  // 8) 공통 필드
  const fields = cleanFields(output.fields as Record<string, unknown>);
  // 3·4) 날짜
  const dates = cleanDates(output.dates);
  // 5·6) 금액 — 결제 + 결제가 아닌 금액(참고·면제·할인·할인 전) + 총액(계약 요약 칸으로)
  const { payments, references, totals } = buildPayments(output.payments, dates);
  totalsToFields(totals, fields, references);
  // 7) 유형별 속성
  const details = buildDetails(output.details, payments);
  // 9) 계약 체크
  const auto = fields.autoRenewal.value as boolean | null;
  const months = fields.renewalPeriodMonths.value as number | null;
  const checks = cleanChecks(output.checks as unknown[]);
  // 조건부 비용(위약금·연체료 …)은 결제가 아니라 계약 체크로
  conditionalCostsToChecks(payments, checks);
  waivedCheck(checks, references);
  // 8) 종료일 기준 통보기한과 그 의미
  const notice = resolveNoticeDays(fields, checks);
  fields.noticeKind = resolveNoticeKind(notice, fields.noticeKind, fields.terminationNoticeDays);
  // 체크 → 일정 관리 제안
  attachSuggestions(checks, dates, notice, auto, months);

  // 강한 보호(Level 1: 주민·외국인등록번호·카드·계좌) 원문이 인용문·설명·값에 남지 않도록 저장·반환 전에 가린다 (의미는 유지)
  return maskLevel1Deep({ category, contractType, fields, dates, payments, references, details, checks, provider, promptVersion: PROMPT_VERSION });
}
