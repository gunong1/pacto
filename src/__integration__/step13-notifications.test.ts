/**
 * 실제 푸시 알림 (Edge Function notifications + DB) — 로컬 Supabase + 가짜 Expo Push 서버
 * 필요: supabase/functions/.env 에 EXPO_PUSH_URL=http://host.docker.internal:4011, ALLOW_TEST_PUSH=true
 * C 설정 변경 재계산 · E 계약 날짜 변경 · F 계약 삭제 · G 두 번 실행해도 1번 · J 잘못된 토큰 비활성화 · 재시도 · 수신 결과 · 권한
 */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { EMPTY_DRAFT } from '@/data/draft';
import { SupabaseNotificationStore } from '@/data/notifications';
import type { ContractDraft, PaymentDraft } from '@/data/repository';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { addDays, parseISODate, todayInSeoul } from '@/domain/dates';

import { adminClient, localEnv, newUser, testFetch } from './helpers';

jest.setTimeout(60_000);

// ===== 가짜 Expo Push 서버 =====
type Mode = 'ok' | 'gone' | 'http500';
const modes = new Map<string, Mode>();
const received: { to: string; title: string; body: string; data: Record<string, unknown> }[] = [];
let receiptAnswer: Record<string, { status: 'ok' | 'error'; details?: { error: string } }> = {};
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (req.url?.endsWith('/getReceipts')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: Object.fromEntries((body.ids as string[]).filter((id) => receiptAnswer[id]).map((id) => [id, receiptAnswer[id]])) }));
      }
      const msgs = body as { to: string; title: string; body: string; data: Record<string, unknown> }[];
      if (msgs.some((m) => modes.get(m.to) === 'http500')) {
        res.writeHead(500);
        return res.end('{}');
      }
      received.push(...msgs);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          data: msgs.map((m, i) =>
            modes.get(m.to) === 'gone' ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: `ticket-${Date.now()}-${i}-${m.to.slice(-6)}` },
          ),
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(4011, '0.0.0.0', r));
  expect((server.address() as AddressInfo).port).toBe(4011);
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const secret = () => /^CLEANUP_SECRET=(.+)$/m.exec(fs.readFileSync(path.resolve(__dirname, '../../supabase/functions/.env'), 'utf8'))![1].trim();
const tick = async () => {
  const res = await testFetch(`${localEnv().API_URL}/functions/v1/notifications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cleanup-secret': secret() },
    body: JSON.stringify({ action: 'tick' }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, number> };
};

// ===== 계약: 월세 850,000 + 관리비 100,000, 지급일 = 오늘(한국)+3일 =====
const TODAY = todayInSeoul();
const PAY_DAY = addDays(TODAY, 3);
const pay = (label: string, amount: number, day = parseISODate(PAY_DAY).day): PaymentDraft => ({
  kind: label === '월세' ? 'rent' : 'maintenance_fee', direction: 'expense', label, amount, frequency: 'monthly', dayOfMonth: day, monthOfYear: null,
  startsOn: null, endsOn: null, installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null,
});
const leaseDraft = (day?: number): ContractDraft => ({
  ...EMPTY_DRAFT, title: '주택 임대차계약', category: 'real_estate', contractType: 'lease', startDate: PAY_DAY, endDate: addDays(PAY_DAY, 700),
  payments: [pay('월세', 850_000, day), pay('관리비', 100_000, day)],
});

async function setup(prefix: string, mode: Mode = 'ok') {
  const a = await newUser(prefix);
  const repo = new SupabaseContractRepository(a.client, () => TODAY);
  const store = new SupabaseNotificationStore(a.client);
  const token = `ExponentPushToken[${prefix}${Math.random().toString(36).slice(2, 12)}]`;
  modes.set(token, mode);
  await store.registerToken(token, `device-${prefix}-${Math.random().toString(36).slice(2, 8)}`, 'android');
  const record = await repo.create({ draft: leaseDraft(), source: 'manual', documents: [], aiChecks: [] });
  return { a, repo, store, token, contractId: record.contract.id };
}

/** 이번 달 지급일 근처만 (35일 창에는 다음 달 결제 알림도 들어 있다) */
const NEAR = addDays(PAY_DAY, 3);
const near = <T extends { fire_on: string }>(xs: T[]) => xs.filter((x) => x.fire_on <= NEAR);
const rows = async (userId: string) =>
  ((await adminClient().from('scheduled_notifications').select('id, status, fire_on, scheduled_at, event_type, attempts, last_error, dedupe_key').eq('user_id', userId).order('scheduled_at')).data ?? []);

describe('푸시 토큰', () => {
  test('RPC로만 등록 · 토큰 값은 앱이 읽을 수 없음 · 직접 넣기 거부', async () => {
    const { a, store } = await setup('tok');
    expect(await store.devices()).toEqual([expect.objectContaining({ platform: 'android', enabled: true })]);
    expect((await a.client.from('push_tokens').select('expo_push_token')).error).not.toBeNull();
    const ins = await a.client.from('push_tokens').insert({ user_id: a.user.id, expo_push_token: 'ExponentPushToken[xxxxxxxxxxxx]', device_id: 'dev-direct-1', platform: 'ios' } as never);
    expect(ins.error).not.toBeNull();
  });

  test('같은 토큰을 다른 계정이 등록하면 옮겨진다 (한 기기 = 지금 로그인한 계정)', async () => {
    const a = await newUser('tok-a');
    const b = await newUser('tok-b');
    const token = `ExponentPushToken[shared${Math.random().toString(36).slice(2, 10)}]`;
    await new SupabaseNotificationStore(a.client).registerToken(token, 'device-shared-01', 'ios');
    await new SupabaseNotificationStore(b.client).registerToken(token, 'device-shared-01', 'ios');
    const { data } = await adminClient().from('push_tokens').select('user_id').eq('expo_push_token', token);
    expect(data).toEqual([{ user_id: b.user.id }]);
  });
});

describe('알림 계획 (계약 저장·수정·삭제·설정 변경 → 예정 알림 갱신)', () => {
  test('저장 → 다음 알림: 결제 전날 오전 9시 1개로 묶음 (950,000원), 잠금화면은 간단히', async () => {
    const { a, store } = await setup('plan');
    await store.requestPlan();
    const up = await store.upcoming();
    const payment = up.filter((u) => u.eventType === 'payment' && u.scheduledAt < `${NEAR}T00:00:00Z`);
    expect(payment).toHaveLength(1);
    expect(payment[0].display).toMatchObject({ message: '내일 950,000원 결제 예정이에요.', detail: '월세 850,000원 · 관리비 100,000원' });
    const [row] = (await a.client.from('scheduled_notifications').select('fire_on, scheduled_at, payload_json').eq('event_type', 'payment').order('scheduled_at')).data!;
    expect(row.fire_on).toBe(addDays(PAY_DAY, -1));
    expect(new Date(row.scheduled_at).toISOString()).toBe(new Date(`${addDays(PAY_DAY, -1)}T09:00:00+09:00`).toISOString());
    expect((row.payload_json as { push: unknown }).push).toEqual({ title: 'PACTO', body: '확인할 계약 일정이 있어요.' });
  });

  test('C. 결제 알림 1일 전 → 3일 전 + 당일: 기존 예정 취소, 새로 생성 / 미리보기 켜면 상세 문구', async () => {
    const { a, store } = await setup('prefs');
    await store.requestPlan();
    const before = (await rows(a.user.id)).filter((r) => r.event_type === 'payment');
    await store.savePreferences({ categories: { payment: { enabled: true, offsets: [3, 0] } }, showDetails: true });
    const after = await rows(a.user.id);
    expect(after.filter((r) => r.dedupe_key === before[0].dedupe_key)[0].status).toBe('cancelled');
    const live = near(after.filter((r) => r.status === 'scheduled' && r.event_type === 'payment')).map((r) => r.fire_on);
    expect(live).toEqual([addDays(PAY_DAY, -3), PAY_DAY].filter((d) => new Date(`${d}T09:00:00+09:00`) > new Date()));
    const { data } = await a.client.from('scheduled_notifications').select('payload_json').eq('status', 'scheduled').eq('event_type', 'payment').limit(1);
    expect((data![0].payload_json as { push: { title: string } }).push.title).toBe('주택 임대차계약');
  });

  test('D. 이 계약만 직접 설정 → 계약별 설정 적용, 해제하면 내 기본 설정', async () => {
    const { a, store, contractId } = await setup('override');
    await store.saveOverride(contractId, { payment: { enabled: true, offsets: [0] } });
    expect(near((await rows(a.user.id)).filter((r) => r.status === 'scheduled' && r.event_type === 'payment')).map((r) => r.fire_on)).toEqual([PAY_DAY]);
    await store.saveOverride(contractId, null);
    expect(near((await rows(a.user.id)).filter((r) => r.status === 'scheduled' && r.event_type === 'payment')).map((r) => r.fire_on)).toEqual([addDays(PAY_DAY, -1)]);
  });

  test('E. 지급일 변경 → 기존 예정 취소, 새 날짜 기준 생성 (DB 트리거 대기열 + 서버 계산)', async () => {
    const { a, repo, contractId } = await setup('edit');
    await tick();
    expect(near((await rows(a.user.id)).filter((r) => r.status === 'scheduled')).map((r) => r.fire_on)).toEqual([addDays(PAY_DAY, -1)]);
    const newDay = addDays(PAY_DAY, 2);
    await repo.update(contractId, { ...leaseDraft(parseISODate(newDay).day), startDate: PAY_DAY });
    await tick(); // 앱이 바로 계산을 요청하지 않아도 5분 안에 (트리거 → 대기열 → tick)
    const after = await rows(a.user.id);
    expect(after.filter((r) => r.fire_on === addDays(PAY_DAY, -1))[0].status).toBe('cancelled');
    expect(near(after.filter((r) => r.status === 'scheduled')).map((r) => r.fire_on)).toEqual([addDays(newDay, -1)]);
  });

  test('F. 계약 삭제 → 예정 알림 모두 사라짐', async () => {
    const { a, repo, store, contractId } = await setup('delete');
    await store.requestPlan();
    expect((await rows(a.user.id)).length).toBeGreaterThan(0);
    await repo.remove(contractId);
    expect(await rows(a.user.id)).toEqual([]);
  });

  test('알림 기준 시간대: 잘못된 이름 거부 / 바꾸면 그 시간대 오전 9시로 다시 계산', async () => {
    const { a, store } = await setup('tz');
    await expect(store.savePreferences({ timezone: 'Mars/Base' })).rejects.toThrow('invalid_timezone');
    await store.savePreferences({ timezone: 'Asia/Tokyo', timeOfDay: '20:30' });
    const live = (await rows(a.user.id)).filter((r) => r.status === 'scheduled' && r.event_type === 'payment');
    expect(new Date(live[0].scheduled_at).toISOString()).toBe(new Date(`${addDays(PAY_DAY, -1)}T20:30:00+09:00`).toISOString());
  });
});

describe('발송 (tick)', () => {
  const makeDue = (id: string) => adminClient().from('scheduled_notifications').update({ scheduled_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', id);

  test('비밀값 없으면 거부', async () => {
    const res = await testFetch(`${localEnv().API_URL}/functions/v1/notifications`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'tick' }) });
    expect(res.status).toBe(401);
  });

  test('G. 두 번 동시에 실행해도 같은 푸시는 1번만 / 문구에 계약 내용 없음', async () => {
    const { a, store, token } = await setup('dup');
    await store.requestPlan();
    const [n] = (await rows(a.user.id)).filter((r) => r.status === 'scheduled');
    await makeDue(n.id);
    await Promise.all([tick(), tick()]);
    await tick();
    const mine = received.filter((m) => m.to === token);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: 'PACTO', body: '확인할 계약 일정이 있어요.' });
    expect(mine[0].data.url).toMatch(/^\/contract\/[0-9a-f-]{36}\?from=push&event=payment$/);
    const after = (await rows(a.user.id)).find((r) => r.id === n.id)!;
    expect(after.status).toBe('sent');
    const { data: d } = await adminClient().from('notification_deliveries').select('status, ticket_id').eq('notification_id', n.id);
    expect(d).toHaveLength(1);
    expect(d![0].status).toBe('ok');
  });

  test('J. 기기가 더 이상 없는 토큰(DeviceNotRegistered) → 토큰 비활성화, 알림 failed', async () => {
    const { a, store } = await setup('gone', 'gone');
    await store.requestPlan();
    const [n] = (await rows(a.user.id)).filter((r) => r.status === 'scheduled');
    await makeDue(n.id);
    await tick();
    expect((await store.devices())[0]).toMatchObject({ enabled: false });
    const after = (await rows(a.user.id)).find((r) => r.id === n.id)!;
    expect(after).toMatchObject({ status: 'failed', last_error: 'devicenotregistered' });
  });

  test('일시적 오류(500) → 재시도 예약 (무한 재시도 없음: 3번 뒤 failed)', async () => {
    const { a, store, token } = await setup('retry', 'http500');
    await store.requestPlan();
    const [n] = (await rows(a.user.id)).filter((r) => r.status === 'scheduled');
    await makeDue(n.id);
    await tick();
    let r = (await rows(a.user.id)).find((x) => x.id === n.id)!;
    expect(r).toMatchObject({ status: 'scheduled', attempts: 1, last_error: 'network_error' });
    for (let i = 0; i < 2; i++) {
      await adminClient().from('scheduled_notifications').update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq('id', n.id);
      await tick();
    }
    r = (await rows(a.user.id)).find((x) => x.id === n.id)!;
    expect(r).toMatchObject({ status: 'failed', attempts: 3 });
    modes.set(token, 'ok');
  });

  test('보낼 시각에 계약 알림이 꺼져 있으면 보내지 않음 (발송 직전 재확인) / 기기 없으면 no_device', async () => {
    const { a, store, token, contractId } = await setup('recheck');
    await store.requestPlan();
    const [n] = (await rows(a.user.id)).filter((r) => r.status === 'scheduled');
    await adminClient().from('contracts').update({ notifications_enabled: false }).eq('id', contractId);
    await adminClient().from('scheduled_notifications').update({ status: 'scheduled', scheduled_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', n.id);
    await tick();
    expect((await rows(a.user.id)).find((r) => r.id === n.id)!.status).toBe('cancelled');
    expect(received.some((m) => m.to === token)).toBe(false);
  });

  test('24시간 넘게 늦은 알림은 보내지 않음 (expired)', async () => {
    const { a, store, token } = await setup('late');
    await store.requestPlan();
    const [n] = (await rows(a.user.id)).filter((r) => r.status === 'scheduled');
    await adminClient().from('scheduled_notifications').update({ scheduled_at: new Date(Date.now() - 25 * 3600_000).toISOString() }).eq('id', n.id);
    await tick();
    expect((await rows(a.user.id)).find((r) => r.id === n.id)!.status).toBe('expired');
    expect(received.some((m) => m.to === token)).toBe(false);
  });

  test('수신 결과 확인: 나중에 DeviceNotRegistered → 토큰 비활성화', async () => {
    const { a, store } = await setup('receipt');
    await store.requestPlan();
    const [n] = (await rows(a.user.id)).filter((r) => r.status === 'scheduled');
    await makeDue(n.id);
    await tick();
    const { data: d } = await adminClient().from('notification_deliveries').select('id, ticket_id').eq('notification_id', n.id);
    receiptAnswer = { [d![0].ticket_id!]: { status: 'error', details: { error: 'DeviceNotRegistered' } } };
    await adminClient().from('notification_deliveries').update({ created_at: new Date(Date.now() - 20 * 60_000).toISOString() }).eq('id', d![0].id);
    await tick();
    expect((await store.devices())[0].enabled).toBe(false);
    const { data: d2 } = await adminClient().from('notification_deliveries').select('receipt_status, receipt_error').eq('id', d![0].id);
    expect(d2![0]).toEqual({ receipt_status: 'error', receipt_error: 'DeviceNotRegistered' });
  });

  test('테스트 알림 (개발 환경): 내 기기로 전송, 계약 상세로 이동', async () => {
    const { store, token, contractId } = await setup('testpush');
    const r = await store.sendTest({ contractId });
    expect(r).toEqual({ devices: 1, ok: 1, errors: [] });
    const m = received.filter((x) => x.to === token).pop()!;
    expect(m.title).toBe('PACTO 테스트 알림');
    expect(m.data.url).toBe(`/contract/${contractId}?from=push&event=test`);
  });
});

describe('권한 (RLS)', () => {
  test('다른 사람의 계약에 계약별 설정을 만들 수 없고, 다른 사람의 예정 알림·설정을 볼 수 없음', async () => {
    const { contractId, store } = await setup('rls-a');
    await store.requestPlan();
    const b = await newUser('rls-b');
    const ins = await b.client.from('contract_notification_overrides').insert({ contract_id: contractId, categories: {} });
    expect(ins.error).not.toBeNull();
    expect((await b.client.from('scheduled_notifications').select('id')).data).toEqual([]);
    expect((await b.client.from('notification_preferences').select('user_id')).data).toEqual([]);
    const bad = await b.client.from('notification_preferences').insert({ user_id: b.user.id, categories: { payment: { enabled: true, offsets: [2] } } });
    expect(bad.error).not.toBeNull(); // 정해진 시점(선택지)만
    // 갱신 통보기한·갱신 여부 확인은 종류별 키로 따로 저장된다 (모르는 키는 거부)
    const kinds = await b.client.from('notification_preferences').insert({ user_id: b.user.id, categories: { renewal_notice: { enabled: true, offsets: [30, 7] }, renewal_decision: { enabled: false, offsets: [30] } } });
    expect(kinds.error).toBeNull();
    const unknownKey = await b.client.from('notification_preferences').update({ categories: { notice_unknown: { enabled: true, offsets: [30] } } }).eq('user_id', b.user.id).select('user_id');
    expect(unknownKey.error).not.toBeNull();
  });
});
