// 푸시 알림 서버
//  - action=tick  (pg_cron 5분마다, x-cleanup-secret): 계산 대기열 처리 → 보낼 알림 발송 → 수신 결과 확인
//  - action=plan  (앱, 로그인 사용자): 계약 저장·설정 변경 직후 그 사용자의 알림을 바로 다시 계산
//  - action=test  (앱, 개발·테스트 환경에서만 ALLOW_TEST_PUSH=true): 내 기기로 테스트 알림
// 계산은 앱과 같은 도메인 코드(_shared/vendor/pacto-domain.js — src/domain 번들)를 쓴다.
// 로그: 사용자·알림 id, 종류, 결과, 개수, 소요 시간만 (토큰 값·알림 문구·계약 내용 없음)
import { getUserId, restJson, rpc, safeEqual } from '../_shared/admin.ts';
import { corsHeaders, json } from '../_shared/cors.ts';
import { buildExpoMessage, chunk, decideOutcome, errorCode, getExpoReceipts, isTokenGone, sendExpo, type ExpoMessage, type ExpoTicket } from '../_shared/push.ts';
import { CONTRACT_SELECT, normalizeCategoryPrefs, planNotifications, toRecord, type ContractNotificationOverride } from '../_shared/vendor/pacto-domain.js';

const EXPO_BASE = Deno.env.get('EXPO_PUSH_URL') ?? 'https://exp.host/--/api/v2/push';
const EXPO_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN') || undefined;

// ===== 계산 =====

async function planUser(userId: string, now = new Date()): Promise<{ created: number; updated: number; cancelled: number; planned: number } | null> {
  const [profile] = await restJson<{ timezone: string; push_preview_enabled: boolean }[]>(`profiles?id=eq.${userId}&select=timezone,push_preview_enabled`, {}, 'profile');
  if (!profile) return null; // 탈퇴한 사용자
  const [prefs] = await restJson<{ enabled: boolean; time_of_day: string; default_times: string[] | null; categories: unknown }[]>(`notification_preferences?user_id=eq.${userId}&select=enabled,time_of_day,default_times,categories`, {}, 'prefs');
  const overrides = await restJson<{ contract_id: string; categories: unknown }[]>(`contract_notification_overrides?user_id=eq.${userId}&select=contract_id,categories`, {}, 'overrides');
  const rows = await restJson<unknown[]>(`contracts?user_id=eq.${userId}&select=${encodeURIComponent(CONTRACT_SELECT)}`, {}, 'contracts');
  const planned = planNotifications({
    userId,
    records: rows.map(toRecord),
    preferences: {
      enabled: prefs?.enabled ?? true,
      // 기본 알림 시간 (예전 데이터는 time_of_day 하나)
      defaultTimes: prefs?.default_times?.length ? prefs.default_times : prefs?.time_of_day ? [prefs.time_of_day.slice(0, 5)] : undefined,
      timezone: profile.timezone,
      showDetails: profile.push_preview_enabled,
      categories: normalizeCategoryPrefs(prefs?.categories),
    },
    overrides: new Map(overrides.map((o) => [o.contract_id, normalizeCategoryPrefs(o.categories) as ContractNotificationOverride])),
    now,
  });
  const plan = planned.map((p) => ({
    contract_id: p.contractId,
    event_key: p.eventKey,
    event_type: p.eventType,
    priority: p.priority,
    source: p.source,
    event_date: p.eventDate,
    fire_on: p.fireOn,
    offset_days: p.offsetDays,
    scheduled_at: p.scheduledAt,
    group_key: p.groupKey,
    dedupe_key: p.dedupeKey,
    payload_json: { push: p.push, data: p.data },
    display_json: p.display,
  }));
  const [r] = await rpc<{ created: number; updated: number; cancelled: number }[]>('apply_notification_plan', { p_user: userId, p_plan: plan, p_now: now.toISOString() });
  return { ...r, planned: plan.length };
}

