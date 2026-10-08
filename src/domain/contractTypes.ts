import { z } from 'zod';

import {
  CATEGORY_DEFS,
  CHECK_TOPIC_DEFS,
  CONTRACT_TYPE_DEFS,
  DATE_KIND_DEFS,
  DETAIL_FIELD_DEFS,
  PAYMENT_KIND_DEFS,
  type DetailInput,
  type Direction,
  type PaymentObligation,
} from '../../supabase/functions/_shared/contractRegistry';

/**
 * 계약 분야(category)와 계약 유형(contract_type).
 * - category = 무슨 계약인가 (사용자가 이해하는 분야: 근로·부동산·보험·자동차 …)
 * - contract_type = 이 계약을 어떤 방식으로 관리할지 (돈·날짜·의무가 움직이는 구조)
 * 같은 분야라도 유형이 다를 수 있다 (자동차: 할부 / 리스·장기렌트(월 납입형) / 보험 / 매매).
 *
 * 목록의 원본은 공용 레지스트리(supabase/functions/_shared/contractRegistry.ts)이고 DB 룩업 테이블과 같다.
 * 레지스트리에 없는 코드(나중에 DB에 추가된 유형 등)도 앱이 깨지지 않도록 모든 조회는 아래 함수로 하고 '기타'로 대체한다.
 * 유형은 관리 방식을 고르는 기준일 뿐, 실제 계약서 내용보다 우선하지 않는다 — 일정·지출은 저장된 결제·날짜에서 만든다.
 */

export {
  AMOUNT_ROLES,
  BUSINESS_DAY_RULES,
  CHECK_BEHAVIORS,
  DIRECTIONS,
  PAYMENT_OBLIGATIONS,
  SOURCE_TYPES,
  type BusinessDayRule,
  type PaymentObligation,
  type CheckBehavior,
  type DetailInput,
  type Direction,
  type SourceType,
} from '../../supabase/functions/_shared/contractRegistry';

export type ContractCategory = (typeof CATEGORY_DEFS)[number]['code'];
export type ContractType = (typeof CONTRACT_TYPE_DEFS)[number]['code'];
export type PaymentKind = (typeof PAYMENT_KIND_DEFS)[number]['code'];
export type ContractDateKind = (typeof DATE_KIND_DEFS)[number]['code'];

export const CONTRACT_CATEGORIES = CATEGORY_DEFS.map((d) => d.code) as unknown as readonly [ContractCategory, ...ContractCategory[]];
export const CONTRACT_TYPES = CONTRACT_TYPE_DEFS.map((d) => d.code) as unknown as readonly [ContractType, ...ContractType[]];
export const PAYMENT_KINDS = PAYMENT_KIND_DEFS.map((d) => d.code) as unknown as readonly [PaymentKind, ...PaymentKind[]];
export const CONTRACT_DATE_KINDS = DATE_KIND_DEFS.map((d) => d.code) as unknown as readonly [ContractDateKind, ...ContractDateKind[]];

const byCode = <T extends { code: string }>(defs: readonly T[]) => new Map<string, T>(defs.map((d) => [d.code, d]));
const CATEGORY_MAP = byCode(CATEGORY_DEFS);
const TYPE_MAP = byCode(CONTRACT_TYPE_DEFS);
const PAYMENT_KIND_MAP = byCode(PAYMENT_KIND_DEFS);
const DATE_KIND_MAP = byCode(DATE_KIND_DEFS);
const TOPIC_MAP = byCode(CHECK_TOPIC_DEFS);

