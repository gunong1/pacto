-- RLS 교차 접근 테스트: 다른 계정의 계약/결제/일정/원본/프로필에 절대 접근할 수 없어야 한다.
-- 실행: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

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
    '{"title":"헬스장","category":"membership","start_date":"2026-01-01","end_date":"2026-12-31","auto_renewal":true,"renewal_period_months":12,"termination_notice_days":30,"source":"upload"}'::jsonb,
    '{"label":"월 회비","amount":55000,"frequency":"monthly","day_of_month":5,"starts_on":"2026-01-01"}'::jsonb,
    null,
    array['aaaaaaaa-0000-0000-0000-00000000000d']::uuid[]
  ) as id;
grant select on a_contract to authenticated;
select isnt((select id from a_contract), null, 'A: save_contract로 계약 생성');
select is((select count(*) from public.contract_payments where contract_id = (select id from a_contract)), 1::bigint, 'A: 대표 결제 저장');
select is((select contract_id from public.contract_documents where id = 'aaaaaaaa-0000-0000-0000-00000000000d'), (select id from a_contract), 'A: 원본이 계약에 연결');
select lives_ok($$ insert into public.contract_events (contract_id, title, event_date) select id, '해지 신청서 제출', '2026-11-20' from a_contract $$, 'A: 일정 추가');

-- 수정: 결제 정보 갱신, 비우면 삭제
select lives_ok($$ select public.save_contract('{"title":"헬스장(수정)","category":"membership"}'::jsonb, '{"label":"월 회비","amount":60000,"frequency":"monthly","day_of_month":5,"starts_on":"2026-01-01"}'::jsonb, (select id from a_contract)) $$, 'A: 계약 수정');
select is((select amount from public.contract_payments where contract_id = (select id from a_contract)), 60000::bigint, 'A: 대표 결제 갱신');

-- ===== B: A의 데이터 접근 시도 =====
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select is((select count(*) from public.contracts), 0::bigint, 'B: A의 계약이 보이지 않음');
select is((select count(*) from public.contract_payments), 0::bigint, 'B: A의 결제가 보이지 않음');
select is((select count(*) from public.contract_events), 0::bigint, 'B: A의 일정이 보이지 않음');
select is((select count(*) from public.contract_documents), 0::bigint, 'B: A의 원본 문서가 보이지 않음');
select is((select count(*) from public.profiles), 1::bigint, 'B: 본인 프로필만 보임');

select results_eq($$ with u as (update public.contracts set title = 'hacked' where id = (select id from a_contract) returning 1) select count(*) from u $$, $$ values (0::bigint) $$, 'B: A의 계약 수정 불가');
select results_eq($$ with d as (delete from public.contracts where id = (select id from a_contract) returning 1) select count(*) from d $$, $$ values (0::bigint) $$, 'B: A의 계약 삭제 불가');
select throws_ok($$ insert into public.contract_payments (contract_id, amount, frequency, starts_on) select id, 1, 'monthly', '2026-01-01' from a_contract $$, '42501', null, 'B: A의 계약에 결제 추가 불가');
select throws_ok($$ insert into public.contract_events (contract_id, title, event_date) select id, 'x', '2026-01-01' from a_contract $$, '42501', null, 'B: A의 계약에 일정 추가 불가');
select throws_ok($$ insert into public.contracts (user_id, title) values ('11111111-1111-1111-1111-111111111111', '위장') $$, '42501', null, 'B: A 명의로 계약 생성 불가');
select throws_ok($$ insert into public.contract_documents (storage_path, mime_type, size_bytes) values ('11111111-1111-1111-1111-111111111111/x.pdf', 'application/pdf', 1) $$, '23514', null, 'B: A의 폴더 경로로 문서 등록 불가');
select throws_ok($$ select public.save_contract('{"title":"x"}'::jsonb, null, (select id from a_contract)) $$, 'P0002', null, 'B: save_contract로 A의 계약 수정 불가');
select throws_ok($$ insert into public.analysis_jobs (status, result) values ('succeeded', '{}') $$, '42501', null, 'B: 실제 AI 결과를 직접 기록할 수 없음');

-- B가 자기 계약을 만들 때 A의 원본을 끌어올 수 없음
select lives_ok($$ select public.save_contract('{"title":"B 계약"}'::jsonb, null, null, array['aaaaaaaa-0000-0000-0000-00000000000d']::uuid[]) $$, 'B: 본인 계약 생성');

-- ===== anon: 아무것도 못 봄 =====
select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select count(*) from public.contracts $$, '42501', null, 'anon: 계약 테이블 접근 불가');

-- ===== A 재확인: 데이터 그대로, B의 계약에 결제 옮기기 불가 =====
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select is((select contract_id from public.contract_documents where id = 'aaaaaaaa-0000-0000-0000-00000000000d'), (select id from a_contract), 'A: 원본 연결 유지 (B가 가져가지 못함)');
select is((select title from public.contracts where id = (select id from a_contract)), '헬스장(수정)', 'A: 계약 내용 변조되지 않음');

select * from finish();
rollback;
