-- 계약 당사자 식별 · 현금흐름(방향과 돈의 성격 분리) · 돌려받을 돈 묶음(보증금·예치금)과 반환 기록
--
-- 원칙
--   - 기존 데이터를 일괄 변경하지 않는다: neutral 행·결제 id·일정·완료 기록·금액 변경 이력·counterparty 그대로
--   - direction(expense/income/neutral)에는 새 값을 넣지 않는다 (예전 앱 호환). neutral = 방향 확인 필요(예전 데이터 포함)
--   - 새 칸은 save_contract가 그 키를 받았을 때만 바꾼다 → 예전 앱이 다시 저장해도 지워지지 않는다
--   - 사용자 이름은 본인만 읽고 쓴다 (profiles RLS). 서버 AI에 보내지 않는다 — 대조는 기기에서 (추천만)
--
-- profiles.contract_names            계약서에 쓰는 내 이름·다른 표기 (최대 5개). 선택 입력
-- profiles.contract_names_skipped_at 첫 등록 안내에서 "건너뛰기" — 다시 묻지 않기 위해
-- contracts.user_party_relation      self(내 계약) · on_behalf(다른 사람 계약 관리) · unknown(잘 모르겠어요) · null(묻지 않음)
--                                    user_party_role(이미 있음)은 사용자가 확정한 역할만 (추천은 저장하지 않는다)
-- contract_payments.money_nature     ordinary · refundable_deposit(돌려받을/돌려줄 돈) · deposit_refund(그 돈의 반환) · null(예전 데이터)
-- contract_payments.direction_basis  방향을 정한 근거: user(사용자가 고름) · role(확정 역할로 계산) · contract(계약서·계약 구조로 명확) · null(예전)
--                                    역할을 바꾸면 role로 계산된 행만 다시 계산한다 (user는 건드리지 않음)
-- contract_payments.payer_role/payee_role  계약서가 실제 지급자·수령자를 밝힌 경우만 (계약상 역할과 지급자가 다를 수 있음)
-- contract_funds                     돌려받을/돌려줄 돈 묶음 — 한 계약에 여러 개 가능 (보증금 + 예치금)
--                                    total_amount null = 계약 요약의 보증금(contracts.deposit_amount)을 총액으로 (중복 저장하지 않음, 계약당 1개만)
--                                    return_due_on = 계약서에 적힌 반환 예정일만. 없으면 저장하지 않고 계약 종료일에 "반환 확인" (갱신하면 함께 이동)
-- fund_refunds                       실제 반환 기록 (금액·날짜) — 원래 지급 행을 바꾸거나 뒤집지 않는다. 일부 반환 여러 번 가능

-- ===== 내 계약자 정보 =====
create or replace function public.valid_contract_names(v text[]) returns boolean
language sql immutable set search_path = '' as $$
  select v is not null and cardinality(v) <= 5
    and not exists (select 1 from unnest(v) n where n is null or n <> btrim(n) or char_length(n) not between 1 and 50)
$$;
alter table public.profiles
  add column contract_names text[] not null default '{}' check (public.valid_contract_names(contract_names)),
  add column contract_names_skipped_at timestamptz;

-- ===== 계약: 나와 이 계약의 관계 =====
alter table public.contracts
  add column user_party_relation text check (user_party_relation is null or user_party_relation in ('self', 'on_behalf', 'unknown'));

-- ===== 돌려받을/돌려줄 돈 묶음 =====
create table public.contract_funds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  kind text not null default 'deposit' check (kind in ('deposit', 'escrow', 'other')),
  label text not null default '보증금' check (char_length(label) between 1 and 50),
  total_amount bigint check (total_amount is null or total_amount >= 0),
  return_due_on date,
  depositor_role text check (depositor_role is null or depositor_role ~ '^[a-z_]{2,30}$'),
  holder_role text check (holder_role is null or holder_role ~ '^[a-z_]{2,30}$'),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (total_amount is not null or kind = 'deposit')
);
-- 계약 요약의 보증금을 총액으로 쓰는 묶음은 계약당 하나
create unique index contract_funds_summary_deposit_idx on public.contract_funds (contract_id) where total_amount is null;
create index contract_funds_contract_idx on public.contract_funds (contract_id, sort_order);
create index contract_funds_user_idx on public.contract_funds (user_id);
create trigger contract_funds_updated_at before update on public.contract_funds
  for each row execute function public.set_updated_at();