async function processQueue(): Promise<number> {
  let users = 0;
  for (let round = 0; round < 4; round++) {
    const batch = await rpc<{ user_id: string }[]>('claim_plan_queue', { p_limit: 50 });
    for (const { user_id } of batch) {
      const t = Date.now();
      try {
        const r = await planUser(user_id);
        console.log(`notifications: plan user=${user_id} ${r ? `planned=${r.planned} created=${r.created} updated=${r.updated} cancelled=${r.cancelled}` : 'skipped=no_profile'} ms=${Date.now() - t}`);
      } catch (e) {
        // 다음 실행에서 다시 계산하도록 대기열에 되돌린다
        await restJson('notification_plan_queue', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ user_id }) }, 'requeue').catch(() => undefined);
        console.error(`notifications: plan user=${user_id} failed code=${e instanceof Error && /^[a-z_0-9]+$/.test(e.message) ? e.message : 'plan_error'}`);
      }
      users++;
    }
    if (batch.length < 50) break;
  }
  return users;
}

// ===== 발송 =====

interface Claimed {
  id: string;
  user_id: string;
  contract_id: string;
  event_type: string;
  priority: string;
  payload_json: { push?: { title?: string; body?: string }; data?: Record<string, unknown> };
  attempts: number;
}
interface TokenRow {
  id: string;
  user_id: string;
  expo_push_token: string;
}

const inList = (ids: string[]) => `in.(${ids.join(',')})`;

async function disableTokens(ids: string[], reason: 'device_not_registered' | 'invalid_token') {
  if (!ids.length) return;
  await restJson(`push_tokens?id=${inList(ids)}`, { method: 'PATCH', body: JSON.stringify({ enabled: false, disabled_reason: reason }) }, 'token_disable');
}

