import {
  CONTRACT_KIND_DEFS,
  contractKindDef,
  contractKindLabel,
  contractSubtypeLabel,
  isSubtypeOf,
  type ContractKindDef,
} from '../../supabase/functions/_shared/contractRegistry';
import { withRo } from './categorySuggestion';
import { detailFields, profileOf, type ContractCategory, type ContractType, type ContractTypeProfile, type DetailFieldSpec } from './contractTypes';
import type { Confidence } from './types';

/**
 * 계약 종류 (contract_kind) — 사용자에게 보여주는 단일 기준값. 정의는 공용 레지스트리 CONTRACT_KIND_DEFS 한 곳
 * (자동 분석·직접 입력 추천·수정 화면 공통). 계약의 본질로 정하며 결제 방식과 무관하다.
 *
 * 화면 이름·유형별 속성 묶음(관리 프로필)은 계약 종류의 profile로 고른다 — 결제 일정은 언제나 저장된 결제에서 만든다.
 * 하위 호환: 계약 종류가 없는 기존 계약은 저장된 contract_type·category로 예전 표시만 한다 (다시 분류하지 않음).
 */
export { CONTRACT_KIND_DEFS, contractKindDef, contractKindLabel, contractSubtypeLabel, isSubtypeOf, type ContractKindDef };
export const CONTRACT_KINDS = CONTRACT_KIND_DEFS;

/** 분류 메타데이터 (contracts.classification) — 신뢰도·다른 후보·이유·근거·함께 포함된 요소·대상 */
export interface ClassificationMeta {
  confidence: Confidence | null;
  alternatives: string[];
  reason: string | null;
  evidence: { quote: string; page: number | null; fileIndex: number | null } | null;
  /** 혼합 계약에서 함께 포함된 계약 요소 (예: 통신 + 단말 할부). 금액은 결제에서 독립적으로 관리 */
  secondaryElements: { kind: string; note: string }[];
  /** 계약 대상 (vehicle 등) — 내부 메타데이터, 사용자가 입력하지 않음 */
  domains: string[];
  /** ai: 자동 분석 그대로 / user: 사용자가 고르거나 바꿈 / suggested: 계약명 추천 그대로 / null: 기존 데이터 */
  source: 'ai' | 'user' | 'suggested' | null;
}
export const EMPTY_CLASSIFICATION: ClassificationMeta = { confidence: null, alternatives: [], reason: null, evidence: null, secondaryElements: [], domains: [], source: null };

interface KindFields {
  contractKind: string | null;
  contractSubtype: string | null;
  contractType: ContractType;
  category: ContractCategory;
}

// ===== 기존 계약 표시 (호환) — 계약 종류가 없을 때만. 분류를 다시 판단하지 않고 예전 화면 이름 그대로 =====
const LEGACY_LABEL_BY_TYPE: Partial<Record<string, string>> = {
  employment: '근로',
  lease: '부동산·임대차',
  loan: '대출',
  insurance: '보험',
  installment: '할부',
  sale: '매매',
  service: '용역·프리랜서',
};
const LEGACY_LABEL_BY_CATEGORY: Partial<Record<string, string>> = {
  employment: '근로',
  real_estate: '부동산·임대차',
  finance: '대출',
  insurance: '보험',
  vehicle: '자동차',
  telecom: '통신',
  subscription: '구독·회원권',
  membership: '구독·회원권',
  rental: '렌탈',
  sale: '매매',
  service: '용역·프리랜서',
  education: '교육',
  business: '사업·거래',
};
/** 예전 화면의 계약 종류 이름 (월 납입형·일회성·기타는 분야로, 그 외는 유형으로) */
export function legacyKindLabel(type: string, category: string): string {
  if (type === 'recurring' || type === 'other' || type === 'one_time') return LEGACY_LABEL_BY_CATEGORY[category] ?? '기타';
  return LEGACY_LABEL_BY_TYPE[type] ?? LEGACY_LABEL_BY_CATEGORY[category] ?? '기타';
}

