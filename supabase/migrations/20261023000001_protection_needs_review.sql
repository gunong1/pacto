-- 민감정보 보호 상태에 needs_review(보호 확인 필요) 추가
-- 개인정보 칸(휴대전화·주민등록번호·계좌·카드 필드명)은 있는데 값의 위치·모양을 확정하지 못한 문서.
-- "탐지한 값을 모두 가렸다"만으로 보호 완료로 보지 않는다 — 자동 AI 분석은 protected · no_sensitive_data에서만 (analyze-contract 게이트)
alter table public.contract_documents drop constraint contract_documents_protection_status_check;
alter table public.contract_documents
  add constraint contract_documents_protection_status_check
  check (protection_status in ('pending', 'protected', 'no_sensitive_data', 'unreadable', 'needs_review', 'unsupported_scan', 'failed'));
