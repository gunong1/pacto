-- 사진 계약서 민감정보 보호 (CLOVA OCR) — 상태에 unreadable 추가
-- unreadable: OCR이 문서를 충분히 읽지 못함 (글자 거의 없음·신뢰도 낮음·흐림) → "민감정보 없음"으로 오판하지 않는다
-- 사진 영역은 기존 document_sensitive_regions(source='ocr')·document_derivatives(kind='protected_view')를 그대로 쓴다
alter table public.contract_documents drop constraint contract_documents_protection_status_check;
alter table public.contract_documents
  add constraint contract_documents_protection_status_check
  check (protection_status in ('pending', 'protected', 'no_sensitive_data', 'unreadable', 'unsupported_scan', 'failed'));
