-- PACTO: 확장 가능한 계약 레지스트리
-- 분야(category)·유형(contract_type)·결제 의미(kind)·날짜 의미를 enum이 아니라 text + 룩업 테이블(FK)로 바꾼다.
-- 새 분야·유형·속성은 룩업 테이블에 행을 추가하는 마이그레이션만으로 늘릴 수 있다 (컬럼·함수 변경 불필요).
-- 목록의 원본: supabase/functions/_shared/contractRegistry.ts (통합 테스트가 DB와 일치하는지 검사)
-- 함께 변경: auto_installment → installment, 분야 education·service·sale 추가, 유형 employment·service·sale 추가,
--            결제 방향(direction: expense | income | neutral) 추가, 상세 속성 검사를 룩업 테이블 기반 트리거로

-- ===== 룩업 테이블 =====
create table public.contract_categories (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null,
  sort_order smallint not null default 0
);
create table public.contract_type_defs (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null,
  sort_order smallint not null default 0
);
create table public.contract_detail_fields (
  contract_type text not null references public.contract_type_defs (code) on update cascade on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,59}$'),
  value_type text not null check (value_type in ('text', 'integer', 'number', 'boolean', 'enum')),
  options text[],
  primary key (contract_type, key)
);
create table public.payment_kind_defs (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null,
  default_direction text not null check (default_direction in ('expense', 'income', 'neutral')),
  sort_order smallint not null default 0
);
create table public.contract_date_kind_defs (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null,
  sort_order smallint not null default 0
);

-- 누구나 읽기만 (쓰기는 마이그레이션으로만)
do $$
declare t text;
begin
  foreach t in array array['contract_categories', 'contract_type_defs', 'contract_detail_fields', 'payment_kind_defs', 'contract_date_kind_defs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy "registry: read" on public.%I for select to authenticated using (true)', t);
  end loop;
end;
$$;

insert into public.contract_categories (code, label, sort_order) values
  ('employment', '근로', 0),
  ('real_estate', '부동산', 1),
  ('insurance', '보험', 2),
  ('vehicle', '자동차', 3),
  ('finance', '금융', 4),
  ('rental', '렌탈', 5),
  ('telecom', '통신', 6),
  ('membership', '회원권', 7),
  ('subscription', '구독', 8),
  ('education', '교육', 9),
  ('service', '용역·프리랜서', 10),
  ('business', '사업·거래', 11),
  ('sale', '매매', 12),
  ('other', '기타', 13)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;
insert into public.contract_type_defs (code, label, sort_order) values
  ('recurring', '월 납입형', 0),
  ('lease', '임대차', 1),
  ('installment', '할부', 2),
  ('loan', '대출', 3),
  ('insurance', '보험', 4),
  ('employment', '근로', 5),
  ('service', '용역·프리랜서', 6),
  ('sale', '매매', 7),
  ('one_time', '일회성 계약', 8),
  ('other', '기타', 9)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;
insert into public.contract_detail_fields (contract_type, key, value_type, options) values
  ('recurring', 'commitment_months', 'integer', null),
  ('recurring', 'equipment_return_terms', 'text', null),
  ('recurring', 'ownership_transfer_terms', 'text', null),
  ('lease', 'lease_kind', 'enum', array['jeonse', 'monthly', 'semi_jeonse', 'commercial', 'other']),
  ('lease', 'landlord', 'text', null),
  ('lease', 'tenant', 'text', null),
  ('lease', 'renewal_terms', 'text', null),
  ('lease', 'deposit_return_terms', 'text', null),
  ('installment', 'vehicle_name', 'text', null),
  ('installment', 'vehicle_price', 'integer', null),
  ('installment', 'advance_payment', 'integer', null),
  ('installment', 'principal', 'integer', null),
  ('installment', 'interest_rate', 'number', null),
  ('installment', 'total_installments', 'integer', null),
  ('installment', 'prepayment_terms', 'text', null),
  ('loan', 'principal', 'integer', null),
  ('loan', 'interest_rate', 'number', null),
  ('loan', 'rate_type', 'enum', array['fixed', 'variable', 'mixed']),
  ('loan', 'repayment_method', 'enum', array['equal_payment', 'equal_principal', 'bullet', 'other']),
  ('loan', 'prepayment_fee_terms', 'text', null),
  ('loan', 'overdue_terms', 'text', null),
  ('insurance', 'product_name', 'text', null),
  ('insurance', 'payment_period', 'text', null),
  ('insurance', 'coverage_period', 'text', null),
  ('insurance', 'renewable', 'boolean', null),
  ('insurance', 'renewal_cycle_years', 'integer', null),
  ('insurance', 'coverage_summary', 'text', null),
  ('insurance', 'surrender_terms', 'text', null),
  ('insurance', 'exclusions', 'text', null),
  ('employment', 'employee_name', 'text', null),
  ('employment', 'employment_kind', 'enum', array['permanent', 'fixed_term', 'part_time', 'other']),
  ('employment', 'job_title', 'text', null),
  ('employment', 'annual_salary', 'integer', null),
  ('employment', 'probation_months', 'integer', null),
  ('employment', 'work_hours', 'text', null),
  ('employment', 'work_days', 'text', null),
  ('employment', 'holidays', 'text', null),
  ('employment', 'leave_terms', 'text', null),
  ('employment', 'severance_terms', 'text', null),
  ('service', 'user_role', 'enum', array['provider', 'client']),
  ('service', 'work_scope', 'text', null),
  ('service', 'acceptance_terms', 'text', null),
  ('service', 'deliverable_ownership', 'text', null),
  ('service', 'revision_terms', 'text', null),
  ('sale', 'user_role', 'enum', array['buyer', 'seller']),
  ('sale', 'subject', 'text', null),
  ('one_time', 'subject', 'text', null)
