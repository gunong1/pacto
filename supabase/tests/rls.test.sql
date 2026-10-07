-- RLS 교차 접근 테스트: 다른 계정의 계약/결제/일정/원본/프로필에 절대 접근할 수 없어야 한다.
-- 실행: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

-- 테스트 사용자 A, B
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-1111-1111-111111111111', 'a@pacto.test', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'b@pacto.test', 'authenticated', 'authenticated');

select is((select count(*) from public.profiles where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')), 2::bigint, '가입 시 프로필 자동 생성');

create function pg_temp.login(uid text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- ===== A: 계약 + 결제 + 일정 + 원본 =====
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select lives_ok($$
  insert into public.contract_documents (id, storage_path, mime_type, size_bytes)
  values ('aaaaaaaa-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-00000000000d.pdf', 'application/pdf', 1000)
$$, 'A: 원본 문서 등록');
create temp table a_contract as
  select public.save_contract(
    '{"title":"헬스장","category":"membership","contract_type":"recurring","start_date":"2026-01-01","end_date":"2026-12-31","auto_renewal":true,"renewal_period_months":12,"termination_notice_days":30,"source":"upload"}'::jsonb,
    '[{"kind":"recurring_fee","label":"월 회비","amount":55000,"frequency":"monthly","day_of_month":5,"starts_on":"2026-01-01"},{"kind":"setup_fee","label":"가입비","amount":30000,"frequency":"one_time","starts_on":"2026-01-01"}]'::jsonb,
    '[{"kind":"other","label":"락커 배정","date":"2026-01-02"}]'::jsonb,
    null,
    array['aaaaaaaa-0000-0000-0000-00000000000d']::uuid[]
  ) as id;
grant select on a_contract to authenticated;
select isnt((select id from a_contract), null, 'A: save_contract로 계약 생성');
select is((select count(*) from public.contract_payments where contract_id = (select id from a_contract)), 2::bigint, 'A: 결제 여러 건 저장');
select is((select count(*) from public.contract_dates where contract_id = (select id from a_contract)), 1::bigint, 'A: 주요 날짜 저장');
select is((select string_agg(direction, ',' order by sort_order) from public.contract_payments where contract_id = (select id from a_contract)), 'expense,expense', 'A: 결제 방향 기본값 (의미별)');
select lives_ok($$ select public.save_contract('{"title":"근로계약","category":"employment","contract_type":"employment","contract_details":{"employment_kind":"permanent","probation_months":3}}'::jsonb, '[{"kind":"salary","label":"월 급여","amount":3000000,"frequency":"monthly","day_of_month":25,"starts_on":"2026-11-01"}]'::jsonb) $$, 'A: 근로계약(새 유형·분야) 저장');
select is((select direction from public.contract_payments where kind = 'salary' limit 1), 'income', 'A: 급여는 수입');
select throws_ok($$ select public.save_contract('{"title":"x","contract_type":"franchise"}'::jsonb) $$, '23503', null, 'A: 룩업에 없는 유형은 거부');
select is((select count(*) from public.contract_type_defs), 10::bigint, '레지스트리: 유형 10개를 누구나 읽기');
select throws_ok($$ insert into public.contract_type_defs (code, label) values ('hack', 'x') $$, '42501', null, '레지스트리는 사용자가 수정 불가');
select is((select contract_id from public.contract_documents where id = 'aaaaaaaa-0000-0000-0000-00000000000d'), (select id from a_contract), 'A: 원본이 계약에 연결');
select lives_ok($$ insert into public.contract_events (contract_id, title, event_date) select id, '해지 신청서 제출', '2026-11-20' from a_contract $$, 'A: 일정 추가');

-- 수정: 결제 정보 갱신, 비우면 삭제
select lives_ok($$ select public.save_contract('{"title":"헬스장(수정)","category":"membership","contract_type":"recurring","contract_details":{"commitment_months":12}}'::jsonb, '[{"kind":"recurring_fee","label":"월 회비","amount":60000,"frequency":"monthly","day_of_month":5,"starts_on":"2026-01-01"}]'::jsonb, null, (select id from a_contract)) $$, 'A: 계약 수정');
select is((select amount from public.contract_payments where contract_id = (select id from a_contract)), 60000::bigint, 'A: 결제 목록 교체');
select is((select count(*) from public.contract_dates where contract_id = (select id from a_contract)), 1::bigint, 'A: 날짜 목록 null이면 유지');
select throws_ok($$ select public.save_contract('{"title":"x","contract_type":"loan","contract_details":{"vehicle_price":1}}'::jsonb) $$, '23514', null, 'A: 유형에 없는 상세 키는 거부');
select throws_ok($$ select public.save_contract('{"title":"x","contract_type":"loan","contract_details":{"interest_rate":"4.5%"}}'::jsonb) $$, '23514', null, 'A: 상세 값 형식 오류는 거부');
select throws_ok($$ select public.save_contract('{"title":"x","contract_type":"lease","contract_details":{"lease_kind":"rent"}}'::jsonb) $$, '23514', null, 'A: 상세 선택값 범위 밖은 거부');
select lives_ok($$ select public.save_contract('{"title":"대출","contract_type":"loan","contract_details":{"principal":100000000,"interest_rate":4.5,"repayment_method":"equal_payment","prepayment_fee_terms":null}}'::jsonb) $$, 'A: 올바른 대출 상세 저장');

-- ===== B: A의 데이터 접근 시도 =====
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select is((select count(*) from public.contracts), 0::bigint, 'B: A의 계약이 보이지 않음');
select is((select count(*) from public.contract_payments), 0::bigint, 'B: A의 결제가 보이지 않음');
select is((select count(*) from public.contract_events), 0::bigint, 'B: A의 일정이 보이지 않음');
select is((select count(*) from public.contract_dates), 0::bigint, 'B: A의 주요 날짜가 보이지 않음');
select throws_ok($$ insert into public.contract_dates (contract_id, label, date) select id, 'x', '2026-01-01' from a_contract $$, '42501', null, 'B: A의 계약에 날짜 추가 불가');
select is((select count(*) from public.contract_documents), 0::bigint, 'B: A의 원본 문서가 보이지 않음');
select is((select count(*) from public.profiles), 1::bigint, 'B: 본인 프로필만 보임');

select results_eq($$ with u as (update public.contracts set title = 'hacked' where id = (select id from a_contract) returning 1) select count(*) from u $$, $$ values (0::bigint) $$, 'B: A의 계약 수정 불가');
select results_eq($$ with d as (delete from public.contracts where id = (select id from a_contract) returning 1) select count(*) from d $$, $$ values (0::bigint) $$, 'B: A의 계약 삭제 불가');
select throws_ok($$ insert into public.contract_payments (contract_id, amount, frequency, starts_on) select id, 1, 'monthly', '2026-01-01' from a_contract $$, '42501', null, 'B: A의 계약에 결제 추가 불가');
select throws_ok($$ insert into public.contract_events (contract_id, title, event_date) select id, 'x', '2026-01-01' from a_contract $$, '42501', null, 'B: A의 계약에 일정 추가 불가');
select throws_ok($$ insert into public.contracts (user_id, title) values ('11111111-1111-1111-1111-111111111111', '위장') $$, '42501', null, 'B: A 명의로 계약 생성 불가');
select throws_ok($$ insert into public.contract_documents (storage_path, mime_type, size_bytes) values ('11111111-1111-1111-1111-111111111111/x.pdf', 'application/pdf', 1) $$, '23514', null, 'B: A의 폴더 경로로 문서 등록 불가');
select throws_ok($$ select public.save_contract('{"title":"x"}'::jsonb, null, null, (select id from a_contract)) $$, 'P0002', null, 'B: save_contract로 A의 계약 수정 불가');
select throws_ok($$ insert into public.analysis_jobs (status, result) values ('succeeded', '{}') $$, '42501', null, 'B: 실제 AI 결과를 직접 기록할 수 없음');

-- B가 자기 계약을 만들 때 A의 원본을 끌어올 수 없음
select lives_ok($$ select public.save_contract('{"title":"B 계약"}'::jsonb, null, null, null, array['aaaaaaaa-0000-0000-0000-00000000000d']::uuid[]) $$, 'B: 본인 계약 생성');

-- ===== anon: 아무것도 못 봄 =====
select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select count(*) from public.contracts $$, '42501', null, 'anon: 계약 테이블 접근 불가');

-- ===== A 재확인: 데이터 그대로, B의 계약에 결제 옮기기 불가 =====
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select is((select contract_id from public.contract_documents where id = 'aaaaaaaa-0000-0000-0000-00000000000d'), (select id from a_contract), 'A: 원본 연결 유지 (B가 가져가지 못함)');
select is((select title from public.contracts where id = (select id from a_contract)), '헬스장(수정)', 'A: 계약 내용 변조되지 않음');

-- ===== 민감정보 보호: 상태·영역·파생본은 서버만 만들고, 사용자는 본인 것만 보고 가림 상태만 바꾼다 =====
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select lives_ok($$ update public.contract_documents set protection_status = 'protected' where id = 'aaaaaaaa-0000-0000-0000-00000000000d' $$, 'A: 보호 상태 변경 요청은 오류 없이');
select is((select protection_status from public.contract_documents where id = 'aaaaaaaa-0000-0000-0000-00000000000d'), 'pending', 'A: 사용자는 보호 상태를 "보호됨"으로 바꿀 수 없음');
select throws_ok($$ insert into public.document_sensitive_regions (user_id, document_id, page_number, sensitive_type, mask_level, bbox_json, confidence, state, masked_preview, region_key)
  values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-00000000000d', 1, 'phone', 2, '[]', 'high', 'masked', '010-****-5678', 'k') $$, '42501', null, 'A: 영역 직접 생성 불가 (서버만)');
-- 서버(service_role)가 처리 결과 저장
select set_config('role', 'service_role', true);
update public.contract_documents set protection_status = 'protected', protected_at = now() where id = 'aaaaaaaa-0000-0000-0000-00000000000d';
insert into public.document_sensitive_regions (id, user_id, document_id, page_number, sensitive_type, mask_level, bbox_json, confidence, state, masked_preview, region_key)
  values ('aaaaaaaa-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-00000000000d', 1, 'resident_registration_number', 1, '[{"x":0.1,"y":0.1,"w":0.2,"h":0.02}]', 'high', 'masked', '901225-1******', 'p1:rrn:0');
insert into public.document_derivatives (user_id, document_id, kind, storage_path, size_bytes)
  values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-00000000000d', 'protected_view', '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-00000000000d.protected_view.pdf', 1000);
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select is((select protection_status from public.contract_documents where id = 'aaaaaaaa-0000-0000-0000-00000000000d'), 'protected', 'A: 서버가 저장한 보호 상태');
select lives_ok($$ update public.document_sensitive_regions set state = 'unmasked', user_confirmed = true where id = 'aaaaaaaa-0000-0000-0000-0000000000a1' $$, 'A: 본인 영역의 가림 상태 변경');
select throws_ok($$ update public.document_sensitive_regions set masked_preview = 'x' where id = 'aaaaaaaa-0000-0000-0000-0000000000a1' $$, '42501', null, 'A: 가림 상태 외 컬럼은 변경 불가');
select throws_ok($$ delete from public.document_derivatives $$, '42501', null, 'A: 파생본 기록 직접 삭제 불가 (계약 삭제 시 함께 삭제)');
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select is((select count(*) from public.document_sensitive_regions), 0::bigint, 'B: A의 민감정보 영역 안 보임');
select is((select count(*) from public.document_derivatives), 0::bigint, 'B: A의 파생본 안 보임');
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select is((select count(*) from public.document_sensitive_regions where state = 'unmasked'), 1::bigint, 'A: 가림 해제 반영');
select is((select count(*) from public.document_derivatives), 1::bigint, 'A: 본인 파생본 조회');

select * from finish();
rollback;
