-- 스캔 PDF 보호 — 페이지별 종류·상태 (원문·OCR 텍스트·민감값 없음)
-- 예: [{"page":1,"kind":"text","status":"protected","detail":null},{"page":2,"kind":"scan","status":"no_sensitive_data","detail":null}]
-- kind: text · scan · unsupported / status: protected · no_sensitive_data · unreadable · unsupported_scan · failed · skipped(다른 페이지 문제로 처리하지 않음)
alter table public.contract_documents
  add column if not exists protection_pages jsonb;

alter table public.contract_documents
  add constraint contract_documents_protection_pages_shape
  check (protection_pages is null or (jsonb_typeof(protection_pages) = 'array' and jsonb_array_length(protection_pages) <= 60));

-- 페이지별 상태도 서버(service_role)만 바꾼다 — 기존 보호 상태 보호 함수에 protection_pages 추가
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
    else
      new.protection_status := old.protection_status;
      new.protection_detail := old.protection_detail;
      new.protection_images_unchecked := old.protection_images_unchecked;
      new.protected_at := old.protected_at;
      new.protection_pages := old.protection_pages;
    end if;
  end if;
  return new;
end;
$$;
