import { router } from 'expo-router';

import { useRegistration } from './store';

/**
 * 등록 모달을 닫고 저장된 계약 상세로 이동.
 * (모달 안 스택에서 dismissTo(상세)는 진입 탭에 따라 동작이 달라 명시적으로 닫은 뒤 이동)
 */
export function finishRegistration(contractId: string) {
  router.dismissTo('/');
  router.push(`/contract/${contractId}`);
  useRegistration.getState().reset();
}
