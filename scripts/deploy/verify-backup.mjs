// 백업 파일 검증기 (읽기 전용 — 파일만 읽고 아무 데도 보내지 않는다).
//   node scripts/deploy/verify-backup.mjs <data.sql> --counts <counts.csv> [--schema <schema.sql>]
// 문자열 개수·파일 크기로 판단하지 않는다. data-only 덤프의 INSERT 문을 따옴표를 인식하며 끝까지 파싱해
// 테이블별 행 수와 id 지문(md5)을 직접 계산하고, 백업 직후 운영 DB에서 뽑은 counts.csv(backup-counts.sql)와 대조한다.
// 출력에는 테이블 이름·행 수·판정만 나온다. 데이터 값은 출력하지 않는다.
// 종료 코드: 0 = 통과, 1 = 실패(진행 중단), 2 = 사용법 오류.
import fs from 'node:fs';
import crypto from 'node:crypto';

// 하나라도 어긋나면 실패: 계약·금액·변경 이력·보증금·반환·문서·사용자 인증
export const KEY_TABLES = [
  'public.contracts', 'public.contract_payments', 'public.contract_payment_changes',
  'public.contract_funds', 'public.fund_refunds', 'public.contract_dates', 'public.contract_documents',
  'public.document_derivatives', 'public.document_sensitive_regions', 'public.profiles',
  'auth.users', 'auth.identities',
];
// 이 CLI(2.119.0)의 data-only 덤프가 원래 넣지 않는 테이블 (각 서비스가 스스로 관리하는 이력)
export const KNOWN_EXCLUDED = ['auth.schema_migrations', 'storage.migrations'];
// 앱을 쓰는 동안 계속 바뀌는 테이블: 운영 집계와 몇 초 차이로 어긋날 수 있어 경고만 한다
const LIVE = /^auth\.(audit_log_entries|sessions|refresh_tokens|mfa_amr_claims|flow_state|one_time_tokens)$|^public\.(notification_|scheduled_notifications|push_tokens|analysis_jobs)/;

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

// INSERT INTO "s"."t" ("c1", ...) VALUES (...), (...); 를 끝까지 파싱한다.
export function parseDump(sql) {
  const problems = [];
  if (!/SET session_replication_role = replica;/.test(sql.slice(0, 2000))) problems.push('머리말에 session_replication_role = replica 없음');
  if (!/SET standard_conforming_strings = on;/.test(sql)) problems.push('standard_conforming_strings = on 없음 (따옴표 해석 기준이 다름)');
  if (!/-- PostgreSQL database dump/.test(sql)) problems.push('pg_dump 머리말 없음');
  if (!/RESET ALL;\s*$/.test(sql)) problems.push('파일 끝(RESET ALL;)이 없음 — 덤프가 중간에 끊겼을 수 있음');
  if (/^COPY /m.test(sql)) problems.push('COPY 형식이 들어 있음 — 이 검증기는 INSERT 형식만 다룸');

  const tables = new Map();
  const head = /INSERT INTO "([^"]+)"\."([^"]+)" \(([^)]*)\) VALUES\s*/g;
  let m;
  let pos = 0;
  while ((m = head.exec(sql))) {
    if (m.index < pos) continue;
    const name = `${m[1]}.${m[2]}`;
    const cols = m[3].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const idIdx = cols.indexOf('id');
    const t = tables.get(name) ?? { rows: 0, ids: [], hasId: idIdx >= 0, cols: cols.length };
    tables.set(name, t);
    let i = head.lastIndex;
    let depth = 0;
    let field = 0;
    let fieldStart = -1;
    let done = false;
    while (i < sql.length) {
      const ch = sql[i];
      if (ch === "'") {
        if (sql[i - 1] === 'E' && fieldStart === i - 1) { problems.push(`${name}: E'' 문자열은 지원하지 않음`); break; }
        i++;
        while (i < sql.length) {
          if (sql[i] === "'") { if (sql[i + 1] === "'") { i += 2; continue; } break; }
          i++;
        }
        if (i >= sql.length) { problems.push(`${name}: 닫히지 않은 문자열`); break; }
        i++;
        continue;
      }
      if (ch === '(') {
        depth++;
        if (depth === 1) { field = 0; fieldStart = i + 1; }
      } else if (ch === ')') {
        if (depth === 1) {
          if (field + 1 !== t.cols) problems.push(`${name}: 칸 수 ${field + 1} ≠ ${t.cols}`);
          if (field === idIdx) t.ids.push(sql.slice(fieldStart, i).trim());
          t.rows++;
        }
        depth--;
        if (depth < 0) { problems.push(`${name}: 괄호 짝이 맞지 않음`); break; }
      } else if (ch === ',' && depth === 1) {
        if (field === idIdx) t.ids.push(sql.slice(fieldStart, i).trim());
        field++;
        fieldStart = i + 1;
      } else if (ch === ';' && depth === 0) { done = true; i++; break; }
      i++;
    }
    if (!done) { problems.push(`${name}: INSERT 문이 ;로 끝나지 않음`); break; }
    pos = i;
    head.lastIndex = i;
  }
  const out = new Map();
  for (const [name, t] of tables) {
    let idMd5 = null;
    if (t.hasId && t.ids.length) {
      const ids = t.ids.map((v) => {
        if (v === 'NULL') return 'NULL';
        return v.startsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v;
      });
      ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); // C 정렬과 같은 코드 단위 정렬
      idMd5 = md5(ids.join(','));
    }
    out.set(name, { rows: t.rows, idMd5 });
  }
  return { tables: out, problems };
}

