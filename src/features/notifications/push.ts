/**
 * 이 기기의 푸시 알림 — 권한, Expo Push Token 등록, 알림을 눌렀을 때 이동.
 * 실제 발송은 서버(notifications 함수)가 한다. 앱이 꺼져 있어도 서버가 보낸 푸시는 도착한다.
 *
 * 받을 수 없는 환경(웹, Expo Go — SDK 53부터 원격 푸시 미지원, 시뮬레이터, EAS projectId 없음)에서는
 * expo-notifications를 불러오지 않고 'unavailable'로 둔다 (기존 Expo Go 개발 흐름이 깨지지 않도록).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';

import { notificationStore } from '@/data';

export type PushPermission = 'unavailable' | 'granted' | 'undetermined' | 'denied' | 'blocked';
export type PushUnavailableReason = 'web' | 'expo_go' | 'simulator' | 'no_project_id' | null;

const DEVICE_ID_KEY = 'pacto.push.deviceId';
const PROMPT_KEY = 'pacto.push.promptDismissedAt';
const PROMPT_SNOOZE_DAYS = 30;

export function projectId(): string | null {
  const id = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof id === 'string' && id ? id : null;
}

export function pushUnavailableReason(): PushUnavailableReason {
  if (Platform.OS === 'web') return 'web';
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return 'expo_go';
  if (!Device.isDevice) return 'simulator';
  if (!projectId()) return 'no_project_id';
  return null;
}

export const PUSH_UNAVAILABLE_COPY: Record<Exclude<PushUnavailableReason, null>, string> = {
  web: '웹에서는 푸시 알림을 받을 수 없어요. 휴대폰 앱에서 알림을 켜주세요.',
  expo_go: 'Expo Go에서는 푸시 알림을 받을 수 없어요. 개발용 앱(development build)에서 확인해주세요.',
  simulator: '시뮬레이터에서는 푸시 알림을 받을 수 없어요. 실제 휴대폰에서 확인해주세요.',
  no_project_id: '푸시 알림 설정(EAS projectId)이 아직 없어요.',
};

const load = () => import('expo-notifications');

let configured = false;
async function configure() {
  if (configured) return;
  configured = true;
  const N = await load();
  // 앱을 보고 있을 때도 배너로 보여준다
  N.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    await N.setNotificationChannelAsync('default', { name: '계약 알림', importance: N.AndroidImportance.HIGH });
  }
}

export async function pushPermission(): Promise<PushPermission> {
  if (pushUnavailableReason()) return 'unavailable';
  const N = await load();
  const p = await N.getPermissionsAsync();
  if (p.granted) return 'granted';
  if (p.status === 'undetermined') return 'undetermined';
  return p.canAskAgain ? 'denied' : 'blocked';
}

async function deviceId(): Promise<string> {
  const saved = await SecureStore.getItemAsync(DEVICE_ID_KEY).catch(() => null);
  if (saved) return saved;
  const id = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id).catch(() => undefined);
  return id;
}

async function registerThisDevice(): Promise<void> {
  const N = await load();
  await configure();
  const { data: token } = await N.getExpoPushTokenAsync({ projectId: projectId()! });
  await notificationStore.registerToken(token, await deviceId(), Platform.OS === 'ios' ? 'ios' : 'android');
}

/** "알림 받기"를 눌렀을 때만 OS 권한을 요청한다 */
export async function enablePush(): Promise<PushPermission> {
  if (pushUnavailableReason()) return 'unavailable';
  const N = await load();
  const current = await N.getPermissionsAsync();
  const p = current.granted ? current : await N.requestPermissionsAsync();
  if (!p.granted) return p.canAskAgain ? 'denied' : 'blocked';
  await registerThisDevice();
  return 'granted';
}

/** 앱 시작·로그인 시: 이미 허용된 기기면 토큰을 다시 등록 (토큰이 바뀌었을 수 있음). 권한을 묻지 않는다 */
export async function syncPushToken(): Promise<void> {
  try {
    if ((await pushPermission()) === 'granted') await registerThisDevice();
  } catch {
    // 네트워크 등 — 다음 실행에서 다시
  }
}

/** 로그아웃: 이 기기로 더 보내지 않는다 */
export async function disablePushForThisDevice(): Promise<void> {
  if (pushUnavailableReason()) return;
  const id = await SecureStore.getItemAsync(DEVICE_ID_KEY).catch(() => null);
  if (id) await notificationStore.unregisterToken(id).catch(() => undefined);
}

export function openSystemSettings() {
  Linking.openSettings().catch(() => undefined);
}

/** 첫 계약 저장 직후 안내: 권한을 아직 묻지 않았고, 최근 "나중에"를 누르지 않았을 때만 */
export async function shouldOfferPushPrompt(): Promise<boolean> {
  if ((await pushPermission()) !== 'undetermined') return false;
  const at = Number(await AsyncStorage.getItem(PROMPT_KEY).catch(() => null)) || 0;
  return Date.now() - at > PROMPT_SNOOZE_DAYS * 86_400_000;
}

export async function snoozePushPrompt(): Promise<void> {
  await AsyncStorage.setItem(PROMPT_KEY, String(Date.now())).catch(() => undefined);
}

/** 앱 안 경로만 연다 (계약 상세·알림 화면) */
export function safeNotificationUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  if (/^\/contract\/[0-9a-f-]{36}(\?[A-Za-z0-9=&_-]*)?$/.test(url)) return url;
  if (url === '/notifications') return url;
  return null;
}

/** 알림을 눌렀을 때 이동 — 앱이 꺼져 있던 경우(마지막 응답)와 실행 중인 경우 모두. 로그인된 화면에서만 */
export function usePushNavigation(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn || pushUnavailableReason()) return;
    let sub: { remove(): void } | null = null;
    let cancelled = false;
    (async () => {
      const N = await load();
      await configure();
      const open = (r: { notification: { request: { identifier: string; content: { data?: Record<string, unknown> } } } } | null) => {
        const url = safeNotificationUrl(r?.notification.request.content.data?.url);
        if (url) router.push(url as never);
      };
      const last = await N.getLastNotificationResponseAsync();
      if (!cancelled && last) {
        open(last);
        await N.clearLastNotificationResponseAsync();
      }
      if (!cancelled) sub = N.addNotificationResponseReceivedListener(open);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [signedIn]);

  // 로그인된 기기: 토큰 갱신
  useEffect(() => {
    if (signedIn) syncPushToken();
  }, [signedIn]);
}
