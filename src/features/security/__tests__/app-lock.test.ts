/* 앱 잠금 — 판단 규칙(순수) + 상태 흐름(기기 인증은 가짜) */
import { deviceAuthMessage, EXTERNAL_ACTIVITY_MAX_MS, parseLockGrace, shouldLockOnReturn, type DeviceAuthResult } from '@/domain/appLock';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  removeItem: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
const mockScreen = { prevent: 0, allow: 0 };
jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(async () => void mockScreen.prevent++),
  allowScreenCaptureAsync: jest.fn(async () => void mockScreen.allow++),
  enableAppSwitcherProtectionAsync: jest.fn(async () => undefined),
  disableAppSwitcherProtectionAsync: jest.fn(async () => undefined),
}));
const mockAuth: { next: DeviceAuthResult; calls: number; during?: () => void } = { next: { ok: true }, calls: 0 };
const mockCancel = { calls: 0 };
jest.mock('../deviceAuth', () => ({
  authenticateDevice: jest.fn(async () => {
    mockAuth.calls++;
    mockAuth.during?.();
    return mockAuth.next;
  }),
  cancelDeviceAuth: jest.fn(async () => void mockCancel.calls++),
}));

// eslint-disable-next-line import/first
import { __resetAppLockForTest, AUTH_TIMEOUT_MS, loadAppLock, onAppStateChange, resetAppLock, setAppLockEnabled, setAppLockGrace, unlockApp, useAppLock, withoutAppLock } from '../appLock';

const base = { enabled: true, grace: 'immediate' as const, leftAt: 1_000, now: 1_000, external: false };

describe('판단 규칙 shouldLockOnReturn', () => {
  test('사용 안 함 → 잠그지 않음', () => {
    expect(shouldLockOnReturn({ ...base, enabled: false, now: 10_000_000 })).toBe(false);
  });
  test('즉시: 백그라운드에 다녀오면 바로 잠금 (0초 포함)', () => {
    expect(shouldLockOnReturn({ ...base, now: 1_000 })).toBe(true);
    expect(shouldLockOnReturn({ ...base, now: 1_500 })).toBe(true);
  });
  test('1분: 60초 미만은 그대로, 60초 이상이면 잠금', () => {
    expect(shouldLockOnReturn({ ...base, grace: 'one_minute', now: 1_000 + 59_999 })).toBe(false);
    expect(shouldLockOnReturn({ ...base, grace: 'one_minute', now: 1_000 + 60_000 })).toBe(true);
  });
  test('시계가 뒤로 가거나 나간 시각을 모르면 잠금 (fail-closed)', () => {
    expect(shouldLockOnReturn({ ...base, grace: 'one_minute', now: 500 })).toBe(true);
    expect(shouldLockOnReturn({ ...base, grace: 'one_minute', leftAt: null })).toBe(true);
    expect(shouldLockOnReturn({ ...base, grace: 'one_minute', now: Number.NaN })).toBe(true);
  });
  test('사용자가 연 외부 화면(사진 선택 등): 5분 안에 돌아오면 잠그지 않고, 그 이상이면 잠금', () => {
    expect(shouldLockOnReturn({ ...base, external: true, now: 1_000 + EXTERNAL_ACTIVITY_MAX_MS - 1 })).toBe(false);
    expect(shouldLockOnReturn({ ...base, external: true, now: 1_000 + EXTERNAL_ACTIVITY_MAX_MS })).toBe(true);
  });
  test('잠금 시점 값 읽기: 모르는 값은 기본(즉시)', () => {
    expect(parseLockGrace('one_minute')).toBe('one_minute');
    expect(parseLockGrace('forever')).toBe('immediate');
    expect(parseLockGrace(null)).toBe('immediate');
  });
  test('인증 결과 문구: 성공·취소는 문구 없음', () => {
    expect(deviceAuthMessage({ ok: true })).toBeNull();
    expect(deviceAuthMessage({ ok: false, reason: 'cancel' })).toBeNull();
    expect(deviceAuthMessage({ ok: false, reason: 'lockout' })).toContain('잠시 후');
    expect(deviceAuthMessage({ ok: false, reason: 'failed' })).toContain('다시 시도');
  });
});

