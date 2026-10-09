import type { NoticeKind } from './noticeKind';
/**
 * PACTO 도메인 타입.
 * DB 스키마(docs/ARCHITECTURE.md §4)의 P0 테이블과 같은 형태를 유지한다.
 * 날짜는 시간대 없는 로컬 날짜 문자열 'YYYY-MM-DD' (Asia/Seoul 기준), 금액은 원 단위 정수.
 */

import type { BusinessDayRule, CheckBehavior, ContractCategory, ContractDateKind, ContractDetails, ContractType, Direction, PaymentKind, PaymentObligation, SourceType } from './contractTypes';

export { CONTRACT_CATEGORIES } from './contractTypes';
export type { BusinessDayRule, CheckBehavior, ContractCategory, ContractDateKind, ContractDetails, ContractType, Direction, PaymentKind, PaymentObligation, SourceType } from './contractTypes';

/** 금액의 구성 항목 (예: 월 임금 = 기본급 + 고정연장근로수당). 표시용 — 합산하지 않는다 */
export interface PaymentComponent {
  label: string;
  amount: number;
}

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
  /**
   * 값별 출처 — 'details.employmentKind': 'inferred' 처럼. 없으면 사용자가 입력했거나 계약서 명시값.
   * 추정(inferred)·계산(calculated) 값은 명시값처럼 보이지 않게 화면에서 구분한다.
   */
  valueSources: Record<string, SourceType>;
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
  /** 통보기한의 의미 (noticeKind.ts) — 기존 계약·확신이 낮은 값은 unknown */
  noticeKind: NoticeKind;
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
  /** 1~31. 해당 월에 없는 날짜는 말일로 보정. null이면 startsOn의 일자 — 단 정기 수입(급여 등)은 null이면 지급일 미확인(일정 없음) */
  dayOfMonth: number | null;
  /** 연납/반기납 기준 월(1~12). null이면 startsOn의 월. */
  monthOfYear: number | null;
  startsOn: ISODate;
  /** null이면 계약 종료일(자동갱신이면 갱신 회차 포함)까지. */
  endsOn: ISODate | null;
  /** 총 회차 (할부·대출). 있으면 마지막 회차 이후 결제는 없다. */
  installmentCount: number | null;
  isVariable: boolean;
  /** 금액 구성 (표시용, 합산하지 않음) */
  components: PaymentComponent[];
  /** 지급일이 휴일이면: 직전 영업일(previous) / 다음 영업일(next) / 조정 없음(none) */
  businessDayRule: BusinessDayRule;
  /** 의무 수준 — confirmed만 캘린더·지출·알림에 반영 */
  obligation: PaymentObligation;
  /** 언제 내는 돈인지 (예: 회원권을 양도하는 경우, 락커를 이용하는 경우) */
  conditionNote: string | null;
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
  /** 민감정보 보호 결과 (원본과 별도) — 없으면 아직 처리 전 */
  protection?: DocumentProtection;
}

/**
 * 민감정보 보호 상태. 원본(original)은 수정하지 않고, 보호 표시본(protected_view)을 따로 만든다.
 * - protected: 찾아서 실제로 제거한 보호본이 있음 / no_sensitive_data: 찾지 못함("없다"가 아님)
 * - unreadable: OCR이 충분히 읽지 못함 / unsupported_scan: 특수한 형식의 스캔 페이지(CCITT·JBIG2·CMYK·여러 이미지 등)·스캔 페이지 수 초과
 * - failed: 처리 못 함 / pending: 처리 전
 */
export type ProtectionStatus = 'pending' | 'protected' | 'no_sensitive_data' | 'unreadable' | 'unsupported_scan' | 'failed';

export interface SensitiveRegion {
  id: string;
  page: number;
  /** resident_registration_number · credit_card · bank_account · phone · email … */
  type: string;
  level: 1 | 2 | 3;
  confidence: 'high' | 'medium' | 'low';
  /** masked 가림 / unmasked 사용자가 해제 / candidate 확신 낮은 후보(가리지 않음) */
  state: 'masked' | 'unmasked' | 'candidate';
  userConfirmed: boolean;
  /** 이미 가린 표시값 (원문 값은 어디에도 저장하지 않는다) */
  maskedPreview: string;
  contextLabel: string | null;
}

export interface DocumentProtection {
  status: ProtectionStatus;
  detail: string | null;
  /** 텍스트 문서 안 이미지(서명·사본 등)는 확인하지 못함 */
  imagesUnchecked: boolean;
  /** 보호 표시본 경로 (status = protected일 때) */
  protectedViewPath: string | null;
  regions: SensitiveRegion[];
  /** PDF 페이지별 종류·상태 (서버 protection_pages — 원문 없음). 사진·예전 처리 결과는 빈 배열 */
  pages: ProtectionPage[];
}

export interface ProtectionPage {
  page: number;
  kind: 'text' | 'scan' | 'unsupported';
  /** skipped: 다른 페이지 문제로 처리하지 않음 */
  status: Exclude<ProtectionStatus, 'pending'> | 'skipped';
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
  /** 정보 / 날짜가 정해진 일 / 조건부 의무 (조건부는 기준 날짜를 정하기 전까지 일정·다음 행동이 되지 않는다) */
  behavior?: CheckBehavior;
  /** 조건부 의무: 어떤 경우에(condition) 무엇을(action) 기준일 며칠 전에(offsetDays) */
  rule?: { condition: string; action: string; offsetDays: number | null } | null;
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
