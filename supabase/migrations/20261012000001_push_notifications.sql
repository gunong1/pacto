-- 실제 푸시 알림 (Expo Push) — 서버 중심
-- 1) push_tokens: 기기별 토큰 (사용자당 여러 개). 앱은 RPC로만 등록·해제
-- 2) notification_preferences: 사용자 전체 설정 (알림 기준 시간대·미리보기는 profiles.timezone·push_preview_enabled 재사용)
-- 3) contract_notification_overrides: 계약별 직접 설정
-- 4) scheduled_notifications: 실제 발송 예정 푸시 — dedupe_key UNIQUE, 같은 계약·같은 시각은 하나 (group_key)
-- 5) notification_deliveries: 기기별 발송 결과 — (알림, 토큰) UNIQUE
-- 6) notification_plan_queue: 계약·설정이 바뀐 사용자 → 서버 planner가 다시 계산 (5분마다 + 앱이 저장 직후 바로 요청)
-- 계약 삭제 → 예정 알림·발송 기록 cascade 삭제 (삭제된 계약에서 푸시가 오지 않도록). 발송 직전에도 다시 확인한다.

-- ===== 1) push_tokens =====
create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null unique check (expo_push_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$'),
  device_id text not null check (device_id ~ '^[A-Za-z0-9_-]{8,100}$'),
  platform text not null check (platform in ('ios', 'android')),
  enabled boolean not null default true,
  disabled_reason text check (disabled_reason in ('logout', 'device_not_registered', 'invalid_token', 'replaced')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id)
);
create index push_tokens_user_idx on public.push_tokens (user_id) where enabled;
create trigger push_tokens_updated_at before update on public.push_tokens
  for each row execute function public.set_updated_at();
alter table public.push_tokens enable row level security;
create policy "push_tokens: read own" on public.push_tokens for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.push_tokens from anon, authenticated;
grant select (id, device_id, platform, enabled, disabled_reason, last_seen_at, created_at) on public.push_tokens to authenticated;
grant select, insert, update, delete on public.push_tokens to service_role;

/** 이 기기의 토큰 등록 — 같은 토큰이 다른 계정에 있으면 이 계정으로 옮긴다 (한 기기 = 지금 로그인한 계정) */
create function public.register_push_token(p_token text, p_device_id text, p_platform text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  delete from public.push_tokens where expo_push_token = p_token and not (user_id = uid and device_id = p_device_id);
  update public.push_tokens set enabled = false, disabled_reason = 'replaced'
    where device_id = p_device_id and user_id <> uid and enabled;
  insert into public.push_tokens (user_id, expo_push_token, device_id, platform)
  values (uid, p_token, p_device_id, p_platform)
  on conflict (user_id, device_id) do update
    set expo_push_token = excluded.expo_push_token, platform = excluded.platform, enabled = true, disabled_reason = null, last_seen_at = now();
end;
$$;

/** 로그아웃·알림 끄기: 이 기기 토큰 비활성화 */
create function public.unregister_push_token(p_device_id text)
returns void language sql security definer set search_path = '' as $$
  update public.push_tokens set enabled = false, disabled_reason = 'logout'
  where user_id = auth.uid() and device_id = p_device_id;
$$;
revoke all on function public.register_push_token(text, text, text) from public, anon;
revoke all on function public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;

-- ===== 2·3) 알림 설정 =====

