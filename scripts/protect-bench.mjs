// 사진 보호 성능 측정 — 실제 Supabase(또는 로컬)에 테스트 계정으로 사진을 올리고 protect-document를 호출해 단계별 시간을 모은다.
// 사진 1장 / 5장 / 10장(기본), 동시 처리 수는 앱과 같이 3장(BENCH_CONCURRENCY). 측정이 끝나면 올린 파일·기록을 모두 지운다.
// 측정용 사진은 가짜 값만 있는 fixture(기본: src/__fixtures__/photo/lease-a4.jpg, 2400×3391)를 쓴다 — 실제 계약서를 쓰지 마세요.
// 출력: 상태별 개수, 서버 단계별 시간(OCR·해석·보호본 생성·확인·재-OCR), 전체 시간, 실패 사유 코드. 원문·좌표는 출력하지 않는다.
//
// 사용 (PowerShell 예):
//   $env:SUPABASE_URL="https://<프로젝트>.supabase.co"; $env:SUPABASE_ANON_KEY="<anon key>"
//   $env:BENCH_EMAIL="<테스트 계정 이메일>"; $env:BENCH_PASSWORD="<테스트 계정 비밀번호>"
//   node scripts/protect-bench.mjs
// 선택: BENCH_IMAGE=<사진 경로> BENCH_COUNTS=1,5,10 BENCH_CONCURRENCY=3
//
// 스캔 PDF 측정 (BENCH_MODE=scan-pdf): 같은 가짜 사진을 페이지마다 한 장씩 넣은 스캔 PDF(1·5·10·20쪽)를 만들어 한 문서씩 보호한다.
//   $env:BENCH_MODE="scan-pdf"; node scripts/protect-bench.mjs
//   선택: BENCH_PAGES=1,5,10,20
//   출력: 상태·페이지별 상태, 전체 시간, 페이지별 worker 시간·OCR 호출 수, 원본/보호본 크기, 보호 이미지 크기(1600px), 자원 한도 초과 여부
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const env = (k, d) => process.env[k] ?? d;
const URL = env('SUPABASE_URL');
const ANON = env('SUPABASE_ANON_KEY');
const EMAIL = env('BENCH_EMAIL');
const PASSWORD = env('BENCH_PASSWORD');
if (!URL || !ANON || !EMAIL || !PASSWORD) {
  console.error('필요: SUPABASE_URL, SUPABASE_ANON_KEY, BENCH_EMAIL, BENCH_PASSWORD');
  process.exit(1);
}
const MODE = env('BENCH_MODE', 'photo');
const IMAGE = env('BENCH_IMAGE', 'src/__fixtures__/photo/lease-a4.jpg');
const COUNTS = env('BENCH_COUNTS', '1,5,10').split(',').map(Number);
const CONCURRENCY = Number(env('BENCH_CONCURRENCY', '3'));
const bytes = fs.readFileSync(IMAGE);
const mime = IMAGE.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
const ext = mime === 'image/png' ? 'png' : 'jpg';

const sb = createClient(URL, ANON, { auth: { persistSession: false } });
const { data: auth, error: authError } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (authError || !auth.session) {
  console.error('로그인 실패:', authError?.message ?? 'no session');
  process.exit(1);
}
const userId = auth.user.id;
const token = auth.session.access_token;

async function upload(fileBytes = bytes, fileMime = mime, fileExt = ext) {
  const id = randomUUID();
  const storagePath = `${userId}/${id}.${fileExt}`;
  const up = await sb.storage.from('contract-files').upload(storagePath, fileBytes, { contentType: fileMime });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  const { error } = await sb.from('contract_documents').insert({ id, storage_path: storagePath, mime_type: fileMime, size_bytes: fileBytes.length, original_filename: `bench.${fileExt}`, sort_order: 0 });
  if (error) throw new Error(`insert: ${error.message}`);
  return { id, storagePath };
}

async function protect(id) {
  const t = Date.now();
  const res = await fetch(`${URL}/functions/v1/protect-document`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId: id }),
  });
  const wall = Date.now() - t;
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* 응답 본문 없음 */
  }
  return {
    http: res.status,
    wall,
    status: body?.status ?? null,
    detail: body?.detail ?? body?.error ?? body?.code ?? null,
    metrics: body?.metrics ?? null,
    pages: body?.pages ?? null,
    scanMetrics: body?.scanMetrics ?? null,
    ocrCalls: body?.ocrCalls ?? null,
    derivativeBytes: body?.derivativeBytes ?? null,
  };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function cleanup(docs) {
  const ids = docs.map((d) => d.id);
  const { data } = await sb.from('contract_documents').select('id, storage_path, document_derivatives(storage_path)').in('id', ids);
  const paths = (data ?? []).flatMap((r) => [r.storage_path, ...(r.document_derivatives ?? []).map((d) => d.storage_path)]);
  if (paths.length) await sb.storage.from('contract-files').remove(paths);
  await sb.from('contract_documents').delete().in('id', ids);
}

const stat = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return '-';
  const p = (q) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  return `평균 ${Math.round(v.reduce((a, b) => a + b, 0) / v.length)} · 중앙 ${p(0.5)} · 최대 ${v[v.length - 1]}`;
};

