import { z } from 'zod';

/**
 * 계약 유형(contract_type) — 돈과 날짜가 움직이는 방식.
 * 분야(category: 부동산·통신·보험 …)와 별개다. 예: 자동차 분야 = 할부(auto_installment) / 리스·렌트(recurring) / 보험(insurance).
 *
 * 유형은 일정·지출 로직과 화면 구성을 고르는 기준일 뿐, 실제 계약서 내용보다 우선하지 않는다.
 * 일정·지출은 언제나 그 계약에 실제로 저장된 결제 목록(payments)과 날짜(dates)에서 만들어진다.
 *
 * DB: supabase/migrations/20261006000001_contract_types.sql (enum·상세 속성 검사 함수와 목록을 맞춘다)
 */

export const CONTRACT_TYPES = ['recurring', 'lease', 'auto_installment', 'loan', 'insurance', 'one_time', 'other'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = {
  recurring: '월 납입형',
  lease: '임대차',
  auto_installment: '자동차 할부',
  loan: '대출',
  insurance: '보험',
  one_time: '일회성 계약',
  other: '기타',
};

export const CONTRACT_TYPE_EXAMPLES: Record<ContractType, string> = {
  recurring: '렌탈 · 통신 · 헬스장 · 구독 · 리스 · 렌트',
  lease: '전세 · 월세 · 반전세 · 상가',
  auto_installment: '자동차 할부 구매',
  loan: '신용 · 담보 · 전세자금 대출',
  insurance: '자동차 · 실손 · 종신 보험',
  one_time: '계약금 · 중도금 · 잔금이 있는 계약',
  other: '위에 해당하지 않는 계약',
};

// ===== 결제 의미 =====
export const PAYMENT_KINDS = [
  'recurring_fee',
  'setup_fee',
  'rent',
  'maintenance_fee',
  'deposit',
  'installment',
  'advance_payment',
  'loan_repayment',
  'interest',
  'premium',
  'down_payment',
  'interim_payment',
  'balance_payment',
  'other',
] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  recurring_fee: '정기 이용료',
  setup_fee: '설치비·가입비',
  rent: '월세',
  maintenance_fee: '관리비',
  deposit: '보증금',
  installment: '할부금',
  advance_payment: '선수금',
  loan_repayment: '원리금 상환',
  interest: '이자',
  premium: '보험료',
  down_payment: '계약금',
  interim_payment: '중도금',
  balance_payment: '잔금',
  other: '기타 결제',
};

/**
 * 지출 합계에서 제외하는 결제 — 보증금(전세금 포함)은 돌려받는 돈이라 소비 지출이 아니다.
 * 캘린더에는 돈이 움직이는 날로 표시한다.
 */
export const NON_SPENDING_PAYMENT_KINDS: ReadonlySet<PaymentKind> = new Set(['deposit']);

export function countsAsSpending(kind: PaymentKind): boolean {
  return !NON_SPENDING_PAYMENT_KINDS.has(kind);
}

// ===== 주요 날짜 의미 (시작일·종료일·체결일은 계약 공통 필드) =====
export const CONTRACT_DATE_KINDS = ['installation', 'activation', 'move_in', 'balance_due', 'renewal', 'other'] as const;
export type ContractDateKind = (typeof CONTRACT_DATE_KINDS)[number];

export const CONTRACT_DATE_KIND_LABEL: Record<ContractDateKind, string> = {
  installation: '설치일',
  activation: '개통일',
  move_in: '입주일',
  balance_due: '잔금일',
  renewal: '갱신일',
  other: '기타 날짜',
};

// ===== 유형별 상세 속성 (contract_details JSONB) =====
export type DetailInput = 'amount' | 'integer' | 'percent' | 'text' | 'enum' | 'boolean';

export interface DetailFieldSpec {
  /** 앱 키 (camelCase) */
  key: string;
  /** DB JSONB 키 (snake_case) — 정식 컬럼으로 승격할 때 이 이름을 쓴다 */
  db: string;
  label: string;
  input: DetailInput;
  suffix?: string;
  options?: readonly { value: string; label: string }[];
}

export const LEASE_KINDS = [
  { value: 'jeonse', label: '전세' },
  { value: 'monthly', label: '월세' },
  { value: 'semi_jeonse', label: '반전세' },
  { value: 'commercial', label: '상가' },
  { value: 'other', label: '기타' },
] as const;

export const REPAYMENT_METHODS = [
  { value: 'equal_payment', label: '원리금균등' },
  { value: 'equal_principal', label: '원금균등' },
  { value: 'bullet', label: '만기일시' },
  { value: 'other', label: '기타' },
] as const;

