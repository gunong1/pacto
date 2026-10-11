/**
 * 공통 필드·유형별 속성 정리
 *
 * 규칙 F1 cleanFields — 목적: 모델이 준 공통 필드(계약명·상대방·자동갱신·통보기한 …)를 형식에 맞게 정리
 *   입력: 모델 출력 fields(키별 객체) / 출력: Record<key, Extracted> (값이 없거나 형식이 틀리면 null + low)
 *   예) terminationNoticeDays "30일" → 30, 400 → null(범위 밖)
 * 규칙 F2 buildDetails — 목적: 유형별 속성은 계약서에 적힌 값만 남긴다
 *   입력: 모델 출력 details + 확정된 월 금액 / 출력: Record<db key, ExtractedDetail>
 *   예) 문맥으로 추정한(inferred) 숫자 속성 → 버림 / 연봉 = 월 임금과 같은 값 → 버림(월 금액을 잘못 옮긴 값)
 * 테스트: src/domain/__tests__/extraction.test.ts, salary-payday.test.ts
 */
import { DETAIL_FIELD_DEFS } from '../contractRegistry.ts';
import type { Extracted, ExtractedDetail, ExtractedPayment } from './types.ts';
import { confidenceOf, isObj, MAX_AMOUNT, oneOf, quoteOf, sourceOf, text, toInt } from './values.ts';
import { FIELDS, NOTICE_KIND_CODES } from './vocabulary.ts';

function cleanField(key: string, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  switch (FIELDS[key].type) {
    case 'string':
      if (key === 'noticeKind') return oneOf(NOTICE_KIND_CODES, raw);
      return text(raw, key === 'title' || key === 'counterparty' ? 100 : 500);
    case 'integer':
      if (key === 'renewalPeriodMonths') return toInt(raw, 1, 120);
      if (key === 'terminationNoticeDays') return toInt(raw, 0, 365);
      return toInt(raw, 0, MAX_AMOUNT);
    case 'boolean':
      return typeof raw === 'boolean' ? raw : null;
  }
}

export function cleanFields(fieldsIn: Record<string, unknown>): Record<string, Extracted> {
  const fields: Record<string, Extracted> = {};
  for (const key of Object.keys(FIELDS)) {
    const f = fieldsIn[key];
    if (!isObj(f)) {
      fields[key] = { value: null, confidence: 'low' };
      continue;
    }
    const value = cleanField(key, f.value);
    fields[key] = { value, confidence: value === null ? 'low' : confidenceOf(f.confidence), ...quoteOf(f) };
  }
  return fields;
}

/** 상세 속성 값 정제 — 해당 키의 형식(레지스트리)에 맞지 않으면 버린다. 유형별 허용 여부는 앱이 확인 */
function cleanDetail(key: string, o: Record<string, unknown>): string | number | boolean | null {
  const def = DETAIL_FIELD_DEFS.find((d) => d.db === key);
  if (!def) return null;
  switch (def.input) {
    case 'enum': {
      const v = o.text_value;
      return DETAIL_FIELD_DEFS.some((d) => d.db === key && d.options?.some((x) => x.value === v)) ? (v as string) : null;
    }
    case 'text':
      return text(o.text_value, 500);
    case 'boolean':
      return typeof o.boolean_value === 'boolean' ? o.boolean_value : null;
    case 'percent': {
      const n = typeof o.number_value === 'number' ? o.number_value : NaN;
      return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 1000) / 1000 : null;
    }
    default:
      return toInt(o.number_value, 0, MAX_AMOUNT);
  }
}

export function buildDetails(raw: unknown, payments: readonly ExtractedPayment[]): Record<string, ExtractedDetail> {
  const monthlyAmounts = new Set(payments.filter((p) => p.frequency === 'monthly').map((p) => p.amount));
  const details: Record<string, ExtractedDetail> = {};
  for (const d of Array.isArray(raw) ? raw : []) {
    if (!isObj(d) || typeof d.key !== 'string' || details[d.key]) continue;
    const value = cleanDetail(d.key, d);
    if (value === null) continue;
    const sourceType = sourceOf(d.source_type);
    const def = DETAIL_FIELD_DEFS.find((x) => x.db === d.key);
    const numeric = def?.input === 'amount' || def?.input === 'integer' || def?.input === 'percent';
    if (numeric && sourceType === 'inferred') continue;
    // 연 단위 금액이 월 금액과 같으면 월 금액을 잘못 옮긴 값 (예: 연봉 = 월 임금 3,600,000)
    if (/^annual_/.test(d.key) && typeof value === 'number' && monthlyAmounts.has(value)) continue;
    details[d.key] = { value, confidence: confidenceOf(d.confidence), sourceType, ...quoteOf(d) };
  }
  return details;
}
