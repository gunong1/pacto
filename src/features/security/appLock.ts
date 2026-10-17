import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenCapture from 'expo-screen-capture';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { DEFAULT_LOCK_GRACE, parseLockGrace, shouldLockOnReturn, type DeviceAuthResult, type LockGrace } from '@/domain/appLock';

import { authenticateDevice, cancelDeviceAuth } from './deviceAuth';
import { __resetExternalActivityForTest, externalActivityInProgress } from './externalActivity';

export { withoutAppLock } from './externalActivity';

/**
 * 앱 잠금 상태 (이 기기 설정 — 서버에 저장하지 않음)
 * - 설정 값(사용 여부·잠금 시점)만 기기 보안 저장소에 둔다. 생체 정보·PIN은 OS가 처리한다.
 * - 설정을 읽지 못하면 잠근다 (fail-closed). 잠금 화면에는 항상 "로그아웃" 탈출구가 있어 영구히 갇히지 않는다.
 * - 로그아웃하면 잠금 설정을 지운다 (다음 로그인 계정은 기본값 꺼짐).
 */
const ENABLED_KEY = 'pacto.appLock.enabled';
const GRACE_KEY = 'pacto.appLock.grace';
const SCREEN_KEY = 'pacto-app-lock';

// 웹(미리보기·E2E)은 SecureStore가 없어 브라우저 저장소를 쓴다 — 웹에서는 실제 기기 인증이 없어 잠금을 켤 수 없다 (테스트용 가짜 인증 제외)
const storage = {
  get: (k: string) => (Platform.OS === 'web' ? AsyncStorage.getItem(k) : SecureStore.getItemAsync(k)),
  set: (k: string, v: string) => (Platform.OS === 'web' ? AsyncStorage.setItem(k, v) : SecureStore.setItemAsync(k, v)),
  del: (k: string) => (Platform.OS === 'web' ? AsyncStorage.removeItem(k) : SecureStore.deleteItemAsync(k)),
};

interface AppLockState {
  /** 설정을 읽었는지 — 읽기 전에는 화면 내용을 보여 주지 않는다 */
  ready: boolean;
  enabled: boolean;
  grace: LockGrace;
  locked: boolean;
  /** 기기 인증 창이 떠 있는 중 (이 동안의 앱 전환은 잠금 판단에서 뺀다) */
  authenticating: boolean;
}

export const useAppLock = create<AppLockState>(() => ({
  ready: false,
  enabled: false,
  grace: DEFAULT_LOCK_GRACE,
  locked: false,
  authenticating: false,
}));

const set = useAppLock.setState;
const get = useAppLock.getState;

/** 백그라운드로 나간 시각 (null = 나간 적 없음) */
let leftAt: number | null = null;
/** 이번 백그라운드가 외부 화면 때문인지 */
let leftForExternal = false;
let loading: Promise<void> | null = null;

async function applyScreenProtection(on: boolean) {
  if (Platform.OS === 'web') return;
  try {
    if (on) {
      // Android: FLAG_SECURE (최근 앱 미리보기 가림 + 화면 캡처 차단) / iOS: 화면 캡처 차단
      await ScreenCapture.preventScreenCaptureAsync(SCREEN_KEY);
      if (Platform.OS === 'ios') await ScreenCapture.enableAppSwitcherProtectionAsync(0.9);
    } else {
      await ScreenCapture.allowScreenCaptureAsync(SCREEN_KEY);
      if (Platform.OS === 'ios') await ScreenCapture.disableAppSwitcherProtectionAsync();
    }
  } catch {
    // 네이티브 모듈이 없는 예전 빌드 등 — 잠금 자체는 계속 동작
  }
}

/** 앱 시작 시 한 번: 설정을 읽고, 사용 중이면 잠근다 (프로세스를 새로 시작해도 잠김) */
export function loadAppLock(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      let enabled: boolean;
      let grace: LockGrace = DEFAULT_LOCK_GRACE;
      try {
        enabled = (await storage.get(ENABLED_KEY)) === '1';
        grace = parseLockGrace(await storage.get(GRACE_KEY));
      } catch {
        enabled = true;
      }
      set({ ready: true, enabled, grace, locked: enabled });
      await applyScreenProtection(enabled);
    })();
  }
  return loading;
}

