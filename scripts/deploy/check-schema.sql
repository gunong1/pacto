-- 읽기 전용: 마이그레이션 이력(schema_migrations)과 실제 스키마를 대조한다. 데이터를 바꾸지 않는다.
-- 대시보드 SQL Editor 또는 psql에서 실행. 결과의 history_recorded 와 schema_present 가 줄마다 같아야 정상.
--   둘 다 true  → 적용 완료        둘 다 false → 미적용
--   history false · schema true → SQL Editor 등으로 직접 실행해 이력이 누락됨 (migration repair 필요 — 런북 참고)
--   history true · schema false → 이력만 있고 스키마 없음 (적용 실패·수동 삭제 — 진행 중단, 원인 확인)
with h as (select version from supabase_migrations.schema_migrations)
select v.version, v.name,
       exists (select 1 from h where h.version = v.version) as history_recorded,
       v.schema_present
from (values
  ('20261025000002', 'auto_excluded_pages',
     exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contract_documents' and column_name = 'analysis_auto_excluded_pages')),
  ('20261026000001', 'cashflow_parties',
     to_regclass('public.contract_funds') is not null
     and to_regclass('public.fund_refunds') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contract_payments' and column_name = 'direction_basis')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'contract_names')
     and exists (select 1 from pg_proc where proname = 'save_contract' and pronamespace = 'public'::regnamespace and pronargs = 8)),
  ('20261026000002', 'old_client_guard',
     exists (select 1 from pg_proc where proname = 'save_contract' and pronamespace = 'public'::regnamespace and pronargs = 8 and prosrc like '%old_client_payment_rewrite%')),
  ('20261027000001', 'deposit_return_alerts',
     exists (select 1 from pg_trigger where tgname = 'notification_preferences_keep_newer')
     and exists (select 1 from pg_trigger where tgname = 'fund_refunds_enqueue_plan')
     and exists (select 1 from pg_proc where proname = 'valid_notification_categories' and prosrc like '%deposit_return%'))
) as v(version, name, schema_present)
order by v.version;
