import type {
  AiCheck,
  ContractCategory,
  ContractDocument,
  ContractEventType,
  ContractLifecycle,
  ContractRecord,
  ISODate,
  PaymentFrequency,
} from '@/domain/types';

/** 확인/수정 폼에서 확정된 계약 정보 (AI 추정값이 아니라 사용자가 확인한 값). */
export interface ContractDraft {
  title: string;
  category: ContractCategory;
  counterparty: string | null;
  contractDate: ISODate | null;
  startDate: ISODate | null;
  endDate: ISODate | null;
  totalAmount: number | null;
  paymentLabel: string | null;
  paymentAmount: number | null;
  paymentFrequency: PaymentFrequency | null;
  paymentDay: number | null;
  paymentVariable: boolean;
  autoRenewal: boolean;
  renewalPeriodMonths: number | null;
  terminationNoticeDays: number | null;
  depositAmount: number | null;
  earlyTerminationTerms: string | null;
  penaltyTerms: string | null;
  memo: string | null;
}

export interface CreateContractInput {
  draft: ContractDraft;
  source: 'upload' | 'manual';
  documents: Omit<ContractDocument, 'id' | 'contractId'>[];
  aiChecks: Omit<AiCheck, 'id' | 'contractId'>[];
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
  setEventCompleted(id: string, eventId: string, completed: boolean): Promise<ContractRecord>;
  /** AI 체크의 일정 연결 제안을 계약 정보에 반영. */
  applyAiSuggestion(id: string, checkId: string): Promise<ContractRecord>;
  setAiCheckStatus(id: string, checkId: string, status: AiCheck['status']): Promise<ContractRecord>;
  remove(id: string): Promise<void>;
}
