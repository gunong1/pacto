-- 참고 금액(결제가 아닌 금액)을 결제와 분리해 저장 — 분석 규칙 리팩터링 C
--
-- 원칙: "실제 결제가 아닌 금액"(차량가·대출금액·할인 전 금액·면제·할인액·요약 칸에 담지 못한 총액)은
--       contract_payments(실제 결제)에 저장하지 않는다. 계약의 reference_amounts 목록에만 보관하고
--       홈·캘린더·알림 계산에는 절대 포함하지 않는다 (계산 함수는 contract_payments만 본다).
--   reference_amounts 항목: { label, amount, role: total | reference | waived | discount | before_discount }
--
-- 기존 데이터 (일회성 정리):
--   obligation = 'informational'(참고 금액)인 결제 행 → 참고 금액 목록으로 옮기고 결제 행은 지운다.
--   총액(보증금·계약 총액)은 계약 요약 칸(deposit_amount·total_amount)이 비어 있으면 그 칸으로, 같은 값이면 생략,
--   다른 값이 이미 있으면 참고 금액(총액)으로. 'potential'(발생 가능) 값은 그대로 둔다 (조건부와 같이 읽음).

alter table public.contracts
  add column reference_amounts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(reference_amounts) = 'array');

-- 일회성 정리 함수 (서버 전용) — 이 마이그레이션에서 한 번 실행한다. 통합 테스트에서도 같은 함수로 검증한다
create or replace function public.migrate_informational_payments() returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- 1) 총액 행이 요약 칸으로 들어갈 수 있으면 채운다
  with info as (
    select p.id, p.contract_id, p.kind, p.label, p.amount, p.condition_note
    from public.contract_payments p
    where p.obligation = 'informational'
  ),
  totals as (
    select i.* from info i
    where i.condition_note like '총액%' or i.label ~ '(보증금|전세금|총\s*계약금액|계약\s*총액|총액|매매대금)'
  )
  update public.contracts c set
    deposit_amount = case when t.kind = 'deposit' or t.label ~ '(보증금|전세금)' then coalesce(c.deposit_amount, t.amount) else c.deposit_amount end,
    total_amount = case when not (t.kind = 'deposit' or t.label ~ '(보증금|전세금)') then coalesce(c.total_amount, t.amount) else c.total_amount end
  from totals t
  where t.contract_id = c.id;

  -- 2) 요약 칸과 같은 값이 아닌 참고 금액만 목록에 남긴다
  update public.contracts c set reference_amounts = c.reference_amounts || x.items
  from (
    select p.contract_id,
      jsonb_agg(jsonb_build_object(
        'label', p.label,
        'amount', p.amount,
        'role', case when p.condition_note like '총액%' then 'total' else 'reference' end
      ) order by p.sort_order) as items
    from public.contract_payments p
    join public.contracts k on k.id = p.contract_id
    where p.obligation = 'informational'
      -- 요약 칸이 비어 있으면(NULL) 같은 값이 아니다 — NULL 비교로 행이 빠지지 않도록 coalesce
      and not coalesce(p.amount = k.deposit_amount and (p.kind = 'deposit' or p.label ~ '(보증금|전세금)'), false)
      and not coalesce(p.amount = k.total_amount and not (p.kind = 'deposit' or p.label ~ '(보증금|전세금)'), false)
    group by p.contract_id
  ) x
  where x.contract_id = c.id;

  -- 3) 참고 금액 결제 행 정리 (결제가 아님)
  delete from public.contract_payments where obligation = 'informational';
end;
$$;
revoke all on function public.migrate_informational_payments() from public, anon, authenticated;
grant execute on function public.migrate_informational_payments() to service_role;

select public.migrate_informational_payments();

-- ===== save_contract: 참고 금액 목록(p_contract.reference_amounts) 저장 =====
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
      penalty_terms, deposit_amount, memo, source, analysis_job_id, ai_checks, value_sources, reference_amounts
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
      coalesce(p_contract -> 'value_sources', '{}'::jsonb),
      coalesce(p_contract -> 'reference_amounts', '[]'::jsonb)
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
      value_sources = coalesce(p_contract -> 'value_sources', value_sources),
      reference_amounts = coalesce(p_contract -> 'reference_amounts', reference_amounts)
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
