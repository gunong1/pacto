-- 알림 시간: 전체 기본 알림 시간(여러 개) + 알림 종류별 다른 시간(override)
--   notification_preferences.default_times  = 전체 기본 알림 시간 ['09:00', '18:30'] (1~4개)
--   categories.<종류>.times                 = 이 종류만 다른 시간 (없으면 기본 알림 시간 사용)
-- 기존 time_of_day는 지우지 않는다 (예전 앱 호환) — default_times의 첫 시간과 항상 같게 맞춘다.
-- 기존 사용자의 알림 시간은 그대로 default_times로 옮긴다 (설정이 초기화되지 않음).

/** 'HH:MM' 1~4개, 중복 없음 */
create function public.valid_notification_times(t text[]) returns boolean
language sql immutable set search_path = '' as $$
  select t is not null
     and coalesce(array_length(t, 1), 0) between 1 and 4
     and not exists (select 1 from unnest(t) x where x !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
     and (select count(distinct x) from unnest(t) x) = array_length(t, 1);
$$;

alter table public.notification_preferences
  add column default_times text[] not null default array['09:00']::text[];

-- 기존 값 옮기기 (예: 08:00으로 설정한 사용자 → ['08:00'])
update public.notification_preferences set default_times = array[to_char(time_of_day, 'HH24:MI')];

alter table public.notification_preferences
  add constraint notification_preferences_default_times_valid check (public.valid_notification_times(default_times));

/** time_of_day ↔ default_times[1] 동기화 — 새 앱은 default_times를, 예전 앱은 time_of_day를 바꾼다 */
create function public.sync_notification_times() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.default_times = array['09:00']::text[] and new.time_of_day <> '09:00'::time then
      new.default_times := array[to_char(new.time_of_day, 'HH24:MI')];
    else
      new.time_of_day := new.default_times[1]::time;
    end if;
  elsif new.default_times is distinct from old.default_times then
    new.time_of_day := new.default_times[1]::time;
  elsif new.time_of_day is distinct from old.time_of_day then
    new.default_times := array[to_char(new.time_of_day, 'HH24:MI')];
  end if;
  return new;
end;
$$;
create trigger notification_preferences_sync_times before insert or update on public.notification_preferences
  for each row execute function public.sync_notification_times();

-- 종류별 설정에 times(선택) 허용: {payment: {enabled, offsets[], times?: ['09:00', '18:00']}}
create or replace function public.valid_notification_categories(c jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(c) = 'object' and not exists (
    select 1 from jsonb_each(c) e
    where e.key not in ('payment', 'termination_notice', 'renewal_notice', 'renewal_decision', 'contract_end', 'renewal')
       or jsonb_typeof(e.value) <> 'object'
       or jsonb_typeof(e.value -> 'enabled') <> 'boolean'
       or jsonb_typeof(e.value -> 'offsets') <> 'array'
       or jsonb_array_length(e.value -> 'offsets') > 9
       or exists (
         select 1 from jsonb_array_elements(e.value -> 'offsets') o
         where jsonb_typeof(o) <> 'number' or o::text not in ('180', '90', '60', '30', '14', '7', '3', '1', '0')
       )
       or (e.value ? 'times' and (
         jsonb_typeof(e.value -> 'times') <> 'array'
         or jsonb_array_length(e.value -> 'times') not between 1 and 4
         or exists (
           select 1 from jsonb_array_elements(e.value -> 'times') t
           where jsonb_typeof(t) <> 'string' or (t #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         )
       ))
  );
$$;
