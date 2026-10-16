-- PACTO: 문서 파일 경로는 소유자 폴더만 ({user_id}/{파일 이름}) — 보안 점검 Phase 1
-- 문제: contract_documents.storage_path는 사용자가 직접 기록하는 값인데 형식 검사가 없어, 남의 폴더를 가리키는 경로
--       (예: "{내 id}/../{남의 id}/..." 또는 남의 보호본 경로)를 기록할 수 있었다. 서버 함수(protect-document·analyze-contract·
--       cleanup-orphans)는 관리자 권한으로 이 경로의 파일을 읽거나 지우므로, 남의 파일을 대신 읽거나 지우게 할 수 있다.
-- 해결: 경로 형식을 DB 제약으로 강제한다 (추가만 — 기존 데이터·함수·정책은 바꾸지 않음).
--   - 첫 폴더 = user_id, 하위 폴더 없음, ".." 없음
--   - document_derivatives(서버만 기록)에도 같은 제약 (방어선)
-- 기존 행이 형식에 맞지 않으면 제약 추가가 실패하고 이 마이그레이션 전체가 적용되지 않는다 (데이터는 바꾸지 않음).
--   적용 전 점검: scripts/deploy/inspect-document-paths.sql (읽기 전용)
alter table public.contract_documents
  add constraint contract_documents_storage_path_owner
  check (split_part(storage_path, '/', 1) = user_id::text and storage_path ~ '^[^/]+/[^/]+$' and strpos(storage_path, '..') = 0);

alter table public.document_derivatives
  add constraint document_derivatives_storage_path_owner
  check (split_part(storage_path, '/', 1) = user_id::text and storage_path ~ '^[^/]+/[^/]+$' and strpos(storage_path, '..') = 0);
