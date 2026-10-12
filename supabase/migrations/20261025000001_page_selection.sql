-- 분석에서 뺄 페이지 (사용자가 직접 고름) · 보호본에 담긴 원본 페이지 번호
-- - analysis_excluded_pages: 사용자가 제외한 원본 페이지 번호 (1부터). 비어 있으면 모든 페이지를 분석에 쓴다
--   AI가 임의로 정하지 않는다 — protect-document가 사용자 요청을 검증해서만 저장한다 (앱이 직접 바꿀 수 없음)
-- - protection_view_pages: 보호본(protected_view)에 담긴 원본 페이지 번호 (보호본 순서). null = 원본의 모든 페이지
--   분석 시 이 목록이 현재 선택과 같아야 보호본을 쓴다 (선택이 바뀐 뒤 예전 보호본을 쓰지 않음)
-- 원본 파일·기존 행은 바꾸지 않는다 (기본값: 제외 없음)
alter table public.contract_documents
  add column if not exists analysis_excluded_pages integer[] not null default '{}',
  add column if not exists protection_view_pages integer[];

alter table public.contract_documents
  add constraint contract_documents_excluded_pages_shape
  check (cardinality(analysis_excluded_pages) <= 60 and 1 <= all (analysis_excluded_pages)),
  add constraint contract_documents_view_pages_shape
  check (protection_view_pages is null or (cardinality(protection_view_pages) between 1 and 60 and 1 <= all (protection_view_pages)));

-- 페이지 선택·보호본 페이지도 서버(service_role)만 바꾼다
create or replace function public.guard_document_protection() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.protection_status := 'pending';
      new.protection_detail := null;
      new.protection_images_unchecked := false;
      new.protected_at := null;
      new.protection_pages := null;
      new.analysis_excluded_pages := '{}';
      new.protection_view_pages := null;
    else
      new.protection_status := old.protection_status;
      new.protection_detail := old.protection_detail;
      new.protection_images_unchecked := old.protection_images_unchecked;
      new.protected_at := old.protected_at;
      new.protection_pages := old.protection_pages;
      new.analysis_excluded_pages := old.analysis_excluded_pages;
      new.protection_view_pages := old.protection_view_pages;
    end if;
  end if;
  return new;
end;
$$;
