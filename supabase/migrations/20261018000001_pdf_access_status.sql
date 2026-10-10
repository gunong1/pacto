-- 암호가 걸린 PDF: 원본을 여는 데 비밀번호가 필요한지 (문서의 지속 상태)
--   accessible             : 비밀번호 없이 열림 (암호 없음, 소유자 비밀번호만)
--   password_required      : 원본을 열려면 사용자 비밀번호가 필요 (원본은 암호 상태 그대로 보관)
--   unsupported_encryption : 지원하지 않는 보안 방식 (인증서 방식 등)
-- 비밀번호 자체와 "비밀번호가 틀렸음"(한 번의 입력 결과)은 저장하지 않는다 — 비밀번호 관련 값은 어디에도 남기지 않는다.
-- 사진 등 PDF가 아닌 문서와 아직 확인 전인 문서는 null.
alter table public.contract_documents
  add column access_status text check (access_status in ('accessible', 'password_required', 'unsupported_encryption'));

comment on column public.contract_documents.access_status is
  'PDF 원본 접근: accessible | password_required | unsupported_encryption (비밀번호·입력 실패는 저장하지 않음)';
