/**
 * PACTO 도메인 타입.
 * DB 스키마(docs/ARCHITECTURE.md §4)의 P0 테이블과 같은 형태를 유지한다.
 * 날짜는 시간대 없는 로컬 날짜 문자열 'YYYY-MM-DD' (Asia/Seoul 기준), 금액은 원 단위 정수.
 */

import type { ContractCategory, ContractDateKind, ContractDetails, ContractType, Direction, PaymentKind } from './contractTypes';

export { CONTRACT_CATEGORIES } from './contractTypes';
export type { ContractCategory, ContractDateKind, ContractDetails, ContractType, Direction, PaymentKind } from './contractTypes';

export type ISODate = string;


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

/** 캘린더 항목 종류: 저장된 일정 종류 + 주요 날짜(contract_dates) + 종료 전 확인 시점 */
export type ScheduleItemType = ContractEventType | 'key_date' | 'prepare';

export type EventSource = 'system' | 'ai' | 'user';

export type ReviewSeverity = 'info' | 'check' | 'caution';

export type Confidence = 'high' | 'medium' | 'low';

export interface Contract {
  id: string;
  title: string;
  category: ContractCategory;
  /** 돈과 날짜가 움직이는 방식 (일정·지출 로직 선택) */
  contractType: ContractType;
  /** 유형별 추가 속성 (contractTypes.ts DETAIL_FIELDS) */
  details: ContractDetails;
  counterparty: string | null;
  lifecycle: ContractLifecycle;
  lifecycleChangedOn: ISODate | null;
  /** 계약 체결일 — 선택값, 기록용 (캘린더·알림에 쓰지 않음) */
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
  kind: PaymentKind;
  /** 사용자 기준 돈의 방향: 지출 / 수입(급여·용역 대금) / 중립(보증금 등 돌려받는 돈) */
  direction: Direction;
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
  /** 총 회차 (할부·대출). 있으면 마지막 회차 이후 결제는 없다. */
  installmentCount: number | null;
  isVariable: boolean;
}

/** 계약 유형별 주요 날짜 (설치일·입주일·잔금일·갱신일 …). 시작·종료·체결일은 Contract 필드. */
export interface ContractDate {
  id: string;
  contractId: string;
  kind: ContractDateKind;
  label: string;
  date: ISODate;
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
  /** private Storage 경로 '{user_id}/{document_id}.{ext}' (mock/미업로드는 null). 열람은 Signed URL로만. */
  storagePath: string | null;
  /** 기기 로컬 URI (mock 미리보기 전용) */
  localUri: string | null;
  pageCount: number | null;
}

/**
 * PACTO 계약 체크 (내부 이름: clause review) — 법적 판정이 아니라 사용자가 놓치기 쉬운, 확인이 필요한 조항.
 * 원문 근거(문서·쪽·문장)와 신뢰도를 함께 보관하고, 가능하면 일정 관리로 연결한다.
 */
export interface AiCheck {
  id: string;
  contractId: string;
  severity: ReviewSeverity;
  /** 주제 코드 (공용 레지스트리 CHECK_TOPIC_DEFS, 이전 버전 코드 포함) */
  topic: string;
  title: string;
  description: string;
  /** AI 판단 신뢰도 (이전 버전 데이터는 없음) */
  confidence?: Confidence;
  evidenceQuote: string | null;
  evidencePage: number | null;
  /** 근거가 있는 원본 문서 id (contract_documents) */
  evidenceDocumentId?: string | null;
  /** 이 조항과 관련해 계약서에 명시된 날짜 */
  relatedDate?: string | null;
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
  dates: ContractDate[];
  events: ContractEvent[];
  documents: ContractDocument[];
  aiChecks: AiCheck[];
}
