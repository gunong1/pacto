-- 반복 결제·수입 금액 변경 이력 (과거 일정 보존)
-- 원칙: 현재 조건이 바뀌어도 과거가 자동으로 다시 쓰이지 않는다.
-- - contract_payments.amount = 최초 금액 (그대로 유지). 변경은 contract_payment_changes에 적용일(effective_from)과 함께 누적
-- - 어떤 날짜의 금액 = 그 날짜 이전(포함)에 시작된 가장 최근 변경의 금액, 없으면 최초 금액 (앱 domain amountAt)
-- - effective_to는 저장하지 않는다 (다음 변경 적용일 - 1일로 계산 → 기간 겹침·빈틈이 생길 수 없음)
-- - 결제 규칙을 기간별로 여러 행으로 쪼개지 않는다 (회차·기준월·결제일 기준이 틀어짐)
-- - 지난 변경(적용일 ≤ 오늘)은 삭제 불가, 아직 적용 전인 변경만 취소 가능
-- - source_document_id: 변경계약서 연결용 (추후 AI 추출 → 사용자 확인 → 변경 생성)
-- save_contract: 결제를 전부 지우고 다시 넣지 않는다 — id 유지(UPDATE) / 새 결제 INSERT / 빠진 결제만 DELETE

create table public.contract_payment_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  payment_id uuid not null references public.contract_payments (id) on delete cascade,
  effective_from date not null,
  amount bigint not null check (amount >= 0),
  -- 결제일 변경 (null = 기존 결제일 유지). 이번 화면에서는 금액만 바꾼다
  day_of_month smallint check (day_of_month between 1 and 31),
  change_reason text check (change_reason is null or char_length(change_reason) <= 100),
  source_document_id uuid references public.contract_documents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id, effective_from)
);
create index contract_payment_changes_user_idx on public.contract_payment_changes (user_id);
create trigger contract_payment_changes_updated_at before update on public.contract_payment_changes
  for each row execute function public.set_updated_at();

-- 어떤 결제의 변경인지·적용일은 바꿀 수 없다 (금액·사유·근거 문서만 정정)
create or replace function public.guard_payment_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.payment_id <> old.payment_id or new.effective_from <> old.effective_from or new.user_id <> old.user_id then
    raise exception 'payment change identity is immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger contract_payment_changes_guard before update on public.contract_payment_changes
  for each row execute function public.guard_payment_change();

-- 오늘 (한국 시간)
create or replace function public.seoul_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Seoul')::date
$$;

create or replace function public.owns_payment(p_payment_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.contract_payments p where p.id = p_payment_id and p.user_id = (select auth.uid()))
$$;

-- 권한: 본인 행만(RLS). 정정은 금액·사유·근거 문서만, 적용일·결제 연결은 바꿀 수 없다
revoke all on public.contract_payment_changes from anon, authenticated;
grant select, delete on public.contract_payment_changes to authenticated;
grant insert (payment_id, effective_from, amount, day_of_month, change_reason, source_document_id) on public.contract_payment_changes to authenticated;
grant update (amount, change_reason, source_document_id) on public.contract_payment_changes to authenticated;
grant select, insert, update, delete on public.contract_payment_changes to service_role;

alter table public.contract_payment_changes enable row level security;
create policy "payment changes: read own" on public.contract_payment_changes for select to authenticated
  using (user_id = (select auth.uid()));
create policy "payment changes: insert own" on public.contract_payment_changes for insert to authenticated
  with check (
    user_id = (select auth.uid()) and public.owns_payment(payment_id)
    and (source_document_id is null or exists (select 1 from public.contract_documents d where d.id = source_document_id and d.user_id = (select auth.uid())))
  );
create policy "payment changes: update own" on public.contract_payment_changes for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (source_document_id is null or exists (select 1 from public.contract_documents d where d.id = source_document_id and d.user_id = (select auth.uid())))
  );
-- 아직 적용 전인 변경만 취소 (결제·계약 삭제 시에는 FK cascade로 함께 삭제)
create policy "payment changes: cancel future own" on public.contract_payment_changes for delete to authenticated
  using (user_id = (select auth.uid()) and effective_from > public.seoul_today());