/** 가짜 사진을 페이지마다 한 장씩 (A4, 이미지가 페이지 전체를 덮음 — 스캔 페이지) */
async function scanPdf(pages) {
  const { PDFDocument, PDFName } = await import('../supabase/functions/_shared/vendor/pdf-lib.js');
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const img = await doc.embedJpg(bytes);
    const page = doc.addPage([595, 842]);
    page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
    page.node.delete(PDFName.of('Annots'));
  }
  return await doc.save();
}

if (MODE === 'scan-pdf') {
  const PAGES = env('BENCH_PAGES', '1,5,10,20').split(',').map(Number);
  console.log(`스캔 PDF: 페이지마다 ${IMAGE} (${bytes.length} bytes) · 문서 하나씩 처리 (페이지는 서버에서 동시 2장)`);
  for (const n of PAGES) {
    const pdf = await scanPdf(n);
    const doc = await upload(pdf, 'application/pdf', 'pdf');
    const r = await protect(doc.id);
    await cleanup([doc]);
    const sm = r.scanMetrics ?? [];
    const pick = (k) => sm.map((x) => x[k]);
    const tk = (k) => sm.map((x) => x.timings?.[k]);
    const pageStatus = {};
    for (const p of r.pages ?? []) pageStatus[`${p.kind}:${p.status}`] = (pageStatus[`${p.kind}:${p.status}`] ?? 0) + 1;
    console.log(`\n== 스캔 PDF ${n}쪽 — 전체 ${r.wall}ms · HTTP ${r.http}`);
    console.log(`결과: ${r.status ?? '-'}${r.detail ? `(${r.detail})` : ''} · 페이지: ${JSON.stringify(pageStatus)}`);
    console.log(`페이지별 worker 시간(대기 포함): ${stat(pick('workerMs'))}`);
    console.log(`  CLOVA 1차: ${stat(tk('ocrMs'))} / 재-OCR: ${stat(tk('verifyOcrMs'))} / 이미지 해석: ${stat(tk('prepareMs'))} / 가리기·저장: ${stat(tk('renderMs'))} / 확인: ${stat(tk('checkMs'))}`);
    console.log(`  OCR 호출: 합계 ${r.ocrCalls ?? '-'} · 페이지당 ${JSON.stringify([...new Set(pick('ocrCalls'))])}`);
    console.log(`  크기: 원본 PDF ${pdf.length} bytes → 보호본 ${r.derivativeBytes ?? '-'} bytes · 보호 이미지 ${sm[0] ? `${sm[0].viewWidth}×${sm[0].viewHeight}, 평균 ${Math.round(pick('imageBytes').reduce((a, b) => a + b, 0) / Math.max(1, sm.length))} bytes` : '-'}`);
    if (r.http === 546 || r.http >= 500 || /WORKER_LIMIT|resource|scan_worker/i.test(String(r.detail))) console.log(`  ⚠ 서버 오류·자원 한도·worker 실패: HTTP ${r.http} ${r.detail ?? ''}`);
  }
  await sb.auth.signOut();
  process.exit(0);
}

console.log(`사진: ${IMAGE} (${bytes.length} bytes) · 동시 처리 ${CONCURRENCY}장`);
for (const n of COUNTS) {
  const docs = [];
  for (let i = 0; i < n; i++) docs.push(await upload());
  const t = Date.now();
  const results = await pool(docs, CONCURRENCY, (d) => protect(d.id));
  const total = Date.now() - t;
  await cleanup(docs);
  const by = {};
  for (const r of results) {
    const k = `${r.status ?? `HTTP ${r.http}`}${r.detail ? `(${r.detail})` : ''}`;
    by[k] = (by[k] ?? 0) + 1;
  }
  const m = (k) => results.map((r) => r.metrics?.[k]);
  console.log(`\n== 사진 ${n}장 — 전체 ${total}ms`);
  console.log(`결과: ${JSON.stringify(by)}`);
  console.log(`요청별 시간(앱에서 본 시간): ${stat(results.map((r) => r.wall))}`);
  console.log(`서버 전체: ${stat(m('totalMs'))}`);
  console.log(`  CLOVA 1차: ${stat(m('ocrMs'))} / 재-OCR: ${stat(m('verifyOcrMs'))}`);
  console.log(`  이미지 해석: ${stat(m('decodeMs'))} / 줄이기·가리기·저장: ${stat(m('renderMs'))} / 보호본 확인: ${stat(m('checkMs'))}`);
  console.log(`  OCR 호출 수: ${JSON.stringify(m('ocrCalls'))} · 보호본: ${results[0]?.metrics ? `${results[0].metrics.viewWidth}×${results[0].metrics.viewHeight}` : '-'}`);
  const limits = results.filter((r) => r.http === 546 || /WORKER_LIMIT|resource limit/i.test(String(r.detail)));
  if (limits.length) console.log(`  ⚠ 자원 한도(CPU·메모리) 초과 응답: ${limits.length}건`);
}
await sb.auth.signOut();
