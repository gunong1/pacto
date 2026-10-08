-- 통보기한의 의미 — "종료 N일 전"이라는 숫자만으로 해지 통보·갱신 통지·갱신 협의를 같은 것으로 다루지 않는다
-- termination_notice  해지·종료 의사를 상대방에게 통지해야 하는 기한
-- renewal_notice      갱신 또는 갱신 거절 의사를 통지해야 하는 기한
-- renewal_decision    갱신 여부를 확인·협의·결정하는 시점
-- unknown             숫자는 있으나 의미를 확정할 수 없음 (기존 데이터, 확신이 낮은 AI 결과) → 중요(important) + 확인 필요
-- 기존 계약은 추측해서 바꾸지 않고 모두 unknown — 사용자가 계약 수정에서 직접 고른다

alter table public.contracts
  add column notice_kind text not null default 'unknown'
    check (notice_kind in ('termination_notice', 'renewal_notice', 'renewal_decision', 'unknown'));

-- save_contract: notice_kind 저장 (수정 시 값이 없으면 기존 값 유지)
create or replace function public.save_contract(
  p_contract jsonb,
  p_payments jsonb default null,
  p_dates jsonb default null,
  p_contract_id uuid default null,
  p_document_ids uuid[] default '{}',
  p_ai_checks jsonb default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := p_contract_id;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_payments is not null and jsonb_typeof(p_payments) <> 'array' then
    raise exception 'p_payments must be an array' using errcode = '22023';
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

  if p_payments is not null then
    delete from public.contract_payments where contract_id = v_id;
    insert into public.contract_payments (
      contract_id, kind, direction, label, amount, frequency, day_of_month, month_of_year, starts_on, ends_on, installment_count, is_variable,
      components, business_day_rule, obligation, condition_note, sort_order
    )
    select
      v_id,
      coalesce(p ->> 'kind', 'other'),
      coalesce(p ->> 'direction', (select d.default_direction from public.payment_kind_defs d where d.code = coalesce(p ->> 'kind', 'other')), 'expense'),
      coalesce(nullif(p ->> 'label', ''), '납부금'),
      (p ->> 'amount')::bigint,
      (p ->> 'frequency')::public.payment_frequency,
      (p ->> 'day_of_month')::smallint,
      (p ->> 'month_of_year')::smallint,
      (p ->> 'starts_on')::date,
      (p ->> 'ends_on')::date,
      (p ->> 'installment_count')::smallint,
      coalesce((p ->> 'is_variable')::boolean, false),
      coalesce(p -> 'components', '[]'::jsonb),
      coalesce(p ->> 'business_day_rule', 'none'),
      coalesce(p ->> 'obligation', 'confirmed'),
      nullif(p ->> 'condition_note', ''),
      (ord - 1)::smallint
    from jsonb_array_elements(p_payments) with ordinality as x (p, ord);
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
revoke all on function public.save_contract(jsonb, jsonb, jsonb, uuid, uuid[], jsonb) from anon, public;
grant execute on function public.save_contract(jsonb, jsonb, jsonb, uuid, uuid[], jsonb) to authenticated;

-- 알림 설정 종류: 갱신 통지(renewal_notice)·갱신 여부 확인(renewal_decision) 키 추가
-- (기존 사용자 설정은 그대로 — renewal_notice는 읽을 때 해지·종료 통보기한 설정을 승계, renewal_decision은 PACTO 기본값)
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
  );
$$;