create or replace function public.owns_fund(p_fund_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.contract_funds f where f.id = p_fund_id and f.user_id = (select auth.uid()))
$$;

revoke all on public.contract_funds from anon, public;
grant select, insert, update, delete on public.contract_funds to authenticated;
grant select, insert, update, delete on public.contract_funds to service_role;
alter table public.contract_funds enable row level security;
create policy "funds: read own" on public.contract_funds for select to authenticated
  using (user_id = (select auth.uid()));
create policy "funds: insert own" on public.contract_funds for insert to authenticated
  with check (user_id = (select auth.uid()) and public.owns_contract(contract_id));
create policy "funds: update own" on public.contract_funds for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.owns_contract(contract_id));
create policy "funds: delete own" on public.contract_funds for delete to authenticated
  using (user_id = (select auth.uid()));

-- ===== 결제: 돈의 성격 · 방향 근거 · 실제 지급자/수령자 · 묶음 =====
alter table public.contract_payments
  add column money_nature text check (money_nature is null or money_nature in ('ordinary', 'refundable_deposit', 'deposit_refund')),
  add column direction_basis text check (direction_basis is null or direction_basis in ('user', 'role', 'contract')),
  add column payer_role text check (payer_role is null or payer_role ~ '^[a-z_]{2,30}$'),
  add column payee_role text check (payee_role is null or payee_role ~ '^[a-z_]{2,30}$'),
  add column fund_id uuid references public.contract_funds (id) on delete set null;
create index contract_payments_fund_idx on public.contract_payments (fund_id) where fund_id is not null;

-- 결제와 묶음은 같은 계약이어야 한다
create or replace function public.guard_payment_fund() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.fund_id is not null and not exists (select 1 from public.contract_funds f where f.id = new.fund_id and f.contract_id = new.contract_id) then
    raise exception 'fund belongs to another contract' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger contract_payments_fund_guard before insert or update of fund_id, contract_id on public.contract_payments
  for each row execute function public.guard_payment_fund();

