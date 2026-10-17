import * as LocalAuthentication from 'expo-local-authentication';
import { Linking, Platform } from 'react-native';

import type { DeviceAuthResult } from '@/domain/appLock';

/**
 * 기기(OS) 인증 — 지문·얼굴인식, 또는 기기 PIN·패턴·비밀번호.
 * 생체 정보·PIN은 OS가 처리하고 PACTO는 성공/실패만 받는다 (저장·전송 없음).
 *
 * 테스트(웹 E2E)용 가짜 인증: 개발 빌드에서만 globalThis.__PACTO_FAKE_DEVICE_AUTH__ 를 쓴다 (운영 빌드는 무시).
 */
export type DeviceLockStatus = 'available' | 'no_device_lock' | 'unsupported';

interface FakeDeviceAuth {
  status: DeviceLockStatus;
  /** 다음 인증 결과 (기본 성공) */
  next?: DeviceAuthResult;
  calls?: number;
}

function fake(): FakeDeviceAuth | null {
  if (!__DEV__) return null;
  const f = (globalThis as { __PACTO_FAKE_DEVICE_AUTH__?: FakeDeviceAuth }).__PACTO_FAKE_DEVICE_AUTH__;
  return f ?? null;
}

export async function deviceLockStatus(): Promise<DeviceLockStatus> {
  const f = fake();
  if (f) return f.status;
  if (Platform.OS === 'web') return 'unsupported';
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level === LocalAuthentication.SecurityLevel.NONE ? 'no_device_lock' : 'available';
  } catch {
    return 'unsupported';
  }
}

export async function authenticateDevice(promptMessage: string): Promise<DeviceAuthResult> {
  const f = fake();
  if (f) {
    f.calls = (f.calls ?? 0) + 1;
    return f.next ?? { ok: true };
  }
  if (Platform.OS === 'web') return { ok: false, reason: 'unavailable' };
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: '취소',
      fallbackLabel: '기기 비밀번호 사용',
      // 생체 인증이 없거나 실패하면 기기 PIN·패턴·비밀번호로 풀 수 있게 한다
      disableDeviceFallback: false,
      requireConfirmation: false,
    });
    if (r.success) return { ok: true };
    switch (r.error) {
      case 'user_cancel':
      case 'system_cancel':
      case 'app_cancel':
      case 'user_fallback':
        return { ok: false, reason: 'cancel' };
      case 'lockout':
        return { ok: false, reason: 'lockout' };
      case 'not_enrolled':
      case 'passcode_not_set':
      case 'not_available':
        return { ok: false, reason: 'unavailable' };
      default:
        return { ok: false, reason: 'failed' };
    }
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** 떠 있는(또는 응답 없이 멈춘) 기기 인증 요청을 취소 — Android에서만 지원, 그 밖은 아무 일도 하지 않음 */
export async function cancelDeviceAuth(): Promise<void> {
  if (fake() || Platform.OS !== 'android') return;
  await LocalAuthentication.cancelAuthenticate().catch(() => undefined);
}

/** 기기 화면 잠금 설정으로 이동 (Android: 보안 설정, iOS: 앱 설정 — iOS는 암호 설정 화면을 직접 열 수 없다) */
export function openDeviceLockSettings() {
  if (Platform.OS === 'android') {
    Linking.sendIntent('android.settings.SECURITY_SETTINGS').catch(() => Linking.openSettings().catch(() => undefined));
  } else {
    Linking.openSettings().catch(() => undefined);
  }
}
