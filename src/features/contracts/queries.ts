import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { contractRepository, documentStore } from '@/data';
import type { PickedFile } from '@/data/ai/provider';
import type { ContractDraft, CreateContractInput, NewEventInput } from '@/data/repository';
import { todayInSeoul } from '@/domain/dates';
import type { AiCheck, ContractLifecycle, ContractRecord, ISODate } from '@/domain/types';

export const contractKeys = {
  all: ['contracts'] as const,
  detail: (id: string) => ['contracts', id] as const,
};

/** 한국 시간 기준 오늘. 화면 단위로 고정해 렌더 중 날짜가 바뀌지 않게 한다. */
export function useToday(): ISODate {
  return useMemo(() => todayInSeoul(), []);
}

export function useContracts() {
  return useQuery({ queryKey: contractKeys.all, queryFn: () => contractRepository.list() });
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
    return qc.invalidateQueries({ queryKey: contractKeys.all });
  };
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
    mutationFn: (draft: ContractDraft) => contractRepository.update(id, draft),
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
  };
}

export function useRemoveContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => contractRepository.remove(id),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: contractKeys.detail(id) });
      return qc.invalidateQueries({ queryKey: contractKeys.all });
    },
  });
}

/** 이미 저장된 계약에 원본 계약서 추가 (직접 입력한 계약 등) */
export function useAttachOriginal(contractId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (files: PickedFile[]) => {
      for (let i = 0; i < files.length; i++) await documentStore.upload(files[i], { contractId, sortOrder: i });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: contractKeys.all }),
  });
}
