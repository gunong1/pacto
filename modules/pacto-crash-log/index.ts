import { requireOptionalNativeModule } from 'expo-modules-core';

/** 안드로이드 크래시 기록 (진단용). iOS·웹·모듈이 없는 빌드에서는 null */
interface PactoCrashLogNative {
  readLastCrash(): string | null;
  clear(): void;
  exitReasons(): { reason: number; status: number; time: number; description: string }[];
}

export const PactoCrashLog = requireOptionalNativeModule<PactoCrashLogNative>('PactoCrashLog');

/** ApplicationExitInfo.reason 코드 → 이름 */
export const EXIT_REASON: Record<number, string> = {
  0: 'unknown',
  1: 'exit_self',
  2: 'signaled',
  3: 'low_memory',
  4: 'crash(java)',
  5: 'crash_native',
  6: 'anr',
  7: 'initialization_failure',
  8: 'permission_change',
  9: 'excessive_resource_usage',
  10: 'user_requested',
  11: 'user_stopped',
  12: 'dependency_died',
  13: 'other',
  14: 'freezer',
  15: 'package_state_change',
  16: 'package_updated',
};
