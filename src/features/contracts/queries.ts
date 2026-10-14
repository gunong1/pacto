import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { contractRepository, documentStore, notificationStore } from '@/data';
import type { PickedFile } from '@/data/ai/provider';
import { activateCheckCost, activateCost, confirmComponentPay, fixDepositReturn, fixLoanDisbursement, mergeLoanInterest, recordToDraft, setComponentStatus } from '@/data/draft';
import type { AmountChangeOp } from '@/domain/amountEdits';
import type { ContractDraft, CreateContractInput, NewEventInput, RefundInput } from '@/data/repository';
import { todayInSeoul } from '@/domain/dates';
import { withConfirmedRole } from '@/domain/cashflow';
import type { AiCheck, ContractLifecycle, ContractRecord, ISODate } from '@/domain/types';

export const notificationKeys = {
  all: ['notifications'] as const,
  preferences: ['notifications', 'preferences'] as const,
  upcoming: ['notifications', 'upcoming'] as const,
  override: (id: string) => ['notifications', 'override', id] as const,
};

export const contractKeys = {
  all: ['contracts'] as const,
  detail: (id: string) => ['contracts', id] as const,
};

/** 한국 시간 기준 오늘. 화면 단위로 고정해 렌더 중 날짜가 바뀌지 않게 한다. */
export function useToday(): ISODate {
  return useMemo(() => todayInSeoul(), []);
}

/** 계약 목록 조회 — 화면(useContracts)과 앱 실행 화면의 미리 불러오기가 같은 설정을 쓴다 */
export const contractsQuery = { queryKey: contractKeys.all, queryFn: () => contractRepository.list() };

export function useContracts() {
  return useQuery(contractsQuery);
}

export function useContract(id: string | undefined) {
  return useQuery({
    queryKey: contractKeys.detail(id ?? ''),
    queryFn: () => contractRepository.get(id!),
    enabled: !!id,
  });
}

/** 저장 후 홈·목록·캘린더·상세가 모두 다시 계산되도록 전체 무효화. */
function useInvalidate() {
  const qc = useQueryClient();
  return (record?: ContractRecord) => {
    if (record) qc.setQueryData(contractKeys.detail(record.contract.id), record);
    // 계약이 바뀌면 예정 알림도 바로 다시 계산 (실패해도 서버가 5분 안에 다시 계산)
    notificationStore.requestPlan().then(() => qc.invalidateQueries({ queryKey: notificationKeys.all }));
    return qc.invalidateQueries({ queryKey: contractKeys.all });
  };
}

/** 저장 실패 안내 — 원인(서버 메시지)을 짧게 붙인다. 계약 내용은 넣지 않는다 */
export function saveErrorText(error: unknown): string | null {
  if (!error) return null;
  const detail = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : '';
  return `저장하지 못했어요. 잠시 후 다시 시도해주세요.${detail ? ` (${detail.slice(0, 120)})` : ''}`;
}

export function useCreateContract() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateContractInput) => contractRepository.create(input),
    onSuccess: (r) => invalidate(r),
  });
}

export function useUpdateContract(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ draft, amountChanges = [] }: { draft: ContractDraft; amountChanges?: readonly AmountChangeOp[] }) => contractRepository.update(id, draft, amountChanges),
    onSuccess: (r) => invalidate(r),
  });
}

