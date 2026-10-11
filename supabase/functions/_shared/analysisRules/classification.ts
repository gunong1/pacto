/**
 * 계약 종류 분류 — AI가 계약의 본질로 판단한 결과를 형식·명백한 모순만 검증한다. 단어로 종류를 뒤집지 않는다.
 *
 * 규칙 K1 cleanClassification — 입력: 모델 classification 객체 / 출력: ExtractedClassification
 *   - 종류가 정해진 값이 아니면(예: 예전 "자동차") → 기타 + 신뢰도 low (임의로 다른 종류를 고르지 않음)
 *   - 상세 분류가 그 종류의 것이 아니면 상세 분류만 비운다 (명백한 모순 — 종류는 유지)
 *   - 다른 후보: 주 분류와 같은 값·없는 값 제외, 최대 2개 / 대상(domains): 정해진 값만, 중복 제거
 *   - 함께 포함된 요소: 정해진 종류이고 주 분류와 다른 것만
 *   예) kind=subscription_membership, subtype=vehicle → subtype null / kind=vehicle → other(low)
 * 규칙 K2 legacyClassifications — 하위 호환값(category·contract_type)은 레지스트리의 종류별 호환값 (AI가 따로 판단하지 않음)
 * 결제 방식(주기·방향·의무)은 이 판단에 쓰지 않는다 — 결제는 payments.ts가 독립적으로 정리한다.
 * 테스트: golden/classification.test.ts
 */
import { CONTRACT_DOMAIN_CODES, CONTRACT_KIND_CODES, contractKindDef, isSubtypeOf } from '../contractRegistry.ts';
import type { Classification, ExtractedClassification } from './types.ts';
import { confidenceOf, isObj, neutralize, oneOf, quoteOf, text } from './values.ts';

export function cleanClassification(raw: unknown): ExtractedClassification {
  const o = isObj(raw) ? raw : {};
  const kind = oneOf(CONTRACT_KIND_CODES, o.kind);
  const value = kind ?? 'other';
  const subtype = kind && typeof o.subtype === 'string' && isSubtypeOf(kind, o.subtype) ? o.subtype : null;
  const kinds = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => oneOf(CONTRACT_KIND_CODES, x)).filter((x): x is string => !!x && x !== value);
  const reason = text(o.reason, 200);
  return {
    kind: value,
    subtype,
    domains: [...new Set((Array.isArray(o.domains) ? o.domains : []).map((d) => oneOf(CONTRACT_DOMAIN_CODES, d)).filter((d): d is (typeof CONTRACT_DOMAIN_CODES)[number] => !!d))],
    confidence: kind ? confidenceOf(o.confidence) : 'low',
    alternatives: [...new Set(kinds(o.alternatives))].slice(0, 2),
    reason: reason ? neutralize(reason, '계약서 내용을 바탕으로 분류했어요.') : null,
    ...quoteOf(o),
    secondaryElements: (Array.isArray(o.secondary_elements) ? o.secondary_elements : [])
      .filter(isObj)
      .map((x) => ({ kind: oneOf(CONTRACT_KIND_CODES, x.kind), note: text(x.note, 80) ?? '' }))
      .filter((x): x is { kind: string; note: string } => !!x.kind && x.kind !== value)
      .slice(0, 3),
  };
}

export function legacyClassifications(c: ExtractedClassification): { category: Classification<never>; contractType: Classification<never> } {
  const legacy = contractKindDef(c.kind)!.legacy;
  const wrap = (v: string) => ({ value: v, confidence: c.confidence, alternatives: [], reason: c.reason }) as unknown as Classification<never>;
  return { category: wrap(legacy.category), contractType: wrap(legacy.type) };
}
