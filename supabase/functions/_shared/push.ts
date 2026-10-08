// Expo Push 발송 — 메시지 만들기 · 결과 판정(재시도/영구 실패/토큰 비활성화)은 순수 함수 (앱 jest에서도 검증)
// 로그·DB에는 알림 id, 종류, 결과 코드만 남긴다 (토큰 값·문구·계약 내용 없음)

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  priority: 'default' | 'high';
  channelId: 'default';
}

export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** 한 번에 보낼 수 있는 메시지 수 (Expo Push API) */
export const EXPO_CHUNK = 100;
/** 일시적 오류 재시도 간격 (분) — 3번째 실패 후에는 failed (무한 재시도 없음) */
export const RETRY_MINUTES = [5, 15, 60] as const;
export const MAX_ATTEMPTS = RETRY_MINUTES.length;

/** 토큰을 더 쓰지 않을 오류 */
const TOKEN_GONE = new Set(['DeviceNotRegistered', 'InvalidCredentials']);
/** 다시 보내도 결과가 같은 오류 (메시지·설정 문제) */
const PERMANENT = new Set(['MessageTooBig', 'InvalidCredentials', 'DeviceNotRegistered']);

export function errorCode(t: ExpoTicket): string {
  const code = t.details?.error ?? 'unknown_error';
  return /^[A-Za-z_0-9]{1,60}$/.test(code) ? code : 'unknown_error';
}

export function isTokenGone(t: ExpoTicket): boolean {
  return t.status === 'error' && TOKEN_GONE.has(errorCode(t));
}

export function buildExpoMessage(token: string, payload: { push?: { title?: string; body?: string }; data?: Record<string, unknown> }, priority: string): ExpoMessage {
  return {
    to: token,
    title: String(payload.push?.title ?? 'PACTO').slice(0, 120),
    body: String(payload.push?.body ?? '확인할 계약 일정이 있어요.').slice(0, 400),
    data: payload.data ?? {},
    sound: 'default',
    priority: priority === 'normal' ? 'default' : 'high',
    channelId: 'default',
  };
}

export type Outcome =
  | { status: 'sent' }
  | { status: 'retry'; nextAttemptAt: string; error: string }
  | { status: 'failed'; error: string };

/**
 * 알림 하나의 결과: 기기 중 하나라도 받았으면 sent. 전부 영구 오류면 failed. 일시적 오류만 있으면 재시도(최대 3회).
 * tickets가 null이면 요청 자체 실패(네트워크·5xx) → 일시적 오류
 */
export function decideOutcome(tickets: (ExpoTicket | null)[], attempts: number, now: Date): Outcome {
  if (tickets.length === 0) return { status: 'failed', error: 'no_device' };
  if (tickets.some((t) => t?.status === 'ok')) return { status: 'sent' };
  const transient = tickets.some((t) => t === null || (t.status === 'error' && !PERMANENT.has(errorCode(t))));
  if (transient && attempts < MAX_ATTEMPTS) {
    const at = new Date(now.getTime() + RETRY_MINUTES[Math.max(0, attempts - 1)] * 60_000);
    return { status: 'retry', nextAttemptAt: at.toISOString(), error: tickets.some((t) => t === null) ? 'network_error' : errorCode(tickets.find((t) => t)!) };
  }
  const first = tickets.find((t) => t && t.status === 'error');
  return { status: 'failed', error: first ? errorCode(first) : 'network_error' };
}

export function chunk<T>(xs: readonly T[], n = EXPO_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Expo Push API — 요청 실패 시 null (상태 코드만 알 수 있다) */
export async function sendExpo(base: string, messages: ExpoMessage[], accessToken?: string): Promise<ExpoTicket[] | null> {
  try {
    const res = await fetch(`${base}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(messages),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return Array.isArray(body?.data) && body.data.length === messages.length ? (body.data as ExpoTicket[]) : null;
  } catch {
    return null;
  }
}

export async function getExpoReceipts(base: string, ids: string[], accessToken?: string): Promise<Record<string, ExpoTicket> | null> {
  try {
    const res = await fetch(`${base}/getReceipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data && typeof body.data === 'object' ? (body.data as Record<string, ExpoTicket>) : null;
  } catch {
    return null;
  }
}