export function useContractActions(id: string) {
  const invalidate = useInvalidate();
  const useAction = <A extends unknown[]>(fn: (...args: A) => Promise<ContractRecord>) =>
    useMutation({ mutationFn: (args: A) => fn(...args), onSuccess: (r) => invalidate(r) });

  return {
    setLifecycle: useAction((lifecycle: ContractLifecycle, on: ISODate | null) => contractRepository.setLifecycle(id, lifecycle, on)),
    setNotifications: useAction((enabled: boolean) => contractRepository.setNotificationsEnabled(id, enabled)),
    addEvent: useAction((input: NewEventInput) => contractRepository.addEvent(id, input)),
    updateEvent: useAction((eventId: string, input: NewEventInput) => contractRepository.updateEvent(id, eventId, input)),
    removeEvent: useAction((eventId: string) => contractRepository.removeEvent(id, eventId)),
    setEventCompleted: useAction((eventId: string, done: boolean) => contractRepository.setEventCompleted(id, eventId, done)),
    applyAiSuggestion: useAction((checkId: string) => contractRepository.applyAiSuggestion(id, checkId)),
    setAiCheckStatus: useAction((checkId: string, status: AiCheck['status']) => contractRepository.setAiCheckStatus(id, checkId, status)),
    /** AI가 추정한 값을 사용자가 계약서와 비교해 확인 → user_confirmed */
    confirmValue: useAction(async (path: string) => {
      const r = await contractRepository.get(id);
      if (!r) throw new Error('계약을 찾을 수 없어요.');
      return contractRepository.update(id, { ...recordToDraft(r), valueSources: { ...r.contract.valueSources, [path]: 'user_confirmed' } });
    }),
    /** "이 계약에서 누구세요?" 확인 (홈의 추천 "맞아요" 등) — 역할에 따라 바뀌는 결제만 다시 계산, 결제 id·사용자가 고른 방향은 그대로 */
    confirmRole: useAction(async (role: string | null, relation: 'self' | 'on_behalf' | 'unknown' = role ? 'self' : 'unknown') => {
      const r = await contractRepository.get(id);
      if (!r) throw new Error('계약을 찾을 수 없어요.');
      return contractRepository.update(id, withConfirmedRole(recordToDraft(r), role, relation));
    }),
    /** 선택형·조건부 비용이 실제로 생김 (락커 이용 시작, 회원권 양도) → 그날부터 확정 결제 */
    /** 보증금·예치금 실제 반환 기록 (원래 지급 결제는 그대로) · 기록 삭제 */
    addRefund: useAction((fundKey: string, input: RefundInput) => contractRepository.addRefund(id, fundKey, input)),
    removeRefund: useAction((refundId: string) => contractRepository.removeRefund(id, refundId)),
    /** 아직 적용 전인 금액 변경 취소 */
    cancelAmountChange: useAction((changeId: string) => contractRepository.cancelAmountChange(id, changeId)),
    activateCost: useAction(async (paymentId: string, date: ISODate) => {
      const r = await contractRepository.get(id);
      if (!r) throw new Error('계약을 찾을 수 없어요.');
      return contractRepository.update(id, activateCost(r, paymentId, date));
    }),
    /** 급여의 조건부·변동·일회성 항목 지급 확정 (실제 지급일·금액 → 그날 1회 수입) / 상태만 변경 (지급 제외 등) */
    confirmComponentPay: useAction(async (paymentId: string, index: number, input: { date: ISODate; amount: number }) => {
      const r = await contractRepository.get(id);
      if (!r) throw new Error('계약을 찾을 수 없어요.');
      return contractRepository.update(id, confirmComponentPay(r, paymentId, index, input));
    }),
    setComponentStatus: useAction(async (paymentId: string, index: number, status: 'pending' | 'needs_check' | 'excluded') => {
      const r = await contractRepository.get(id);
      if (!r) throw new Error('계약을 찾을 수 없어요.');
      return contractRepository.update(id, setComponentStatus(r, paymentId, index, status));
    }),
    /** 결제로 잘못 저장된 보증금 반환 정리 (사용자가 확인했을 때만) */
    fixDepositReturn: useAction(async (paymentId: string, dateIsStated: boolean) => {
      const r = await contractRepository.get(id);
      if (!r) throw new Error('계약을 찾을 수 없어요.');
      return contractRepository.update(id, fixDepositReturn(r, paymentId, dateIsStated));
    }),
    /** 대출: 결제로 저장된 실행금 정리 (사용자가 확인했을 때만) */
    fixLoanDisbursement: useAction(async (paymentId: string) => {
      const r = await contractRepository.get(id);
      if (!r) throw new Error('계약을 찾을 수 없어요.');
      return contractRepository.update(id, fixLoanDisbursement(r, paymentId));
    }),
    /** 대출: 회차별 이자 결제 여러 개 → 이자 납부 규칙 1건 (사용자가 확인했을 때만) */
    mergeLoanInterest: useAction(async (paymentIds: string[]) => {
      const r = await contractRepository.get(id);
      if (!r) throw new Error('계약을 찾을 수 없어요.');
      return contractRepository.update(id, mergeLoanInterest(r, paymentIds));
    }),
    /** 계약 체크의 조건부 비용이 실제로 생김 → 그날 1회 결제 */
    activateCheckCost: useAction(async (checkId: string, date: ISODate) => {
      const r = await contractRepository.get(id);
      if (!r) throw new Error('계약을 찾을 수 없어요.');
      return contractRepository.update(id, activateCheckCost(r, checkId, date));
    }),
    /** 조건부 규칙: 사용자가 기준일(예: 퇴직 예정일)을 정하면 기준일 − N일 일정을 만든다 */
    scheduleRule: useAction(async (checkId: string, title: string, eventDate: ISODate) => {
      await contractRepository.addEvent(id, { title, eventDate, eventType: 'custom' });
      return contractRepository.setAiCheckStatus(id, checkId, 'acknowledged');
    }),
  };
}

export function useRemoveContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => contractRepository.remove(id),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: contractKeys.detail(id) });
      qc.invalidateQueries({ queryKey: notificationKeys.all });
      return qc.invalidateQueries({ queryKey: contractKeys.all });
    },
  });
}

/** 이미 저장된 계약에 원본 계약서 추가 (직접 입력한 계약 등) */
export function useAttachOriginal(contractId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (files: PickedFile[]) => {
      for (let i = 0; i < files.length; i++) {
        const doc = await documentStore.upload(files[i], { contractId, sortOrder: i });
        // 원본은 그대로 두고 민감정보 보호본을 만든다 (실패해도 원본 보관은 유지)
        await documentStore.protect(doc.id).catch(() => undefined);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

/** 문서별 민감정보 보호 결과 (계약 저장 전 업로드 문서 포함) */
export function useDocumentProtection(documentIds: string[]) {
  return useQuery({
    queryKey: ['protection', ...documentIds],
    queryFn: () => documentStore.getProtection(documentIds),
    enabled: documentIds.length > 0,
  });
}

/** 보호 처리 또는 가림 선택 반영 (보호본을 서버에서 다시 만든다) */
export function useProtectDocument() {
  const qc = useQueryClient();
  return useMutation({
    // password: 암호 PDF 비밀번호 — 요청 body로만, 저장하지 않음 (useProtectWithPassword)
    mutationFn: ({ documentId, regions, password }: { documentId: string; regions?: { id: string; state: 'masked' | 'unmasked' }[]; password?: string }) =>
      documentStore.protect(documentId, regions, password ? { password } : undefined),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: contractKeys.all }), qc.invalidateQueries({ queryKey: ['protection'] })]),
  });
}
