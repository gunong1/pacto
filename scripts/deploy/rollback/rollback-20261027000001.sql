-- 되돌리기: 20261027000001_deposit_return_alerts (보증금 반환 확인 알림)
-- 실행 후: npx supabase migration repair --linked --status reverted 20261027000001
-- 데이터 영향 (새로 생긴 값만 정리):
--   알림 설정의 _v · deposit_return 키 제거 / 기준일 뒤(음수 offset) 예약 알림 삭제
-- 새 앱(APK)·새 notifications 함수가 이미 배포됐다면 먼저 이전 버전으로 돌린 뒤 실행 (새 앱은 _v를 붙여 저장하므로 설정 저장이 거부됨)
begin;
drop trigger if exists notification_preferences_keep_newer on public.notification_preferences;
drop trigger if exists contract_notification_overrides_keep_newer on public.contract_notification_overrides;
drop function if exists public.keep_newer_notification_categories();
drop trigger if exists contract_funds_enqueue_plan on public.contract_funds;
drop trigger if exists fund_refunds_enqueue_plan on public.fund_refunds;
update public.notification_preferences set categories = categories - '_v' - 'deposit_return' where categories ? '_v' or categories ? 'deposit_return';
update public.contract_notification_overrides set categories = categories - '_v' - 'deposit_return' where categories ? '_v' or categories ? 'deposit_return';
delete from public.scheduled_notifications where offset_days < 0;
alter table public.scheduled_notifications drop constraint if exists scheduled_notifications_offset_days_check;
alter table public.scheduled_notifications add constraint scheduled_notifications_offset_days_check check (offset_days between 0 and 400);
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
commit;
