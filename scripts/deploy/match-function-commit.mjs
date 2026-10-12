// 운영에서 내려받은 함수 코드가 git의 어느 커밋과 같은지 찾는다 (읽기 전용 — git과 로컬 파일만 읽는다).
//   node scripts/deploy/match-function-commit.mjs <내려받은 workdir> <함수 이름> [<함수 이름> ...]
// <workdir>/supabase/functions/ 아래 파일(함수 폴더 + 함께 내려온 _shared 등)을 git 커밋의 같은 경로 파일과 바이트 단위(blob 해시)로 비교한다.
// Windows에서 CRLF로 배포됐을 수 있어 줄바꿈을 LF로 바꾼 해시도 함께 비교한다.
// 결과: 함수마다 "일치하는 가장 최근 커밋" 또는 "일치 없음(커밋되지 않은 코드가 배포됨)".
// 일치 커밋이 있으면 그 커밋을 git worktree로 꺼내 그대로 다시 배포하는 것이 되돌리기 방법이 된다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
const blob = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

const [workdir, ...names] = process.argv.slice(2);
if (!workdir || names.length === 0) { console.error('사용법: match-function-commit.mjs <workdir> <함수 이름...>'); process.exit(2); }
const fnRoot = path.join(workdir, 'supabase', 'functions');
const files = walk(fnRoot).map((f) => {
  const buf = fs.readFileSync(f);
  const lf = Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return { rel: 'supabase/functions/' + path.relative(fnRoot, f).split(path.sep).join('/'), hashes: new Set([blob(buf), blob(lf)]) };
});
// 함수 하나가 쓰는 파일 = 그 함수 폴더 + 함수 폴더 밖의 파일(_shared 등). 여러 함수를 한 workdir에 받으면 _shared가 섞이므로 함수별 폴더 사용 권장
const commits = git('log', '--format=%H %cs', '--', 'supabase/functions').trim().split('\n').filter(Boolean);
let allOk = true;
for (const name of names) {
  const own = files.filter((f) => f.rel.startsWith(`supabase/functions/${name}/`));
  const shared = files.filter((f) => !/^supabase\/functions\/[^/]+\//.test(f.rel) || f.rel.startsWith('supabase/functions/_'));
  const mine = [...own, ...shared];
  if (own.length === 0) { console.log(`FAIL ${name}: 내려받은 폴더에 이 함수 파일이 없음`); allOk = false; continue; }
  let found = null;
  for (const line of commits) {
    const [sha, date] = line.split(' ');
    const tree = new Map(git('ls-tree', '-r', sha, '--', ...new Set(mine.map((f) => f.rel))).trim().split('\n').filter(Boolean).map((l) => {
      const [meta, p] = l.split('\t');
      return [p, meta.split(' ')[2]];
    }));
    if (mine.every((f) => f.hashes.has(tree.get(f.rel)))) {
      // 그 커밋의 함수 폴더에 내려받은 것보다 더 많은 파일이 있으면 같은 배포가 아니다
      const extra = git('ls-tree', '-r', '--name-only', sha, '--', `supabase/functions/${name}/`).trim().split('\n').filter((p) => p && !own.some((f) => f.rel === p));
      if (extra.length === 0) { found = { sha, date }; break; }
    }
  }
  if (found) console.log(`OK   ${name}: 파일 ${mine.length}개가 커밋 ${found.sha.slice(0, 7)} (${found.date})와 바이트 단위로 같음`);
  else { console.log(`FAIL ${name}: 일치하는 커밋 없음 — 커밋되지 않은 코드가 배포됐거나 다른 저장소에서 배포됨`); allOk = false; }
}
process.exit(allOk ? 0 : 1);
