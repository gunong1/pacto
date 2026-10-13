/**
 * 단계별 마이그레이션 적용 준비 — 지정한 버전까지의 마이그레이션만 담은 임시 폴더(.deploy-stage)를 만든다.
 * 그 폴더로 `supabase db push --workdir .deploy-stage`를 실행하면 그 버전까지만 적용되고,
 * CLI가 supabase_migrations.schema_migrations 이력도 함께 기록한다 (SQL Editor 직접 실행과 달리 이력 누락 없음).
 *
 * 사용: node scripts/deploy/stage.mjs <버전>     예) node scripts/deploy/stage.mjs 20261026000002
 * - 원본 supabase/migrations 는 읽기만 한다 (복사 전후 sha256 비교로 확인)
 * - 원본이 git HEAD와 다르거나(수정·추가·삭제) 커밋되지 않은 파일이 있으면 중단한다
 * - 복사본이 원본과 바이트 단위로 같은지 확인하고, 적용 대상 파일의 sha256을 출력한다
 * - supabase/config.toml 과 연결 정보(supabase/.temp — supabase link 결과)를 복사한다
 * - 운영 DB에는 아무것도 하지 않는다 (파일만 만든다)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fail = (msg) => { console.error(`중단: ${msg}`); process.exit(1); };
// STAGE_DEBUG=1 이면 단계마다 진행 표시 (비정상 종료 위치 확인용)
const trace = (step) => { if (process.env.STAGE_DEBUG) console.error(`[진행] ${step}`); };
const version = process.argv[2];
if (!/^\d{14}$/.test(version ?? '')) {
  console.error('사용: node scripts/deploy/stage.mjs <14자리 버전>  (예: 20261026000002)');
  process.exit(2);
}
// Windows 한글 경로(C:\\Users\\김지은\\...)도 그대로 — fileURLToPath가 디코딩한다
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = path.join(root, 'supabase');
const migDir = path.join(src, 'migrations');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// Windows git(core.autocrlf)이 줄바꿈을 CRLF로 바꿔 둘 수 있어, 비교용으로 LF 기준 해시도 함께 보여 준다
const shaLf = (file) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const hashAll = () => new Map(fs.readdirSync(migDir).sort().map((f) => [f, sha(path.join(migDir, f))]));

// 1) 원본이 git HEAD와 같은지 (수정·추가·삭제·스테이징 모두 거부)
trace('git 상태 확인');
let dirty;
try {
  dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'supabase/migrations'], { cwd: root, encoding: 'utf8' }).trim();
} catch {
  fail('git 상태를 확인할 수 없습니다 (git 설치·저장소 위치 확인)');
}
if (dirty) fail(`supabase/migrations 가 커밋된 상태와 다릅니다:\n${dirty}`);

trace('원본 해시 계산');
const before = hashAll();
const all = [...before.keys()].filter((f) => /^\d{14}_.*\.sql$/.test(f));
const targets = all.filter((f) => f.startsWith(version));
if (targets.length !== 1) fail(`supabase/migrations에 ${version} 파일이 ${targets.length}개 있습니다 (정확히 1개여야 함)`);

// 2) 임시 폴더 구성
const stage = path.join(root, '.deploy-stage');
// fs.rmSync(recursive)·fs.cpSync는 쓰지 않는다 — Windows의 Node 24에서 한글 경로(C:\\Users\\김지은\\...)일 때 0xC0000409로 비정상 종료됨
const removeDir = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) removeDir(p);
    else fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
};
trace('임시 폴더 비우기');
removeDir(stage);
trace('임시 폴더 만들기');
fs.mkdirSync(path.join(stage, 'supabase', 'migrations'), { recursive: true });
fs.copyFileSync(path.join(src, 'config.toml'), path.join(stage, 'supabase', 'config.toml'));
const linked = fs.existsSync(path.join(src, '.temp'));
const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name));
    else if (e.isFile()) fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
};
trace('연결 정보 복사');
if (linked) copyDir(path.join(src, '.temp'), path.join(stage, 'supabase', '.temp'));
trace('마이그레이션 복사');
const picked = all.filter((f) => f.slice(0, 14) <= version);
for (const f of picked) fs.copyFileSync(path.join(migDir, f), path.join(stage, 'supabase', 'migrations', f));

// 3) 검증: 복사본 = 원본, 원본 불변, 마지막 파일 = 대상
trace('복사본 검증');
const staged = fs.readdirSync(path.join(stage, 'supabase', 'migrations')).sort();
if (staged.join('\n') !== picked.join('\n')) fail('임시 폴더의 파일 목록이 예상과 다릅니다');
for (const f of staged) if (sha(path.join(stage, 'supabase', 'migrations', f)) !== before.get(f)) fail(`${f} 복사본이 원본과 다릅니다`);
const after = hashAll();
if ([...after].join('\n') !== [...before].join('\n')) fail('복사 중에 원본 supabase/migrations 가 바뀌었습니다');
if (staged.at(-1) !== targets[0]) fail(`마지막 파일이 대상이 아닙니다: ${staged.at(-1)}`);

console.log(`.deploy-stage 준비: 마이그레이션 ${picked.length}개 (원본 ${all.length}개 중 ${version} 까지)`);
console.log(`적용 대상: ${targets[0]}`);
console.log(`대상 sha256: ${before.get(targets[0])}`);
console.log(`대상 sha256(LF 기준, 실행서의 기대값과 비교): ${shaLf(path.join(migDir, targets[0]))}`);
console.log(`원본 변경 없음 · 복사본 일치 확인`);
console.log(`연결 정보 복사: ${linked ? '예' : '아니요 — 먼저 npx supabase link 를 실행하거나 명령에 --project-ref 를 붙이세요'}`);
