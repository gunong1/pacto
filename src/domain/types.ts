import type { NoticeKind } from './noticeKind';
/**
 * PACTO 도메인 타입.
 * DB 스키마(docs/ARCHITECTURE.md §4)의 P0 테이블과 같은 형태를 유지한다.
 * 날짜는 시간대 없는 로컬 날짜 문자열 'YYYY-MM-DD' (Asia/Seoul 기준), 금액은 원 단위 정수.
 */

import type { ClassificationMeta } from './contractKinds';
import type { ContractParty } from './parties';
import type { BusinessDayRule, CheckBehavior, ContractCategory, ContractDateKind, ContractDetails, ContractType, Direction, PaymentKind, PaymentObligation, SourceType } from './contractTypes';
import type { DirectionBasis, FundKind, MoneyNature, PartyRelation } from '../../supabase/functions/_shared/contractRegistry';

export { CONTRACT_CATEGORIES } from './contractTypes';
export type { BusinessDayRule, CheckBehavior, ContractCategory, ContractDateKind, ContractDetails, ContractType, Direction, PaymentKind, PaymentObligation, SourceType } from './contractTypes';
export type { DirectionBasis, FundKind, MoneyNature, PartyRelation } from '../../supabase/functions/_shared/contractRegistry';

/**
 * 금액의 구성 항목 (예: 월 임금 = 기본급 + 고정연장근로수당). 표시용 — 일정·합계에 따로 더하지 않는다.
 * 아래 칸은 모두 선택 (예전 데이터·예전 앱은 label·amount만) — 규칙: src/domain/payroll.ts
 */
export interface PaymentComponent {
  label: string;
  amount: number;
  /**
   * 지급 유형 (지급 예측·현금흐름용 — 통상임금·과세 판정 아님)
   * fixed 매월 확정 · conditional 조건 충족 시(성과급 등) · variable 실제 근무·실적에 따라(연장근로수당 등) · one_time 특정 시점 1회 · unknown 확인 필요
   * 없으면 예전 데이터 (unknown과 같이 다루되, 합계가 맞으면 고정으로 본다)
   */
  pay?: ComponentPayType;
  /** 금액 성격 — exact 확정 금액 · max 최대(상한) · range 범위. max·range는 확정 금액으로 쓰지 않는다 */
  amountKind?: 'exact' | 'max' | 'range';
  /** 지급 조건 (계약서 문구 요약) */
  condition?: string | null;
  /** 조건부·변동·일회성 항목의 상태 — pending 미확정 · needs_check 확인 필요 · confirmed 지급 확정 · excluded 지급 제외 */
  status?: ComponentStatus;
  /** 입사·퇴사 달 일할 계산 — daily 일할 · full 전액 · 없으면 계약의 일할 계산 규정을 따름 */
  prorate?: 'daily' | 'full' | null;
  /** 변동수당 산식 (예: 통상시급 × 연장근로시간 × 150%) — 셋 다 있을 때만 금액을 계산한다 */
  calc?: { unitAmount: number | null; quantity: number | null; ratePct: number | null } | null;
  /** 지급 확정으로 만든 결제 id (같은 항목으로 결제를 두 번 만들지 않음) */
  paymentId?: string | null;
}
export type ComponentPayType = 'fixed' | 'conditional' | 'variable' | 'one_time' | 'unknown';
export type ComponentStatus = 'pending' | 'needs_check' | 'confirmed' | 'excluded';

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

/** 결제가 아닌 금액의 종류 — total: 요약 칸(보증금·계약 총액)에 담지 못한 총액 / reference: 참고 / waived: 면제 / discount: 할인액 / before_discount: 할인 전 */
export type ReferenceAmountRole = 'total' | 'reference' | 'waived' | 'discount' | 'before_discount';

export interface ReferenceAmount {
  label: string;
  amount: number;
  role: ReferenceAmountRole;
}