export const categoryLabel = (c: string) => CATEGORY_MAP.get(c)?.label ?? '기타';
export const contractTypeLabel = (t: string) => TYPE_MAP.get(t)?.label ?? '기타';
export const contractTypeExamples = (t: string) => TYPE_MAP.get(t)?.examples ?? '';
export const paymentKindLabel = (k: string) => PAYMENT_KIND_MAP.get(k)?.label ?? '결제';
export const dateKindLabel = (k: string) => DATE_KIND_MAP.get(k)?.label ?? '날짜';
/** 계약 체크 주제 이름 (이전 버전 주제 이름도 지원) */
export const checkTopicLabel = (t: string) => TOPIC_MAP.get(t)?.label ?? LEGACY_TOPIC_LABEL[t] ?? '확인할 조항';
const LEGACY_TOPIC_LABEL: Record<string, string> = { termination: '해지', penalty: '중도해지·위약금', deposit: '보증금', payment: '결제 조건' };

/** 결제 의미의 기본 방향 */
export const defaultDirection = (k: string): Direction => PAYMENT_KIND_MAP.get(k)?.direction ?? 'expense';
export const DIRECTION_LABEL: Record<Direction, string> = { expense: '지출', income: '수입', neutral: '보증금·중립' };

/** 지출 합계에 넣는 결제 (보증금처럼 돌려받는 돈 = neutral, 수입 = income 은 제외) */
export function countsAsSpending(direction: Direction): boolean {
  return direction === 'expense';
}

// ===== 유형별 상세 속성 (contract_details JSONB) =====
export interface DetailFieldSpec {
  key: string;
  db: string;
  label: string;
  input: DetailInput;
  suffix?: string;
  options?: readonly { value: string; label: string }[];
}

export function detailFields(type: string): readonly DetailFieldSpec[] {
  return DETAIL_FIELD_DEFS.filter((d) => d.type === type);
}

export type DetailValue = string | number | boolean | null;
export type ContractDetails = Record<string, DetailValue>;

function detailValueSchema(spec: DetailFieldSpec) {
  switch (spec.input) {
    case 'amount':
    case 'integer':
      return z.number().int().min(0).nullable();
    case 'percent':
      return z.number().min(0).max(100).nullable();
    case 'text':
      return z.string().max(500).nullable();
    case 'boolean':
      return z.boolean().nullable();
    case 'enum':
      return z.enum((spec.options ?? []).map((o) => o.value) as [string, ...string[]]).nullable();
  }
}

/** 유형별 상세 속성 스키마 — 사용자 입력·AI 결과·저장이 같은 스키마로 검증된다. 정의되지 않은 키는 거부. */
export function detailSchema(type: string): z.ZodType<ContractDetails> {
  return z.strictObject(Object.fromEntries(detailFields(type).map((f) => [f.key, detailValueSchema(f).optional()]))) as unknown as z.ZodType<ContractDetails>;
}

/** 유형에 없는 키·형식이 틀린 값은 버린다 (AI 결과·유형 변경 시 정리). */
export function cleanDetails(type: string, input: Record<string, unknown> | null | undefined): ContractDetails {
  const out: ContractDetails = {};
  for (const spec of detailFields(type)) {
    const raw = input?.[spec.key];
    if (raw === undefined || raw === null || raw === '') continue;
    const parsed = detailValueSchema(spec).safeParse(raw);
    if (parsed.success && parsed.data !== null) out[spec.key] = parsed.data;
  }
  return out;
}

/** 앱 키 → DB JSONB 키 (null 값은 저장하지 않음) */
export function detailsToDb(type: string, details: ContractDetails): Record<string, DetailValue> {
  const out: Record<string, DetailValue> = {};
  for (const spec of detailFields(type)) {
    const v = details[spec.key];
    if (v !== undefined && v !== null) out[spec.db] = v;
  }
  return out;
}

/** DB JSONB → 앱 키 */
export function detailsFromDb(type: string, raw: unknown): ContractDetails {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const mapped: Record<string, unknown> = {};
  for (const spec of detailFields(type)) mapped[spec.key] = obj[spec.db];
  return cleanDetails(type, mapped);
}

/** DB 키 → 앱 키 (AI 결과 변환용, 모든 유형) */
export const DETAIL_DB_TO_KEY: Record<string, string> = Object.fromEntries(DETAIL_FIELD_DEFS.map((d) => [d.db, d.key]));

