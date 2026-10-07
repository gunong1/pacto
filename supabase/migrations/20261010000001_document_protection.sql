-- PACTO: 계약서 민감정보 보호 (V1)
-- 원본(original)은 절대 수정하지 않는다. 서버가 원본에서 민감정보를 찾아
--   ① 위치·종류·신뢰도·가림 상태·이미 가린 표시값만 metadata로 저장하고 (원문 값·해시는 저장하지 않음)
--   ② 민감한 글자를 실제로 제거한 보호 표시본(protected_view)을 별도 파일로 만든다.
-- 공유용 보호본(redacted_share)·AI 전송 전 제거는 다음 단계 — 역할만 미리 구분해 둔다.

-- ===== 문서 보호 상태 =====
-- pending           아직 처리 전 (기존 문서 포함 — 사용자가 "민감정보 보호하기"를 누를 때만 처리)
-- protected         민감정보를 찾아 보호 표시본을 만들었고, 보호본에서 원문이 추출되지 않음을 검증함
-- no_sensitive_data 지원되는 문서에서 민감정보를 찾지 못함 ("없다"는 뜻이 아님)
-- unsupported_scan  사진·스캔본(글자가 이미지) — V1 자동 가리기 미지원 (향후 OCR)
-- failed            처리하지 못함 (암호화·해석 불가 글꼴·입력 양식·검증 실패 등) — 보호됐다고 표시하지 않는다
alter table public.contract_documents
  add column protection_status text not null default 'pending'
    check (protection_status in ('pending', 'protected', 'no_sensitive_data', 'unsupported_scan', 'failed')),
  add column protection_detail text check (protection_detail is null or protection_detail ~ '^[a-z_]{1,40}$'),
  -- 텍스트 페이지에 이미지가 있으면 이미지 속 내용은 확인하지 못했다는 안내에 쓴다
  add column protection_images_unchecked boolean not null default false,
  add column protected_at timestamptz;

-- 보호 상태는 서버(service_role)만 바꾼다. 사용자 요청(authenticated)으로는 바꿀 수 없음 — 조용히 기존 값을 유지
create function public.guard_document_protection() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.protection_status := 'pending';
      new.protection_detail := null;
      new.protection_images_unchecked := false;
      new.protected_at := null;
    else
      new.protection_status := old.protection_status;
      new.protection_detail := old.protection_detail;
      new.protection_images_unchecked := old.protection_images_unchecked;
      new.protected_at := old.protected_at;
    end if;
  end if;
  return new;
end;
$$;
create trigger contract_documents_guard_protection before insert or update on public.contract_documents
  for each row execute function public.guard_document_protection();

-- ===== 민감정보 영역 (원문 값은 저장하지 않는다) =====
create table public.document_sensitive_regions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid not null references public.contract_documents (id) on delete cascade,
  page_number smallint not null check (page_number >= 1),
  sensitive_type text not null check (sensitive_type in (
    'resident_registration_number', 'foreigner_registration_number', 'passport_number', 'driver_license_number',
    'credit_card', 'bank_account', 'phone', 'email', 'address', 'signature', 'stamp', 'name', 'other'
  )),
  -- 1 강한 보호(자동 가림) / 2 기본 가림 권장 / 3 계약 이해에 필요(기본 표시, 향후 "이름도 가리기")
  mask_level smallint not null check (mask_level between 1 and 3),
  -- 페이지 크기 대비 0~1 좌표, 왼쪽 위 기준 [{x,y,w,h}] (한 값이 여러 조각일 수 있음)
  bbox_json jsonb not null check (jsonb_typeof(bbox_json) = 'array'),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  source text not null default 'pattern' check (source in ('pattern', 'ai', 'ocr', 'user')),
  -- masked: 가려서 표시 / unmasked: 사용자가 가리기 해제 / candidate: 확신이 낮은 후보(기본 표시, 사용자가 가릴 수 있음)
  state text not null check (state in ('masked', 'unmasked', 'candidate')),
  user_confirmed boolean not null default false,
  -- 이미 가린 표시값만 (예: 901225-1******) — 원문 값·해시는 저장하지 않는다
  masked_preview text not null check (char_length(masked_preview) <= 80),
  -- 주변 필드명 (예: 주민등록번호) — 판단 근거 표시용
  context_label text check (context_label is null or char_length(context_label) <= 30),
  -- 같은 문서를 다시 처리해도 같은 영역을 가리키는 순번 (사용자 선택 유지용)
  region_key text not null check (char_length(region_key) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, region_key)
);
create index document_sensitive_regions_doc_idx on public.document_sensitive_regions (document_id, page_number);
create index document_sensitive_regions_user_idx on public.document_sensitive_regions (user_id);
create trigger document_sensitive_regions_updated_at before update on public.document_sensitive_regions
  for each row execute function public.set_updated_at();

alter table public.document_sensitive_regions enable row level security;
create policy "regions: read own" on public.document_sensitive_regions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "regions: update own" on public.document_sensitive_regions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- 사용자는 가림 상태·확인 여부만 바꿀 수 있다 (생성·삭제·위치 변경은 서버만)
revoke insert, update, delete on public.document_sensitive_regions from authenticated, anon;
grant select on public.document_sensitive_regions to authenticated;
grant update (state, user_confirmed) on public.document_sensitive_regions to authenticated;

-- ===== 파생 파일 (원본과 별도 저장) =====
-- protected_view: PACTO가 기본으로 보여주는 보호 표시본 / redacted_share: 제3자 공유용 (다음 단계)
create table public.document_derivatives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid not null references public.contract_documents (id) on delete cascade,
  kind text not null check (kind in ('protected_view', 'redacted_share')),
  storage_path text not null unique,
  size_bytes integer check (size_bytes > 0),
  created_at timestamptz not null default now(),
  unique (document_id, kind),
  check (split_part(storage_path, '/', 1) = user_id::text)
);
create index document_derivatives_user_idx on public.document_derivatives (user_id);
alter table public.document_derivatives enable row level security;
create policy "derivatives: read own" on public.document_derivatives for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.document_derivatives from authenticated, anon;
grant select on public.document_derivatives to authenticated;

-- 서버(Edge Function, service_role)만 영역·파생본을 만들고 지운다
grant select, insert, update, delete on public.document_sensitive_regions to service_role;
grant select, insert, update, delete on public.document_derivatives to service_role;