export interface Contract {
  id: string;
  title: string;
  /**
   * 계약 종류 (contract_kind) — 사용자에게 보여주는 기준값 (레지스트리 CONTRACT_KIND_DEFS). 계약의 본질로 정하며 결제 방식과 무관.
   * null = 분류 개편 전에 저장된 계약 (자동 변경하지 않음 — 화면은 기존 표시, 수정·재분석할 때 채워짐)
   */
  contractKind: string | null;
  /** 상세 분류 (예: software_saas) — 계약 종류에 속한 값만 */
  contractSubtype: string | null;
  /** 분류 메타데이터 — 신뢰도·다른 후보·이유·근거·함께 포함된 요소·대상(domains) */
  classification: ClassificationMeta;
  /** 하위 호환값 (분야) — 새 코드는 계약 종류가 있으면 읽지 않는다 */
  category: ContractCategory;
  /** 하위 호환값 (관리 유형) — 새 코드는 계약 종류가 있으면 읽지 않는다. 결제 일정은 언제나 저장된 결제에서 만든다 */
  contractType: ContractType;
  /** 유형별 추가 속성 (contractTypes.ts DETAIL_FIELDS) */
  details: ContractDetails;
  /**
   * 값별 출처 — 'details.employmentKind': 'inferred' 처럼. 없으면 사용자가 입력했거나 계약서 명시값.
   * 추정(inferred)·계산(calculated) 값은 명시값처럼 보이지 않게 화면에서 구분한다.
   */
  valueSources: Record<string, SourceType>;
  /** 결제가 아닌 금액 (차량가·대출금액·할인 전 금액·면제·할인액 …) — 보여주기만, 홈·캘린더·알림 계산에 넣지 않는다 */
  referenceAmounts: ReferenceAmount[];
  counterparty: string | null;
  /** 계약 당사자 (역할 + 계약서의 이름) — 비어 있으면 예전 계약 (counterparty를 "계약 상대방"으로) · src/domain/parties.ts */
  parties: ContractParty[];
  /** 사용자가 확정한 역할 (null = 모름 — AI가 추측하지 않음, 이름 일치 추천은 저장하지 않음) */
  userPartyRole: string | null;
  /**
   * 나와 이 계약의 관계 — self: 내 계약 · on_behalf: 다른 사람(가족 등)의 계약을 관리 (userPartyRole = 그 사람의 역할)
   * · unknown: "잘 모르겠어요" (다시 묻지 않음, 방향을 정할 수 없는 금액은 확인 필요) · null: 아직 묻지 않음
   */
  userPartyRelation?: PartyRelation | null;
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
  /**
   * 사용자 기준 실제 돈의 방향: 지출(출금) / 수입(입금) / neutral = 방향 확인 필요 (예전 데이터의 "중립"도 여기 — 합계에 넣지 않는다)
   * 돈의 성격(보증금인지)은 moneyNature로 따로 — 방향을 계약 종류·이름만으로 정하지 않는다 (cashflow.ts)
   */
  direction: Direction;
  /** 돈의 성격 — ordinary 일반 · refundable_deposit 돌려받을/돌려줄 돈(보증금·예치금) · deposit_refund 그 돈의 반환 · null 예전 데이터 */
  moneyNature?: MoneyNature | null;
  /** 방향을 정한 근거 — user 사용자가 고름 · role 확정 역할로 계산 · contract 계약서·계약 구조로 명확 · null 예전 데이터 */
  directionBasis?: DirectionBasis | null;
  /** 계약서가 밝힌 실제 지급자·수령자 역할 (계약상 역할과 지급자가 다를 수 있음) — 없으면 계약 종류의 기본 흐름 */
  payerRole?: string | null;
  payeeRole?: string | null;
  /** 읽을 때만 붙는 안내 (저장하지 않음) — document_conflict: 과거 자동 판단 방향이 계약서 지급자·수령자와 반대라 확인 필요로 돌림 */
  reviewReason?: 'document_conflict' | null;
  /** 이 금액이 속한 돌려받을 돈 묶음 (보증금 계약금·잔금 → 보증금 묶음) */
  fundId?: string | null;
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
  /**
   * 금액 변경 이력 (적용일 순). amount는 최초 금액 — 어떤 날짜의 금액은 amountAt(payment, date)로 구한다.
   * 과거 일정은 변경 이력이 없는 한 최초 금액을 유지한다.
   */
  amountChanges?: PaymentAmountChange[];
}

