-- 읽기 전용: 20261102000001_document_path_owner 적용 전 점검. 개수만 출력 (경로·파일 이름·사용자 id는 출력하지 않음)
-- bad_* 가 모두 0이어야 마이그레이션이 적용된다. 0이 아니면 적용하지 말고 결과를 보고한다.
select
  (select count(*) from public.contract_documents) as documents,
  (select count(*) from public.contract_documents
     where not (split_part(storage_path, '/', 1) = user_id::text and storage_path ~ '^[^/]+/[^/]+$' and strpos(storage_path, '..') = 0)) as bad_documents,
  (select count(*) from public.document_derivatives) as derivatives,
  (select count(*) from public.document_derivatives
     where not (split_part(storage_path, '/', 1) = user_id::text and storage_path ~ '^[^/]+/[^/]+$' and strpos(storage_path, '..') = 0)) as bad_derivatives;
