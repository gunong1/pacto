-- 실제 AI 연결(Step 9): 분석 작업 기록은 서버(Edge Function, service_role)만 생성·갱신한다.
-- V1 mock 단계에서 허용했던 사용자 직접 기록(provider='mock') 예외를 제거.
drop policy if exists "jobs: insert own" on public.analysis_jobs;
