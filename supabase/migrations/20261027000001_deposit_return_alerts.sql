-- 보증금·예치금 반환 확인 알림
-- 1) 알림 종류 'deposit_return' 허용 + 새 앱 저장 표시(_v)
-- 2) 반환 기준일이 지난 뒤 알림(기준일 + N일)을 담을 수 있게 offset_days 음수 허용
-- 3) 보증금 묶음·반환 기록이 바뀌면 알림 다시 계산
-- 4) 예전 앱 호환: 예전 앱은 자기가 아는 종류만 저장하므로, _v 표시가 없는 저장이면
--    예전 앱이 모르는 종류(지금은 deposit_return)의 기존 설정을 지우지 않고 이어붙인다

create or replace function public.valid_notification_categories(c jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(c) = 'object' and not exists (
    select 1 from jsonb_each(c) e
    where (e.key = '_v' and (jsonb_typeof(e.value) <> 'number' or e.value::text <> '2'))
       or (e.key <> '_v' and (
         e.key not in ('payment', 'termination_notice', 'renewal_notice', 'renewal_decision', 'contract_end', 'renewal', 'deposit_return')
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
       ))
  );
$$;

-- 기준일 + N일 알림은 offset_days가 음수 (예: 반환 확인 기준일 7일 뒤 → -7)
alter table public.scheduled_notifications drop constraint if exists scheduled_notifications_offset_days_check;
alter table public.scheduled_notifications add constraint scheduled_notifications_offset_days_check check (offset_days between -400 and 400);

-- 예전 앱이 모르는 종류의 설정 보존 (_v 표시가 없는 저장 = 예전 앱)
create or replace function public.keep_newer_notification_categories() returns trigger
language plpgsql set search_path = '' as $$
declare
  k text;
begin
  if new.categories ? '_v' or old.categories is null then
    return new;
  end if;
  for k in
    select e.key from jsonb_each(old.categories) e
    where e.key not in ('_v', 'payment', 'termination_notice', 'renewal_notice', 'renewal_decision', 'contract_end', 'renewal')
  loop
    if not (new.categories ? k) then
      new.categories := new.categories || jsonb_build_object(k, old.categories -> k);
    end if;
  end loop;
  return new;
end;
$$;

create trigger notification_preferences_keep_newer before update of categories on public.notification_preferences
  for each row execute function public.keep_newer_notification_categories();
create trigger contract_notification_overrides_keep_newer before update of categories on public.contract_notification_overrides
  for each row execute function public.keep_newer_notification_categories();

-- 보증금 묶음·반환 기록이 바뀌면 다시 계산 (반환 완료 → 알림 취소, 일부 반환 → 남은 금액 문구, 반환일 변경 → 날짜 이동)
create trigger contract_funds_enqueue_plan after insert or update or delete on public.contract_funds
  for each row execute function public.enqueue_notification_plan();
create trigger fund_refunds_enqueue_plan after insert or update or delete on public.fund_refunds
  for each row execute function public.enqueue_notification_plan();