export const DETAIL_FIELDS: Record<ContractType, readonly DetailFieldSpec[]> = {
  recurring: [
    { key: 'commitmentMonths', db: 'commitment_months', label: '의무 사용기간', input: 'integer', suffix: '개월' },
    { key: 'ownershipTransferTerms', db: 'ownership_transfer_terms', label: '소유권 이전 조건', input: 'text' },
  ],
  lease: [
    { key: 'leaseKind', db: 'lease_kind', label: '임대 형태', input: 'enum', options: LEASE_KINDS },
    { key: 'renewalTerms', db: 'renewal_terms', label: '갱신 관련 조건', input: 'text' },
  ],
  auto_installment: [
    { key: 'vehicleName', db: 'vehicle_name', label: '차량', input: 'text' },
    { key: 'vehiclePrice', db: 'vehicle_price', label: '차량가', input: 'amount', suffix: '원' },
    { key: 'advancePayment', db: 'advance_payment', label: '선수금', input: 'amount', suffix: '원' },
    { key: 'principal', db: 'principal', label: '할부원금', input: 'amount', suffix: '원' },
    { key: 'interestRate', db: 'interest_rate', label: '금리', input: 'percent', suffix: '%' },
    { key: 'totalInstallments', db: 'total_installments', label: '총 할부기간', input: 'integer', suffix: '개월' },
  ],
  loan: [
    { key: 'principal', db: 'principal', label: '대출원금', input: 'amount', suffix: '원' },
    { key: 'interestRate', db: 'interest_rate', label: '금리', input: 'percent', suffix: '%' },
    { key: 'repaymentMethod', db: 'repayment_method', label: '상환방식', input: 'enum', options: REPAYMENT_METHODS },
    { key: 'prepaymentFeeTerms', db: 'prepayment_fee_terms', label: '중도상환수수료', input: 'text' },
  ],
  insurance: [
    { key: 'renewable', db: 'renewable', label: '갱신형', input: 'boolean' },
    { key: 'renewalCycleYears', db: 'renewal_cycle_years', label: '갱신 주기', input: 'integer', suffix: '년' },
    { key: 'coverageSummary', db: 'coverage_summary', label: '주요 보장', input: 'text' },
  ],
  one_time: [{ key: 'subject', db: 'subject', label: '계약 대상', input: 'text' }],
  other: [],
};

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

/** 유형별 상세 속성 스키마 — 사용자 입력·AI 결과·저장 모두 같은 스키마로 검증한다. 정의되지 않은 키는 거부. */
export const DETAIL_SCHEMAS: Record<ContractType, z.ZodType<ContractDetails>> = Object.fromEntries(
  CONTRACT_TYPES.map((t) => [
    t,
    z.strictObject(Object.fromEntries(DETAIL_FIELDS[t].map((f) => [f.key, detailValueSchema(f).optional()]))) as unknown as z.ZodType<ContractDetails>,
  ]),
) as Record<ContractType, z.ZodType<ContractDetails>>;

/** 유형에 없는 키·형식이 틀린 값은 버린다 (AI 결과 정리용). */
export function cleanDetails(type: ContractType, input: Record<string, unknown> | null | undefined): ContractDetails {
  const out: ContractDetails = {};
  for (const spec of DETAIL_FIELDS[type]) {
    const raw = input?.[spec.key];
    if (raw === undefined || raw === null || raw === '') continue;
    const parsed = detailValueSchema(spec).safeParse(raw);
    if (parsed.success && parsed.data !== null) out[spec.key] = parsed.data;
  }
  return out;
}

/** 앱 키 → DB JSONB 키 (null 값은 저장하지 않음) */
export function detailsToDb(type: ContractType, details: ContractDetails): Record<string, DetailValue> {
  const out: Record<string, DetailValue> = {};
  for (const spec of DETAIL_FIELDS[type]) {
    const v = details[spec.key];
    if (v !== undefined && v !== null) out[spec.db] = v;
  }
  return out;
}

/** DB JSONB → 앱 키 */
export function detailsFromDb(type: ContractType, raw: unknown): ContractDetails {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const mapped: Record<string, unknown> = {};
  for (const spec of DETAIL_FIELDS[type]) mapped[spec.key] = obj[spec.db];
  return cleanDetails(type, mapped);
}

// ===== 유형별 프로필: 날짜 이름 · 일정 문구 · 결제 기본값 =====
export interface ContractTypeProfile {
  /** 시작일·종료일 입력/표시 이름 */
  startLabel: string;
  endLabel: string;
  /** 캘린더 시작 일정 이름 (null = 표시하지 않음) */
  startEvent: string | null;
  /** 캘린더 종료 일정 이름 */
  endEvent: string;
  endGuidance: string;
  /** 종료 전 미리 확인할 시점 (임대차: 갱신 확인) */
  prepare?: { daysBefore: number; label: string; guidance: string };
  /** 자동갱신·해지 통보 입력을 보여줄지 */
  hasRenewal: boolean;
  noticeLabel: string;
  noticeGuidance: (monthDay: string) => string;
  /** 결제를 새로 추가할 때 기본 의미와 고를 수 있는 의미 (앞쪽이 자주 쓰는 것) */
  paymentKinds: readonly PaymentKind[];
  dateKinds: readonly ContractDateKind[];
}