// ===== 유형별 프로필: 날짜 이름 · 일정 문구 · 결제 기본값 =====
export interface ContractTypeProfile {
  /** 시작일·종료일 입력/표시 이름 */
  startLabel: string;
  endLabel: string;
  /** 기간 이름 (상세 화면) */
  periodLabel: string;
  /** 캘린더 시작 일정 이름 (null = 표시하지 않음) */
  startEvent: string | null;
  /** 캘린더 종료 일정 이름 */
  endEvent: string;
  endGuidance: string;
  /** 종료 전 미리 확인할 시점 (임대차: 갱신 여부 확인) */
  prepare?: { daysBefore: number; label: string; guidance: string };
  /** 자동갱신 입력을 보여줄지 */
  hasRenewal: boolean;
  /** 해지·종료 통보기한의 이름 (의미별 이름·문구는 noticeKind.ts) */
  noticeLabel: string;
  /** 만기가 멀면 "다음 행동" 대신 "다음 결제"를 보여줄지 (할부·대출) */
  deferEndUntilDays?: number;
  /** 결제를 새로 추가할 때 고를 수 있는 의미 (앞쪽이 기본) */
  paymentKinds: readonly PaymentKind[];
  dateKinds: readonly ContractDateKind[];
}


const PROFILES: Record<ContractType, ContractTypeProfile> = {
  recurring: {
    startLabel: '이용 시작일', endLabel: '이용 종료일', periodLabel: '이용 기간',
    startEvent: '이용 시작', endEvent: '이용 종료',
    endGuidance: '종료 후 반납·소유권 이전·재약정 조건을 계약서에서 확인해주세요.',
    hasRenewal: true, noticeLabel: '해지 통보기한',
    paymentKinds: ['recurring_fee', 'setup_fee', 'deposit', 'other'],
    dateKinds: ['installation', 'activation', 'other'],
  },
  lease: {
    startLabel: '임대차 시작일', endLabel: '임대차 종료일', periodLabel: '임대차 기간',
    startEvent: '임대차 시작', endEvent: '계약 만기',
    endGuidance: '만기일의 보증금 반환·이사 일정을 확인해주세요.',
    prepare: { daysBefore: 60, label: '갱신 여부 확인', guidance: '만기 전에 재계약 또는 이사 여부를 정하고 상대방과 미리 확인해두세요.' },
    hasRenewal: true, noticeLabel: '종료 통보기한',
    paymentKinds: ['rent', 'maintenance_fee', 'deposit', 'other'],
    dateKinds: ['move_in', 'balance_due', 'other'],
  },
  installment: {
    startLabel: '할부 실행일', endLabel: '만기일', periodLabel: '할부 기간',
    startEvent: null, endEvent: '할부 만기',
    endGuidance: '마지막 회차 납입과 만기 후 처리(소유권 이전 등록 등)를 확인해주세요.',
    hasRenewal: false, noticeLabel: '통보기한', deferEndUntilDays: 90,
    paymentKinds: ['installment', 'advance_payment', 'other'],
    dateKinds: ['handover', 'other'],
  },
  loan: {
    startLabel: '대출 실행일', endLabel: '만기일', periodLabel: '대출 기간',
    startEvent: '대출 실행', endEvent: '대출 만기',
    endGuidance: '만기일의 상환·연장 조건을 확인해주세요.',
    hasRenewal: false, noticeLabel: '통보기한', deferEndUntilDays: 90,
    paymentKinds: ['loan_repayment', 'interest', 'other'],
    dateKinds: ['other'],
  },
  insurance: {
    startLabel: '보험 시작일', endLabel: '보험 만기일', periodLabel: '보험 기간',
    startEvent: '보험 시작', endEvent: '보험 만기',
    endGuidance: '만기 전에 갱신 여부와 보험료를 확인해주세요.',
    hasRenewal: true, noticeLabel: '해지 통보기한',
    paymentKinds: ['premium', 'other'],
    dateKinds: ['renewal', 'other'],
  },
  employment: {
    startLabel: '근로 시작일', endLabel: '근로 종료일', periodLabel: '근로 기간',
    startEvent: '근로 시작', endEvent: '근로계약 종료',
    endGuidance: '계약 종료 전에 갱신·전환 여부와 퇴직 관련 조건을 확인해주세요.',
    hasRenewal: false, noticeLabel: '통보기한',
    paymentKinds: ['salary', 'bonus', 'other'],
    dateKinds: ['hire', 'other'],
  },
  service: {
    startLabel: '업무 시작일', endLabel: '업무 종료일', periodLabel: '업무 기간',
    startEvent: '업무 시작', endEvent: '업무 종료',
    endGuidance: '납기·검수와 남은 대금 지급 일정을 확인해주세요.',
    hasRenewal: false, noticeLabel: '통보기한',
    paymentKinds: ['down_payment', 'interim_payment', 'balance_payment', 'service_fee', 'other'],
    dateKinds: ['delivery', 'inspection', 'other'],
  },
  sale: {
    startLabel: '계약 시작일', endLabel: '계약 완료일', periodLabel: '계약 기간',
    startEvent: null, endEvent: '매매 완료',
    endGuidance: '잔금과 인도·소유권 이전 일정을 확인해주세요.',
    hasRenewal: false, noticeLabel: '통보기한',
    paymentKinds: ['down_payment', 'interim_payment', 'balance_payment', 'other'],
    dateKinds: ['handover', 'ownership_transfer', 'other'],
  },
  one_time: {
    startLabel: '계약 시작일', endLabel: '계약 완료일', periodLabel: '계약 기간',
    startEvent: null, endEvent: '계약 완료',
    endGuidance: '완료일에 남은 잔금과 인도·이행 사항을 확인해주세요.',
    hasRenewal: false, noticeLabel: '통보기한',
    paymentKinds: ['down_payment', 'interim_payment', 'balance_payment', 'other'],
    dateKinds: ['other'],
  },
  other: {
    startLabel: '계약 시작일', endLabel: '계약 종료일', periodLabel: '계약 기간',
    startEvent: '계약 시작', endEvent: '계약 종료',
    endGuidance: '종료 후 처리할 일이 있는지 확인해주세요.',
    hasRenewal: true, noticeLabel: '해지 통보기한',
    paymentKinds: ['other', 'recurring_fee', 'setup_fee', 'deposit'],
    dateKinds: ['other'],
  },
};