async function sendDue(now = new Date()): Promise<{ sent: number; retry: number; failed: number }> {
  const stats = { sent: 0, retry: 0, failed: 0 };
  const claimed = await rpc<Claimed[]>('claim_due_notifications', { p_limit: 200 });
  if (!claimed.length) return stats;
  const userIds = [...new Set(claimed.map((c) => c.user_id))];
  const tokens = await restJson<TokenRow[]>(`push_tokens?user_id=${inList(userIds)}&enabled=eq.true&select=id,user_id,expo_push_token`, {}, 'tokens');
  // 재시도일 때 이미 받은 기기에는 다시 보내지 않는다
  const delivered = await restJson<{ notification_id: string; push_token_id: string }[]>(
    `notification_deliveries?notification_id=${inList(claimed.map((c) => c.id))}&status=eq.ok&select=notification_id,push_token_id`,
    {},
    'deliveries',
  );
  const done = new Set(delivered.map((d) => `${d.notification_id}|${d.push_token_id}`));

  const jobs: { n: Claimed; token: TokenRow; message: ExpoMessage }[] = [];
  for (const n of claimed) {
    for (const token of tokens.filter((t) => t.user_id === n.user_id && !done.has(`${n.id}|${t.id}`))) {
      jobs.push({ n, token, message: buildExpoMessage(token.expo_push_token, n.payload_json, n.priority) });
    }
  }
  const results = new Map<string, (ExpoTicket | null)[]>(claimed.map((c) => [c.id, []]));
  const deliveries: Record<string, unknown>[] = [];
  const gone: string[] = [];
  for (const part of chunk(jobs)) {
    const tickets = await sendExpo(EXPO_BASE, part.map((j) => j.message), EXPO_TOKEN);
    part.forEach((j, i) => {
      const t = tickets ? tickets[i] : null;
      results.get(j.n.id)!.push(t);
      if (!t) return;
      if (isTokenGone(t)) gone.push(j.token.id);
      deliveries.push({
        notification_id: j.n.id,
        user_id: j.n.user_id,
        push_token_id: j.token.id,
        status: t.status === 'ok' ? 'ok' : 'error',
        ticket_id: t.status === 'ok' && typeof t.id === 'string' ? t.id.slice(0, 100) : null,
        error_code: t.status === 'ok' ? null : errorCode(t),
      });
    });
  }
  if (deliveries.length) {
    await restJson('notification_deliveries?on_conflict=notification_id,push_token_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(deliveries) }, 'deliveries_save');
  }
  await disableTokens([...new Set(gone)], 'device_not_registered');

  for (const n of claimed) {
    const tickets = results.get(n.id)!;
    // 재시도에서 이미 받은 기기가 있으면 보낸 것으로 (같은 알림을 다시 보내지 않음)
    const o = delivered.some((d) => d.notification_id === n.id) ? { status: 'sent' as const } : decideOutcome(tickets, n.attempts, now);
    const patch =
      o.status === 'sent'
        ? { status: 'sent', sent_at: now.toISOString(), last_error: null, next_attempt_at: null }
        : o.status === 'retry'
          ? { status: 'scheduled', next_attempt_at: o.nextAttemptAt, last_error: o.error.toLowerCase(), processing_started_at: null }
          : { status: 'failed', last_error: o.error.toLowerCase() };
    await restJson(`scheduled_notifications?id=eq.${n.id}&status=eq.processing`, { method: 'PATCH', body: JSON.stringify(patch) }, 'notification_update');
    stats[o.status === 'sent' ? 'sent' : o.status === 'retry' ? 'retry' : 'failed']++;
    console.log(`notifications: send id=${n.id} type=${n.event_type} result=${o.status}${o.status === 'sent' ? '' : ` code=${o.error}`} devices=${tickets.length}`);
  }
  return stats;
}

/** 15분 이상 지난 발송의 수신 결과 확인 — 기기가 더 이상 없으면 토큰 비활성화 */
async function checkReceipts(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - 15 * 60_000).toISOString();
  const rows = await restJson<{ id: string; ticket_id: string; push_token_id: string | null; created_at: string }[]>(
    `notification_deliveries?ticket_id=not.is.null&receipt_checked_at=is.null&created_at=lt.${before}&select=id,ticket_id,push_token_id,created_at&order=created_at&limit=300`,
    {},
    'receipts_select',
  );
  if (!rows.length) return 0;
  const receipts = await getExpoReceipts(EXPO_BASE, rows.map((r) => r.ticket_id), EXPO_TOKEN);
  if (!receipts) return 0;
  const gone: string[] = [];
  let checked = 0;
  for (const r of rows) {
    const rc = receipts[r.ticket_id];
    const stale = now.getTime() - new Date(r.created_at).getTime() > 24 * 3600_000;
    if (!rc && !stale) continue; // 아직 준비 안 됨
    if (rc && isTokenGone(rc) && r.push_token_id) gone.push(r.push_token_id);
    await restJson(
      `notification_deliveries?id=eq.${r.id}`,
      { method: 'PATCH', body: JSON.stringify({ receipt_status: rc ? rc.status : null, receipt_error: rc ? (rc.status === 'ok' ? null : errorCode(rc)) : 'receipt_unavailable', receipt_checked_at: now.toISOString() }) },
      'receipt_update',
    );
    checked++;
  }
  await disableTokens([...new Set(gone)], 'device_not_registered');
  if (checked) console.log(`notifications: receipts checked=${checked} tokens_disabled=${new Set(gone).size}`);
  return checked;
}

// ===== 테스트 알림 =====

