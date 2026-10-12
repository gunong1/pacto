// check-schema.sql 생성기. 기대값은 손으로 쓰지 않고 로컬 DB의 두 상태에서 뽑는다.
//   1) node scripts/deploy/gen-check-schema.mjs probe > probe.sql
//   2) npx supabase db reset --local --version 20261026000001 → psql -At -F' ' < probe.sql > before.txt
//   3) npx supabase db reset --local                            → psql -At -F' ' < probe.sql > after.txt
//   4) node scripts/deploy/gen-check-schema.mjs build before.txt after.txt > scripts/deploy/check-schema.sql
// 항목 SQL은 객체가 없으면 오류 없이 NULL을 돌려준다. 값은 정의(함수 본문·제약·정책)의 md5 지문이라 데이터를 읽지 않는다.
import fs from 'node:fs';

const fn = (name, nargs) =>
  `(select md5(string_agg(pronargs::text || ':' || md5(prosrc), ',' order by pronargs)) from pg_proc where pronamespace = 'public'::regnamespace and proname = '${name}'${nargs == null ? '' : ` and pronargs = ${nargs}`})`;
const fnArity = (name) =>
  `(select string_agg(pronargs::text, ',' order by pronargs) from pg_proc where pronamespace = 'public'::regnamespace and proname = '${name}')`;
const con = (table, name) =>
  `(select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid = to_regclass('public.${table}') and c.conname = '${name}')`;
const trg = (name) =>
  `(select t.tgrelid::regclass::text || ':' || t.tgfoid::regproc::text || ':' || t.tgtype::text || ':' || t.tgenabled::text from pg_trigger t where t.tgname = '${name}' and not t.tgisinternal)`;
const rls = (table) =>
  `(select relrowsecurity::text || ':' || relforcerowsecurity::text from pg_class where oid = to_regclass('public.${table}'))`;
const pol = (table) =>
  `(select md5(string_agg(policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), ';' order by policyname)) from pg_policies where schemaname = 'public' and tablename = '${table}')`;
const col = (table, column) =>
  `(select md5(data_type || ':' || is_nullable || ':' || coalesce(column_default, '')) from information_schema.columns where table_schema = 'public' and table_name = '${table}' and column_name = '${column}')`;
const colGrants = (table, role) =>
  `(select md5(string_agg(column_name || ':' || privilege_type, ',' order by column_name, privilege_type)) from information_schema.column_privileges where table_schema = 'public' and table_name = '${table}' and grantee = '${role}')`;
const tblGrants = (table, role) =>
  `(select md5(string_agg(privilege_type, ',' order by privilege_type)) from information_schema.role_table_grants where table_schema = 'public' and table_name = '${table}' and grantee = '${role}')`;

