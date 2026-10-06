-- PACTO: 계약 유형(contract_type)별 구조
-- - category      = 사용자가 이해하는 분야 (부동산·통신·보험·자동차 …) — 아이콘·필터
-- - contract_type = 돈과 날짜가 움직이는 방식 — 일정·지출 로직 선택
-- - contract_details (JSONB) = 유형별 추가 속성. 유형별 허용 키·값 형식을 DB에서도 검사한다
--   (앱 src/domain/contractTypes.ts의 DETAIL_FIELDS와 같은 목록). 자주 검색·통계하는 키는 나중에 정식 컬럼으로 승격.
-- - contract_payments.kind / installment_count = 결제 의미와 총 회차 (한 계약에 결제 여러 건)
-- - contract_dates = 계약 유형별 주요 날짜 (설치일·개통일·입주일·잔금일·갱신일 …)
--   시작일·종료일은 contracts.start_date / end_date, 체결일은 contracts.contract_date(선택, 기록용)

create type public.contract_type as enum ('recurring', 'lease', 'auto_installment', 'loan', 'insurance', 'one_time', 'other');

create type public.payment_kind as enum (
  'recurring_fee',    -- 정기 이용료 (렌탈료·요금·회비·구독료·리스료)
  'setup_fee',        -- 설치비·가입비 등 일회성 비용
  'rent',             -- 월세
  'maintenance_fee',  -- 관리비
  'deposit',          -- 보증금 성격 (전세금·보증금의 계약금/잔금) — 돌려받는 돈이라 지출 합계에서 제외
  'installment',      -- 할부금
  'advance_payment',  -- 선수금
  'loan_repayment',   -- 원리금 상환
  'interest',         -- 이자
  'premium',          -- 보험료
  'down_payment',     -- 계약금
  'interim_payment',  -- 중도금
  'balance_payment',  -- 잔금
  'other'
);

create type public.contract_date_kind as enum (
  'installation',  -- 설치일
  'activation',    -- 개통일
  'move_in',       -- 입주일
  'balance_due',   -- 잔금일 (금액을 모를 때. 금액이 있으면 결제로 관리)
  'renewal',       -- 갱신일 (갱신형 보험 등)
  'other'
);

-- ===== 유형별 상세 속성 검사 =====
-- 허용 키: 유형마다 정해진 키만. 값: null 또는 지정 형식. 금액·회차·비율은 0 이상.
create function public.contract_detail_spec(t public.contract_type)
returns table (key text, value_type text, options text[])
language sql immutable set search_path = '' as $$
  select s.key, s.value_type, s.options from (values
    ('recurring'::public.contract_type, 'commitment_months', 'integer', null::text[]),
    ('recurring', 'ownership_transfer_terms', 'text', null),
    ('lease', 'lease_kind', 'enum', array['jeonse', 'monthly', 'semi_jeonse', 'commercial', 'other']),
    ('lease', 'renewal_terms', 'text', null),
    ('auto_installment', 'vehicle_name', 'text', null),
    ('auto_installment', 'vehicle_price', 'integer', null),
    ('auto_installment', 'advance_payment', 'integer', null),
    ('auto_installment', 'principal', 'integer', null),
    ('auto_installment', 'interest_rate', 'number', null),
    ('auto_installment', 'total_installments', 'integer', null),
    ('loan', 'principal', 'integer', null),
    ('loan', 'interest_rate', 'number', null),
    ('loan', 'repayment_method', 'enum', array['equal_payment', 'equal_principal', 'bullet', 'other']),
    ('loan', 'prepayment_fee_terms', 'text', null),
    ('insurance', 'renewable', 'boolean', null),
    ('insurance', 'renewal_cycle_years', 'integer', null),
    ('insurance', 'coverage_summary', 'text', null),
    ('one_time', 'subject', 'text', null)
  ) as s (type, key, value_type, options)
  where s.type = t;
$$;

create function public.valid_contract_details(t public.contract_type, d jsonb)
returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
  spec record;
