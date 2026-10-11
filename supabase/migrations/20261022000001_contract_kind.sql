-- 계약 종류 (contract_kind) — 분류 개편 (2026-10)
--
-- 계약 종류 = 계약의 본질 (무엇을 제공·사용·보장·대여·이전하는 관계인가). 결제 방식과 무관하다.
-- 사용자에게 보여주는 기준값은 contract_kind 하나다. 기존 category·contract_type은 하위 호환값으로 남긴다
-- (예전 앱·예전 데이터용 — 새 코드는 contract_kind가 있으면 읽지 않는다).
--   contract_kind     계약 종류 (13개, 자동차는 종류가 아니라 대상이라 없음)
--   contract_subtype  상세 분류 (그 종류에 속한 값만 — (종류, 상세 분류) 쌍으로 기준표 검사)
--   classification    분류 메타데이터 { confidence, alternatives, reason, evidence, secondaryElements, domains, source }
--                     domains: 계약 대상 (예: ["vehicle"]) — "자동차 관련 계약 전체 보기"용 내부 값
--
-- 기존 데이터는 바꾸지 않는다: contract_kind = null (화면은 기존 표시). 사용자가 수정하거나 다시 분석할 때 채워진다.
-- 목록의 원본: supabase/functions/_shared/contractRegistry.ts CONTRACT_KIND_DEFS (통합 테스트가 일치 여부를 검사)

create table public.contract_kind_defs (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null,
  sort_order smallint not null default 0
);
create table public.contract_subtype_defs (
  kind text not null references public.contract_kind_defs (code) on update cascade on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null,
  sort_order smallint not null default 0,
  primary key (kind, code)
);

do $$
declare t text;
begin
  foreach t in array array['contract_kind_defs', 'contract_subtype_defs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy "registry: read" on public.%I for select to authenticated using (true)', t);
  end loop;
end;
$$;

insert into public.contract_kind_defs (code, label, sort_order) values
  ('employment', '근로', 0),
  ('lease', '부동산·임대차', 1),
  ('loan', '대출', 2),
  ('insurance', '보험', 3),
  ('telecom', '통신', 4),
  ('subscription_membership', '구독·회원권', 5),
  ('rental', '렌탈', 6),
  ('installment', '할부', 7),
  ('sale', '매매', 8),
  ('service', '용역·프리랜서', 9),
  ('education', '교육', 10),
  ('business', '사업·거래', 11),
  ('other', '기타', 12);

insert into public.contract_subtype_defs (kind, code, label, sort_order) values
  ('employment', 'full_time', '정규직', 0),
  ('employment', 'fixed_term', '계약직', 1),
  ('employment', 'part_time', '단시간·아르바이트', 2),
  ('lease', 'housing', '주택', 0),
  ('lease', 'commercial', '상가', 1),
  ('lease', 'office', '사무실', 2),
  ('lease', 'land', '토지', 3),
  ('loan', 'credit', '신용대출', 0),
  ('loan', 'mortgage', '주택담보대출', 1),
  ('loan', 'jeonse_loan', '전세자금대출', 2),
  ('loan', 'auto_loan', '자동차 대출', 3),
  ('loan', 'auto_lease', '자동차 금융리스', 4),
  ('insurance', 'auto', '자동차보험', 0),
  ('insurance', 'health', '건강·실손보험', 1),
  ('insurance', 'life', '생명보험', 2),
  ('insurance', 'fire', '화재보험', 3),
  ('insurance', 'liability', '배상책임보험', 4),
  ('insurance', 'travel', '여행자보험', 5),
  ('telecom', 'mobile', '휴대전화', 0),
  ('telecom', 'internet', '인터넷', 1),
  ('telecom', 'iptv', 'IPTV', 2),
  ('telecom', 'landline', '유선전화', 3),
  ('subscription_membership', 'software_saas', '소프트웨어·SaaS', 0),
  ('subscription_membership', 'streaming', '영상·음악 스트리밍', 1),
  ('subscription_membership', 'fitness_membership', '피트니스·운동', 2),
  ('subscription_membership', 'online_platform', '온라인 플랫폼', 3),
  ('subscription_membership', 'content_subscription', '콘텐츠 구독', 4),
  ('rental', 'appliance', '가전·생활기기', 0),
  ('rental', 'vehicle', '자동차', 1),
  ('rental', 'vehicle_lease', '자동차 운용리스', 2),
  ('rental', 'equipment', '장비·기계', 3),
  ('rental', 'office_device', '사무기기', 4),
  ('installment', 'vehicle', '자동차', 0),
  ('installment', 'goods', '물품', 1),
  ('installment', 'device', '휴대폰·단말', 2),
  ('sale', 'real_estate', '부동산', 0),
  ('sale', 'vehicle', '자동차', 1),
  ('sale', 'goods', '물품', 2),
  ('sale', 'business_transfer', '사업 양수도', 3),
  ('service', 'development', '개발', 0),
  ('service', 'design', '디자인', 1),
  ('service', 'consulting', '컨설팅', 2),
  ('service', 'maintenance', '유지보수', 3),
  ('service', 'content_production', '콘텐츠 제작', 4),
  ('education', 'academy', '학원', 0),
  ('education', 'tutoring', '과외', 1),
  ('education', 'online_course', '온라인 강의', 2),
  ('education', 'vocational', '직업교육', 3),
  ('business', 'supply', '공급', 0),
  ('business', 'partnership', '제휴', 1),
  ('business', 'distribution', '유통', 2),
  ('business', 'agency', '판매대행', 3);

alter table public.contracts
  add column contract_kind text references public.contract_kind_defs (code) on update cascade,
  add column contract_subtype text,
  add column classification jsonb not null default '{}'::jsonb check (jsonb_typeof(classification) = 'object'),
  add constraint contracts_subtype_needs_kind check (contract_subtype is null or contract_kind is not null),
  add constraint contracts_subtype_fk foreign key (contract_kind, contract_subtype) references public.contract_subtype_defs (kind, code) on update cascade;

-- ===== save_contract: 계약 종류·상세 분류·분류 메타데이터 저장 =====
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
      penalty_terms, deposit_amount, memo, source, analysis_job_id, ai_checks, value_sources, reference_amounts,
      contract_kind, contract_subtype, classification
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
      coalesce(p_contract -> 'reference_amounts', '[]'::jsonb),
      nullif(p_contract ->> 'contract_kind', ''),
      nullif(p_contract ->> 'contract_subtype', ''),
      coalesce(p_contract -> 'classification', '{}'::jsonb)
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
      reference_amounts = coalesce(p_contract -> 'reference_amounts', reference_amounts),
      -- 계약 종류: 보낸 경우에만 바꾼다 (예전 앱은 이 키를 보내지 않음 → 새 앱이 저장한 종류를 지우지 않는다)
      contract_kind = case when p_contract ? 'contract_kind' then nullif(p_contract ->> 'contract_kind', '') else contract_kind end,
      contract_subtype = case when p_contract ? 'contract_kind' then nullif(p_contract ->> 'contract_subtype', '') else contract_subtype end,
      classification = case when p_contract ? 'classification' then coalesce(p_contract -> 'classification', '{}'::jsonb) else classification end
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
