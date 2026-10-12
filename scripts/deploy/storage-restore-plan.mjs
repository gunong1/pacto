// Storage 복구 계획 (읽기 전용 — 두 목록 CSV만 비교한다. 운영에 아무것도 올리거나 지우지 않는다).
//   node scripts/deploy/storage-restore-plan.mjs <백업 때 storage-manifest.csv> <지금 storage-manifest.csv> [--write <plan.ps1>]
// 분류
//   빠진 파일   : 백업 목록에는 있고 지금은 없음 → 백업 파일을 같은 경로로 다시 올리면 됨 (storage cp는 덮어쓰지 않음)
//   바뀐 파일   : 같은 경로인데 크기·eTag가 다름 → 지우고 다시 올려야 함 (운영 삭제가 들어가므로 따로 승인)
//   새 파일     : 지금만 있음 (백업 뒤 사용자가 올린 파일) → 건드리지 않음
// --write 를 주면 "빠진 파일"만 다시 올리는 PowerShell 명령 파일을 만든다. 경로에 사용자 id가 들어 있으므로 백업 폴더에 둔다.
// 이 도구는 명령을 실행하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { readText } from './verify-backup.mjs';
import { parseCsv } from './verify-storage.mjs';

const load = (file) => {
  const [header, ...rows] = parseCsv(readText(file)).filter((r) => !/^Connecting/.test(r[0]));
  const at = (k) => header.indexOf(k);
  return new Map(rows.map((r) => [`${r[at('bucket_id')]}/${r[at('name')]}`, `${r[at('size')]}:${r[at('etag')]}`]));
};
const argv = process.argv.slice(2);
const [backupCsv, currentCsv] = argv;
if (!backupCsv || !currentCsv) { console.error('사용법: storage-restore-plan.mjs <백업 목록> <현재 목록> [--write plan.ps1]'); process.exit(2); }
const backup = load(backupCsv);
const current = load(currentCsv);
const missing = [...backup.keys()].filter((k) => !current.has(k));
const changed = [...backup.keys()].filter((k) => current.has(k) && current.get(k) !== backup.get(k));
const added = [...current.keys()].filter((k) => !backup.has(k));
console.log(`백업 목록 ${backup.size} · 현재 ${current.size}`);
console.log(`빠진 파일 ${missing.length}개 — 다시 올리기 가능`);
console.log(`바뀐 파일 ${changed.length}개 — 삭제 후 다시 올려야 함 (별도 승인)`);
console.log(`새 파일 ${added.length}개 — 건드리지 않음`);
const out = argv.includes('--write') ? argv[argv.indexOf('--write') + 1] : null;
if (out) {
  const lines = ['# 자동 생성: 빠진 파일만 다시 올린다 (덮어쓰지 않음). $B 는 백업 폴더. 실행 전 승인 필요.'];
  for (const k of missing) {
    const local = path.win32.join('$B', 'storage', ...k.split('/'));
    lines.push(`npx supabase storage cp "${local}" "ss:///${k}" --linked --experimental`);
    lines.push('if ($LASTEXITCODE -ne 0) { Write-Host "중단: 업로드 실패"; exit 1 }');
  }
  fs.writeFileSync(out, lines.join('\r\n') + '\r\n');
  console.log(`명령 파일: ${out} (명령 ${missing.length}개, 실행하지 않음)`);
}
