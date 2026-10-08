/* Expo Push 결과 판정 — 재시도는 일시적 오류만, 최대 3번 / 기기가 없어진 토큰은 비활성화 대상 */
import { buildExpoMessage, decideOutcome, isTokenGone, MAX_ATTEMPTS } from '../../../supabase/functions/_shared/push.ts';

const NOW = new Date('2026-10-19T00:00:00Z');
const ok = { status: 'ok' as const, id: 't1' };
const gone = { status: 'error' as const, details: { error: 'DeviceNotRegistered' } };
const rate = { status: 'error' as const, details: { error: 'MessageRateExceeded' } };

test('한 기기라도 받으면 sent', () => expect(decideOutcome([gone, ok], 1, NOW)).toEqual({ status: 'sent' }));
test('기기 없음 → failed(no_device), 재시도 안 함', () => expect(decideOutcome([], 1, NOW)).toEqual({ status: 'failed', error: 'no_device' }));
test('모두 DeviceNotRegistered → failed (재시도 안 함)', () => expect(decideOutcome([gone], 1, NOW)).toEqual({ status: 'failed', error: 'DeviceNotRegistered' }));
test('네트워크 오류 → 5분·15분 뒤 재시도, 3번째 실패는 failed', () => {
  expect(decideOutcome([null], 1, NOW)).toEqual({ status: 'retry', nextAttemptAt: '2026-10-19T00:05:00.000Z', error: 'network_error' });
  expect(decideOutcome([rate], 2, NOW)).toEqual({ status: 'retry', nextAttemptAt: '2026-10-19T00:15:00.000Z', error: 'MessageRateExceeded' });
  expect(decideOutcome([null], MAX_ATTEMPTS, NOW)).toEqual({ status: 'failed', error: 'network_error' });
});
test('토큰 비활성화 대상', () => {
  expect(isTokenGone(gone)).toBe(true);
  expect(isTokenGone(rate)).toBe(false);
});
test('메시지: critical·important는 high, 일반은 default / 문구 길이 제한', () => {
  const m = buildExpoMessage('ExponentPushToken[x]', { push: { title: 'PACTO', body: 'b'.repeat(1000) }, data: { url: '/contract/1' } }, 'critical');
  expect(m).toMatchObject({ priority: 'high', sound: 'default', data: { url: '/contract/1' } });
  expect(m.body.length).toBe(400);
  expect(buildExpoMessage('t', {}, 'normal')).toMatchObject({ priority: 'default', title: 'PACTO', body: '확인할 계약 일정이 있어요.' });
});
