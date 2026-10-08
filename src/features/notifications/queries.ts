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

export function useSaveNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<NotificationPreferences>) => notificationStore.savePreferences(patch),
    onSuccess: (prefs) => {
      qc.setQueryData(notificationKeys.preferences, prefs);
      return qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/** 실제로 앞으로 보낼 알림 */
export function useUpcomingNotifications() {
  return useQuery({ queryKey: notificationKeys.upcoming, queryFn: () => notificationStore.upcoming(30) });
}

export function useContractNotificationOverride(contractId: string) {
  return useQuery({ queryKey: notificationKeys.override(contractId), queryFn: () => notificationStore.getOverride(contractId) });
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