describe('상태 흐름', () => {
  beforeEach(() => {
    mockStore.clear();
    mockAuth.next = { ok: true };
    mockAuth.calls = 0;
    mockAuth.during = undefined;
    mockScreen.prevent = 0;
    mockScreen.allow = 0;
    __resetAppLockForTest();
  });

  test('처음 설치: 꺼짐 · 잠기지 않음', async () => {
    await loadAppLock();
    expect(useAppLock.getState()).toMatchObject({ ready: true, enabled: false, locked: false });
  });

  test('켜기는 기기 인증 후에만 · 취소하면 그대로 꺼짐', async () => {
    await loadAppLock();
    mockAuth.next = { ok: false, reason: 'cancel' };
    expect(await setAppLockEnabled(true)).toEqual({ ok: false, reason: 'cancel' });
    expect(useAppLock.getState().enabled).toBe(false);
    expect(mockStore.get('pacto.appLock.enabled')).toBeUndefined();

    mockAuth.next = { ok: true };
    expect((await setAppLockEnabled(true)).ok).toBe(true);
    expect(useAppLock.getState()).toMatchObject({ enabled: true, locked: false });
    expect(mockStore.get('pacto.appLock.enabled')).toBe('1');
    expect(mockScreen.prevent).toBeGreaterThan(0); // 최근 앱 미리보기·캡처 보호
  });

  test('끄기도 기기 인증 후에만 · 실패하면 그대로 켜짐', async () => {
    mockStore.set('pacto.appLock.enabled', '1');
    await loadAppLock();
    useAppLock.setState({ locked: false });
    mockAuth.next = { ok: false, reason: 'failed' };
    await setAppLockEnabled(false);
    expect(useAppLock.getState().enabled).toBe(true);
    mockAuth.next = { ok: true };
    await setAppLockEnabled(false);
    expect(useAppLock.getState().enabled).toBe(false);
    expect(mockStore.get('pacto.appLock.enabled')).toBe('0');
    expect(mockScreen.allow).toBeGreaterThan(0);
  });

  test('앱 시작(프로세스 새로 시작): 켜져 있으면 잠긴 상태로 시작', async () => {
    mockStore.set('pacto.appLock.enabled', '1');
    await loadAppLock();
    expect(useAppLock.getState()).toMatchObject({ ready: true, enabled: true, locked: true });
  });

  test('설정을 읽지 못하면 잠근다 (fail-closed)', async () => {
    const SecureStore = jest.requireMock('expo-secure-store') as { getItemAsync: jest.Mock };
    const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage') as { getItem: jest.Mock };
    SecureStore.getItemAsync.mockRejectedValueOnce(new Error('keystore'));
    AsyncStorage.getItem.mockRejectedValueOnce(new Error('storage'));
    await loadAppLock();
    expect(useAppLock.getState()).toMatchObject({ enabled: true, locked: true });
  });

  test('잠금 해제: 성공해야만 풀림 · 실패·취소면 계속 잠김', async () => {
    mockStore.set('pacto.appLock.enabled', '1');
    await loadAppLock();
    mockAuth.next = { ok: false, reason: 'failed' };
    await unlockApp();
    expect(useAppLock.getState().locked).toBe(true);
    mockAuth.next = { ok: false, reason: 'cancel' };
    await unlockApp();
    expect(useAppLock.getState().locked).toBe(true);
    mockAuth.next = { ok: true };
    await unlockApp();
    expect(useAppLock.getState().locked).toBe(false);
  });

  test('즉시: 백그라운드에 다녀오면 잠김 · 1분: 짧게 다녀오면 그대로', async () => {
    mockStore.set('pacto.appLock.enabled', '1');
    await loadAppLock();
    useAppLock.setState({ locked: false });
    onAppStateChange('background', 10_000);
    onAppStateChange('active', 10_100);
    expect(useAppLock.getState().locked).toBe(true);

    useAppLock.setState({ locked: false });
    await setAppLockGrace('one_minute');
    onAppStateChange('background', 20_000);
    onAppStateChange('active', 50_000);
    expect(useAppLock.getState().locked).toBe(false);
    onAppStateChange('background', 60_000);
    onAppStateChange('active', 130_000);
    expect(useAppLock.getState().locked).toBe(true);
  });

  test('inactive(알림창 내림 등)만으로는 잠그지 않음', async () => {
    mockStore.set('pacto.appLock.enabled', '1');
    await loadAppLock();
    useAppLock.setState({ locked: false });
    onAppStateChange('inactive', 10_000);
    onAppStateChange('active', 10_100);
    expect(useAppLock.getState().locked).toBe(false);
  });

  test('기기 인증 창(PIN 화면)으로 잠시 나갔다 와도 다시 잠그지 않음 (무한 반복 방지)', async () => {
    mockStore.set('pacto.appLock.enabled', '1');
    await loadAppLock();
    mockAuth.during = () => {
      onAppStateChange('background', 1_000);
      onAppStateChange('active', 2_000);
    };
    await unlockApp();
    expect(useAppLock.getState().locked).toBe(false);
  });

  test('사진 선택 등 외부 화면 동안은 잠그지 않음', async () => {
    mockStore.set('pacto.appLock.enabled', '1');
    await loadAppLock();
    useAppLock.setState({ locked: false });
    await withoutAppLock(async () => {
      onAppStateChange('background', 1_000);
    });
    onAppStateChange('active', 30_000);
    expect(useAppLock.getState().locked).toBe(false);
    // 그 뒤 일반 백그라운드는 다시 잠금
    onAppStateChange('background', 40_000);
    onAppStateChange('active', 40_500);
    expect(useAppLock.getState().locked).toBe(true);
  });

  test('잠금 시점 변경은 잠금 사용 중이면 인증 필요 · 취소하면 그대로', async () => {
    mockStore.set('pacto.appLock.enabled', '1');
    await loadAppLock();
    mockAuth.next = { ok: false, reason: 'cancel' };
    await setAppLockGrace('one_minute');
    expect(useAppLock.getState().grace).toBe('immediate');
    mockAuth.next = { ok: true };
    await setAppLockGrace('one_minute');
    expect(useAppLock.getState().grace).toBe('one_minute');
  });

  test('로그아웃: 잠금 설정을 지우고 잠금을 푼다 (다음 계정은 꺼짐)', async () => {
    mockStore.set('pacto.appLock.enabled', '1');
    mockStore.set('pacto.appLock.grace', 'one_minute');
    await loadAppLock();
    await resetAppLock();
    expect(useAppLock.getState()).toMatchObject({ enabled: false, locked: false, grace: 'immediate' });
    expect(mockStore.size).toBe(0);
  });

  test('인증 창이 응답 없이 멈춰도 [잠금 해제]를 다시 누르면 이전 요청을 취소하고 새로 띄운다 (잠금화면 알림 진입)', async () => {
    mockStore.set('pacto.appLock.enabled', '1');
    await loadAppLock();
    mockCancel.calls = 0;
    const auth = jest.requireMock('../deviceAuth') as { authenticateDevice: jest.Mock };
    auth.authenticateDevice.mockImplementationOnce(() => new Promise(() => undefined)); // OS가 답하지 않음
    const stuck = unlockApp();
    expect(useAppLock.getState().authenticating).toBe(true);
    // 다시 누름 → 이전 요청 취소 + 새 인증 성공 → 풀림
    expect(await unlockApp()).toEqual({ ok: true });
    expect(mockCancel.calls).toBe(1);
    expect(useAppLock.getState()).toMatchObject({ locked: false, authenticating: false });
    void stuck;
  });

  test('응답 없는 인증은 시간이 지나면 취소되어 다시 시도할 수 있다 (계속 잠김 유지)', async () => {
    mockStore.set('pacto.appLock.enabled', '1');
    await loadAppLock();
    jest.useFakeTimers();
    try {
      const auth = jest.requireMock('../deviceAuth') as { authenticateDevice: jest.Mock };
      auth.authenticateDevice.mockImplementationOnce(() => new Promise(() => undefined));
      const p = unlockApp();
      jest.advanceTimersByTime(AUTH_TIMEOUT_MS);
      expect(await p).toEqual({ ok: false, reason: 'cancel' });
      expect(useAppLock.getState()).toMatchObject({ locked: true, authenticating: false });
    } finally {
      jest.useRealTimers();
    }
  });

  test('이전 요청이 나중에 성공으로 끝나도 새 요청 결과로만 판단한다', async () => {
    mockStore.set('pacto.appLock.enabled', '1');
    await loadAppLock();
    let releaseOld!: () => void;
    const auth = jest.requireMock('../deviceAuth') as { authenticateDevice: jest.Mock };
    auth.authenticateDevice.mockImplementationOnce(() => new Promise((r) => (releaseOld = () => r({ ok: true }))));
    const old = unlockApp();
    mockAuth.next = { ok: false, reason: 'cancel' };
    await unlockApp();
    releaseOld();
    expect(await old).toEqual({ ok: false, reason: 'cancel' });
    expect(useAppLock.getState().locked).toBe(true);
  });
});