// PowerShell 5의 > 리디렉션은 UTF-16, Out-File -Encoding utf8 은 BOM을 붙인다 — 둘 다 읽는다
export function readText(file) {
  const buf = fs.readFileSync(file);
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
  return text.replace(/^\uFEFF/, '');
}

export function readCounts(csv) {
  const map = new Map();
  const lines = csv.split(/\r?\n/).filter((l) => /^(public|auth|storage),/.test(l));
  for (const l of lines) {
    const [s, t, n, h, r] = l.split(',');
    const v = (x) => (x === undefined || x === 'NULL' || x === '' ? null : x);
    map.set(`${s}.${t}`, { rows: Number(n), idMd5: v(h), contentMd5: v(r) });
  }
  return map;
}

export function compare(dump, counts) {
  const rows = [];
  for (const [name, want] of counts) {
    const got = dump.tables.get(name) ?? { rows: 0, idMd5: null };
    const same = got.rows === want.rows && got.idMd5 === want.idMd5;
    let verdict;
    if (same) verdict = 'OK';
    else if (KNOWN_EXCLUDED.includes(name) && got.rows === 0) verdict = 'EXCLUDED';
    else if (KEY_TABLES.includes(name)) verdict = 'FAIL';
    else if (LIVE.test(name)) verdict = 'WARN';
    else verdict = 'FAIL';
    const idNote = want.idMd5 == null && got.idMd5 == null ? '없음' : got.idMd5 === want.idMd5 ? '같음' : '다름';
    if (verdict !== 'OK' || want.rows > 0) rows.push({ name, want: want.rows, got: got.rows, idNote, verdict });
  }
  for (const name of dump.tables.keys()) if (!counts.has(name)) rows.push({ name, want: null, got: dump.tables.get(name).rows, idNote: '-', verdict: 'FAIL' });
  return rows;
}

function main(argv) {
  const file = argv[0];
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const countsFile = get('--counts');
  const schemaFile = get('--schema');
  if (!file || !countsFile) { console.error('사용법: verify-backup.mjs <data.sql> --counts <counts.csv> [--schema <schema.sql>]'); return 2; }
  const dump = parseDump(readText(file));
  const counts = readCounts(readText(countsFile));
  let fail = dump.problems.length > 0;
  for (const p of dump.problems) console.log(`FAIL  형식: ${p}`);
  if (counts.size === 0) { console.log('FAIL  counts.csv에 테이블이 없음'); fail = true; }
  const rows = compare(dump, counts);
  for (const r of rows) {
    console.log(`${r.verdict.padEnd(8)} ${r.name.padEnd(42)} 운영 ${String(r.want ?? '-').padStart(7)}  백업 ${String(r.got).padStart(7)}  id지문 ${r.idNote}`);
    if (r.verdict === 'FAIL') fail = true;
  }
  for (const k of KEY_TABLES) if (!counts.has(k)) { console.log(`FAIL  핵심 테이블 ${k}가 counts.csv에 없음`); fail = true; }
  if (schemaFile) {
    const schema = readText(schemaFile);
    const created = new Set([...schema.matchAll(/CREATE TABLE IF NOT EXISTS "public"\."([^"]+)"|CREATE TABLE "public"\."([^"]+)"/g)].map((x) => `public.${x[1] ?? x[2]}`));
    const missing = [...counts.keys()].filter((k) => k.startsWith('public.') && !created.has(k));
    if (missing.length) { console.log(`FAIL  스키마 백업에 없는 public 테이블: ${missing.join(', ')}`); fail = true; }
    else console.log(`OK       스키마 백업: public 테이블 ${created.size}개 정의 포함`);
  }
  console.log(fail ? '\n결과: FAIL — 이 백업으로는 진행하지 마세요.' : '\n결과: PASS — 핵심 테이블의 행 수와 id 지문이 운영과 같습니다.');
  return fail ? 1 : 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) process.exit(main(process.argv.slice(2)));