begin
  if d is null or jsonb_typeof(d) <> 'object' then
    return false;
  end if;
  for k, v in select * from jsonb_each(d) loop
    select * into spec from public.contract_detail_spec(t) s where s.key = k;
    if not found then
      return false; -- 이 유형에 없는 키
    end if;
    continue when jsonb_typeof(v) = 'null';
    case spec.value_type
      when 'text' then
        if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 500 then return false; end if;
      when 'integer' then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) then return false; end if;
      when 'number' then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric > 100 then return false; end if;
      when 'boolean' then
        if jsonb_typeof(v) <> 'boolean' then return false; end if;
      when 'enum' then
        if jsonb_typeof(v) <> 'string' or not ((v #>> '{}') = any (spec.options)) then return false; end if;
      else
        return false;
    end case;
  end loop;
  return true;
end;
$$;

-- ===== contracts =====
alter table public.contracts
  add column contract_type public.contract_type not null default 'other',
  add column contract_details jsonb not null default '{}'::jsonb;

-- 기존 계약: 분야에서 유형을 정한다 (정기 결제가 있으면 월 납입형)
update public.contracts c set contract_type = case
  when c.category = 'real_estate' then 'lease'
  when c.category = 'insurance' then 'insurance'
  when c.category = 'finance' then 'loan'
  when c.category in ('rental', 'telecom', 'membership', 'subscription') then 'recurring'
  when exists (select 1 from public.contract_payments p where p.contract_id = c.id and p.frequency <> 'one_time') then 'recurring'
  else 'other'
end::public.contract_type;

-- 기존 보증금(deposit_amount)은 공통 컬럼으로 유지. 유형이 정해진 뒤 상세 검사 제약을 건다.
alter table public.contracts
  add constraint contracts_details_valid check (public.valid_contract_details(contract_type, contract_details));
create index contracts_user_type_idx on public.contracts (user_id, contract_type);

-- ===== contract_payments =====
alter table public.contract_payments
  add column kind public.payment_kind not null default 'other',
  add column installment_count smallint check (installment_count between 1 and 600);

update public.contract_payments p set kind = case
  when p.frequency = 'one_time' then 'other'
  when c.contract_type = 'recurring' then 'recurring_fee'
  when c.contract_type = 'lease' then 'rent'
  when c.contract_type = 'insurance' then 'premium'
  when c.contract_type = 'loan' then 'loan_repayment'
  when c.contract_type = 'auto_installment' then 'installment'
  else 'other'
end::public.payment_kind
from public.contracts c where c.id = p.contract_id;

-- ===== contract_dates =====
create table public.contract_dates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  kind public.contract_date_kind not null default 'other',
  label text not null check (char_length(label) between 1 and 40),
  date date not null,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);
create index contract_dates_user_date_idx on public.contract_dates (user_id, date);
create index contract_dates_contract_idx on public.contract_dates (contract_id);

grant select, insert, update, delete on public.contract_dates to authenticated;
grant all on public.contract_dates to service_role;
alter table public.contract_dates enable row level security;
create policy "dates: read own" on public.contract_dates for select to authenticated
  using (user_id = (select auth.uid()));
create policy "dates: insert own" on public.contract_dates for insert to authenticated
  with check (user_id = (select auth.uid()) and public.owns_contract(contract_id));
create policy "dates: update own" on public.contract_dates for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.owns_contract(contract_id));
create policy "dates: delete own" on public.contract_dates for delete to authenticated
  using (user_id = (select auth.uid()));

-- ===== 계약 저장 RPC v2 =====
-- 계약 + 결제 목록 + 주요 날짜 + 원본 연결을 한 트랜잭션으로.
-- p_payments / p_dates: 배열이면 해당 계약의 목록을 통째로 교체, null이면 (수정 시) 그대로 둔다.
drop function public.save_contract(jsonb, jsonb, uuid, uuid[], jsonb);

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
      coalesce((p_contract ->> 'category')::public.contract_category, 'other'),
      coalesce((p_contract ->> 'contract_type')::public.contract_type, 'other'),
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
      category = coalesce((p_contract ->> 'category')::public.contract_category, 'other'),
      contract_type = coalesce((p_contract ->> 'contract_type')::public.contract_type, contract_type),
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
      contract_id, kind, label, amount, frequency, day_of_month, month_of_year, starts_on, ends_on, installment_count, is_variable, sort_order
    )
    select
      v_id,
      coalesce((p ->> 'kind')::public.payment_kind, 'other'),
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
    select
      v_id,
      coalesce((d ->> 'kind')::public.contract_date_kind, 'other'),
      d ->> 'label',
      (d ->> 'date')::date,
      (ord - 1)::smallint
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
revoke all on function public.contract_detail_spec(public.contract_type) from anon, public;
revoke all on function public.valid_contract_details(public.contract_type, jsonb) from anon, public;
grant execute on function public.contract_detail_spec(public.contract_type) to authenticated;
grant execute on function public.valid_contract_details(public.contract_type, jsonb) to authenticated;
