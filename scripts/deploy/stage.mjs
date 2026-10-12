/**
 * 단계별 마이그레이션 적용 준비 — 지정한 버전까지의 마이그레이션만 담은 폴더(.deploy-stage)를 만든다.
 * 그 폴더로 `supabase db push --workdir .deploy-stage`를 실행하면 그 버전까지만 적용되고,
 * CLI가 supabase_migrations.schema_migrations 이력도 함께 기록한다 (SQL Editor 직접 실행과 달리 이력 누락 없음).
 *
 * 사용: node scripts/deploy/stage.mjs <버전>     예) node scripts/deploy/stage.mjs 20261025000002
 * - supabase/config.toml 과 연결 정보(supabase/.temp — supabase link 결과)를 그대로 복사한다
 * - 운영 DB에는 아무것도 하지 않는다 (파일만 만든다)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!/^\d{14}$/.test(version ?? '')) {
  console.error('사용: node scripts/deploy/stage.mjs <14자리 버전>  (예: 20261025000002)');
  process.exit(2);
}
// Windows 한글 경로(C:\\Users\\김지은\\...)도 그대로 — fileURLToPath가 디코딩한다
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = path.join(root, 'supabase');
const all = fs.readdirSync(path.join(src, 'migrations')).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
if (!all.some((f) => f.startsWith(version))) {
  console.error(`supabase/migrations에 ${version} 파일이 없습니다`);
  process.exit(2);
}
const stage = path.join(root, '.deploy-stage');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'supabase', 'migrations'), { recursive: true });
fs.copyFileSync(path.join(src, 'config.toml'), path.join(stage, 'supabase', 'config.toml'));
if (fs.existsSync(path.join(src, '.temp'))) fs.cpSync(path.join(src, '.temp'), path.join(stage, 'supabase', '.temp'), { recursive: true });
const picked = all.filter((f) => f.slice(0, 14) <= version);
for (const f of picked) fs.copyFileSync(path.join(src, 'migrations', f), path.join(stage, 'supabase', 'migrations', f));
console.log(`.deploy-stage 준비: 마이그레이션 ${picked.length}개 (마지막 ${picked.at(-1)})`);
console.log(`연결 정보 복사: ${fs.existsSync(path.join(src, '.temp')) ? '예' : '아니요 — 먼저 npx supabase link 를 실행하세요'}`);
