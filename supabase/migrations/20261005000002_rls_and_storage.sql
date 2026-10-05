-- PACTO 보안: 권한(GRANT) + Row Level Security + private Storage
-- 원칙: anon은 어떤 데이터에도 접근 불가. authenticated는 RLS로 "본인 행"만.

-- ===== 권한 =====
revoke all on all tables in schema public from anon, public;
revoke all on all functions in schema public from anon, public;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

alter table public.profiles enable row level security;
alter table public.analysis_jobs enable row level security;
alter table public.contracts enable row level security;
alter table public.contract_documents enable row level security;
alter table public.contract_payments enable row level security;
alter table public.contract_events enable row level security;

-- 계약 접근 가능 여부 (P2 가족 공유 시 이 함수만 확장)
create function public.owns_contract(cid uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.contracts c where c.id = cid and c.user_id = (select auth.uid()));
$$;
grant execute on function public.owns_contract(uuid) to authenticated;

-- ===== profiles =====
create policy "profiles: read own" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- insert는 가입 트리거, delete는 auth.users cascade

-- ===== contracts =====
create policy "contracts: read own" on public.contracts for select to authenticated
  using (user_id = (select auth.uid()));
create policy "contracts: insert own" on public.contracts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "contracts: update own" on public.contracts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "contracts: delete own" on public.contracts for delete to authenticated
  using (user_id = (select auth.uid()));

-- ===== 하위 테이블: 본인 행 + 본인 계약에만 연결 가능 =====
create policy "payments: read own" on public.contract_payments for select to authenticated
  using (user_id = (select auth.uid()));
create policy "payments: insert own" on public.contract_payments for insert to authenticated
  with check (user_id = (select auth.uid()) and public.owns_contract(contract_id));
create policy "payments: update own" on public.contract_payments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.owns_contract(contract_id));
create policy "payments: delete own" on public.contract_payments for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "events: read own" on public.contract_events for select to authenticated
  using (user_id = (select auth.uid()));
create policy "events: insert own" on public.contract_events for insert to authenticated
  with check (user_id = (select auth.uid()) and public.owns_contract(contract_id));
create policy "events: update own" on public.contract_events for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.owns_contract(contract_id));
create policy "events: delete own" on public.contract_events for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "documents: read own" on public.contract_documents for select to authenticated
  using (user_id = (select auth.uid()));
create policy "documents: insert own" on public.contract_documents for insert to authenticated
  with check (user_id = (select auth.uid()) and (contract_id is null or public.owns_contract(contract_id)));
create policy "documents: update own" on public.contract_documents for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (contract_id is null or public.owns_contract(contract_id)));
create policy "documents: delete own" on public.contract_documents for delete to authenticated
  using (user_id = (select auth.uid()));

-- ===== analysis_jobs =====
-- 사용자는 작업 생성/조회만. 결과·상태 기록은 서버(Edge Function, service_role) 담당.
-- V1(mock AI) 동안만 provider='mock' 작업은 결과를 함께 기록할 수 있게 허용 — 실제 AI 연결(Step 9) 시 제거.
create policy "jobs: read own" on public.analysis_jobs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "jobs: insert own" on public.analysis_jobs for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and contract_id is null
    and ((status = 'queued' and result is null) or provider = 'mock')
  );