const RENEWAL_NOTICE = (md: string) => `계약서 기준 ${md}까지 해지 의사를 전달해야 자동갱신을 피할 수 있습니다.`;

export const CONTRACT_TYPE_PROFILES: Record<ContractType, ContractTypeProfile> = {
  recurring: {
    startLabel: '이용 시작일',
    endLabel: '이용 종료일',
    startEvent: '이용 시작',
    endEvent: '이용 종료',
    endGuidance: '종료 후 반납·소유권 이전·재약정 조건을 계약서에서 확인해주세요.',
    hasRenewal: true,
    noticeLabel: '해지 통보기한',
    noticeGuidance: RENEWAL_NOTICE,
    paymentKinds: ['recurring_fee', 'setup_fee', 'deposit', 'other'],
    dateKinds: ['installation', 'activation', 'other'],
  },
  lease: {
    startLabel: '임대차 시작일',
    endLabel: '임대차 종료일',
    startEvent: '임대차 시작',
    endEvent: '계약 만기',
    endGuidance: '만기일의 보증금 반환·이사 일정을 확인해주세요.',
    prepare: { daysBefore: 60, label: '갱신 여부 확인', guidance: '만기 전에 재계약 또는 이사 여부를 정하고 상대방과 미리 확인해두세요.' },
    hasRenewal: true,
    noticeLabel: '종료 통보기한',
    noticeGuidance: (md) => `계약서에 적힌 통보기한이에요. 종료 또는 갱신 여부를 ${md}까지 상대방에게 알려주세요.`,
    paymentKinds: ['rent', 'maintenance_fee', 'deposit', 'down_payment', 'balance_payment', 'other'],
    dateKinds: ['move_in', 'balance_due', 'other'],
  },
  auto_installment: {
    startLabel: '할부 실행일',
    endLabel: '만기일',
    startEvent: null,
    endEvent: '할부 만기',
    endGuidance: '마지막 회차 납입과 만기 후 처리(소유권 이전 등록 등)를 확인해주세요.',
    hasRenewal: false,
    noticeLabel: '통보기한',
    noticeGuidance: (md) => `계약서에 적힌 기한이에요. ${md}까지 필요한 의사를 전달해주세요.`,
    paymentKinds: ['installment', 'advance_payment', 'other'],
    dateKinds: ['other'],
  },
  loan: {
    startLabel: '대출 실행일',
    endLabel: '만기일',
    startEvent: '대출 실행',
    endEvent: '대출 만기',
    endGuidance: '만기일의 상환·연장 조건을 확인해주세요.',
    hasRenewal: false,
    noticeLabel: '통보기한',
    noticeGuidance: (md) => `계약서에 적힌 기한이에요. ${md}까지 필요한 의사를 전달해주세요.`,
    paymentKinds: ['loan_repayment', 'interest', 'other'],
    dateKinds: ['other'],
  },
  insurance: {
    startLabel: '보험 시작일',
    endLabel: '보험 만기일',
    startEvent: '보험 시작',
    endEvent: '보험 만기',
    endGuidance: '만기 전에 갱신 여부와 보험료를 확인해주세요.',
    hasRenewal: true,
    noticeLabel: '해지 통보기한',
    noticeGuidance: RENEWAL_NOTICE,
    paymentKinds: ['premium', 'other'],
    dateKinds: ['renewal', 'other'],
  },
  one_time: {
    startLabel: '계약 시작일',
    endLabel: '계약 완료일',
    startEvent: null,
    endEvent: '계약 완료',
    endGuidance: '완료일에 남은 잔금과 인도·이행 사항을 확인해주세요.',
    hasRenewal: false,
    noticeLabel: '통보기한',
    noticeGuidance: (md) => `계약서에 적힌 기한이에요. ${md}까지 필요한 의사를 전달해주세요.`,
    paymentKinds: ['down_payment', 'interim_payment', 'balance_payment', 'other'],
    dateKinds: ['other'],
  },
  other: {
    startLabel: '계약 시작일',
    endLabel: '계약 종료일',
    startEvent: '계약 시작',
    endEvent: '계약 종료',
    endGuidance: '종료 후 처리할 일이 있는지 확인해주세요.',
    hasRenewal: true,
    noticeLabel: '해지 통보기한',
    noticeGuidance: RENEWAL_NOTICE,
    paymentKinds: ['other', 'recurring_fee', 'setup_fee', 'deposit'],
    dateKinds: ['other'],
  },
};

/** 분야 → 기본 유형 (직접 입력에서 분야를 먼저 고른 경우의 제안값) */
export function defaultTypeForCategory(category: string): ContractType {
  switch (category) {
    case 'real_estate':
      return 'lease';
    case 'insurance':
      return 'insurance';
    case 'finance':
      return 'loan';
    case 'rental':
    case 'telecom':
    case 'membership':
    case 'subscription':
      return 'recurring';
    default:
      return 'other';
  }
}