/** 화면에 보여줄 계약 종류 · 상세 분류 */
export function kindDisplay(c: KindFields): { label: string; subtypeLabel: string | null; legacy: boolean } {
  if (c.contractKind && contractKindDef(c.contractKind)) return { label: contractKindLabel(c.contractKind), subtypeLabel: contractSubtypeLabel(c.contractKind, c.contractSubtype), legacy: false };
  return { label: legacyKindLabel(c.contractType, c.category), subtypeLabel: null, legacy: true };
}

/** 관리 프로필 키 (화면 이름·유형별 속성·날짜 우선순위 묶음) — 계약 종류가 있으면 종류로, 없으면 기존 유형으로 */
export function profileKeyOf(c: Pick<KindFields, 'contractKind' | 'contractType'>): ContractType {
  return (contractKindDef(c.contractKind)?.profile ?? c.contractType) as ContractType;
}
export const profileFor = (c: Pick<KindFields, 'contractKind' | 'contractType'>): ContractTypeProfile => profileOf(profileKeyOf(c));
export const detailFieldsFor = (c: Pick<KindFields, 'contractKind' | 'contractType'>): readonly DetailFieldSpec[] => detailFields(profileKeyOf(c));
/** 종료 문구용 분야 (계약 종류가 있으면 종류의 호환 분야) */
export const endCategoryOf = (c: Pick<KindFields, 'contractKind' | 'category'>): ContractCategory => (contractKindDef(c.contractKind)?.legacy.category ?? c.category) as ContractCategory;

/** 계약 종류 → 하위 호환값 (contracts.contract_type·category). 새 코드는 읽지 않는다 */
export function legacyOf(kind: string): { contractType: ContractType; category: ContractCategory } {
  const d = contractKindDef(kind) ?? contractKindDef('other')!;
  return { contractType: d.legacy.type as ContractType, category: d.legacy.category as ContractCategory };
}

// ===== 등록 확인 화면의 AI 판단 표시 =====
export interface KindClassification {
  kind: string;
  subtype: string | null;
  confidence: Confidence;
  alternatives: string[];
  reason: string | null;
}

const CONFIDENCE_LABEL: Record<Confidence, string> = { high: '신뢰도 높음', medium: '신뢰도 보통', low: '신뢰도 낮음' };

/**
 * AI 판단 한 줄 + 신뢰도별 안내
 * - 높음: 자동 선택 · 다른 가능성 숨김
 * - 보통: 가장 가능성 높은 값 선택 · "○○로 분류했어요 · 변경" · 다른 가능성 표시
 * - 낮음: 임의로 확정하지 않고 후보(최대 2개)와 이유 — 사용자가 골라야 최종 등록
 */
export function classificationView(c: KindClassification) {
  const label = contractKindLabel(c.kind);
  const sub = contractSubtypeLabel(c.kind, c.subtype);
  const alternatives = c.alternatives.filter((a) => a !== c.kind && contractKindDef(a));
  return {
    headline: sub ? `${label} · ${sub}` : label,
    confidenceLabel: CONFIDENCE_LABEL[c.confidence],
    note: c.confidence === 'medium' ? `${withRo(label)} 분류했어요` : null,
    showAlternatives: c.confidence !== 'high' && alternatives.length > 0,
    alternativeLabels: alternatives.map(contractKindLabel),
    needsChoice: c.confidence === 'low',
    candidates: c.confidence === 'low' ? [c.kind, ...alternatives].slice(0, 2) : [],
    reason: c.reason,
  };
}

/** 최종 등록 가능 여부 — 신뢰도 낮음은 사용자가 종류를 골라야 한다 (임시 저장은 막지 않음) */
export function canRegisterKind(c: KindClassification, picked: string | null): boolean {
  return c.confidence !== 'low' || !!picked;
}