on conflict (contract_type, key) do update set value_type = excluded.value_type, options = excluded.options;
insert into public.payment_kind_defs (code, label, default_direction, sort_order) values
  ('recurring_fee', '정기 이용료', 'expense', 0),
  ('setup_fee', '설치비·가입비', 'expense', 1),
  ('rent', '월세', 'expense', 2),
  ('maintenance_fee', '관리비', 'expense', 3),
  ('deposit', '보증금', 'neutral', 4),
  ('installment', '할부금', 'expense', 5),
  ('advance_payment', '선수금', 'expense', 6),
  ('loan_repayment', '원리금 상환', 'expense', 7),
  ('interest', '이자', 'expense', 8),
  ('premium', '보험료', 'expense', 9),
  ('salary', '급여', 'income', 10),
  ('bonus', '상여·수당', 'income', 11),
  ('service_fee', '용역 대금', 'income', 12),
  ('down_payment', '계약금', 'expense', 13),
  ('interim_payment', '중도금', 'expense', 14),
  ('balance_payment', '잔금', 'expense', 15),
  ('other', '기타 결제', 'expense', 16)
on conflict (code) do update set label = excluded.label, default_direction = excluded.default_direction, sort_order = excluded.sort_order;
insert into public.contract_date_kind_defs (code, label, sort_order) values
  ('installation', '설치일', 0),
  ('activation', '개통일', 1),
  ('move_in', '입주일', 2),
  ('balance_due', '잔금일', 3),
  ('renewal', '갱신일', 4),
  ('hire', '입사일', 5),
  ('delivery', '납기일', 6),
  ('inspection', '검수일', 7),
  ('handover', '인도일', 8),
  ('ownership_transfer', '소유권 이전일', 9),
  ('other', '기타 날짜', 10)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

-- ===== 기존 enum 의존 객체 제거 =====
alter table public.contracts drop constraint contracts_details_valid;
drop function public.save_contract(jsonb, jsonb, jsonb, uuid, uuid[], jsonb);
drop function public.valid_contract_details(public.contract_type, jsonb);
drop function public.contract_detail_spec(public.contract_type);

-- ===== enum → text + FK =====
alter table public.contracts
  alter column category drop default,
  alter column category type text using category::text,
  alter column category set default 'other',
  alter column contract_type drop default,
  alter column contract_type type text using (case when contract_type::text = 'auto_installment' then 'installment' else contract_type::text end),
  alter column contract_type set default 'other';
alter table public.contracts
  add constraint contracts_category_fk foreign key (category) references public.contract_categories (code) on update cascade,
  add constraint contracts_contract_type_fk foreign key (contract_type) references public.contract_type_defs (code) on update cascade;

alter table public.contract_payments
  alter column kind drop default,
  alter column kind type text using kind::text,
  alter column kind set default 'other',
  add constraint contract_payments_kind_fk foreign key (kind) references public.payment_kind_defs (code) on update cascade,
  add column direction text not null default 'expense' check (direction in ('expense', 'income', 'neutral'));
update public.contract_payments p set direction = d.default_direction from public.payment_kind_defs d where d.code = p.kind;

alter table public.contract_dates
  alter column kind drop default,
  alter column kind type text using kind::text,
  alter column kind set default 'other',
  add constraint contract_dates_kind_fk foreign key (kind) references public.contract_date_kind_defs (code) on update cascade;

drop type public.contract_category;
drop type public.contract_type;
drop type public.payment_kind;
drop type public.contract_date_kind;

-- ===== 유형별 상세 속성 검사 (룩업 테이블 기반) =====
-- 유형에 정의된 키만, 값은 null 또는 지정 형식. 금액·회차·비율은 0 이상. 위반 시 23514(check_violation)
create function public.check_contract_details() returns trigger
language plpgsql set search_path = '' as $$
declare
  k text;
  v jsonb;
  spec record;
begin
  if new.contract_details is null or jsonb_typeof(new.contract_details) <> 'object' then
    raise exception 'contract_details must be an object' using errcode = '23514';
  end if;
  for k, v in select * from jsonb_each(new.contract_details) loop
    select f.value_type, f.options into spec from public.contract_detail_fields f
      where f.contract_type = new.contract_type and f.key = k;
    if not found then
      raise exception 'detail key % is not defined for %', k, new.contract_type using errcode = '23514';
    end if;
    continue when jsonb_typeof(v) = 'null';
    if (spec.value_type = 'text' and (jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 500))
      or (spec.value_type = 'integer' and (jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric)))
      or (spec.value_type = 'number' and (jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric > 100))
      or (spec.value_type = 'boolean' and jsonb_typeof(v) <> 'boolean')
      or (spec.value_type = 'enum' and (jsonb_typeof(v) <> 'string' or not ((v #>> '{}') = any (spec.options))))
    then
      raise exception 'invalid value for detail key %', k using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
create trigger contracts_details_check before insert or update of contract_type, contract_details on public.contracts
  for each row execute function public.check_contract_details();

-- ===== 계약 저장 RPC v3 (결제 방향 포함) =====
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
      penalty_terms, deposit_amount, memo, source, analysis_job_id, ai_checks
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
      coalesce(p_ai_checks, '[]'::jsonb)
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
      ai_checks = coalesce(p_ai_checks, ai_checks)
    where id = v_id;
    if not found then
      raise exception 'contract not found' using errcode = 'P0002';
    end if;
  end if;

  if p_payments is not null then
    delete from public.contract_payments where contract_id = v_id;
    insert into public.contract_payments (
      contract_id, kind, direction, label, amount, frequency, day_of_month, month_of_year, starts_on, ends_on, installment_count, is_variable, sort_order
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
revoke all on function public.check_contract_details() from anon, public;