/** 종류별 설정 {payment: {enabled, offsets[]}, …} — 정해진 종류·시점만 */
create function public.valid_notification_categories(c jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(c) = 'object' and not exists (
    select 1 from jsonb_each(c) e
    where e.key not in ('payment', 'termination_notice', 'contract_end', 'renewal')
       or jsonb_typeof(e.value) <> 'object'
       or jsonb_typeof(e.value -> 'enabled') <> 'boolean'
       or jsonb_typeof(e.value -> 'offsets') <> 'array'
       or jsonb_array_length(e.value -> 'offsets') > 9
       or exists (
         select 1 from jsonb_array_elements(e.value -> 'offsets') o
         where jsonb_typeof(o) <> 'number' or o::text not in ('180', '90', '60', '30', '14', '7', '3', '1', '0')
       )
  );
$$;

create table public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  enabled boolean not null default true,
  time_of_day time not null default '09:00',
  categories jsonb not null default '{}'::jsonb check (public.valid_notification_categories(categories)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();
alter table public.notification_preferences enable row level security;
create policy "notification_preferences: read own" on public.notification_preferences for select to authenticated using (user_id = (select auth.uid()));
create policy "notification_preferences: insert own" on public.notification_preferences for insert to authenticated with check (user_id = (select auth.uid()));
create policy "notification_preferences: update own" on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.notification_preferences to service_role;

create table public.contract_notification_overrides (
  contract_id uuid primary key references public.contracts (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  categories jsonb not null check (public.valid_notification_categories(categories)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contract_notification_overrides_user_idx on public.contract_notification_overrides (user_id);
create trigger contract_notification_overrides_updated_at before update on public.contract_notification_overrides
  for each row execute function public.set_updated_at();
alter table public.contract_notification_overrides enable row level security;
create policy "overrides: read own" on public.contract_notification_overrides for select to authenticated using (user_id = (select auth.uid()));
create policy "overrides: insert own" on public.contract_notification_overrides for insert to authenticated
  with check (user_id = (select auth.uid()) and public.owns_contract(contract_id));
create policy "overrides: update own" on public.contract_notification_overrides for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.owns_contract(contract_id));
create policy "overrides: delete own" on public.contract_notification_overrides for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.contract_notification_overrides to authenticated, service_role;

-- 알림 기준 시간대: 사용자가 설정에서 직접 바꾼다 (기기 시간대를 따라 자동으로 바꾸지 않음). 잘못된 이름은 거부
create function public.guard_profile_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.timezone is distinct from old.timezone and not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger profiles_guard_timezone before update of timezone on public.profiles
  for each row execute function public.guard_profile_timezone();

-- ===== 4·5) 발송 예정 알림 · 발송 결과 =====
create table public.scheduled_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  event_key text not null check (char_length(event_key) <= 200),
  event_type text not null check (event_type ~ '^[a-z_]{1,40}$'),
  priority text not null check (priority in ('critical', 'important', 'normal')),
  source text not null check (source in ('contract', 'manual_entry', 'legal', 'pacto', 'user_custom')),
  event_date date not null,
  fire_on date not null,
  offset_days smallint not null check (offset_days between 0 and 400),
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'processing', 'sent', 'failed', 'cancelled', 'expired')),
  group_key text not null check (char_length(group_key) <= 200),
  dedupe_key text not null unique check (char_length(dedupe_key) <= 2000),
  -- 잠금화면 문구(미리보기 설정 반영) + 눌렀을 때 이동할 경로 — 주민번호·계좌번호·원문 등은 넣지 않는다
  payload_json jsonb not null check (jsonb_typeof(payload_json) = 'object'),
  -- 앱 안 "다음 알림" 표시용
  display_json jsonb not null check (jsonb_typeof(display_json) = 'object'),
  attempts smallint not null default 0,
  next_attempt_at timestamptz,
  processing_started_at timestamptz,
  sent_at timestamptz,
  last_error text check (last_error is null or last_error ~ '^[a-z_0-9]{1,60}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 같은 계약 + 같은 발송 시각 = 푸시 하나 (보낸 뒤 계약이 바뀌어도 같은 시각에 다시 보내지 않음)
create unique index scheduled_notifications_group_uniq on public.scheduled_notifications (group_key)
  where status in ('scheduled', 'processing', 'sent');
create index scheduled_notifications_due_idx on public.scheduled_notifications (scheduled_at) where status in ('scheduled', 'processing');
create index scheduled_notifications_user_idx on public.scheduled_notifications (user_id, scheduled_at);
create index scheduled_notifications_contract_idx on public.scheduled_notifications (contract_id);
create trigger scheduled_notifications_updated_at before update on public.scheduled_notifications
  for each row execute function public.set_updated_at();
alter table public.scheduled_notifications enable row level security;
create policy "scheduled_notifications: read own" on public.scheduled_notifications for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.scheduled_notifications from anon, authenticated;
grant select (id, contract_id, event_type, priority, source, event_date, fire_on, offset_days, scheduled_at, status, display_json, payload_json, sent_at)
  on public.scheduled_notifications to authenticated;
grant select, insert, update, delete on public.scheduled_notifications to service_role;

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.scheduled_notifications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  push_token_id uuid references public.push_tokens (id) on delete set null,
  status text not null check (status in ('ok', 'error')),
  ticket_id text check (ticket_id is null or char_length(ticket_id) <= 100),
  error_code text check (error_code is null or error_code ~ '^[A-Za-z_0-9]{1,60}$'),
  receipt_status text check (receipt_status in ('ok', 'error')),
  receipt_error text check (receipt_error is null or receipt_error ~ '^[A-Za-z_0-9]{1,60}$'),
  receipt_checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (notification_id, push_token_id)
);
create index notification_deliveries_receipt_idx on public.notification_deliveries (created_at) where ticket_id is not null and receipt_checked_at is null;
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon, authenticated;
grant select, insert, update, delete on public.notification_deliveries to service_role;

-- ===== 6) 다시 계산할 사용자 =====
-- FK 없음: 회원 탈퇴 cascade 중에도 트리거가 넣을 수 있게 (planner가 없는 사용자는 건너뛴다)
create table public.notification_plan_queue (
  user_id uuid primary key,
  requested_at timestamptz not null default now()
);
alter table public.notification_plan_queue enable row level security;
revoke all on public.notification_plan_queue from anon, authenticated;
grant select, insert, update, delete on public.notification_plan_queue to service_role;

