-- PACTO V1 (P0) 핵심 스키마
-- 테이블: profiles, analysis_jobs, contracts, contract_documents, contract_payments, contract_events
-- 원칙: 모든 사용자 데이터에 user_id (auth.users cascade) → RLS 단순화 + 회원 탈퇴 시 일괄 삭제
--       금액은 원 단위 bigint, 계약 날짜는 date(시간대 없음, Asia/Seoul 기준)

-- ===== enums =====
create type public.contract_category as enum (
  'real_estate', 'vehicle', 'insurance', 'telecom', 'rental', 'finance',
  'employment', 'business', 'membership', 'subscription', 'other'
);
create type public.contract_lifecycle as enum ('active', 'ended', 'cancelled');
create type public.contract_source as enum ('upload', 'manual');
create type public.payment_frequency as enum ('one_time', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'yearly');
create type public.contract_event_type as enum ('payment', 'contract_start', 'contract_end', 'renewal', 'termination_notice', 'custom');
create type public.event_source as enum ('system', 'ai', 'user');
create type public.job_status as enum ('queued', 'processing', 'succeeded', 'failed', 'expired');

-- ===== updated_at =====
create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===== profiles =====
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 50),
  onboarding_completed_at timestamptz,
  terms_agreed_at timestamptz,
  privacy_agreed_at timestamptz,
  ai_processing_agreed_at timestamptz,
  push_preview_enabled boolean not null default false,
  timezone text not null default 'Asia/Seoul',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- 가입 시 프로필 자동 생성
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===== analysis_jobs (계약서 자동 정리 작업 / 초안) =====
create table public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status public.job_status not null default 'queued',
  provider text,
  model text,
  prompt_version text,
  result jsonb,          -- 초안 (확정값 아님)
  error_code text,       -- 원문/개인정보 미포함 코드만
  contract_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index analysis_jobs_user_idx on public.analysis_jobs (user_id, created_at desc);

-- ===== contracts =====
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  category public.contract_category not null default 'other',
  counterparty text check (char_length(counterparty) <= 100),
  lifecycle public.contract_lifecycle not null default 'active',
  lifecycle_changed_on date,
  contract_date date,
  start_date date,
  end_date date,
  total_amount bigint check (total_amount >= 0),
  auto_renewal boolean not null default false,
  renewal_period_months smallint check (renewal_period_months between 1 and 120),
  termination_notice_days smallint check (termination_notice_days between 0 and 365),
  early_termination_terms text check (char_length(early_termination_terms) <= 500),
  penalty_terms text check (char_length(penalty_terms) <= 500),
  deposit_amount bigint check (deposit_amount >= 0),
  currency char(3) not null default 'KRW',
  memo text check (char_length(memo) <= 2000),
  source public.contract_source not null default 'manual',
  analysis_job_id uuid references public.analysis_jobs (id) on delete set null,
  notifications_enabled boolean not null default true,
  -- P0 임시: 확인이 필요한 조항(AI 체크) 스냅샷 + 사용자 확인 상태. P1에서 contract_ai_reviews로 정규화.
  ai_checks jsonb not null default '[]'::jsonb check (jsonb_typeof(ai_checks) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index contracts_user_idx on public.contracts (user_id, created_at desc);
create index contracts_user_end_idx on public.contracts (user_id, end_date);
create trigger contracts_updated_at before update on public.contracts
  for each row execute function public.set_updated_at();

alter table public.analysis_jobs
  add constraint analysis_jobs_contract_fk foreign key (contract_id) references public.contracts (id) on delete set null;

-- ===== contract_documents (원본 계약서 — private Storage 경로만 저장, public URL 사용 안 함) =====
create table public.contract_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  contract_id uuid references public.contracts (id) on delete cascade,   -- 저장 전 null
  analysis_job_id uuid references public.analysis_jobs (id) on delete set null,
  storage_path text not null unique,       -- '{user_id}/{document_id}.{ext}'
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 20971520),
  page_count smallint check (page_count > 0),
  sort_order smallint not null default 0,
  original_filename text check (char_length(original_filename) <= 255),
  created_at timestamptz not null default now(),
  -- 경로는 반드시 본인 폴더
  check (split_part(storage_path, '/', 1) = user_id::text)
);
create index contract_documents_contract_idx on public.contract_documents (contract_id, sort_order);
create index contract_documents_user_idx on public.contract_documents (user_id);

-- ===== contract_payments (결제 규칙 — 조회 범위에서 전개) =====
create table public.contract_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  label text not null default '납부금' check (char_length(label) between 1 and 40),
  amount bigint not null check (amount >= 0),
  currency char(3) not null default 'KRW',
  frequency public.payment_frequency not null,
  day_of_month smallint check (day_of_month between 1 and 31),
  month_of_year smallint check (month_of_year between 1 and 12),
  starts_on date not null,
  ends_on date,
  is_variable boolean not null default false,
  sort_order smallint not null default 0,  -- 0 = 대표 결제 (폼에서 수정하는 항목)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contract_payments_contract_idx on public.contract_payments (contract_id, sort_order);
create index contract_payments_user_idx on public.contract_payments (user_id);
create trigger contract_payments_updated_at before update on public.contract_payments
  for each row execute function public.set_updated_at();

-- ===== contract_events (사용자·AI 제안 일정. 시작/종료/해지통보/갱신은 계약 정보에서 계산) =====
create table public.contract_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  event_type public.contract_event_type not null default 'custom',
  title text not null check (char_length(title) between 1 and 60),
  event_date date not null,
  amount bigint check (amount >= 0),
  is_recurring boolean not null default false,
  recurrence_rule text,
  source public.event_source not null default 'user',
  notification_enabled boolean not null default true,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contract_events_user_date_idx on public.contract_events (user_id, event_date);
create index contract_events_contract_idx on public.contract_events (contract_id);
create trigger contract_events_updated_at before update on public.contract_events
  for each row execute function public.set_updated_at();