// [버전, 항목, SQL]. 이미 적용된 두 버전은 '적용됨' 값만 의미가 있고, 미적용 두 버전은 적용 전/후 값을 모두 쓴다.
export const ITEMS = [
  ['20261025000002', 'contract_documents.analysis_auto_excluded_pages 칸', col('contract_documents', 'analysis_auto_excluded_pages')],
  ['20261025000002', '제약 contract_documents_auto_excluded_subset', con('contract_documents', 'contract_documents_auto_excluded_subset')],
  ['20261025000002', '함수 guard_document_protection 본문', fn('guard_document_protection')],

  ['20261026000001', 'contract_funds RLS 켜짐', rls('contract_funds')],
  ['20261026000001', 'fund_refunds RLS 켜짐', rls('fund_refunds')],
  ['20261026000001', '정책 contract_funds', pol('contract_funds')],
  ['20261026000001', '정책 fund_refunds', pol('fund_refunds')],
  ['20261026000001', '권한 contract_funds (authenticated)', tblGrants('contract_funds', 'authenticated')],
  ['20261026000001', '칸별 권한 fund_refunds (authenticated)', colGrants('fund_refunds', 'authenticated')],
  ['20261026000001', 'contract_payments.money_nature 칸', col('contract_payments', 'money_nature')],
  ['20261026000001', 'contract_payments.direction_basis 칸', col('contract_payments', 'direction_basis')],
  ['20261026000001', 'contract_payments.payer_role 칸', col('contract_payments', 'payer_role')],
  ['20261026000001', 'contract_payments.payee_role 칸', col('contract_payments', 'payee_role')],
  ['20261026000001', 'contract_payments.fund_id 칸', col('contract_payments', 'fund_id')],
  ['20261026000001', '제약 contract_payments_money_nature_check', con('contract_payments', 'contract_payments_money_nature_check')],
  ['20261026000001', '제약 contract_payments_direction_basis_check', con('contract_payments', 'contract_payments_direction_basis_check')],
  ['20261026000001', '제약 contract_payments_fund_id_fkey', con('contract_payments', 'contract_payments_fund_id_fkey')],
  ['20261026000001', 'profiles.contract_names 칸', col('profiles', 'contract_names')],
  ['20261026000001', 'contracts.user_party_relation 칸', col('contracts', 'user_party_relation')],
  ['20261026000001', '함수 owns_fund 본문', fn('owns_fund')],
  ['20261026000001', '함수 guard_payment_fund 본문', fn('guard_payment_fund')],
  ['20261026000001', '함수 guard_fund_refund 본문', fn('guard_fund_refund')],
  ['20261026000001', '함수 valid_contract_names 본문', fn('valid_contract_names')],
  ['20261026000001', '트리거 contract_payments_fund_guard', trg('contract_payments_fund_guard')],
  ['20261026000001', '트리거 fund_refunds_guard', trg('fund_refunds_guard')],
  ['20261026000001', '트리거 contract_funds_updated_at', trg('contract_funds_updated_at')],
  ['20261026000001', '트리거 fund_refunds_updated_at', trg('fund_refunds_updated_at')],
  ['20261026000001', 'save_contract 인자 개수 (8개 하나만)', fnArity('save_contract')],

  ['20261026000002', '함수 save_contract(8인자) 본문', fn('save_contract', 8)],

  ['20261027000001', '함수 valid_notification_categories 본문', fn('valid_notification_categories')],
  ['20261027000001', '제약 scheduled_notifications_offset_days_check', con('scheduled_notifications', 'scheduled_notifications_offset_days_check')],
  ['20261027000001', '함수 keep_newer_notification_categories 본문', fn('keep_newer_notification_categories')],
  ['20261027000001', '트리거 notification_preferences_keep_newer', trg('notification_preferences_keep_newer')],
  ['20261027000001', '트리거 contract_notification_overrides_keep_newer', trg('contract_notification_overrides_keep_newer')],
  ['20261027000001', '트리거 contract_funds_enqueue_plan', trg('contract_funds_enqueue_plan')],
  ['20261027000001', '트리거 fund_refunds_enqueue_plan', trg('fund_refunds_enqueue_plan')],
];
// 운영에 아직 없는 버전: 적용 전 값도 기대값으로 쓴다.
const PENDING = new Set(['20261026000002', '20261027000001']);
const LAST = '20261027000001';

const q = (s) => (s == null ? 'null' : `'${s.replace(/'/g, "''")}'`);

function readValues(file) {
  const out = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^(\d+) ?(.*)$/);
    if (m) out.set(Number(m[1]), m[2] === '' ? null : m[2]);
  }
  if (out.size !== ITEMS.length) throw new Error(`${file}: ${out.size}줄 (기대 ${ITEMS.length})`);
  return out;
}

