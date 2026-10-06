import type {
  AiCheck,
  BusinessDayRule,
  PaymentComponent,
  SourceType,
  ContractCategory,
  ContractDateKind,
  ContractDetails,
  ContractType,
  Direction,
  PaymentKind,
  ContractDocument,
  ContractEventType,
  ContractLifecycle,
  ContractRecord,
  ISODate,
  PaymentFrequency,
} from '@/domain/types';

/** 결제 한 건 (확인/수정 폼). 한 계약에 여러 건 — 월 렌탈료 + 설치비, 계약금 + 잔금 … */
export interface PaymentDraft {
  kind: PaymentKind;
  /** 사용자 기준 돈의 방향 (지출 / 수입 / 보증금 등 중립) */
  direction: Direction;
  label: string;
  amount: number;
  frequency: PaymentFrequency;
  /** 정기 결제일 (매월 N일). 일시불은 null */
  dayOfMonth: number | null;
  /** 연납·반기납 기준 월 */
  monthOfYear: number | null;
  /** 첫 결제일(정기) 또는 결제일(일시불). null이면 계약 시작일 */
  startsOn: ISODate | null;
  /** 마지막 결제일 (예: 보험료 납입기간 종료). null이면 계약 종료일까지 */
  endsOn: ISODate | null;
  /** 총 회차 (할부·대출) */
  installmentCount: number | null;
  isVariable: boolean;
  /** 금액 구성 (표시용, 합산하지 않음) */
  components: PaymentComponent[];
  /** 지급일이 휴일이면 직전/다음 영업일 */
  businessDayRule: BusinessDayRule;
}

/** 주요 날짜 한 건 (설치일·입주일·잔금일·갱신일 …) */
export interface DateDraft {
  kind: ContractDateKind;
  label: string;
  date: ISODate;
}

/** 확인/수정 폼에서 확정된 계약 정보 (AI 추정값이 아니라 사용자가 확인한 값). */
export interface ContractDraft {
  title: string;
  category: ContractCategory;
  contractType: ContractType;
  details: ContractDetails;
  counterparty: string | null;
  /** 선택값 — 계약서에 명확히 있을 때만 */
  contractDate: ISODate | null;
  startDate: ISODate | null;
  endDate: ISODate | null;
  totalAmount: number | null;
  depositAmount: number | null;
  autoRenewal: boolean;
  renewalPeriodMonths: number | null;
  terminationNoticeDays: number | null;
  earlyTerminationTerms: string | null;
  penaltyTerms: string | null;
  memo: string | null;
  payments: PaymentDraft[];
  dates: DateDraft[];
  /** 값별 출처 (AI 추정·PACTO 계산 구분, 사용자가 고치면 user_confirmed) */
  valueSources: Record<string, SourceType>;
}

/** 계약에 연결할 원본 문서. id가 있으면 이미 업로드된 문서(contract_documents)를 연결한다. */
export type ContractDocumentInput = Omit<ContractDocument, 'id' | 'contractId'> & { id?: string };

export interface CreateContractInput {
  draft: ContractDraft;
  source: 'upload' | 'manual';
  documents: ContractDocumentInput[];
  aiChecks: Omit<AiCheck, 'id' | 'contractId'>[];
  analysisJobId?: string | null;
  /** 확인 화면에서 "캘린더에 추가"를 고른 계약 체크 일정 (AI 제안) */
  events?: NewEventInput[];
}

export interface NewEventInput {
  title: string;
  eventDate: ISODate;
  eventType: ContractEventType;
}

/**
 * 계약 데이터 접근 인터페이스.
 * Step 1~4: MockContractRepository (인메모리), Step 5~: SupabaseContractRepository.
 * 화면 코드는 이 인터페이스에만 의존한다.
 */
export interface ContractRepository {
  list(): Promise<ContractRecord[]>;
  get(id: string): Promise<ContractRecord | null>;
  create(input: CreateContractInput): Promise<ContractRecord>;
  update(id: string, draft: ContractDraft): Promise<ContractRecord>;
  setLifecycle(id: string, lifecycle: ContractLifecycle, on: ISODate | null): Promise<ContractRecord>;
  setNotificationsEnabled(id: string, enabled: boolean): Promise<ContractRecord>;
  addEvent(id: string, input: NewEventInput): Promise<ContractRecord>;
  updateEvent(id: string, eventId: string, input: NewEventInput): Promise<ContractRecord>;
  removeEvent(id: string, eventId: string): Promise<ContractRecord>;
  setEventCompleted(id: string, eventId: string, completed: boolean): Promise<ContractRecord>;
  /** AI 체크의 일정 연결 제안을 계약 정보에 반영. */
  applyAiSuggestion(id: string, checkId: string): Promise<ContractRecord>;
  setAiCheckStatus(id: string, checkId: string, status: AiCheck['status']): Promise<ContractRecord>;
  remove(id: string): Promise<void>;
}