/** 계약·결제·날짜·일정·설정이 바뀌면 그 사용자를 다시 계산 대기열에 */
create function public.enqueue_notification_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  uid uuid := (r ->> case when tg_table_name = 'profiles' then 'id' else 'user_id' end)::uuid;
begin
  if uid is not null then
    insert into public.notification_plan_queue (user_id) values (uid)
    on conflict (user_id) do update set requested_at = least(public.notification_plan_queue.requested_at, excluded.requested_at);
  end if;
  return null;
end;
$$;
create trigger contracts_enqueue_plan after insert or update or delete on public.contracts for each row execute function public.enqueue_notification_plan();
create trigger contract_payments_enqueue_plan after insert or update or delete on public.contract_payments for each row execute function public.enqueue_notification_plan();
create trigger contract_dates_enqueue_plan after insert or update or delete on public.contract_dates for each row execute function public.enqueue_notification_plan();
create trigger contract_events_enqueue_plan after insert or update or delete on public.contract_events for each row execute function public.enqueue_notification_plan();
create trigger notification_preferences_enqueue_plan after insert or update or delete on public.notification_preferences for each row execute function public.enqueue_notification_plan();
create trigger contract_notification_overrides_enqueue_plan after insert or update or delete on public.contract_notification_overrides for each row execute function public.enqueue_notification_plan();
create trigger profiles_enqueue_plan after update of timezone, push_preview_enabled on public.profiles for each row execute function public.enqueue_notification_plan();

/** 대기열에서 사용자 꺼내기 (동시에 두 번 처리하지 않도록 SKIP LOCKED) */
create function public.claim_plan_queue(p_limit integer default 50)
returns table (user_id uuid) language sql security definer set search_path = '' as $$
  delete from public.notification_plan_queue q
  where q.user_id in (select q2.user_id from public.notification_plan_queue q2 order by q2.requested_at limit greatest(1, least(p_limit, 500)) for update skip locked)
  returning q.user_id;
$$;

/**
 * 계산 결과 반영 (한 트랜잭션):
 *  1) 새 계획에 없는 미래 예정 알림 → cancelled (지난 알림·보낸 알림은 그대로)
 *  2) 같은 dedupe_key가 예정·취소 상태면 내용 갱신(다시 예정), 없으면 새로 만든다. 이미 보낸 같은 시각의 알림이 있으면 만들지 않는다
 */
create function public.apply_notification_plan(p_user uuid, p_plan jsonb, p_now timestamptz default now())
returns table (created integer, updated integer, cancelled integer)
language plpgsql security definer set search_path = '' as $$
declare
  n_created integer := 0;
  n_updated integer := 0;
  n_cancelled integer := 0;
  item jsonb;
  hit integer;
