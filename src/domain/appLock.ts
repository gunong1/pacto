/**
 * 앱 잠금 판단 규칙 (순수 함수 — 화면·기기 기능과 분리해 테스트한다)
 * - 잠금은 기기(OS) 인증으로만 푼다. PACTO 자체 PIN·생체 정보 저장 없음. 서버 로그인과 별개.
 * - 앱 시작(프로세스 새로 시작 포함) → 잠금 사용 중이면 항상 잠금
 * - 백그라운드에서 돌아옴 → 잠금 시점(즉시 / 1분)에 따라 잠금
 * - 시계가 뒤로 가는 등 판단할 수 없으면 잠근다 (fail-closed)
 * - 사용자가 직접 연 사진 선택·카메라·파일 선택·권한 창은 잠깐 앱을 떠나도 잠그지 않는다 (최대 5분)
 */

export type LockGrace = 'immediate' | 'one_minute';

export const LOCK_GRACE_OPTIONS: { value: LockGrace; label: string }[] = [
  { value: 'immediate', label: '즉시' },
  { value: 'one_minute', label: '1분 후' },
];

export const DEFAULT_LOCK_GRACE: LockGrace = 'immediate';

const GRACE_MS: Record<LockGrace, number> = { immediate: 0, one_minute: 60_000 };

/** 사용자가 연 외부 화면(사진 선택·카메라 등)에서 이 시간 안에 돌아오면 잠그지 않는다 */
export const EXTERNAL_ACTIVITY_MAX_MS = 5 * 60_000;

export function parseLockGrace(v: unknown): LockGrace {
  return v === 'one_minute' ? 'one_minute' : DEFAULT_LOCK_GRACE;
}

/** 앱을 다시 볼 때 잠가야 하는지 */
export function shouldLockOnReturn(o: { enabled: boolean; grace: LockGrace; leftAt: number | null; now: number; external: boolean }): boolean {
  if (!o.enabled) return false;
  if (o.leftAt == null) return true;
  const away = o.now - o.leftAt;
  if (!Number.isFinite(away) || away < 0) return true;
  if (o.external && away < EXTERNAL_ACTIVITY_MAX_MS) return false;
  return away >= GRACE_MS[o.grace];
}

/** 기기 인증 결과 → 사용자에게 보여 줄 문구 (성공·취소는 문구 없음) */
export type DeviceAuthResult = { ok: true } | { ok: false; reason: 'cancel' | 'failed' | 'lockout' | 'unavailable' };

export function deviceAuthMessage(r: DeviceAuthResult): string | null {
  if (r.ok || r.reason === 'cancel') return null;
  if (r.reason === 'lockout') return '인증 시도가 너무 많아요. 잠시 후 다시 시도하거나 기기 잠금을 먼저 해제해 주세요.';
  if (r.reason === 'unavailable') return '이 기기에서 잠금 해제 인증을 사용할 수 없어요. 기기 화면 잠금 설정을 확인해 주세요.';
  return '인증하지 못했어요. 다시 시도해 주세요.';
}
