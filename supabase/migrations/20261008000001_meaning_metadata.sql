-- PACTO: 의미 해석 → 관리 데이터
-- 숫자·날짜를 그대로 결제·일정으로 만들지 않도록, 결제와 계약에 의미 정보를 더한다.
-- - contract_payments.components: 금액의 구성 항목 (예: 월 임금 = 기본급 + 고정연장근로수당). 표시용이며 합산하지 않는다
-- - contract_payments.business_day_rule: 지급일이 휴일이면 직전(previous)/다음(next) 영업일 — 실제 지급 예정일 계산
-- - contracts.value_sources: 값별 출처 (explicit 계약서 명시 / inferred AI 추정 / calculated PACTO 계산 / user_confirmed 사용자 확인)
-- - 레지스트리: 근로 유형 속성(수습기간 임금 비율, 갱신 관련 조건) 추가

alter table public.contract_payments
  add column components jsonb not null default '[]'::jsonb check (jsonb_typeof(components) = 'array'),
  add column business_day_rule text not null default 'none' check (business_day_rule in ('none', 'previous', 'next'));

alter table public.contracts
  add column value_sources jsonb not null default '{}'::jsonb check (jsonb_typeof(value_sources) = 'object');

insert into public.contract_detail_fields (contract_type, key, value_type, options) values
  ('employment', 'probation_pay_rate', 'number', null),
  ('employment', 'renewal_terms', 'text', null)
on conflict (contract_type, key) do update set value_type = excluded.value_type, options = excluded.options;

drop function public.save_contract(jsonb, jsonb, jsonb, uuid, uuid[], jsonb);

create function public.save_contract(
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
      auto_renewal, renewal_period_months, termination_notice_days, early_termination_terms,
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
      components, business_day_rule, sort_order
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
