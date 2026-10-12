// 선택: 백업 파일을 "로컬" Supabase DB에 실제로 복원해 보고, 모든 행 내용이 운영 집계(counts.csv)와 같은지 확인한다.
//   node scripts/deploy/restore-test.mjs <data.sql> --counts <counts.csv> --version <운영 마지막 버전> --yes-reset-local
// - 운영 DB에는 접속하지 않는다. 로컬 Docker의 supabase_db_<project_id> 컨테이너만 쓴다 (npx supabase start 필요).
// - 로컬 DB를 지운다: db reset --local --version <버전> → 비우기 → 복원(한 트랜잭션, 트리거 끔) → 지문 비교 → 다시 db reset --local
//   마지막 reset은 운영 데이터 사본이 로컬 DB에 남지 않게 하려는 것. 실패해도 마지막 reset은 실행한다.
// - 출력은 테이블 이름·행 수·판정뿐이다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readCounts, readText, parseDump, KNOWN_EXCLUDED } from './verify-backup.mjs';

const argv = process.argv.slice(2);
const get = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const [file] = argv;
const countsFile = get('--counts');
const version = get('--version');
if (!file || !countsFile || !/^\d{14}$/.test(version ?? '') || !argv.includes('--yes-reset-local')) {
  console.error('사용법: restore-test.mjs <data.sql> --counts <counts.csv> --version <14자리> --yes-reset-local  (로컬 DB를 지웁니다)');
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const projectId = fs.readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
const container = `supabase_db_${projectId}`;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30, shell: process.platform === 'win32' && cmd === npx, ...opts });
const psql = (input) => run('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-At', '-F,'], { input });
const resetLocal = (v) => run(npx, ['supabase', 'db', 'reset', '--local', ...(v ? ['--version', v] : [])]);

let ok = false;
try {
  if (run('docker', ['inspect', container]).status !== 0) throw new Error(`로컬 컨테이너 ${container} 없음 — npx supabase start 먼저`);
  if (resetLocal(version).status !== 0) throw new Error('로컬 db reset 실패');
  // 비울 테이블 = 백업에 들어 있는 테이블 전부 + public 전부 (마이그레이션이 넣은 기준표 행과 겹치지 않게)
  const dump = readText(file);
  const parsed = parseDump(dump);
  if (parsed.problems.length) throw new Error(`백업 형식 문제 ${parsed.problems.length}건 — verify-backup.mjs 먼저`);
  const tables = psql(`select n.nspname||'.'||c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') order by 1;`);
  if (tables.status !== 0) throw new Error('테이블 목록 조회 실패');
  const quote = (name) => name.split('.').map((x) => `"${x}"`).join('.');
  const list = [...new Set([...tables.stdout.trim().split('\n').filter(Boolean).map(quote), ...[...parsed.tables.keys()].map(quote)])];
  const restore = psql(`begin;\nset session_replication_role = replica;\ntruncate ${list.join(', ')} cascade;\n${dump}\ncommit;\n`);
  if (restore.status !== 0) throw new Error(`복원 실패 (트랜잭션 전체 취소): ${(restore.stderr || '').split('\n').find((l) => /ERROR/.test(l))?.replace(/DETAIL.*$/, '') ?? '알 수 없음'}`);
  console.log(`복원 완료: 테이블 ${list.length}개 비우고 백업 적용`);
  const counted = psql(fs.readFileSync(path.join(root, 'scripts', 'deploy', 'backup-counts.sql'), 'utf8'));
  if (counted.status !== 0) throw new Error('복원 후 집계 실패');
  const local = readCounts(counted.stdout);
  const want = readCounts(readText(countsFile));
  let fail = false;
  for (const [name, w] of want) {
    if (KNOWN_EXCLUDED.includes(name)) continue;
    const g = local.get(name) ?? { rows: 0, idMd5: null, contentMd5: null };
    const same = g.rows === w.rows && g.idMd5 === w.idMd5 && g.contentMd5 === w.contentMd5;
    if (!same) fail = true;
    if (!same || w.rows > 0) console.log(`${same ? 'OK  ' : 'FAIL'} ${name.padEnd(42)} 운영 ${String(w.rows).padStart(7)}  복원 ${String(g.rows).padStart(7)}  내용 ${g.contentMd5 === w.contentMd5 ? '같음' : '다름'}`);
  }
  ok = !fail;
} catch (e) {
  console.log(`FAIL ${e.message}`);
} finally {
  const r = resetLocal();
  console.log(r.status === 0 ? '로컬 DB 초기화 완료 (운영 데이터 사본 제거)' : '주의: 마지막 로컬 db reset 실패 — 직접 npx supabase db reset --local 실행');
}
console.log(ok ? '\n결과: PASS — 백업을 실제로 복원했고 모든 테이블의 행 내용이 운영과 같습니다.' : '\n결과: FAIL — 이 백업의 복원 가능성을 확인하지 못했습니다.');
process.exit(ok ? 0 : 1);