/** 유형 프로필 (모르는 유형은 '기타' 프로필) */
export function profileOf(type: string): ContractTypeProfile {
  return PROFILES[type as ContractType] ?? PROFILES.other;
}

/** 분야 → 기본 유형 제안 (직접 입력에서 분야를 먼저 고른 경우). AI 분석은 계약 내용으로 유형을 정한다. */
export function defaultTypeForCategory(category: string): ContractType {
  switch (category) {
    case 'real_estate':
      return 'lease';
    case 'insurance':
      return 'insurance';
    case 'finance':
      return 'loan';
    case 'employment':
      return 'employment';
    case 'service':
      return 'service';
    case 'sale':
      return 'sale';
    case 'rental':
    case 'telecom':
    case 'membership':
    case 'subscription':
    case 'education':
      return 'recurring';
    default:
      return 'other';
  }
}

/** 금액의 의무 수준 이름 */
export const OBLIGATION_LABEL: Record<PaymentObligation, string> = {
  confirmed: '확정 결제',
  optional: '선택형',
  conditional: '조건부',
  potential: '발생 가능',
  informational: '참고 금액',
};

/** 캘린더·지출·알림에 반영되는 금액 — 지급 의무와 시점이 확정된 것만 (선택·조건부·잠재·참고 금액은 계약 조건으로만) */
export function isConfirmedPayment(p: { obligation?: PaymentObligation }): boolean {
  return (p.obligation ?? 'confirmed') === 'confirmed';
}
