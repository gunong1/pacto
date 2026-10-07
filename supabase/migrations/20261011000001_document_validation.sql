-- 문서 확인 게이트 + 계약에 연결되지 않은 원본 자동 정리
-- 1) 문서 역할: AI(서버)가 판정, 사용자가 "계약 관련 문서가 맞아요"/"그대로 포함"으로 확인했는지 — 사용자가 직접 바꿀 수 없다
-- 2) 계약이 아니거나 읽을 수 없다고 판정된 문서는 (사용자 확인 없이) 계약에 연결할 수 없다
-- 3) 분석 작업: 판정(validation, 원문 없음) + 사용자 선택 반영용 모델 출력(raw_output, Level 1 민감정보 가림) — raw_output은 서버만 읽는다
-- 4) 24시간 이상 계약에 연결되지 않은 업로드·파생본·민감정보 영역·임시 분석 데이터 정리 (Edge Function cleanup-orphans가 Storage API로 파일 삭제)

alter table public.contract_documents
  add column document_role text check (document_role in ('contract', 'addendum', 'supporting', 'non_contract', 'uncertain', 'unreadable')),
  add column role_confirmed_by_user boolean not null default false;

alter table public.analysis_jobs
  add column validation jsonb,
  add column raw_output jsonb;

-- 사용자는 문서 역할·확인 여부를 바꿀 수 없다 (서버 service_role만)
create function public.guard_document_role() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.document_role := null;
      new.role_confirmed_by_user := false;
    else
      new.document_role := old.document_role;
      new.role_confirmed_by_user := old.role_confirmed_by_user;
    end if;
  end if;
  -- 계약이 아니거나 읽을 수 없는 문서는 계약에 연결하지 않는다 (가짜 계약·일정·알림 방지)
  if new.contract_id is not null and (tg_op = 'INSERT' or old.contract_id is null)
     and new.document_role in ('non_contract', 'unreadable') and not new.role_confirmed_by_user then
    raise exception 'document_not_contract' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger contract_documents_guard_role before insert or update on public.contract_documents
  for each row execute function public.guard_document_role();

-- 분석 작업의 모델 출력(raw_output)은 앱이 읽지 못하게 (판정을 거친 result만)
revoke select on public.analysis_jobs from authenticated;
grant select (id, user_id, status, provider, model, prompt_version, result, error_code, contract_id, started_at, completed_at, created_at, validation)
  on public.analysis_jobs to authenticated;

-- ===== 고아 파일 정리 =====

/**
 * 정리 대상 문서를 고르고 행을 지운 뒤, 지울 Storage 경로(원본 + 보호 파생본)를 돌려준다.
 * 보수적 기준: 계약에 연결되지 않음 + 생성 후 24시간 경과 + 그 문서·그 사용자의 분석 작업이 진행 중이 아님.
 * 행 삭제 시 민감정보 영역·파생본 기록은 cascade로 함께 지워진다.
 */
create function public.claim_orphan_documents(p_limit integer default 200)
returns table (document_id uuid, paths text[])
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with cand as (
    select d.id, d.storage_path
    from public.contract_documents d
    where d.contract_id is null
      and d.created_at < now() - interval '24 hours'
      and not exists (
        select 1 from public.analysis_jobs j
        where (j.id = d.analysis_job_id or j.user_id = d.user_id)
          and j.status in ('queued', 'processing')
          and j.created_at > now() - interval '24 hours'
      )
    order by d.created_at
    limit greatest(1, least(p_limit, 1000))
    for update of d skip locked
  ),
  with_paths as (
    select c.id, array[c.storage_path] || coalesce((select array_agg(x.storage_path) from public.document_derivatives x where x.document_id = c.id), '{}'::text[]) as paths
    from cand c
  ),
  del as (
    delete from public.contract_documents d using with_paths w
    where d.id = w.id and d.contract_id is null
    returning d.id
  )
  select w.id, w.paths from with_paths w join del on del.id = w.id;
end;
$$;

/**
 * 임시 분석 데이터 정리: 24시간이 지난 작업 중 문서·계약 어디에도 연결되지 않은 것은 삭제,
 * 연결된 작업도 사용자 선택 반영용 모델 출력(raw_output)은 비운다 (원문이 섞인 데이터를 오래 두지 않는다).
 */
create function public.purge_stale_analysis_jobs()
returns table (deleted_jobs integer, cleared_outputs integer)
language plpgsql security definer set search_path = '' as $$
declare
  n_deleted integer;
  n_cleared integer;
begin
  delete from public.analysis_jobs j
  where j.created_at < now() - interval '24 hours'
    and j.contract_id is null
    and not exists (select 1 from public.contract_documents d where d.analysis_job_id = j.id)
    and not exists (select 1 from public.contracts c where c.analysis_job_id = j.id);
  get diagnostics n_deleted = row_count;
  update public.analysis_jobs set raw_output = null
  where raw_output is not null and created_at < now() - interval '24 hours';
  get diagnostics n_cleared = row_count;
  return query select n_deleted, n_cleared;
end;
$$;

revoke all on function public.claim_orphan_documents(integer) from public, anon, authenticated;
revoke all on function public.purge_stale_analysis_jobs() from public, anon, authenticated;
grant execute on function public.claim_orphan_documents(integer) to service_role;
grant execute on function public.purge_stale_analysis_jobs() to service_role;

-- 매시간 정리 함수 호출 (pg_cron + pg_net). 주소·비밀값은 Vault에 넣는다 (없으면 호출이 실패할 뿐 데이터는 그대로):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<CLEANUP_SECRET과 같은 값>', 'cleanup_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule(
  'pacto-cleanup-orphans',
  '23 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/cleanup-orphans',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_secret')),
    body := '{}'::jsonb
  )
  $cron$
);
