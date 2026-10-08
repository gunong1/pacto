import { paymentKindLabel } from '@/domain/contractTypes';
import type { Contract, ContractDate, ContractPayment, ContractRecord } from '@/domain/types';

import type { ContractDraft, DateDraft, PaymentDraft } from './repository';

export const EMPTY_DRAFT: ContractDraft = {
  title: '',
  category: 'other',
  contractType: 'other',
  details: {},
  counterparty: null,
  contractDate: null,
  startDate: null,
  endDate: null,
  totalAmount: null,
  depositAmount: null,
  autoRenewal: false,
  renewalPeriodMonths: null,
  terminationNoticeDays: null,
  noticeKind: 'unknown',
  earlyTerminationTerms: null,
  penaltyTerms: null,
  memo: null,
  payments: [],
  dates: [],
  valueSources: {},
};

/** 새 계약의 기본값 (draft 적용 전). */
export function blankContract(id: string, source: Contract['source'], now: string): Contract {
  return {
    id,
    title: '',
    category: 'other',
    contractType: 'other',
    details: {},
    valueSources: {},
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
  noticeKind: 'unknown',
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
    contractType: draft.contractType,
    details: draft.details,
    valueSources: draft.valueSources,
    counterparty: draft.counterparty,
    contractDate: draft.contractDate,
    startDate: draft.startDate,
    endDate: draft.endDate,
    totalAmount: draft.totalAmount,
    autoRenewal: draft.autoRenewal,
    renewalPeriodMonths: draft.autoRenewal ? draft.renewalPeriodMonths : null,
    terminationNoticeDays: draft.terminationNoticeDays,
    noticeKind: draft.noticeKind,
    depositAmount: draft.depositAmount,
    earlyTerminationTerms: draft.earlyTerminationTerms,
    penaltyTerms: draft.penaltyTerms,
    memo: draft.memo,
  };
}

/**
 * 결제 draft → 결제 규칙. 시작일이 없으면 계약 시작일(없으면 체결일, 그것도 없으면 fallback).
 * 일시불은 startsOn이 결제일이라 결제일(dayOfMonth)·회차를 쓰지 않는다.
 */
export function draftToPayment(p: PaymentDraft, draft: Pick<ContractDraft, 'startDate' | 'contractDate'>, contractId: string, id: string, fallbackStart: string): ContractPayment {
  const oneTime = p.frequency === 'one_time';
  return {
    id,
    contractId,
    kind: p.kind,
    direction: p.direction,
    label: p.label.trim() || paymentKindLabel(p.kind),
    amount: p.amount,
    frequency: p.frequency,
    dayOfMonth: oneTime ? null : p.dayOfMonth,
    monthOfYear: oneTime ? null : p.monthOfYear,
    startsOn: p.startsOn ?? draft.startDate ?? draft.contractDate ?? fallbackStart,
    endsOn: oneTime ? null : p.endsOn,
    installmentCount: oneTime ? null : p.installmentCount,
    isVariable: p.isVariable,
    components: p.components,
    businessDayRule: p.businessDayRule,
    obligation: p.obligation ?? 'confirmed',
    conditionNote: p.conditionNote ?? null,
  };
}

export function draftToPayments(draft: ContractDraft, contractId: string, newId: (i: number) => string, fallbackStart: string): ContractPayment[] {
  return draft.payments.map((p, i) => draftToPayment(p, draft, contractId, newId(i), fallbackStart));
}

export function draftToDates(draft: ContractDraft, contractId: string, newId: (i: number) => string): ContractDate[] {
  return draft.dates.map((d, i) => ({ id: newId(i), contractId, kind: d.kind, label: d.label.trim(), date: d.date }));
}

/** draft로 미리보기용 계약 레코드를 만든다 (일정 미리보기·테스트). */
export function draftToRecord(draft: ContractDraft, id: string, fallbackStart: string): ContractRecord {
  return {
    contract: applyDraftToContract(blankContract(id, 'manual', ''), draft),
    payments: draftToPayments(draft, id, (i) => `${id}-p${i}`, fallbackStart),
    dates: draftToDates(draft, id, (i) => `${id}-d${i}`),
    events: [],
    documents: [],
    aiChecks: [],
  };
}

/**
 * 저장된 계약 → 수정 폼 초기값.
 * 결제 시작일이 계약 시작일과 같으면 비워 둔다 → "시작일을 따라감"으로 보여주고, 시작일을 고치면 결제도 함께 옮겨진다.
 */
export function recordToDraft(record: Pick<ContractRecord, 'contract' | 'payments' | 'dates'>): ContractDraft {
  const { contract } = record;
  return {
    title: contract.title,
    category: contract.category,
    contractType: contract.contractType,
    details: contract.details,
    counterparty: contract.counterparty,
    contractDate: contract.contractDate,
    startDate: contract.startDate,
    endDate: contract.endDate,
    totalAmount: contract.totalAmount,
    depositAmount: contract.depositAmount,
    autoRenewal: contract.autoRenewal,
    renewalPeriodMonths: contract.renewalPeriodMonths,
    terminationNoticeDays: contract.terminationNoticeDays,
    noticeKind: contract.noticeKind,
    earlyTerminationTerms: contract.earlyTerminationTerms,
    penaltyTerms: contract.penaltyTerms,
    memo: contract.memo,
    payments: record.payments.map(
      (p): PaymentDraft => ({
        kind: p.kind,
        direction: p.direction,
        label: p.label,
        amount: p.amount,
        frequency: p.frequency,
        dayOfMonth: p.dayOfMonth,
        monthOfYear: p.monthOfYear,
        startsOn: p.startsOn === contract.startDate ? null : p.startsOn,
        endsOn: p.endsOn,
        installmentCount: p.installmentCount,
        isVariable: p.isVariable,
        components: p.components,
        businessDayRule: p.businessDayRule,
        obligation: p.obligation,
        conditionNote: p.conditionNote,
      }),
    ),
    dates: record.dates.map((d): DateDraft => ({ kind: d.kind, label: d.label, date: d.date })),
    valueSources: contract.valueSources,
  };
}

/**
 * 선택형·조건부 비용을 실제 결제로 전환 (예: 락커 이용 시작, 회원권 양도 결정).
 * 전환한 날부터 확정 결제가 되어 캘린더·지출·알림에 반영된다. 일시불은 그날 1회, 정기 결제는 그날부터 같은 날짜에.
 */
export function activateCost(record: ContractRecord, paymentId: string, date: string): ContractDraft {
  const draft = recordToDraft(record);
  const idx = record.payments.findIndex((p) => p.id === paymentId);
  if (idx < 0) throw new Error('결제 항목을 찾을 수 없어요.');
  const p = draft.payments[idx];
  draft.payments[idx] = {
    ...p,
    obligation: 'confirmed',
    startsOn: date,
    dayOfMonth: p.frequency === 'one_time' ? null : (p.dayOfMonth ?? Number(date.slice(8, 10))),
  };
  return draft;
}