begin
  update public.scheduled_notifications s set status = 'cancelled', next_attempt_at = null
  where s.user_id = p_user and s.status = 'scheduled' and s.scheduled_at > p_now
    and not exists (select 1 from jsonb_array_elements(p_plan) x where x ->> 'dedupe_key' = s.dedupe_key);
  get diagnostics n_cancelled = row_count;

  for item in select * from jsonb_array_elements(p_plan) loop
    if (item ->> 'scheduled_at')::timestamptz <= p_now then continue; end if;
    -- 삭제됐거나 다른 사용자의 계약은 무시
    if not exists (select 1 from public.contracts c where c.id = (item ->> 'contract_id')::uuid and c.user_id = p_user) then continue; end if;
    update public.scheduled_notifications s set
      status = 'scheduled', attempts = 0, next_attempt_at = null, last_error = null,
      event_key = item ->> 'event_key', event_type = item ->> 'event_type', priority = item ->> 'priority', source = item ->> 'source',
      event_date = (item ->> 'event_date')::date, payload_json = item -> 'payload_json', display_json = item -> 'display_json'
    where s.dedupe_key = item ->> 'dedupe_key' and s.user_id = p_user and s.status in ('scheduled', 'cancelled')
      and not exists (
        select 1 from public.scheduled_notifications o
        where o.group_key = s.group_key and o.id <> s.id and o.status in ('scheduled', 'processing', 'sent')
      );
    get diagnostics hit = row_count;
    if hit > 0 then n_updated := n_updated + 1; continue; end if;
    insert into public.scheduled_notifications (
      user_id, contract_id, event_key, event_type, priority, source, event_date, fire_on, offset_days, scheduled_at, group_key, dedupe_key, payload_json, display_json
    ) values (
      p_user, (item ->> 'contract_id')::uuid, item ->> 'event_key', item ->> 'event_type', item ->> 'priority', item ->> 'source',
      (item ->> 'event_date')::date, (item ->> 'fire_on')::date, (item ->> 'offset_days')::smallint, (item ->> 'scheduled_at')::timestamptz,
      item ->> 'group_key', item ->> 'dedupe_key', item -> 'payload_json', item -> 'display_json'
    ) on conflict do nothing;
    get diagnostics hit = row_count;
    n_created := n_created + hit;
  end loop;
  return query select n_created, n_updated, n_cancelled;
end;
$$;

/**
 * 보낼 알림 선점 (scheduled → processing). 두 번 실행돼도 같은 알림을 두 번 가져가지 않는다 (SKIP LOCKED + 상태 전이).
 * 먼저: 24시간 넘게 늦은 알림 → expired (날짜가 지난 "내일 결제" 알림을 보내지 않음),
 *       계약 알림·전체 알림이 꺼졌으면 → cancelled, 10분 넘게 processing이면 다시 예정으로(작업 중 중단 대비)
 */
create function public.claim_due_notifications(p_limit integer default 100)
returns table (id uuid, user_id uuid, contract_id uuid, event_type text, priority text, payload_json jsonb, attempts smallint)
language plpgsql security definer set search_path = '' as $$
begin
  update public.scheduled_notifications s set status = 'expired'
  where s.status = 'scheduled' and s.scheduled_at < now() - interval '24 hours';
  update public.scheduled_notifications s set status = 'cancelled'
  where s.status = 'scheduled' and s.scheduled_at <= now()
    and (not exists (select 1 from public.contracts c where c.id = s.contract_id and c.notifications_enabled)
      or exists (select 1 from public.notification_preferences p where p.user_id = s.user_id and not p.enabled));
  update public.scheduled_notifications s set status = 'scheduled', processing_started_at = null
  where s.status = 'processing' and s.processing_started_at < now() - interval '10 minutes';
  return query
  update public.scheduled_notifications s set status = 'processing', processing_started_at = now(), attempts = s.attempts + 1
  where s.id in (
    select x.id from public.scheduled_notifications x
    where x.status = 'scheduled' and x.scheduled_at <= now() and (x.next_attempt_at is null or x.next_attempt_at <= now())
    order by x.scheduled_at
    limit greatest(1, least(p_limit, 500))
    for update skip locked
  )
  returning s.id, s.user_id, s.contract_id, s.event_type, s.priority, s.payload_json, s.attempts;
end;
$$;

revoke all on function public.claim_plan_queue(integer) from public, anon, authenticated;
revoke all on function public.apply_notification_plan(uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_due_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_plan_queue(integer) to service_role;
grant execute on function public.apply_notification_plan(uuid, jsonb, timestamptz) to service_role;
grant execute on function public.claim_due_notifications(integer) to service_role;

-- ===== 예약 실행 =====
-- 5분마다: 대기열 다시 계산 → 보낼 알림 발송 → 수신 결과 확인 (주소·비밀값은 고아 파일 정리와 같은 Vault 값 재사용)
select cron.schedule(
  'pacto-notifications',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/notifications',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_secret')),
    body := '{"action":"tick"}'::jsonb
  )
  $cron$
);
-- 매일 한 번: 모든 사용자 다시 계산 (35일 미리 만들기 창을 하루씩 늘린다) — 한국 시간 00:07
select cron.schedule(
  'pacto-notifications-daily',
  '7 15 * * *',
  $cron$
  insert into public.notification_plan_queue (user_id)
  select distinct c.user_id from public.contracts c
  on conflict (user_id) do nothing
  $cron$
);