-- 아직 적용 전인 금액 변경 취소 — 이미 적용이 시작된 변경은 취소할 수 없다
create or replace function public.cancel_payment_change(p_change_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from public.contract_payment_changes where id = p_change_id and effective_from > public.seoul_today();
  if not found then
    raise exception 'change not cancellable' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.cancel_payment_change(uuid) from anon, public;
grant execute on function public.cancel_payment_change(uuid) to authenticated;

-- ===== save_contract: 결제 id 유지 + 금액 변경 =====
drop function if exists public.save_contract(jsonb, jsonb, jsonb, uuid, uuid[], jsonb);

create or replace function public.save_contract(
  p_contract jsonb,
  p_payments jsonb default null,
  p_dates jsonb default null,
  p_contract_id uuid default null,
  p_document_ids uuid[] default '{}',
  p_ai_checks jsonb default null,
  p_amount_changes jsonb default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := p_contract_id;
  v_keep uuid[] := '{}';
  v_pid uuid;
  v_p jsonb;
  v_ord bigint;
  v_c jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_payments is not null and jsonb_typeof(p_payments) <> 'array' then
    raise exception 'p_payments must be an array' using errcode = '22023';
  end if;
  if p_amount_changes is not null and jsonb_typeof(p_amount_changes) <> 'array' then
    raise exception 'p_amount_changes must be an array' using errcode = '22023';
  end if;
  if p_dates is not null and jsonb_typeof(p_dates) <> 'array' then
    raise exception 'p_dates must be an array' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.contracts (
      title, category, contract_type, contract_details, counterparty, contract_date, start_date, end_date, total_amount,
      auto_renewal, renewal_period_months, termination_notice_days, notice_kind, early_termination_terms,
      penalty_terms, deposit_amount, memo, source, analysis_job_id, ai_checks, value_sources
    ) values (
      p_contract ->> 'title',
      coalesce(p_contract ->> 'category', 'other'),
      coalesce(p_contract ->> 'contract_type', 'other'),
      coalesce(p_contract -> 'contract_details', '{}'::jsonb),
      p_contract ->> 'counterparty',
      (p_contract ->> 'contract_date')::date,
      (p_contract ->> 'start_date')::date,
      (p_contract ->> 'end_date')::date,
      (p_contract ->> 'total_amount')::bigint,
      coalesce((p_contract ->> 'auto_renewal')::boolean, false),
      (p_contract ->> 'renewal_period_months')::smallint,
      (p_contract ->> 'termination_notice_days')::smallint,
      coalesce(p_contract ->> 'notice_kind', 'unknown'),
      p_contract ->> 'early_termination_terms',
      p_contract ->> 'penalty_terms',
      (p_contract ->> 'deposit_amount')::bigint,
      p_contract ->> 'memo',
      coalesce((p_contract ->> 'source')::public.contract_source, 'manual'),
      (p_contract ->> 'analysis_job_id')::uuid,
      coalesce(p_ai_checks, '[]'::jsonb),
      coalesce(p_contract -> 'value_sources', '{}'::jsonb)
    ) returning id into v_id;
  else
    update public.contracts set
      title = p_contract ->> 'title',
      category = coalesce(p_contract ->> 'category', 'other'),
      contract_type = coalesce(p_contract ->> 'contract_type', contract_type),
      contract_details = coalesce(p_contract -> 'contract_details', contract_details),
      counterparty = p_contract ->> 'counterparty',
      contract_date = (p_contract ->> 'contract_date')::date,
      start_date = (p_contract ->> 'start_date')::date,
      end_date = (p_contract ->> 'end_date')::date,
      total_amount = (p_contract ->> 'total_amount')::bigint,
      auto_renewal = coalesce((p_contract ->> 'auto_renewal')::boolean, false),
      renewal_period_months = (p_contract ->> 'renewal_period_months')::smallint,
      termination_notice_days = (p_contract ->> 'termination_notice_days')::smallint,
      notice_kind = coalesce(p_contract ->> 'notice_kind', notice_kind),
      early_termination_terms = p_contract ->> 'early_termination_terms',
      penalty_terms = p_contract ->> 'penalty_terms',
      deposit_amount = (p_contract ->> 'deposit_amount')::bigint,
      memo = p_contract ->> 'memo',
      ai_checks = coalesce(p_ai_checks, ai_checks),
      value_sources = coalesce(p_contract -> 'value_sources', value_sources)
    where id = v_id;
    if not found then
      raise exception 'contract not found' using errcode = 'P0002';
    end if;
  end if;

  -- 결제 규칙: id를 유지한다 (변경 이력·근거 문서가 결제 id에 연결됨)
  --   id 있음 → 이 계약의 결제면 UPDATE (다른 계약·없는 id면 오류) / id 없음 → INSERT / 목록에서 빠진 결제 → DELETE (변경 이력도 함께)
  if p_payments is not null then
    for v_p, v_ord in select x.p, x.n from jsonb_array_elements(p_payments) with ordinality as x (p, n) loop
      v_pid := nullif(v_p ->> 'id', '')::uuid;
      if v_pid is not null then
        update public.contract_payments set
          kind = coalesce(v_p ->> 'kind', 'other'),
          direction = coalesce(v_p ->> 'direction', (select d.default_direction from public.payment_kind_defs d where d.code = coalesce(v_p ->> 'kind', 'other')), 'expense'),
          label = coalesce(nullif(v_p ->> 'label', ''), '납부금'),
          amount = (v_p ->> 'amount')::bigint,
          frequency = (v_p ->> 'frequency')::public.payment_frequency,
          day_of_month = (v_p ->> 'day_of_month')::smallint,
          month_of_year = (v_p ->> 'month_of_year')::smallint,
          starts_on = (v_p ->> 'starts_on')::date,
          ends_on = (v_p ->> 'ends_on')::date,
          installment_count = (v_p ->> 'installment_count')::smallint,
          is_variable = coalesce((v_p ->> 'is_variable')::boolean, false),
          components = coalesce(v_p -> 'components', '[]'::jsonb),
          business_day_rule = coalesce(v_p ->> 'business_day_rule', 'none'),
          obligation = coalesce(v_p ->> 'obligation', 'confirmed'),
          condition_note = nullif(v_p ->> 'condition_note', ''),
          sort_order = (v_ord - 1)::smallint
        where id = v_pid and contract_id = v_id;
        if not found then
          raise exception 'payment not found' using errcode = 'P0002';
        end if;
      else
        insert into public.contract_payments (
          contract_id, kind, direction, label, amount, frequency, day_of_month, month_of_year, starts_on, ends_on, installment_count, is_variable,
          components, business_day_rule, obligation, condition_note, sort_order
        ) values (
          v_id,
          coalesce(v_p ->> 'kind', 'other'),
          coalesce(v_p ->> 'direction', (select d.default_direction from public.payment_kind_defs d where d.code = coalesce(v_p ->> 'kind', 'other')), 'expense'),
          coalesce(nullif(v_p ->> 'label', ''), '납부금'),
          (v_p ->> 'amount')::bigint,
          (v_p ->> 'frequency')::public.payment_frequency,
          (v_p ->> 'day_of_month')::smallint,
          (v_p ->> 'month_of_year')::smallint,
          (v_p ->> 'starts_on')::date,
          (v_p ->> 'ends_on')::date,
          (v_p ->> 'installment_count')::smallint,
          coalesce((v_p ->> 'is_variable')::boolean, false),
          coalesce(v_p -> 'components', '[]'::jsonb),
          coalesce(v_p ->> 'business_day_rule', 'none'),
          coalesce(v_p ->> 'obligation', 'confirmed'),
          nullif(v_p ->> 'condition_note', ''),
          (v_ord - 1)::smallint
        ) returning id into v_pid;
      end if;
      v_keep := v_keep || v_pid;
    end loop;
    delete from public.contract_payments where contract_id = v_id and id <> all (v_keep);
  end if;

  -- 금액 변경 (같은 트랜잭션)
  --   add: 적용일부터 새 금액 (같은 적용일이 이미 있으면 그 금액을 바꾼다)
  --   correct: 기존 변경 이력의 금액 정정 (입력 실수) — 적용일은 바꾸지 않는다
  if p_amount_changes is not null then
    for v_c in select value from jsonb_array_elements(p_amount_changes) loop
      if v_c ->> 'op' = 'add' then
        if not exists (
          select 1 from public.contract_payments x
          where x.id = (v_c ->> 'payment_id')::uuid and x.contract_id = v_id and x.frequency <> 'one_time'
            and (v_c ->> 'effective_from')::date > x.starts_on
        ) then
          raise exception 'invalid amount change' using errcode = '22023';
        end if;
        insert into public.contract_payment_changes (payment_id, effective_from, amount, change_reason, source_document_id)
        values (
          (v_c ->> 'payment_id')::uuid,
          (v_c ->> 'effective_from')::date,
          (v_c ->> 'amount')::bigint,
          nullif(btrim(v_c ->> 'change_reason'), ''),
          nullif(v_c ->> 'source_document_id', '')::uuid
        )
        on conflict (payment_id, effective_from) do update set
          amount = excluded.amount,
          change_reason = coalesce(excluded.change_reason, public.contract_payment_changes.change_reason),
          source_document_id = coalesce(excluded.source_document_id, public.contract_payment_changes.source_document_id);
      elsif v_c ->> 'op' = 'correct' then
        update public.contract_payment_changes ch set amount = (v_c ->> 'amount')::bigint
        from public.contract_payments x
        where ch.id = (v_c ->> 'change_id')::uuid and x.id = ch.payment_id and x.contract_id = v_id;
        if not found then
          raise exception 'amount change not found' using errcode = 'P0002';
        end if;
      else
        raise exception 'unknown amount change op' using errcode = '22023';
      end if;
    end loop;
  end if;

  if p_dates is not null then
    delete from public.contract_dates where contract_id = v_id;
    insert into public.contract_dates (contract_id, kind, label, date, sort_order)
    select v_id, coalesce(d ->> 'kind', 'other'), d ->> 'label', (d ->> 'date')::date, (ord - 1)::smallint
    from jsonb_array_elements(p_dates) with ordinality as x (d, ord);
  end if;

  -- 업로드해 둔 원본 계약서를 계약에 연결 (본인 문서만 — RLS)
  if array_length(p_document_ids, 1) > 0 then
    update public.contract_documents set contract_id = v_id
      where id = any (p_document_ids) and contract_id is null;
  end if;

  return v_id;
end;
$$;
revoke all on function public.save_contract(jsonb, jsonb, jsonb, uuid, uuid[], jsonb, jsonb) from anon, public;
grant execute on function public.save_contract(jsonb, jsonb, jsonb, uuid, uuid[], jsonb, jsonb) to authenticated;