/** 반복 결제·수입 금액 변경 — effectiveFrom부터 amount (다음 변경 전날까지) */
export interface PaymentAmountChange {
  id: string;
  paymentId: string;
  effectiveFrom: ISODate;
  amount: number;
  changeReason: string | null;
  /** 변경계약서 등 근거 문서 (추후 AI 추출 → 사용자 확인으로 연결) */
  sourceDocumentId: string | null;
  createdAt: string;
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
/** needs_review: 개인정보 칸(필드명)은 있는데 값의 위치·모양을 확정하지 못함 — 보호 완료로 보지 않고 자동 분석을 막는다 */
export type ProtectionStatus = 'pending' | 'protected' | 'no_sensitive_data' | 'unreadable' | 'needs_review' | 'unsupported_scan' | 'failed';

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

/** PDF 원본 접근: 비밀번호가 필요한지 (null = 확인 전·사진). 비밀번호·입력 실패는 저장하지 않는다 */
export type DocumentAccessStatus = 'accessible' | 'password_required' | 'unsupported_encryption';

export interface DocumentProtection {
  status: ProtectionStatus;
  detail: string | null;
  /** PDF 원본 접근 (암호) — password_required면 원본은 비밀번호를 다시 입력해야 열린다 (보호본은 비밀번호 없이) */
  access?: DocumentAccessStatus | null;
  /** 텍스트 문서 안 이미지(서명·사본 등)는 확인하지 못함 */
  imagesUnchecked: boolean;
  /** 보호 표시본 경로 (status = protected일 때) */
  protectedViewPath: string | null;
  regions: SensitiveRegion[];
  /** PDF 페이지별 종류·상태 (서버 protection_pages — 원문 없음). 사진·예전 처리 결과는 빈 배열 */
  pages: ProtectionPage[];
  /** 사용자가 분석에서 뺀 원본 페이지 (사진 한 장을 빼면 [1]) */
  excludedPages?: number[];
  /** 그중 서버가 자동으로 뺀 페이지 (글자를 거의 읽지 못함) — 사용자가 뺀 페이지와 구분 */
  autoExcludedPages?: number[];
  /** 보호본에 담긴 원본 페이지 (보호본 순서). null = 원본의 모든 페이지 */
  viewPages?: number[] | null;
}

export interface ProtectionPage {
  page: number;
  /** excluded: 사용자가 뺀 페이지 (읽지 않아 종류를 모름) */
  kind: 'text' | 'scan' | 'unsupported' | 'excluded';
  /** skipped: 다른 페이지 문제로 처리하지 않음 / excluded: 분석에서 뺀 페이지 */
  status: Exclude<ProtectionStatus, 'pending'> | 'skipped' | 'excluded';
  /** 사유 코드 (예: low_ocr_quality · 뺀 페이지는 auto_unreadable / user) */
  detail?: string | null;
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
  /** 조건부 비용의 금액 (위약금 200,000원 등) — 홈·캘린더에 넣지 않는다. "발생했어요"로 1회 결제를 만들 수 있다 */
  amount?: number | null;
  /** 금액 계산식·기준 (예: 잔여 렌탈료의 10%) */
  amountNote?: string | null;
  /** 의미 키 (레지스트리 SEMANTIC_KEY_DEFS) — 같은 의미의 체크는 하나. 이전 버전 데이터는 없음 */
  semanticKey?: string | null;
  /** 구조화된 계약 정보에서 서버가 만든 체크면 그 출처 (예: ['terminationNoticeDays', 'endDate']) */
  derivedFrom?: string[] | null;
  /** 사용자가 할 일 (AI가 찾은 경우) */
  userAction?: string | null;
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
      /** 확인이 필요한 기한 — 등록 확인 화면에서 사용자가 "N일 전 넣기"를 골라야 저장 */
      needsConfirm?: boolean;
    }
  | { kind: 'add_event'; eventType: ContractEventType; title: string; eventDate: ISODate };

/**
 * 돌려받을/돌려줄 돈 묶음 (보증금·예치금) — 한 계약에 여러 개 가능.
 * 지급은 묶음에 속한 결제(계약금·잔금 …)로, 반환은 refunds(실제 기록)로. 원래 지급 결제를 바꾸거나 뒤집지 않는다.
 */
export interface ContractFund {
  id: string;
  contractId: string;
  kind: FundKind;
  label: string;
  /** null = 계약 요약의 보증금(depositAmount)을 총액으로 (계약당 하나) */
  totalAmount: number | null;
  /** 계약서에 적힌 반환 예정일만 — 없으면 계약 종료일에 "반환 확인" (확정 반환일로 보지 않음) */
  returnDueOn: ISODate | null;
  /** 맡기는 쪽·맡아 두는 쪽 역할 (null = 계약 종류의 기본 흐름) */
  depositorRole: string | null;
  holderRole: string | null;
  refunds: FundRefund[];
}

/** 실제 반환 기록 — 일부 반환은 여러 건 */
export interface FundRefund {
  id: string;
  fundId: string;
  amount: number;
  refundedOn: ISODate;
  note: string | null;
}

/** 계약 + 하위 데이터 묶음 (화면/저장소 단위). */
export interface ContractRecord {
  contract: Contract;
  payments: ContractPayment[];
  dates: ContractDate[];
  events: ContractEvent[];
  documents: ContractDocument[];
  aiChecks: AiCheck[];
  /** 돌려받을 돈 묶음 (없으면 빈 목록 — 예전 계약) */
  funds?: ContractFund[];
}
