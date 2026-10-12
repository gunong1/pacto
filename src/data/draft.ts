import { EMPTY_CLASSIFICATION, legacyOf } from '@/domain/contractKinds';
import { paymentKindLabel } from '@/domain/contractTypes';
import { amountAt } from '@/domain/paymentAmount';
import { natureOf, normalizeRecord } from '@/domain/cashflow';
import type { Contract, ContractDate, ContractFund, ContractPayment, ContractRecord, ISODate } from '@/domain/types';

import type { ContractDraft, DateDraft, FundDraft, PaymentDraft } from './repository';

export const EMPTY_DRAFT: ContractDraft = {
  title: '',
  contractKind: null,
  contractSubtype: null,
  classification: EMPTY_CLASSIFICATION,
  category: 'other',
  contractType: 'other',
  details: {},
  counterparty: null,
  parties: [],
  userPartyRole: null,
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
  referenceAmounts: [],
};

/** 새 계약의 기본값 (draft 적용 전). */
export function blankContract(id: string, source: Contract['source'], now: string): Contract {
  return {
    id,
    title: '',
    contractKind: null,
    contractSubtype: null,
    classification: EMPTY_CLASSIFICATION,
    category: 'other',
    contractType: 'other',
    details: {},
    valueSources: {},
    referenceAmounts: [],
    counterparty: null,
    parties: [],
    userPartyRole: null,
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

/**
 * 저장할 하위 호환값 (contract_type·category) — 계약 종류가 있으면 레지스트리의 호환값, 없으면(기존 계약) 저장된 값 그대로.
 * 새 코드는 계약 종류가 있으면 이 두 값을 읽지 않는다 (예전 앱·예전 데이터용).
 */
export function legacyFields(draft: Pick<ContractDraft, 'contractKind' | 'contractType' | 'category'>): Pick<Contract, 'contractType' | 'category'> {
  return draft.contractKind ? legacyOf(draft.contractKind) : { contractType: draft.contractType, category: draft.category };
}

/** draft의 계약 필드만 Contract에 반영. */
export function applyDraftToContract(contract: Contract, draft: ContractDraft): Contract {
  return {
    ...contract,
    title: draft.title.trim(),
    contractKind: draft.contractKind,
    contractSubtype: draft.contractKind ? draft.contractSubtype : null,
    classification: { ...draft.classification },
    ...legacyFields(draft),
    details: draft.details,
    valueSources: draft.valueSources,
    referenceAmounts: draft.referenceAmounts.map((r) => ({ ...r })),
    counterparty: draft.counterparty,
    parties: draft.parties.map((p) => ({ ...p })),
    userPartyRole: draft.userPartyRole,
    userPartyRelation: draft.userPartyRelation !== undefined ? draft.userPartyRelation : (contract.userPartyRelation ?? null),
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
    moneyNature: p.moneyNature ?? null,
    directionBasis: p.directionBasis ?? null,
    payerRole: p.payerRole ?? null,
    payeeRole: p.payeeRole ?? null,
    fundId: p.fundKey ?? null,
  };
}

export function draftToPayments(draft: ContractDraft, contractId: string, newId: (i: number) => string, fallbackStart: string): ContractPayment[] {
  // 저장된 결제는 id를 유지한다 (변경 이력 연결)
  return draft.payments.map((p, i) => draftToPayment(p, draft, contractId, p.id ?? newId(i), fallbackStart));
}

export function draftToDates(draft: ContractDraft, contractId: string, newId: (i: number) => string): ContractDate[] {
  return draft.dates.map((d, i) => ({ id: newId(i), contractId, kind: d.kind, label: d.label.trim(), date: d.date }));
}

/** 묶음 draft → 묶음 (id는 key — 결제의 fundKey와 같은 값. 반환 기록은 저장된 것만 — refunds로 전달) */
export function draftToFunds(draft: Pick<ContractDraft, 'funds'>, contractId: string, refunds: ContractFund['refunds'] = []): ContractFund[] {
  return (draft.funds ?? []).map((f) => ({
    id: f.key,
    contractId,
    kind: f.kind,
    label: f.label,
    totalAmount: f.totalAmount,
    returnDueOn: f.returnDueOn,
    depositorRole: f.depositorRole,
    holderRole: f.holderRole,
    refunds: refunds.filter((r) => r.fundId === f.key),
  }));
}

/** draft로 미리보기용 계약 레코드를 만든다 (일정 미리보기·테스트). */
export function draftToRecord(draft: ContractDraft, id: string, fallbackStart: string): ContractRecord {
  // 저장된 계약을 읽을 때와 같은 규칙 (당사자 역할 정리 · 정할 수 있는 방향 채우기 — cashflow.normalizeRecord)
  return normalizeRecord({
    contract: applyDraftToContract(blankContract(id, 'manual', ''), draft),
    payments: draftToPayments(draft, id, (i) => `${id}-p${i}`, fallbackStart),
    dates: draftToDates(draft, id, (i) => `${id}-d${i}`),
    events: [],
    documents: [],
    aiChecks: [],
    funds: draftToFunds(draft, id),
  });
}

/** 저장된 묶음 → draft (key = id) */
export function fundsToDrafts(funds: readonly ContractFund[]): FundDraft[] {
  return funds.map((f) => ({ id: f.id, key: f.id, kind: f.kind, label: f.label, totalAmount: f.totalAmount, returnDueOn: f.returnDueOn, depositorRole: f.depositorRole, holderRole: f.holderRole }));
}

/** 묶음 없이 저장된 예전 계약의 보증금 → 보증금 묶음을 만들고 보증금 결제를 연결 (반환을 기록하기 전에 한 번) */
export const SUMMARY_FUND_KEY = 'summary';
export function withSummaryFund(draft: ContractDraft): ContractDraft {
  const funds = draft.funds ?? [];
  if (funds.some((f) => f.totalAmount == null)) return draft;
  return {
    ...draft,
    funds: [{ key: SUMMARY_FUND_KEY, kind: 'deposit', label: '보증금', totalAmount: null, returnDueOn: null, depositorRole: null, holderRole: null }, ...funds],
    payments: draft.payments.map((p) =>
      !p.fundKey && natureOf(p) === 'deposit' && p.moneyNature !== 'deposit_refund' ? { ...p, fundKey: SUMMARY_FUND_KEY } : p,
    ),
  };
}

/**
 * 저장된 계약 → 수정 폼 초기값.
 * 결제 시작일이 계약 시작일과 같으면 비워 둔다 → "시작일을 따라감"으로 보여주고, 시작일을 고치면 결제도 함께 옮겨진다.
 * amountsAt: 수정 화면은 그날 적용 중인 금액을 보여준다 (저장 전 resolveAmountEdits가 최초 금액/변경 이력으로 되돌린다).
 * 없으면 최초 금액 그대로 (다른 저장 경로).
 */
export function recordToDraft(record: Pick<ContractRecord, 'contract' | 'payments' | 'dates' | 'funds'>, amountsAt?: ISODate): ContractDraft {
  const { contract } = record;
  return {
    title: contract.title,
    contractKind: contract.contractKind,
    contractSubtype: contract.contractSubtype,
    classification: contract.classification,
    category: contract.category,
    contractType: contract.contractType,
    details: contract.details,
    counterparty: contract.counterparty,
    parties: contract.parties.map((p) => ({ ...p })),
    userPartyRole: contract.userPartyRole,
    userPartyRelation: contract.userPartyRelation ?? null,
    funds: fundsToDrafts(record.funds ?? []),
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
        id: p.id,
        kind: p.kind,
        direction: p.direction,
        label: p.label,
        amount: amountsAt && p.frequency !== 'one_time' ? amountAt(p, amountsAt) : p.amount,
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
        moneyNature: p.moneyNature ?? null,
        directionBasis: p.directionBasis ?? null,
        payerRole: p.payerRole ?? null,
        payeeRole: p.payeeRole ?? null,
        fundKey: p.fundId ?? null,
      }),
    ),
    dates: record.dates.map((d): DateDraft => ({ kind: d.kind, label: d.label, date: d.date })),
    valueSources: contract.valueSources,
    referenceAmounts: contract.referenceAmounts.map((r) => ({ ...r })),
  };
}

/**
 * 계약 체크의 조건부 비용(위약금·양도 수수료 등)이 실제로 생김 → 그날 1회 확정 결제를 만든다 (사용자가 "발생했어요"를 눌렀을 때만).
 * 체크는 그대로 두어 근거·조건을 계속 볼 수 있다.
 */
export function activateCheckCost(record: ContractRecord, checkId: string, date: string): ContractDraft {
  const check = record.aiChecks.find((c) => c.id === checkId);
  if (!check || check.amount == null) throw new Error('비용 항목을 찾을 수 없어요.');
  const draft = recordToDraft(record);
  draft.payments.push({
    kind: 'other',
    direction: 'expense',
    label: check.title,
    amount: check.amount,
    frequency: 'one_time',
    dayOfMonth: null,
    monthOfYear: null,
    startsOn: date,
    endsOn: null,
    installmentCount: null,
    isVariable: false,
    components: [],
    businessDayRule: 'none',
    obligation: 'confirmed',
    conditionNote: check.rule?.condition ?? null,
  });
  return draft;
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
