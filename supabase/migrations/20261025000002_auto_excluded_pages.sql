-- 자동 제외 페이지 — 글자를 거의 읽지 못한(unreadable) 페이지를 서버가 분석에서 뺀 경우 (사용자가 직접 뺀 페이지와 구분)
-- - analysis_excluded_pages = 분석에 쓰지 않은 모든 페이지 (사용자 제외 + 자동 제외)
-- - analysis_auto_excluded_pages = 그중 자동으로 뺀 페이지 (analysis_excluded_pages의 부분집합)
-- 서버(service_role)만 바꾼다. 기존 행은 바꾸지 않는다 (기본값: 자동 제외 없음)
alter table public.contract_documents
  add column if not exists analysis_auto_excluded_pages integer[] not null default '{}';

alter table public.contract_documents
  add constraint contract_documents_auto_excluded_subset
  check (analysis_auto_excluded_pages <@ analysis_excluded_pages);

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
      new.analysis_auto_excluded_pages := '{}';
      new.protection_view_pages := null;
    else
      new.protection_status := old.protection_status;
      new.protection_detail := old.protection_detail;
      new.protection_images_unchecked := old.protection_images_unchecked;
      new.protected_at := old.protected_at;
      new.protection_pages := old.protection_pages;
      new.analysis_excluded_pages := old.analysis_excluded_pages;
      new.analysis_auto_excluded_pages := old.analysis_auto_excluded_pages;
      new.protection_view_pages := old.protection_view_pages;
    end if;
  end if;
  return new;
end;
$$;