-- ===== 계약 저장 RPC (확인 화면 → 계약 + 대표 결제 + 원본 연결을 한 트랜잭션으로) =====
-- security invoker: 모든 쓰기에 호출자 RLS가 그대로 적용된다.
create function public.save_contract(
  p_contract jsonb,
  p_payment jsonb default null,
  p_contract_id uuid default null,
  p_document_ids uuid[] default '{}',
  p_ai_checks jsonb default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := p_contract_id;
  v_primary uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.contracts (
      title, category, counterparty, contract_date, start_date, end_date, total_amount,
      auto_renewal, renewal_period_months, termination_notice_days, early_termination_terms,
      penalty_terms, deposit_amount, memo, source, analysis_job_id, ai_checks
    ) values (
      p_contract ->> 'title',
      coalesce((p_contract ->> 'category')::public.contract_category, 'other'),
      p_contract ->> 'counterparty',
      (p_contract ->> 'contract_date')::date,
      (p_contract ->> 'start_date')::date,
      (p_contract ->> 'end_date')::date,
      (p_contract ->> 'total_amount')::bigint,
      coalesce((p_contract ->> 'auto_renewal')::boolean, false),
      (p_contract ->> 'renewal_period_months')::smallint,
      (p_contract ->> 'termination_notice_days')::smallint,
      p_contract ->> 'early_termination_terms',
      p_contract ->> 'penalty_terms',
      (p_contract ->> 'deposit_amount')::bigint,
      p_contract ->> 'memo',
      coalesce((p_contract ->> 'source')::public.contract_source, 'manual'),
      (p_contract ->> 'analysis_job_id')::uuid,
      coalesce(p_ai_checks, '[]'::jsonb)
    ) returning id into v_id;
  else
    update public.contracts set
      title = p_contract ->> 'title',
      category = coalesce((p_contract ->> 'category')::public.contract_category, 'other'),
      counterparty = p_contract ->> 'counterparty',
      contract_date = (p_contract ->> 'contract_date')::date,
      start_date = (p_contract ->> 'start_date')::date,
      end_date = (p_contract ->> 'end_date')::date,
      total_amount = (p_contract ->> 'total_amount')::bigint,
      auto_renewal = coalesce((p_contract ->> 'auto_renewal')::boolean, false),
      renewal_period_months = (p_contract ->> 'renewal_period_months')::smallint,
      termination_notice_days = (p_contract ->> 'termination_notice_days')::smallint,
      early_termination_terms = p_contract ->> 'early_termination_terms',
      penalty_terms = p_contract ->> 'penalty_terms',
      deposit_amount = (p_contract ->> 'deposit_amount')::bigint,
      memo = p_contract ->> 'memo',
      ai_checks = coalesce(p_ai_checks, ai_checks)
    where id = v_id;
    if not found then
      raise exception 'contract not found' using errcode = 'P0002';
    end if;
  end if;

  -- 대표 결제(sort_order 0): 있으면 갱신, 없으면 생성, 결제 정보가 비면 삭제
  select id into v_primary from public.contract_payments
    where contract_id = v_id and sort_order = 0 limit 1;
  if p_payment is null then
    delete from public.contract_payments where id = v_primary;
  elsif v_primary is null then
    insert into public.contract_payments (contract_id, label, amount, frequency, day_of_month, month_of_year, starts_on, ends_on, is_variable, sort_order)
    values (
      v_id,
      coalesce(p_payment ->> 'label', '납부금'),
      (p_payment ->> 'amount')::bigint,
      (p_payment ->> 'frequency')::public.payment_frequency,
      (p_payment ->> 'day_of_month')::smallint,
      (p_payment ->> 'month_of_year')::smallint,
      (p_payment ->> 'starts_on')::date,
      (p_payment ->> 'ends_on')::date,
      coalesce((p_payment ->> 'is_variable')::boolean, false),
      0
    );
  else
    update public.contract_payments set
      label = coalesce(p_payment ->> 'label', '납부금'),
      amount = (p_payment ->> 'amount')::bigint,
      frequency = (p_payment ->> 'frequency')::public.payment_frequency,
      day_of_month = (p_payment ->> 'day_of_month')::smallint,
      month_of_year = case
        when frequency = (p_payment ->> 'frequency')::public.payment_frequency then month_of_year
        else (p_payment ->> 'month_of_year')::smallint end,
      starts_on = (p_payment ->> 'starts_on')::date,
      ends_on = (p_payment ->> 'ends_on')::date,
      is_variable = coalesce((p_payment ->> 'is_variable')::boolean, false)
    where id = v_primary;
  end if;

  -- 업로드해 둔 원본 계약서를 계약에 연결 (본인 문서만 — RLS)
  if array_length(p_document_ids, 1) > 0 then
    update public.contract_documents set contract_id = v_id
      where id = any (p_document_ids) and contract_id is null;
  end if;

  return v_id;
end;
$$;
grant execute on function public.save_contract(jsonb, jsonb, uuid, uuid[], jsonb) to authenticated;

-- ===== Storage: 원본 계약서 private bucket =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contract-files', 'contract-files', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- 경로 첫 폴더 = 본인 user id. 덮어쓰기(update) 정책은 두지 않는다.
create policy "contract-files: read own" on storage.objects for select to authenticated
  using (bucket_id = 'contract-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "contract-files: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'contract-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "contract-files: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'contract-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
