import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { notificationStore } from '@/data';
import type { ContractNotificationOverride, NotificationPreferences } from '@/domain/notifications';
import { notificationKeys } from '@/features/contracts/queries';

import { pushPermission, type PushPermission } from './push';

export function useNotificationPreferences() {
  return useQuery({ queryKey: notificationKeys.preferences, queryFn: () => notificationStore.getPreferences() });
}

const SAVE_PREFS = ['notifications', 'save-preferences'] as const;

/**
 * 설정 저장 — 누르는 즉시 화면에 반영(낙관적 업데이트)하고 저장은 뒤에서. 실패하면 이전 값으로 되돌린다.
 * 빠르게 여러 번 눌러도 마지막 저장이 끝난 뒤에만 서버 값으로 다시 맞춘다 (중간 응답이 화면을 되돌리지 않도록).
 */
export function useSaveNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: SAVE_PREFS,
    mutationFn: (patch: Partial<NotificationPreferences>) => notificationStore.savePreferences(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: notificationKeys.preferences });
      const prev = qc.getQueryData<NotificationPreferences>(notificationKeys.preferences);
      if (prev) qc.setQueryData<NotificationPreferences>(notificationKeys.preferences, { ...prev, ...patch, categories: patch.categories ?? prev.categories });
      return { prev };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(notificationKeys.preferences, ctx.prev);
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey: SAVE_PREFS }) <= 1) return qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

export function useContractNotificationOverride(contractId: string) {
  return useQuery({ queryKey: notificationKeys.override(contractId), queryFn: () => notificationStore.getOverride(contractId) });
}

export function useNotificationOverrides() {
  return useQuery({ queryKey: [...notificationKeys.all, 'overrides'] as const, queryFn: () => notificationStore.listOverrides() });
}

export function useSaveContractNotificationOverride(contractId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (o: ContractNotificationOverride | null) => notificationStore.saveOverride(contractId, o),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

/** 이 기기의 알림 권한 — 설정 앱에서 돌아왔을 때 다시 확인 */
export function usePushPermission(): [PushPermission | null, () => void] {
  const [state, setState] = useState<PushPermission | null>(null);
  const refresh = useCallback(() => {
    pushPermission()
      .then(setState)
      .catch(() => setState('unavailable'));
  }, []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);
  return [state, refresh];
}
