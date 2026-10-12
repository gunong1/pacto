-- 자동 생성: node scripts/deploy/gen-check-schema.mjs (직접 고치지 말 것)
-- 읽기 전용. 데이터를 바꾸지 않고 정의(함수 본문·제약·트리거·RLS·정책·칸·권한)의 지문만 읽는다.
-- 대시보드 SQL Editor 또는 psql에서 실행한다. 결과는 두 부분:
--   kind = 'item'    : 항목마다 actual 이 applied(적용 후 기대값)와 같은지, before(적용 전 기대값)와 같은지
--   kind = 'version' : 버전마다 이력 기록 여부 + 스키마 판정 + 해야 할 일
-- 스키마 판정
--   APPLIED     : 그 버전의 모든 항목이 적용 후 기대값과 정확히 같음
--   NOT_APPLIED : 모든 항목이 적용 전 기대값과 같음 (미적용 버전에만 있음)
--   MISMATCH    : 섞여 있거나 어느 쪽과도 다름 → 진행 중단, 원인 확인
-- 해야 할 일(action)
--   OK                 : 이력 기록 + APPLIED
--   PENDING            : 이력 없음 + NOT_APPLIED → 단계별 적용 대상
--   REPAIR_CANDIDATE   : 이력 없음 + APPLIED (SQL Editor 등으로 직접 실행된 흔적). 이때만 migration repair 검토
--   STOP               : 그 밖의 모든 경우 (이력만 있고 스키마가 다름, MISMATCH, 이미 적용돼야 할 버전이 NOT_APPLIED 등)
-- 주의: 지문은 로컬 PostgreSQL 17에서 만들었다. 운영의 메이저 버전이 다르면 정책·제약 정의의 표기 차이로 MISMATCH가
--       날 수 있다. 그때도 repair 하지 말고 진행을 멈춘 뒤 해당 항목의 실제 정의를 따로 확인한다.
with item(version, n, name, actual, applied, before, pending) as (values
  ('20261025000002', 1, 'contract_documents.analysis_auto_excluded_pages 칸',
   (select md5(data_type || ':' || is_nullable || ':' || coalesce(column_default, '')) from information_schema.columns where table_schema = 'public' and table_name = 'contract_documents' and column_name = 'analysis_auto_excluded_pages'),
   'c5ec42e42c97ab9baeb8b8b6b0b433c5', null, false),
  ('20261025000002', 2, '제약 contract_documents_auto_excluded_subset',
   (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid = to_regclass('public.contract_documents') and c.conname = 'contract_documents_auto_excluded_subset'),
   'a953a55dd38838654a8fd0dccc8f990d', null, false),
  ('20261025000002', 3, '함수 guard_document_protection 본문',
   (select md5(string_agg(pronargs::text || ':' || md5(replace(prosrc, chr(13), '')), ',' order by pronargs)) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'guard_document_protection'),
   '0ddda0ab936494c4577ef971853c9da0', null, false),
  ('20261026000001', 4, 'contract_funds RLS 켜짐',
   (select relrowsecurity::text || ':' || relforcerowsecurity::text from pg_class where oid = to_regclass('public.contract_funds')),
   'true:false', null, false),
  ('20261026000001', 5, 'fund_refunds RLS 켜짐',
   (select relrowsecurity::text || ':' || relforcerowsecurity::text from pg_class where oid = to_regclass('public.fund_refunds')),
   'true:false', null, false),
  ('20261026000001', 6, '정책 contract_funds',
   (select md5(string_agg(policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), ';' order by policyname)) from pg_policies where schemaname = 'public' and tablename = 'contract_funds'),
   '72e78868950a0ebc8ddd1e9547ddfc9b', null, false),
  ('20261026000001', 7, '정책 fund_refunds',
   (select md5(string_agg(policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), ';' order by policyname)) from pg_policies where schemaname = 'public' and tablename = 'fund_refunds'),
   '7949dc6aa27ea1b1dcb983c77f60ba33', null, false),
  ('20261026000001', 8, '권한 contract_funds (authenticated)',
   (select md5(string_agg(privilege_type, ',' order by privilege_type)) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'contract_funds' and grantee = 'authenticated'),
   'b4008b34b7b3db1404361617247524af', null, false),
  ('20261026000001', 9, '칸별 권한 fund_refunds (authenticated)',
   (select md5(string_agg(column_name || ':' || privilege_type, ',' order by column_name, privilege_type)) from information_schema.column_privileges where table_schema = 'public' and table_name = 'fund_refunds' and grantee = 'authenticated'),
   '76e09b1ec82fc4faf1fb07fc5b05b292', null, false),
  ('20261026000001', 10, 'contract_payments.money_nature 칸',
   (select md5(data_type || ':' || is_nullable || ':' || coalesce(column_default, '')) from information_schema.columns where table_schema = 'public' and table_name = 'contract_payments' and column_name = 'money_nature'),
   '181893c426a4f473ae9f56b13882fab6', null, false),
  ('20261026000001', 11, 'contract_payments.direction_basis 칸',
   (select md5(data_type || ':' || is_nullable || ':' || coalesce(column_default, '')) from information_schema.columns where table_schema = 'public' and table_name = 'contract_payments' and column_name = 'direction_basis'),
   '181893c426a4f473ae9f56b13882fab6', null, false),
  ('20261026000001', 12, 'contract_payments.payer_role 칸',
   (select md5(data_type || ':' || is_nullable || ':' || coalesce(column_default, '')) from information_schema.columns where table_schema = 'public' and table_name = 'contract_payments' and column_name = 'payer_role'),
   '181893c426a4f473ae9f56b13882fab6', null, false),
  ('20261026000001', 13, 'contract_payments.payee_role 칸',
   (select md5(data_type || ':' || is_nullable || ':' || coalesce(column_default, '')) from information_schema.columns where table_schema = 'public' and table_name = 'contract_payments' and column_name = 'payee_role'),
   '181893c426a4f473ae9f56b13882fab6', null, false),
  ('20261026000001', 14, 'contract_payments.fund_id 칸',
   (select md5(data_type || ':' || is_nullable || ':' || coalesce(column_default, '')) from information_schema.columns where table_schema = 'public' and table_name = 'contract_payments' and column_name = 'fund_id'),
   '937cfda1416d2a7b61e9f32bc38a3247', null, false),
  ('20261026000001', 15, '제약 contract_payments_money_nature_check',
   (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid = to_regclass('public.contract_payments') and c.conname = 'contract_payments_money_nature_check'),
   '4d97d7637d1f5eeace970c3625cbb3bf', null, false),
  ('20261026000001', 16, '제약 contract_payments_direction_basis_check',
   (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid = to_regclass('public.contract_payments') and c.conname = 'contract_payments_direction_basis_check'),
   '0c044d8987898594bd41570480611cdd', null, false),
  ('20261026000001', 17, '제약 contract_payments_fund_id_fkey',
   (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid = to_regclass('public.contract_payments') and c.conname = 'contract_payments_fund_id_fkey'),
   'f85438c3a347b41c2beab94ba07a1efc', null, false),
  ('20261026000001', 18, 'profiles.contract_names 칸',
   (select md5(data_type || ':' || is_nullable || ':' || coalesce(column_default, '')) from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'contract_names'),
   'a55f15a0619f651d525c0487a1989ddb', null, false),
  ('20261026000001', 19, 'contracts.user_party_relation 칸',
   (select md5(data_type || ':' || is_nullable || ':' || coalesce(column_default, '')) from information_schema.columns where table_schema = 'public' and table_name = 'contracts' and column_name = 'user_party_relation'),
   '181893c426a4f473ae9f56b13882fab6', null, false),
  ('20261026000001', 20, '함수 owns_fund 본문',
   (select md5(string_agg(pronargs::text || ':' || md5(replace(prosrc, chr(13), '')), ',' order by pronargs)) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'owns_fund'),
   '4560a99ffd9bee92709c0045ef72379d', null, false),
  ('20261026000001', 21, '함수 guard_payment_fund 본문',
   (select md5(string_agg(pronargs::text || ':' || md5(replace(prosrc, chr(13), '')), ',' order by pronargs)) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'guard_payment_fund'),
   '38b1f61e3543867abb8aa8b57d1919bb', null, false),
  ('20261026000001', 22, '함수 guard_fund_refund 본문',
   (select md5(string_agg(pronargs::text || ':' || md5(replace(prosrc, chr(13), '')), ',' order by pronargs)) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'guard_fund_refund'),
   'da5ffe795d9ea2cce72067968777c64f', null, false),
  ('20261026000001', 23, '함수 valid_contract_names 본문',
   (select md5(string_agg(pronargs::text || ':' || md5(replace(prosrc, chr(13), '')), ',' order by pronargs)) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'valid_contract_names'),
   'bcfe965543d8975efc84719fb9d96fbe', null, false),
  ('20261026000001', 24, '트리거 contract_payments_fund_guard',
   (select t.tgrelid::regclass::text || ':' || t.tgfoid::regproc::text || ':' || t.tgtype::text || ':' || t.tgenabled::text from pg_trigger t where t.tgname = 'contract_payments_fund_guard' and not t.tgisinternal),
   'contract_payments:guard_payment_fund:23:O', null, false),
  ('20261026000001', 25, '트리거 fund_refunds_guard',
   (select t.tgrelid::regclass::text || ':' || t.tgfoid::regproc::text || ':' || t.tgtype::text || ':' || t.tgenabled::text from pg_trigger t where t.tgname = 'fund_refunds_guard' and not t.tgisinternal),
   'fund_refunds:guard_fund_refund:19:O', null, false),
  ('20261026000001', 26, '트리거 contract_funds_updated_at',
   (select t.tgrelid::regclass::text || ':' || t.tgfoid::regproc::text || ':' || t.tgtype::text || ':' || t.tgenabled::text from pg_trigger t where t.tgname = 'contract_funds_updated_at' and not t.tgisinternal),
   'contract_funds:set_updated_at:19:O', null, false),
  ('20261026000001', 27, '트리거 fund_refunds_updated_at',
   (select t.tgrelid::regclass::text || ':' || t.tgfoid::regproc::text || ':' || t.tgtype::text || ':' || t.tgenabled::text from pg_trigger t where t.tgname = 'fund_refunds_updated_at' and not t.tgisinternal),
   'fund_refunds:set_updated_at:19:O', null, false),
  ('20261026000001', 28, 'save_contract 인자 개수 (8개 하나만)',
   (select string_agg(pronargs::text, ',' order by pronargs) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_contract'),
   '8', null, false),
  ('20261026000002', 29, '함수 save_contract(8인자) 본문',
   (select md5(string_agg(pronargs::text || ':' || md5(replace(prosrc, chr(13), '')), ',' order by pronargs)) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_contract' and pronargs = 8),
   '3fc68903ed84b7bcd65d307e8d32dc50', '9576d1f7d958728f2c9a58995397f6e5', true),
  ('20261027000001', 30, '함수 valid_notification_categories 본문',
   (select md5(string_agg(pronargs::text || ':' || md5(replace(prosrc, chr(13), '')), ',' order by pronargs)) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'valid_notification_categories'),
   '66c4881ef699074ac8b47e332da2a610', '3afad4c7db4e20e3058ad0120d908cab', true),
  ('20261027000001', 31, '제약 scheduled_notifications_offset_days_check',
   (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid = to_regclass('public.scheduled_notifications') and c.conname = 'scheduled_notifications_offset_days_check'),
   'f3e990f18d534eca4555786df0652fd6', 'e03d9f7a5bd3cc5d17c108b411ec6ca3', true),
  ('20261027000001', 32, '함수 keep_newer_notification_categories 본문',
   (select md5(string_agg(pronargs::text || ':' || md5(replace(prosrc, chr(13), '')), ',' order by pronargs)) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'keep_newer_notification_categories'),
   'e6b0a6689e7982199ea4a178fc1ecc7d', null, true),
  ('20261027000001', 33, '트리거 notification_preferences_keep_newer',
   (select t.tgrelid::regclass::text || ':' || t.tgfoid::regproc::text || ':' || t.tgtype::text || ':' || t.tgenabled::text from pg_trigger t where t.tgname = 'notification_preferences_keep_newer' and not t.tgisinternal),
   'notification_preferences:keep_newer_notification_categories:19:O', null, true),
  ('20261027000001', 34, '트리거 contract_notification_overrides_keep_newer',
   (select t.tgrelid::regclass::text || ':' || t.tgfoid::regproc::text || ':' || t.tgtype::text || ':' || t.tgenabled::text from pg_trigger t where t.tgname = 'contract_notification_overrides_keep_newer' and not t.tgisinternal),
   'contract_notification_overrides:keep_newer_notification_categories:19:O', null, true),
  ('20261027000001', 35, '트리거 contract_funds_enqueue_plan',
   (select t.tgrelid::regclass::text || ':' || t.tgfoid::regproc::text || ':' || t.tgtype::text || ':' || t.tgenabled::text from pg_trigger t where t.tgname = 'contract_funds_enqueue_plan' and not t.tgisinternal),
   'contract_funds:enqueue_notification_plan:29:O', null, true),
  ('20261027000001', 36, '트리거 fund_refunds_enqueue_plan',
   (select t.tgrelid::regclass::text || ':' || t.tgfoid::regproc::text || ':' || t.tgtype::text || ':' || t.tgenabled::text from pg_trigger t where t.tgname = 'fund_refunds_enqueue_plan' and not t.tgisinternal),
   'fund_refunds:enqueue_notification_plan:29:O', null, true)
),
judged as (
  select *,
    actual is not distinct from applied as is_applied,
    pending and actual is not distinct from before as is_before
  from item
),
hist as (select version from supabase_migrations.schema_migrations),
ver as (
  select version,
    exists (select 1 from hist h where h.version = j.version) as history_recorded,
    case when bool_and(is_applied) then 'APPLIED'
         when bool_and(is_before) then 'NOT_APPLIED'
         else 'MISMATCH' end as schema_state,
    count(*) filter (where not is_applied and not is_before) as unexpected_items
  from judged j group by version
)
select 'item' as kind, version, n, name,
  case when is_applied then 'applied' when is_before then 'before' else 'UNEXPECTED' end as result,
  null::boolean as history_recorded, null::text as action
from judged
union all
select 'version', version, null, null, schema_state, history_recorded,
  case when history_recorded and schema_state = 'APPLIED' then 'OK'
       when not history_recorded and schema_state = 'NOT_APPLIED' then 'PENDING'
       when not history_recorded and schema_state = 'APPLIED' then 'REPAIR_CANDIDATE'
       else 'STOP' end
from ver
union all
select 'extra_history', version, null, '파일 목록에 없는 이력 (20261027000001 이후)', null, true, 'STOP'
from hist where version > '20261027000001'
order by kind desc, version, n;
