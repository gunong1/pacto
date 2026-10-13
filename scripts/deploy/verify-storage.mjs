// Storage 백업 검증기 (읽기 전용 — 로컬 파일만 읽고 아무 데도 보내지 않는다).
//   node scripts/deploy/verify-storage.mjs <storage-manifest.csv> <내려받은 폴더>
// <내려받은 폴더>/<버킷>/<경로> 에 파일이 있어야 한다 (supabase storage cp -r ss:///<버킷> <폴더>/<버킷> 결과).
// 파일마다: 있음 · 크기 일치 · (eTag가 md5 형식이면) md5 일치 → 하나라도 어긋나면 실패.
// 형식 머리/꼬리(PDF %PDF…%%EOF, JPEG FFD8…FFD9, PNG 서명)는 참고 정보(형식 경고)로만 센다 — md5가 맞으면 운영에 저장된
// 바이트와 같다는 뜻이고, 형식 경고는 "원래 저장된 파일이 그런 모양"이라는 뜻이다 (뒤에 여분 바이트가 붙은 사진 등).
// 목록에 없는 여분 파일도 실패로 본다. 출력은 버킷별 개수와 실패 개수만 — 경로는 --show-paths 를 줄 때만 출력한다
// (경로에 사용자 id가 들어 있으므로 채팅에 보낼 때는 개수만 보낸다).
// 종료 코드: 0 = 통과, 1 = 실패, 2 = 사용법 오류.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readText } from './verify-backup.mjs';

// 따옴표·쉼표를 인식하는 CSV 파서
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

function formatProblem(file, buf) {
  const ext = path.extname(file).toLowerCase();
  const head = buf.subarray(0, 8);
  const tail = buf.subarray(Math.max(0, buf.length - 1024)).toString('latin1');
  if (ext === '.pdf') {
    if (head.toString('latin1', 0, 5) !== '%PDF-') return 'PDF 머리 없음';
    if (!tail.includes('%%EOF')) return 'PDF 끝(%%EOF) 없음';
  } else if (ext === '.jpg' || ext === '.jpeg') {
    if (head[0] !== 0xff || head[1] !== 0xd8) return 'JPEG 머리 없음';
    if (buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) return 'JPEG 끝 없음';
  } else if (ext === '.png') {
    if (head.toString('hex') !== '89504e470d0a1a0a') return 'PNG 서명 없음';
  }
  return null;
}

export function verifyStorage(manifestRows, dir, { checkFormat = true } = {}) {
  const [header, ...rows] = manifestRows;
  const idx = (k) => header.indexOf(k);
  const [ib, inm, isz, iet] = ['bucket_id', 'name', 'size', 'etag'].map(idx);
  if ([ib, inm, isz, iet].some((x) => x < 0)) throw new Error('manifest 머리줄에 bucket_id,name,size,etag 가 없음');
  const result = new Map();
  const failures = [];
  const expected = new Set();
  for (const r of rows) {
    const bucket = r[ib];
    const name = r[inm];
    const s = result.get(bucket) ?? { files: 0, bytes: 0, md5: 0, sizeOnly: 0, fail: 0, formatWarn: 0 };
    result.set(bucket, s);
    s.files++;
    const rel = path.join(bucket, ...name.split('/'));
    expected.add(rel);
    const file = path.join(dir, rel);
    const fail = (why) => { s.fail++; failures.push({ bucket, name, why }); };
    if (!fs.existsSync(file)) { fail('파일 없음'); continue; }
    const buf = fs.readFileSync(file);
    s.bytes += buf.length;
    // 목록 크기가 1.028576e+06 같은 지수 표기로 올 수 있어 숫자로 비교한다 (정수로 정확히 떨어질 때만 인정)
    const listed = Number(r[isz]);
    if (!Number.isSafeInteger(listed) || listed !== buf.length) { fail(`크기 다름 (목록 ${r[isz]}, 파일 ${buf.length})`); continue; }
    const etag = (r[iet] ?? '').toLowerCase();
    if (/^[0-9a-f]{32}$/.test(etag)) {
      if (crypto.createHash('md5').update(buf).digest('hex') !== etag) { fail('md5가 eTag와 다름'); continue; }
      s.md5++;
    } else s.sizeOnly++;
    if (checkFormat && formatProblem(file, buf)) s.formatWarn++;
  }
  // 목록에 없는 여분 파일
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const extra = fs.existsSync(dir) ? walk(dir).map((f) => path.relative(dir, f)).filter((f) => !expected.has(f)) : [];
  for (const f of extra) failures.push({ bucket: f.split(path.sep)[0], name: f, why: '목록에 없는 파일' });
  return { result, failures, extra: extra.length };
}

function main(argv) {
  const [manifest, dir] = argv;
  if (!manifest || !dir) { console.error('사용법: verify-storage.mjs <storage-manifest.csv> <내려받은 폴더> [--show-failures (id 가림)] [--show-paths]'); return 2; }
  const rows = parseCsv(readText(manifest)).filter((r) => !/^Connecting/.test(r[0]));
  const { result, failures, extra } = verifyStorage(rows, dir);
  if (result.size === 0) { console.log('FAIL  manifest에 파일이 없음 (목록 조회가 실패했을 수 있음 — 빈 Storage라면 이 메시지가 정상)'); }
  for (const [b, s] of result) {
    console.log(`${s.fail ? 'FAIL' : 'OK  '} ${b.padEnd(16)} 파일 ${String(s.files).padStart(6)}  바이트 ${String(s.bytes).padStart(12)}  md5 확인 ${s.md5}  크기만 확인 ${s.sizeOnly}  실패 ${s.fail}  형식 경고 ${s.formatWarn}`);
  }
  if (extra) console.log(`FAIL 목록에 없는 여분 파일 ${extra}개`);
  const why = new Map();
  for (const f of failures) why.set(f.why.replace(/ \(.*\)$/, ''), (why.get(f.why.replace(/ \(.*\)$/, '')) ?? 0) + 1);
  for (const [w, n] of why) console.log(`     실패 사유: ${w} ${n}개`);
  if (argv.includes('--show-paths')) for (const f of failures) console.log(`     ${f.bucket}/${f.name}: ${f.why}`);
  // 채팅에 보내도 되게: 경로의 id(uuid)는 앞 4글자만 남기고 가린다
  const mask = (p) => p.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (u) => `${u.slice(0, 4)}…`);
  if (argv.includes('--show-failures')) for (const f of failures) console.log(`     ${mask(`${f.bucket}/${f.name}`)}: ${f.why}`);
  const ok = failures.length === 0 && result.size > 0;
  console.log(ok ? '\n결과: PASS — 목록의 모든 파일이 있고 크기와 내용(md5 확인 가능한 파일)이 운영 목록과 같습니다.' : '\n결과: FAIL — 이 Storage 백업으로는 진행하지 마세요.');
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) process.exit(main(process.argv.slice(2)));
