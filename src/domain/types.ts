/**
 * PACTO 도메인 타입.
 * DB 스키마(docs/ARCHITECTURE.md §4)의 P0 테이블과 같은 형태를 유지한다.
 * 날짜는 시간대 없는 로컬 날짜 문자열 'YYYY-MM-DD' (Asia/Seoul 기준), 금액은 원 단위 정수.
 */

export type ISODate = string;

export const CONTRACT_CATEGORIES = [
  'real_estate',
  'vehicle',
  'insurance',
  'telecom',
  'rental',
  'finance',
  'employment',
  'business',
  'membership',
  'subscription',
  'other',
] as const;
export type ContractCategory = (typeof CONTRACT_CATEGORIES)[number];

/** DB에 저장되는 상태. 종료 임박/갱신 예정은 날짜로 계산한다 (status.ts). */
export type ContractLifecycle = 'active' | 'ended' | 'cancelled';

/** 화면에 표시하는 계산된 상태. */
export type ContractStatus = 'active' | 'ending_soon' | 'renewal_due' | 'ended' | 'cancelled';

export const PAYMENT_FREQUENCIES = [
  'monthly',
  'bimonthly',
  'quarterly',
  'semiannual',
  'yearly',
  'one_time',
] as const;
export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number];

export type ContractEventType =
  | 'payment'
  | 'contract_start'
  | 'contract_end'
  | 'renewal'
  | 'termination_notice'
  | 'custom';

export type EventSource = 'system' | 'ai' | 'user';

export type ReviewSeverity = 'info' | 'check' | 'caution';

export type Confidence = 'high' | 'medium' | 'low';

export interface Contract {
  id: string;
  title: string;
  category: ContractCategory;
  counterparty: string | null;
  lifecycle: ContractLifecycle;
  lifecycleChangedOn: ISODate | null;
  contractDate: ISODate | null;
  startDate: ISODate | null;
  endDate: ISODate | null;
  totalAmount: number | null;
  autoRenewal: boolean;
  renewalPeriodMonths: number | null;
  terminationNoticeDays: number | null;
  earlyTerminationTerms: string | null;
  penaltyTerms: string | null;
  depositAmount: number | null;
  currency: 'KRW';
  memo: string | null;
  source: 'upload' | 'manual';
  notificationsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 결제 규칙. 정기결제는 행을 무한히 만들지 않고 조회 범위에서 전개한다 (schedule.ts). */
export interface ContractPayment {
  id: string;
  contractId: string;
  label: string;
  amount: number;
  frequency: PaymentFrequency;
  /** 1~31. 해당 월에 없는 날짜는 말일로 보정. null이면 startsOn의 일자. */
  dayOfMonth: number | null;
  /** 연납/반기납 기준 월(1~12). null이면 startsOn의 월. */
  monthOfYear: number | null;
  startsOn: ISODate;
  /** null이면 계약 종료일(자동갱신이면 갱신 회차 포함)까지. */
  endsOn: ISODate | null;
  isVariable: boolean;
}

/** 사용자가 직접 추가한 일정. 시작/종료/해지통보/갱신 일정은 계약 정보에서 계산한다. */
export interface ContractEvent {
  id: string;
  contractId: string;
  eventType: ContractEventType;
  title: string;
  eventDate: ISODate;
  amount: number | null;
  source: EventSource;
  notificationEnabled: boolean;
  completedAt: string | null;
}

export interface ContractDocument {
  id: string;
  contractId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  /** V1(Step 1~4)에서는 기기 로컬 URI만 보관. 업로드는 Step 8. */
  localUri: string | null;
  pageCount: number | null;
}

/** AI 체크 결과 — 위험 평가가 아니라 확인/일정 연결을 위한 정보. */
export interface AiCheck {
  id: string;
  contractId: string;
  severity: ReviewSeverity;
  topic: 'auto_renewal' | 'termination' | 'penalty' | 'deposit' | 'payment' | 'other';
  title: string;
  description: string;
  evidenceQuote: string | null;
  evidencePage: number | null;
  /** 이 체크를 일정 관리로 연결하는 제안. */
  suggestion: AiCheckSuggestion | null;
  status: 'new' | 'acknowledged' | 'dismissed';
}

export type AiCheckSuggestion =
  | {
      kind: 'set_termination_notice';
      terminationNoticeDays: number;
      autoRenewal: boolean;
      renewalPeriodMonths: number | null;
    }
  | { kind: 'add_event'; eventType: ContractEventType; title: string; eventDate: ISODate };

/** 계약 + 하위 데이터 묶음 (화면/저장소 단위). */
export interface ContractRecord {
  contract: Contract;
  payments: ContractPayment[];
  events: ContractEvent[];
  documents: ContractDocument[];
  aiChecks: AiCheck[];
}