async function sendTest(userId: string, contractId: string | null): Promise<{ devices: number; ok: number; errors: string[] }> {
  const tokens = await restJson<TokenRow[]>(`push_tokens?user_id=eq.${userId}&enabled=eq.true&select=id,user_id,expo_push_token`, {}, 'tokens');
  if (!tokens.length) return { devices: 0, ok: 0, errors: ['no_device'] };
  let url = '/notifications';
  if (contractId && /^[0-9a-f-]{36}$/.test(contractId)) {
    const own = await restJson<{ id: string }[]>(`contracts?id=eq.${contractId}&user_id=eq.${userId}&select=id`, {}, 'contract');
    if (own.length) url = `/contract/${contractId}?from=push&event=test`;
  }
  const payload = { push: { title: 'PACTO 테스트 알림', body: '알림이 정상적으로 도착했어요. 눌러서 이동을 확인해보세요.' }, data: { url, eventType: 'test' } };
  const tickets = await sendExpo(EXPO_BASE, tokens.map((t) => buildExpoMessage(t.expo_push_token, payload, 'important')), EXPO_TOKEN);
  if (!tickets) return { devices: tokens.length, ok: 0, errors: ['network_error'] };
  await disableTokens(tokens.filter((_, i) => isTokenGone(tickets[i])).map((t) => t.id), 'device_not_registered');
  return { devices: tokens.length, ok: tickets.filter((t) => t.status === 'ok').length, errors: tickets.filter((t) => t.status !== 'ok').map(errorCode) };
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const started = Date.now();
  let body: { action?: string; contractId?: string; delaySeconds?: number } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  // 예약 실행
  if (body.action === 'tick') {
    const secret = Deno.env.get('CLEANUP_SECRET');
    if (!secret) return json({ error: 'not_configured' }, 503);
    if (!safeEqual(req.headers.get('x-cleanup-secret') ?? '', secret)) return json({ error: 'unauthorized' }, 401);
    try {
      const planned = await processQueue();
      const sent = await sendDue();
      const receipts = await checkReceipts();
      console.log(`notifications: tick planned_users=${planned} sent=${sent.sent} retry=${sent.retry} failed=${sent.failed} receipts=${receipts} ms=${Date.now() - started}`);
      return json({ plannedUsers: planned, ...sent, receipts });
    } catch (e) {
      const code = e instanceof Error && /^[a-z_0-9]+$/.test(e.message) ? e.message : 'tick_error';
      console.error(`notifications: tick failed code=${code} ms=${Date.now() - started}`);
      return json({ error: code }, 500);
    }
  }

  // 앱 (로그인 사용자)
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const userId = token ? await getUserId(token) : null;
  if (!userId) return json({ error: 'unauthorized' }, 401);

  if (body.action === 'plan') {
    try {
      await restJson(`notification_plan_queue?user_id=eq.${userId}`, { method: 'DELETE' }, 'queue_delete');
      const r = await planUser(userId);
      console.log(`notifications: plan user=${userId} planned=${r?.planned ?? 0} created=${r?.created ?? 0} cancelled=${r?.cancelled ?? 0} source=app ms=${Date.now() - started}`);
      return json({ planned: r?.planned ?? 0 });
    } catch (e) {
      await restJson('notification_plan_queue', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ user_id: userId }) }, 'requeue').catch(() => undefined);
      console.error(`notifications: plan user=${userId} failed code=${e instanceof Error && /^[a-z_0-9]+$/.test(e.message) ? e.message : 'plan_error'}`);
      return json({ error: 'plan_failed' }, 500);
    }
  }

  if (body.action === 'test') {
    if (Deno.env.get('ALLOW_TEST_PUSH') !== 'true') return json({ error: 'test_push_disabled' }, 403);
    const delay = Math.max(0, Math.min(60, Math.round(Number(body.delaySeconds) || 0)));
    const run = async () => {
      if (delay) await new Promise((r) => setTimeout(r, delay * 1000));
      const r = await sendTest(userId, body.contractId ?? null);
      console.log(`notifications: test user=${userId} devices=${r.devices} ok=${r.ok} errors=${r.errors.join('|') || '-'} delay=${delay}`);
      return r;
    };
    if (delay && typeof EdgeRuntime !== 'undefined') {
      EdgeRuntime.waitUntil(run());
      return json({ scheduledInSeconds: delay });
    }
    return json(await run());
  }

  return json({ error: 'unknown_action' }, 400);
});