-- ===== 실제 반환 기록 =====
create table public.fund_refunds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  fund_id uuid not null references public.contract_funds (id) on delete cascade,
  amount bigint not null check (amount > 0),
  refunded_on date not null,
  note text check (note is null or char_length(note) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fund_refunds_fund_idx on public.fund_refunds (fund_id, refunded_on);
create index fund_refunds_user_idx on public.fund_refunds (user_id);
create trigger fund_refunds_updated_at before update on public.fund_refunds
  for each row execute function public.set_updated_at();
-- 어느 묶음의 기록인지는 바꿀 수 없다
create or replace function public.guard_fund_refund() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.fund_id <> old.fund_id or new.user_id <> old.user_id then
    raise exception 'refund identity is immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger fund_refunds_guard before update on public.fund_refunds
  for each row execute function public.guard_fund_refund();

revoke all on public.fund_refunds from anon, public, authenticated;
grant select, delete on public.fund_refunds to authenticated;
grant insert (fund_id, amount, refunded_on, note) on public.fund_refunds to authenticated;
grant update (amount, refunded_on, note) on public.fund_refunds to authenticated;
grant select, insert, update, delete on public.fund_refunds to service_role;
alter table public.fund_refunds enable row level security;
create policy "fund refunds: read own" on public.fund_refunds for select to authenticated
  using (user_id = (select auth.uid()));
create policy "fund refunds: insert own" on public.fund_refunds for insert to authenticated
  with check (user_id = (select auth.uid()) and public.owns_fund(fund_id));
create policy "fund refunds: update own" on public.fund_refunds for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "fund refunds: delete own" on public.fund_refunds for delete to authenticated
  using (user_id = (select auth.uid()));

-- ===== save_contract: 새 칸은 보낸 경우에만 · 묶음(p_funds) (그 밖은 20261024000001과 같음) =====
drop function public.save_contract(jsonb, jsonb, jsonb, uuid, uuid[], jsonb, jsonb);
create function public.save_contract(
  p_contract jsonb,
  p_payments jsonb default null,
  p_dates jsonb default null,
  p_contract_id uuid default null,
  p_document_ids uuid[] default '{}',
  p_ai_checks jsonb default null,
  p_amount_changes jsonb default null,
  p_funds jsonb default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := p_contract_id;
  v_keep uuid[] := '{}';
  v_pid uuid;
  v_p jsonb;
  v_ord bigint;
  v_c jsonb;
  v_f jsonb;
  v_fid uuid;
  v_fund_keep uuid[] := '{}';
  v_fund_map jsonb := '{}'::jsonb;
  v_fund uuid;
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
  if p_funds is not null and jsonb_typeof(p_funds) <> 'array' then
    raise exception 'p_funds must be an array' using errcode = '22023';
  end if;
  if p_dates is not null and jsonb_typeof(p_dates) <> 'array' then
    raise exception 'p_dates must be an array' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.contracts (
      title, category, contract_type, contract_details, counterparty, contract_date, start_date, end_date, total_amount,
      auto_renewal, renewal_period_months, termination_notice_days, notice_kind, early_termination_terms,
      penalty_terms, deposit_amount, memo, source, analysis_job_id, ai_checks, value_sources, reference_amounts,
      contract_kind, contract_subtype, classification, parties, user_party_role, user_party_relation
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
      coalesce(p_contract -> 'classification', '{}'::jsonb),
      coalesce(p_contract -> 'parties', '[]'::jsonb),
      nullif(p_contract ->> 'user_party_role', ''),
      nullif(p_contract ->> 'user_party_relation', '')
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
      classification = case when p_contract ? 'classification' then coalesce(p_contract -> 'classification', '{}'::jsonb) else classification end,
      parties = coalesce(p_contract -> 'parties', parties),
      user_party_role = case when p_contract ? 'user_party_role' then nullif(p_contract ->> 'user_party_role', '') else user_party_role end,
      user_party_relation = case when p_contract ? 'user_party_relation' then nullif(p_contract ->> 'user_party_relation', '') else user_party_relation end
    where id = v_id;
    if not found then
      raise exception 'contract not found' using errcode = 'P0002';
    end if;
  end if;

  -- 돌려받을/돌려줄 돈 묶음 (보증금·예치금): 보낸 경우에만 정리 (예전 앱은 p_funds를 보내지 않음 → 그대로)
  --   id 있음 → UPDATE / 없음 → INSERT / 목록에서 빠진 묶음 → DELETE (반환 기록도 함께)
  --   key: 같은 요청의 결제가 fund_key로 이 묶음을 가리킨다 (새 묶음은 임시 key, 저장된 묶음은 id 문자열)
  if p_funds is not null then
    for v_f, v_ord in select x.f, x.n from jsonb_array_elements(p_funds) with ordinality as x (f, n) loop
      v_fid := nullif(v_f ->> 'id', '')::uuid;
      if v_fid is not null then
        update public.contract_funds set
          kind = coalesce(v_f ->> 'kind', 'deposit'),
          label = coalesce(nullif(v_f ->> 'label', ''), '보증금'),
          total_amount = (v_f ->> 'total_amount')::bigint,
          return_due_on = (v_f ->> 'return_due_on')::date,
          depositor_role = nullif(v_f ->> 'depositor_role', ''),
          holder_role = nullif(v_f ->> 'holder_role', ''),
          sort_order = (v_ord - 1)::smallint
        where id = v_fid and contract_id = v_id;
        if not found then
          raise exception 'fund not found' using errcode = 'P0002';
        end if;
      else
        insert into public.contract_funds (contract_id, kind, label, total_amount, return_due_on, depositor_role, holder_role, sort_order)
        values (
          v_id,
          coalesce(v_f ->> 'kind', 'deposit'),
          coalesce(nullif(v_f ->> 'label', ''), '보증금'),
          (v_f ->> 'total_amount')::bigint,
          (v_f ->> 'return_due_on')::date,
          nullif(v_f ->> 'depositor_role', ''),
          nullif(v_f ->> 'holder_role', ''),
          (v_ord - 1)::smallint
        ) returning id into v_fid;
      end if;
      v_fund_keep := v_fund_keep || v_fid;
      v_fund_map := v_fund_map || jsonb_build_object(v_fid::text, v_fid);
      if nullif(v_f ->> 'key', '') is not null then
        v_fund_map := v_fund_map || jsonb_build_object(v_f ->> 'key', v_fid);
      end if;
    end loop;
    delete from public.contract_funds where contract_id = v_id and id <> all (v_fund_keep);
  end if;

  -- 결제 규칙: id를 유지한다 (변경 이력·근거 문서가 결제 id에 연결됨)
  --   id 있음 → 이 계약의 결제면 UPDATE (다른 계약·없는 id면 오류) / id 없음 → INSERT / 목록에서 빠진 결제 → DELETE (변경 이력도 함께)
  if p_payments is not null then
    for v_p, v_ord in select x.p, x.n from jsonb_array_elements(p_payments) with ordinality as x (p, n) loop
      v_pid := nullif(v_p ->> 'id', '')::uuid;
      -- 묶음 연결: fund_key를 보낸 경우에만 (null이면 연결 해제). 이 계약의 묶음만
      v_fund := null;
      if nullif(v_p ->> 'fund_key', '') is not null then
        v_fund := coalesce(
          (v_fund_map ->> (v_p ->> 'fund_key'))::uuid,
          (select f.id from public.contract_funds f where f.contract_id = v_id and f.id::text = v_p ->> 'fund_key')
        );
        if v_fund is null then
          raise exception 'fund not found' using errcode = 'P0002';
        end if;
      end if;
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
          sort_order = (v_ord - 1)::smallint,
          -- 새 칸: 보낸 경우에만 바꾼다 (예전 앱은 보내지 않음 → 저장된 값 유지)
          money_nature = case when v_p ? 'money_nature' then nullif(v_p ->> 'money_nature', '') else money_nature end,
          direction_basis = case when v_p ? 'direction_basis' then nullif(v_p ->> 'direction_basis', '') else direction_basis end,
          payer_role = case when v_p ? 'payer_role' then nullif(v_p ->> 'payer_role', '') else payer_role end,
          payee_role = case when v_p ? 'payee_role' then nullif(v_p ->> 'payee_role', '') else payee_role end,
          fund_id = case when v_p ? 'fund_key' then v_fund else fund_id end
        where id = v_pid and contract_id = v_id;
        if not found then
          raise exception 'payment not found' using errcode = 'P0002';
        end if;
      else
        insert into public.contract_payments (
          contract_id, kind, direction, label, amount, frequency, day_of_month, month_of_year, starts_on, ends_on, installment_count, is_variable,
          components, business_day_rule, obligation, condition_note, sort_order,
          money_nature, direction_basis, payer_role, payee_role, fund_id
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
          (v_ord - 1)::smallint,
          nullif(v_p ->> 'money_nature', ''),
          nullif(v_p ->> 'direction_basis', ''),
          nullif(v_p ->> 'payer_role', ''),
          nullif(v_p ->> 'payee_role', ''),
          v_fund
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
revoke all on function public.save_contract(jsonb, jsonb, jsonb, uuid, uuid[], jsonb, jsonb, jsonb) from anon, public;
grant execute on function public.save_contract(jsonb, jsonb, jsonb, uuid, uuid[], jsonb, jsonb, jsonb) to authenticated;
