// Docker 없이 백업 — supabase db dump(CLI 2.119.0)가 Docker 안에서 실행하는 pg_dump 명령을 그대로 재현한다.
//   node scripts/deploy/dump-native.mjs --out <백업 폴더> --host <호스트> --user <사용자> [--port 5432] [--pg-dump <pg_dump.exe 경로>]
// 만드는 파일: schema.sql (public 구조), history.sql (마이그레이션 이력), data.sql (데이터)
// - pg_dump 옵션·제외 스키마·후처리(sed)는 `npx supabase db dump --dry-run` 출력과 같다 (CLI와 같은 형식 → verify-backup.mjs로 검증)
// - 읽기 전용: pg_dump는 READ ONLY 트랜잭션으로 읽기만 한다
// - 비밀번호는 한 번 묻고(화면에 안 보임) 이 프로세스가 실행하는 pg_dump에만 넘긴다. 파일·로그에 남기지 않는다
// - pg_dump는 운영 DB 메이저 버전(17)보다 낮으면 안 된다 → 시작 전에 버전을 확인한다
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';

const argv = process.argv.slice(2);
const get = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const out = get('--out');
const host = get('--host');
const user = get('--user');
const port = get('--port', '5432');
const pgDump = get('--pg-dump', process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump');
if (!out || !host || !user) {
  console.error('사용법: dump-native.mjs --out <폴더> --host <호스트> --user <사용자> [--port 5432] [--pg-dump <경로>]');
  process.exit(2);
}

const INTERNAL_DATA = 'information_schema|pg_*|graphql|graphql_public|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault|etl|extensions|pgbouncer|realtime|supabase_migrations|_analytics|_realtime|_supavisor';
const INTERNAL_SCHEMA = 'information_schema|pg_*|_analytics|_realtime|_supavisor|auth|etl|extensions|pgbouncer|realtime|storage|supabase_functions|supabase_migrations|cron|dbdev|graphql|graphql_public|net|pgmq|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault';
const EXCLUDED_TABLES = ['auth.schema_migrations', 'storage.migrations', 'supabase_functions.migrations'];
const common = ['--quote-all-identifiers', '--role', 'postgres'];
const restrict = (l) => l.replace(/^\\(un)?restrict .*$/, (m) => `-- ${m}`);

// CLI의 schema 덤프 sed 목록을 줄 단위로 옮긴 것
const schemaRe = new RegExp(`^(GRANT|REVOKE) (.+) ON (.+) "(${INTERNAL_SCHEMA})"`);
function schemaLine(l) {
  l = restrict(l)
    .replace(/^CREATE SCHEMA "/, 'CREATE SCHEMA IF NOT EXISTS "')
    .replace(/^CREATE TABLE "/, 'CREATE TABLE IF NOT EXISTS "')
    .replace(/^CREATE SEQUENCE "/, 'CREATE SEQUENCE IF NOT EXISTS "')
    .replace(/^CREATE VIEW "/, 'CREATE OR REPLACE VIEW "')
    .replace(/^CREATE FUNCTION "/, 'CREATE OR REPLACE FUNCTION "')
    .replace(/^CREATE TRIGGER "/, 'CREATE OR REPLACE TRIGGER "');
  const comment = [/^CREATE PUBLICATION "supabase_realtime/, /^CREATE EVENT TRIGGER /, /^ {9}WHEN TAG IN /, /^ {3}EXECUTE FUNCTION /,
    /^ALTER EVENT TRIGGER /, /^ALTER PUBLICATION "supabase_realtime_/, /^ALTER FOREIGN DATA WRAPPER (.+) OWNER TO /,
    /^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"/, /^GRANT ALL ON FOREIGN DATA WRAPPER (.+) TO "postgres" WITH GRANT OPTION/,
    schemaRe, /^COMMENT ON EXTENSION (.+)/, /^CREATE POLICY "cron_job_/, /^ALTER TABLE "cron"/, /^SET transaction_timeout = 0;/];
  if (comment.some((re) => re.test(l))) l = `-- ${l}`;
  l = l.replace(/^(CREATE EXTENSION IF NOT EXISTS "(pg_tle|pgsodium|pgmq)").+/, '$1;');
  return l.startsWith('--') ? null : l;
}

const jobs = [
  { file: 'schema.sql', args: ['--schema-only', ...common, '--exclude-schema', INTERNAL_SCHEMA], line: schemaLine },
  { file: 'history.sql', args: ['--data-only', ...common, '--exclude-schema', '', ...EXCLUDED_TABLES.flatMap((t) => ['--exclude-table', t]), '--schema', 'supabase_migrations', '--column-inserts', '--rows-per-insert', '100000'], line: restrict, head: 'SET session_replication_role = replica;\n\n', tail: 'RESET ALL;\n' },
  { file: 'data.sql', args: ['--data-only', ...common, '--exclude-schema', INTERNAL_DATA, ...EXCLUDED_TABLES.flatMap((t) => ['--exclude-table', t]), '--schema', '*', '--column-inserts', '--rows-per-insert', '100000'], line: restrict, head: 'SET session_replication_role = replica;\n\n', tail: 'RESET ALL;\n' },
];

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(prompt)) process.stdout.write(s); };
    rl.question(prompt, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

function run(job, env) {
  return new Promise((resolve) => {
    const target = path.join(out, job.file);
    const ws = fs.createWriteStream(target);
    if (job.head) ws.write(job.head);
    const child = spawn(pgDump, ['--host', host, '--port', port, '--username', user, '--dbname', 'postgres', '--no-password', ...job.args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) { const o = job.line(l); if (o !== null) ws.write(o + '\n'); }
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { err += e.message; });
    child.on('close', (code) => {
      if (buf) { const o = job.line(buf); if (o !== null) ws.write(o + '\n'); }
      if (code === 0 && job.tail) ws.write(job.tail);
      ws.end(() => resolve({ code, err, size: fs.statSync(target).size }));
    });
  });
}

const v = spawnSync(pgDump, ['--version'], { encoding: 'utf8' });
const major = Number(v.stdout?.match(/(\d+)\.\d+/)?.[1]);
if (v.status !== 0 || !major) { console.error(`중단: pg_dump를 실행할 수 없습니다 (${pgDump}). PostgreSQL 17 Command Line Tools 설치 확인`); process.exit(1); }
if (major < 17) { console.error(`중단: pg_dump ${major} — 운영 DB(17)보다 낮습니다. 17 이상을 쓰세요`); process.exit(1); }
console.log(`pg_dump ${v.stdout.trim()}`);
fs.mkdirSync(out, { recursive: true });
const password = process.env.PGPASSWORD || (await askHidden('DB 비밀번호 (화면에 안 보임): '));
const env = { ...process.env, PGPASSWORD: password, PGSSLMODE: process.env.PGSSLMODE || 'require' };
let ok = true;
for (const job of jobs) {
  process.stdout.write(`${job.file} 만드는 중... `);
  const r = await run(job, env);
  if (r.code === 0 && r.size > 0) console.log(`완료 (${r.size} 바이트)`);
  else {
    ok = false;
    // 오류 메시지에서 비밀번호가 나올 일은 없지만, 혹시 몰라 지운다
    console.log(`실패 (종료 코드 ${r.code})\n  ${r.err.split(password).join('***').trim().split('\n').slice(0, 3).join('\n  ')}`);
    break;
  }
}
console.log(ok ? '\n세 파일 생성 완료 → verify-backup.mjs 로 검증하세요.' : '\n중단: 백업 실패. 위 오류를 확인하세요.');
process.exit(ok ? 0 : 1);
