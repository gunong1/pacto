import type { Contract, ContractPayment } from '@/domain/types';

import type { ContractDraft } from './repository';

export const EMPTY_DRAFT: ContractDraft = {
  title: '',
  category: 'other',
  counterparty: null,
  contractDate: null,
  startDate: null,
  endDate: null,
  totalAmount: null,
  paymentLabel: null,
  paymentAmount: null,
  paymentFrequency: null,
  paymentDay: null,
  paymentVariable: false,
  autoRenewal: false,
  renewalPeriodMonths: null,
  terminationNoticeDays: null,
  depositAmount: null,
  earlyTerminationTerms: null,
  penaltyTerms: null,
  memo: null,
};

/** 새 계약의 기본값 (draft 적용 전). */
export function blankContract(id: string, source: Contract['source'], now: string): Contract {
  return {
    id,
    title: '',
    category: 'other',
    counterparty: null,
    lifecycle: 'active',
    lifecycleChangedOn: null,
    contractDate: null,
    startDate: null,
    endDate: null,
    totalAmount: null,
    autoRenewal: false,
    renewalPeriodMonths: null,
    terminationNoticeDays: null,
    earlyTerminationTerms: null,
    penaltyTerms: null,
    depositAmount: null,
    currency: 'KRW',
    memo: null,
    source,
    notificationsEnabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** draft의 계약 필드만 Contract에 반영. */
export function applyDraftToContract(contract: Contract, draft: ContractDraft): Contract {
  return {
    ...contract,
    title: draft.title.trim(),
    category: draft.category,
    counterparty: draft.counterparty,
    contractDate: draft.contractDate,
    startDate: draft.startDate,
    endDate: draft.endDate,
    totalAmount: draft.totalAmount,
    autoRenewal: draft.autoRenewal,
    renewalPeriodMonths: draft.autoRenewal ? draft.renewalPeriodMonths : null,
    terminationNoticeDays: draft.terminationNoticeDays,
    depositAmount: draft.depositAmount,
    earlyTerminationTerms: draft.earlyTerminationTerms,
    penaltyTerms: draft.penaltyTerms,
    memo: draft.memo,
  };
}

/** draft의 결제 정보 → 대표 결제 규칙. 금액/주기가 없으면 null. */
export function draftToPayment(draft: ContractDraft, contractId: string, id: string, fallbackStart: string): ContractPayment | null {
  if (draft.paymentAmount == null || draft.paymentFrequency == null) return null;
  return {
    id,
    contractId,
    label: draft.paymentLabel?.trim() || (draft.paymentFrequency === 'one_time' ? '결제금' : '납부금'),
    amount: draft.paymentAmount,
    frequency: draft.paymentFrequency,
    dayOfMonth: draft.paymentDay,
    monthOfYear: null,
    startsOn: draft.startDate ?? draft.contractDate ?? fallbackStart,
    endsOn: null,
    isVariable: draft.paymentVariable,
  };
}

/** 저장된 계약 → 수정 폼 초기값. */
export function recordToDraft(contract: Contract, payment: ContractPayment | undefined): ContractDraft {
  return {
    title: contract.title,
    category: contract.category,
    counterparty: contract.counterparty,
    contractDate: contract.contractDate,
    startDate: contract.startDate,
    endDate: contract.endDate,
    totalAmount: contract.totalAmount,
    paymentLabel: payment?.label ?? null,
    paymentAmount: payment?.amount ?? null,
    paymentFrequency: payment?.frequency ?? null,
    paymentDay: payment?.dayOfMonth ?? null,
    paymentVariable: payment?.isVariable ?? false,
    autoRenewal: contract.autoRenewal,
    renewalPeriodMonths: contract.renewalPeriodMonths,
    terminationNoticeDays: contract.terminationNoticeDays,
    depositAmount: contract.depositAmount,
    earlyTerminationTerms: contract.earlyTerminationTerms,
    penaltyTerms: contract.penaltyTerms,
    memo: contract.memo,
  };
}