const [mode, beforeFile, afterFile] = process.argv.slice(2);
if (mode === 'probe') {
  console.log(`select i, x from (values\n${ITEMS.map(([, , s], i) => `  (${i}, ${s})`).join(',\n')}\n) t(i, x) order by i;`);
} else if (mode === 'build') {
  const before = readValues(beforeFile);
  const after = readValues(afterFile);
  for (const [i, [v]] of ITEMS.entries()) {
    if (!PENDING.has(v) && before.get(i) !== after.get(i)) throw new Error(`이미 적용된 ${v}의 항목 ${i} 값이 두 상태에서 다름`);
    if (PENDING.has(v) && before.get(i) === after.get(i)) throw new Error(`항목 ${i}이 적용 전/후를 구분하지 못함`);
  }
  const rows = ITEMS.map(([v, name, sql], i) =>
    `  ('${v}', ${i + 1}, ${q(name)},\n   ${sql},\n   ${q(after.get(i))}, ${PENDING.has(v) ? q(before.get(i)) : 'null'}, ${PENDING.has(v)})`,
  ).join(',\n');
  process.stdout.write(`-- 자동 생성: node scripts/deploy/gen-check-schema.mjs (직접 고치지 말 것)
-- 읽기 전용. 데이터를 바꾸지 않고 정의(함수 본문·제약·트리거·RLS·정책·칸·권한)의 지문만 읽는다.
-- 대시보드 SQL Editor 또는 psql에서 실행한다. 결과는 두 부분:
--   kind = 'item'    : 항목마다 actual 이 applied(적용 후 기대값)와 같은지, before(적용 전 기대값)와 같은지
--   kind = 'version' : 버전마다 이력 기록 여부 + 스키마 판정 + 해야 할 일
-- 스키마 판정
--   APPLIED     : 그 버전의 모든 항목이 적용 후 기대값과 정확히 같음
--   NOT_APPLIED : 모든 항목이 적용 전 기대값과 같음 (미적용 버전에만 있음)
--   MISMATCH    : 섞여 있거나 어느 쪽과도 다름 → 진행 중단, 원인 확인
-- 해야 할 일(action)
--   OK                 : 이력 기록 + APPLIED
--   PENDING            : 이력 없음 + NOT_APPLIED → 단계별 적용 대상
--   REPAIR_CANDIDATE   : 이력 없음 + APPLIED (SQL Editor 등으로 직접 실행된 흔적). 이때만 migration repair 검토
--   STOP               : 그 밖의 모든 경우 (이력만 있고 스키마가 다름, MISMATCH, 이미 적용돼야 할 버전이 NOT_APPLIED 등)
-- 주의: 지문은 로컬 PostgreSQL ${'17'}에서 만들었다. 운영의 메이저 버전이 다르면 정책·제약 정의의 표기 차이로 MISMATCH가
--       날 수 있다. 그때도 repair 하지 말고 진행을 멈춘 뒤 해당 항목의 실제 정의를 따로 확인한다.
with item(version, n, name, actual, applied, before, pending) as (values
${rows}
),
judged as (
  select *,
    actual is not distinct from applied as is_applied,
    pending and actual is not distinct from before as is_before
  from item
),
hist as (select version from supabase_migrations.schema_migrations),
ver as (
  select version,
    exists (select 1 from hist h where h.version = j.version) as history_recorded,
    case when bool_and(is_applied) then 'APPLIED'
         when bool_and(is_before) then 'NOT_APPLIED'
         else 'MISMATCH' end as schema_state,
    count(*) filter (where not is_applied and not is_before) as unexpected_items
  from judged j group by version
)
select 'item' as kind, version, n, name,
  case when is_applied then 'applied' when is_before then 'before' else 'UNEXPECTED' end as result,
  null::boolean as history_recorded, null::text as action
from judged
union all
select 'version', version, null, null, schema_state, history_recorded,
  case when history_recorded and schema_state = 'APPLIED' then 'OK'
       when not history_recorded and schema_state = 'NOT_APPLIED' then 'PENDING'
       when not history_recorded and schema_state = 'APPLIED' then 'REPAIR_CANDIDATE'
       else 'STOP' end
from ver
union all
select 'extra_history', version, null, '파일 목록에 없는 이력 (${LAST} 이후)', null, true, 'STOP'
from hist where version > '${LAST}'
order by kind desc, version, n;
`);
} else {
  console.error('사용법: probe | build before.txt after.txt');
  process.exit(2);
}