/** AppState 변화 — background로 나간 시각을 기록하고, active로 돌아오면 잠금 판단 */
export function onAppStateChange(next: string, now = Date.now()) {
  const s = get();
  if (s.authenticating) return; // 기기 인증 창(PIN 화면 등)으로 잠시 나가는 것은 무시
  if (next === 'background') {
    if (leftAt == null) {
      leftAt = now;
      leftForExternal = externalActivityInProgress();
    }
    return;
  }
  if (next !== 'active') return;
  if (leftAt == null) return;
  const lock = s.ready && !s.locked && shouldLockOnReturn({ enabled: s.enabled, grace: s.grace, leftAt, now, external: leftForExternal });
  leftAt = null;
  leftForExternal = false;
  if (lock) set({ locked: true });
}

/** 인증 창이 이 시간 안에 답하지 않으면 멈춘 것으로 보고 취소한다 (다시 시도할 수 있게) */
export const AUTH_TIMEOUT_MS = 60_000;
/** 진행 중인 인증 요청 번호 — 새 요청이 오면 이전 요청은 결과를 버린다 */
let authSeq = 0;

/**
 * 기기 인증. 이미 진행 중이면 이전 요청을 취소하고 새로 띄운다
 * (잠금화면 알림으로 들어올 때처럼 앱이 화면에 오르기 전에 띄운 창은 OS가 답하지 않을 수 있어, 멈춘 채로 두지 않는다).
 */
async function authenticate(prompt: string): Promise<DeviceAuthResult> {
  const seq = ++authSeq;
  if (get().authenticating) await cancelDeviceAuth();
  set({ authenticating: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<DeviceAuthResult>((resolve) => {
      timer = setTimeout(() => {
        cancelDeviceAuth();
        resolve({ ok: false, reason: 'cancel' });
      }, AUTH_TIMEOUT_MS);
    });
    const r = await Promise.race([authenticateDevice(prompt), timeout]);
    // 더 새 요청이 있으면 이 결과는 쓰지 않는다 (성공도 무시 — 새 요청 결과로 판단)
    return seq === authSeq ? r : { ok: false, reason: 'cancel' };
  } finally {
    clearTimeout(timer);
    if (seq === authSeq) {
      // 인증 창이 닫히며 오는 active 이벤트를 무시한 뒤 풀어 준다
      leftAt = null;
      leftForExternal = false;
      set({ authenticating: false });
    }
  }
}

/** 잠금 해제 — 기기 인증 성공 시에만. 실패·취소면 잠금 유지 */
export async function unlockApp(): Promise<DeviceAuthResult> {
  const r = await authenticate('PACTO 잠금 해제');
  if (r.ok) set({ locked: false });
  return r;
}

/** 앱 잠금 켜기/끄기 — 바꾸기 전에 기기 인증. 취소·실패면 그대로 */
export async function setAppLockEnabled(next: boolean): Promise<DeviceAuthResult> {
  const r = await authenticate(next ? '앱 잠금 사용 확인' : '앱 잠금 해제 확인');
  if (!r.ok) return r;
  await storage.set(ENABLED_KEY, next ? '1' : '0');
  set({ enabled: next, locked: false });
  await applyScreenProtection(next);
  return r;
}

/** 잠금 시점 바꾸기 — 잠금을 쓰는 중이면 기기 인증 후에만 */
export async function setAppLockGrace(grace: LockGrace): Promise<DeviceAuthResult> {
  if (get().enabled) {
    const r = await authenticate('잠금 시점 변경 확인');
    if (!r.ok) return r;
  }
  await storage.set(GRACE_KEY, grace);
  set({ grace });
  return { ok: true };
}

/** 로그아웃·탈퇴 시: 잠금 설정을 지우고 잠금을 푼다 (다음 계정은 기본값 꺼짐) */
export async function resetAppLock(): Promise<void> {
  await Promise.all([storage.del(ENABLED_KEY), storage.del(GRACE_KEY)]).catch(() => undefined);
  leftAt = null;
  leftForExternal = false;
  set({ enabled: false, grace: DEFAULT_LOCK_GRACE, locked: false });
  await applyScreenProtection(false);
}

/** 테스트 전용: 모듈 상태 초기화 */
export function __resetAppLockForTest() {
  leftAt = null;
  leftForExternal = false;
  __resetExternalActivityForTest();
  loading = null;
  authSeq = 0;
  set({ ready: false, enabled: false, grace: DEFAULT_LOCK_GRACE, locked: false, authenticating: false });
}
