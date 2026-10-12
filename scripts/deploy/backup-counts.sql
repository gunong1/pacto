-- 읽기 전용 (SELECT 한 문장 — 데이터를 바꾸지 않는다). 백업 직후 운영 DB에서 실행해 백업 파일과 대조할 기준값을 만든다.
--   npx supabase db query --linked -o csv -f scripts/deploy/backup-counts.sql > <저장소 밖 백업 폴더>\counts.csv
-- 출력: 테이블마다 행 수, id 목록 지문, 행 내용 지문(md5). 데이터 값 자체는 출력하지 않는다.
--   id_md5      = md5(id::text를 C 정렬로 이어 붙인 문자열)      → verify-backup.mjs가 덤프 파일에서 같은 공식으로 계산
--   content_md5 = md5(각 행 전체 텍스트의 md5를 C 정렬로 이어 붙인 문자열) → restore-test.mjs가 복원한 로컬 DB에서 같은 공식으로 계산
-- 행 텍스트가 접속 설정에 따라 달라지지 않도록 이 쿼리 안에서만 시간대·날짜 표기를 고정한다 (set_config(..., true) = 이 트랜잭션 한정).
select n.nspname as schema, c.relname as table_name,
  (xpath('/row/n/text()', x))[1]::text::bigint as row_count,
  (xpath('/row/h/text()', x))[1]::text as id_md5,
  (xpath('/row/r/text()', x))[1]::text as content_md5
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral (
  select set_config('TimeZone', 'UTC', true) || set_config('DateStyle', 'ISO, MDY', true)
    || set_config('IntervalStyle', 'postgres', true) || set_config('extra_float_digits', '1', true)
    || set_config('bytea_output', 'hex', true) as fixed
) s
cross join lateral query_to_xml(format(
  '/* %s */ select count(*) as n, '
  || case when exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'id' and not a.attisdropped)
       then 'md5(string_agg(t.id::text, '','' order by t.id::text collate "C")) as h, '
       else '' end
  || 'md5(string_agg(md5(t::text), '','' order by md5(t::text) collate "C")) as r from %I.%I t',
  s.fixed, n.nspname, c.relname), false, true, '') as x
where n.nspname in ('public', 'auth', 'storage') and c.relkind in ('r', 'p')
order by 1, 2;
