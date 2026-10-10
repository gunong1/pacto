// 암호 PDF — 보호본으로 AI 분석했을 때 추출 정확도 비교 (배포 환경, 실제 AI).
// 같은 가짜 계약서를 ① 암호 없는 PDF ② 암호 PDF(AES-256, 비밀번호 입력 → 서버 메모리 복호화 → 보호본)로 각각 올려
// 보호 → 분석한 뒤, 날짜·금액·결제일·자동갱신·해지 통보기한을 나란히 비교한다. 측정이 끝나면 올린 파일·기록을 지운다.
// 계약서 내용은 모두 가짜 값이다 — 실제 계약서를 쓰지 마세요. 출력에는 추출된 날짜·금액 등 비교 값만 (주민번호·계좌 등 원문 없음).
//
// 사용 (PowerShell 예, 테스트 계정은 AI 처리 동의가 되어 있어야 함):
//   $env:SUPABASE_URL="https://<프로젝트>.supabase.co"; $env:SUPABASE_ANON_KEY="<anon key>"
//   $env:BENCH_EMAIL="<테스트 계정 이메일>"; $env:BENCH_PASSWORD="<테스트 계정 비밀번호>"
//   node --experimental-strip-types --no-warnings scripts/encrypted-bench.ts
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import createQpdf from '../supabase/functions/_shared/vendor/qpdf.js';
import { QPDF_WASM_BASE64 } from '../supabase/functions/_shared/vendor/qpdf-wasm.js';
import { ContractPdf } from '../tests/protection/fixtures.ts';

const env = (k: string) => process.env[k];
const URL_ = env('SUPABASE_URL');
const ANON = env('SUPABASE_ANON_KEY');
const EMAIL = env('BENCH_EMAIL');
const ACCOUNT_PW = env('BENCH_PASSWORD');
if (!URL_ || !ANON || !EMAIL || !ACCOUNT_PW) {
  console.error('필요: SUPABASE_URL, SUPABASE_ANON_KEY, BENCH_EMAIL, BENCH_PASSWORD');
  process.exit(1);
}
/** 측정용 PDF 비밀번호 (가짜 문서에만 씀, 출력하지 않음) */
const PDF_PW = `bench-${randomUUID().slice(0, 8)}!계약`;

/** 가짜 임대차계약서 — 민감정보(주민번호·계좌·전화) + 날짜·금액·자동갱신·해지 통보 조건 */
async function contractPdf() {
  const c = await ContractPdf.create();
  await c.page([
    '주택 임대차계약서',
    '임대인: 김가짜   임차인: 이테스트 (주민등록번호: 900101-1234567)',
    '연락처: 010-1111-2222',
    '임대차 기간: 2026년 11월 1일부터 2028년 10월 31일까지',
    '보증금 50,000,000원, 월세 850,000원은 매월 25일에 지급한다.',
    '월세 입금 계좌: 국민은행 123456-01-234567',
    '계약 만료 2개월(60일) 전까지 갱신 거절 통지가 없으면 같은 조건으로 1년 자동 갱신된다.',
  ]);
  return c.save();
}

async function encrypt(plain: Uint8Array): Promise<Uint8Array> {
  const q = await createQpdf({ noInitialRun: true, locateFile: () => `data:application/wasm;base64,${QPDF_WASM_BASE64}` });
  q.FS.writeFile('/p.pdf', plain);
  const rc = q.callMain(['--encrypt', PDF_PW, `owner-${PDF_PW}`, '256', '--', '/p.pdf', '/e.pdf']);
  if (rc !== 0 && rc !== 3) throw new Error(`encrypt rc=${rc}`);
  return q.FS.readFile('/e.pdf').slice();
}

const sb = createClient(URL_, ANON, { auth: { persistSession: false } });
const { data: auth, error: authError } = await sb.auth.signInWithPassword({ email: EMAIL, password: ACCOUNT_PW });
if (authError || !auth.session) {
  console.error('로그인 실패:', authError?.message ?? 'no session');
  process.exit(1);
}
const userId = auth.user.id;
const token = auth.session.access_token;
const call = async (fn: string, body: unknown) => {
  const t = Date.now();
  const res = await fetch(`${URL_}/functions/v1/${fn}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { http: res.status, ms: Date.now() - t, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

async function run(label: string, bytes: Uint8Array, password: string | null) {
  const id = randomUUID();
  const path = `${userId}/${id}.pdf`;
  const up = await sb.storage.from('contract-files').upload(path, bytes, { contentType: 'application/pdf' });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  const ins = await sb.from('contract_documents').insert({ id, storage_path: path, mime_type: 'application/pdf', size_bytes: bytes.length, original_filename: 'bench-lease.pdf', sort_order: 0 });
  if (ins.error) throw new Error(`insert: ${ins.error.message}`);
  try {
    const first = await call('protect-document', { documentId: id });
    const prot = password ? await call('protect-document', { documentId: id, password }) : first;
    const analyzed = await call('analyze-contract', { documentIds: [id], ...(password ? { passwords: { [id]: password } } : {}) });
    console.log(
      `${label}: protect http=${prot.http} status=${prot.body?.status} access=${prot.body?.access ?? '-'} (${prot.ms}ms, 비밀번호 전 access=${first.body?.access ?? '-'}) · analyze http=${analyzed.http} (${analyzed.ms}ms) decision=${(analyzed.body?.validation as { decision?: string } | undefined)?.decision ?? analyzed.body?.error}`,
    );
    return facts(analyzed.body?.result);
  } finally {
    await sb.storage.from('contract-files').remove([path, `${userId}/${id}.protected_view.pdf`]);
    await sb.from('contract_documents').delete().eq('id', id);
  }
}

/** 비교할 값만: 기간·날짜·결제(금액·주기·결제일)·자동갱신·통보기한 (근거·신뢰도는 빼고) */
function facts(r: unknown) {
  const res = (r ?? {}) as { fields?: Record<string, { value?: unknown }>; payments?: Record<string, unknown>[]; dates?: Record<string, unknown>[] };
  const val = (x: unknown) => (x && typeof x === 'object' && 'value' in (x as object) ? (x as { value: unknown }).value : x);
  const f = res.fields ?? {};
  const pick = ['startDate', 'endDate', 'autoRenewal', 'renewalPeriodMonths', 'terminationNoticeDays', 'noticeKind', 'depositAmount', 'totalAmount'];
  return {
    fields: Object.fromEntries(pick.filter((k) => k in f).map((k) => [k, val(f[k])])),
    payments: (res.payments ?? []).map((p) => ({ amount: val(p.amount), frequency: val(p.frequency), dayOfMonth: val(p.dayOfMonth), kind: val(p.kind) })),
    dates: (res.dates ?? []).map((d) => ({ meaning: val(d.meaning), date: val(d.date) })),
  };
}

const plain = await contractPdf();
const a = await run('① 암호 없는 PDF (원본 → AI)', plain, null);
const b = await run('② 암호 PDF (보호본 → AI)', await encrypt(plain), PDF_PW);
const rows: [string, unknown, unknown][] = [
  ...[...new Set([...Object.keys(a.fields), ...Object.keys(b.fields)])].map((k): [string, unknown, unknown] => [k, a.fields[k as keyof typeof a.fields], b.fields[k as keyof typeof b.fields]]),
  ['payments', a.payments, b.payments],
  ['dates', a.dates, b.dates],
];
let same = 0;
for (const [k, x, y] of rows) {
  const ok = JSON.stringify(x) === JSON.stringify(y);
  if (ok) same++;
  console.log(`${ok ? '=' : '≠'} ${k}: ① ${JSON.stringify(x)} | ② ${JSON.stringify(y)}`);
}
console.log(`\n같은 값 ${same}/${rows.length} — 기대값: 기간 2026-11-01~2028-10-31 · 월세 850,000원 매월 25일 · 보증금 50,000,000원 · 자동갱신 · 통보 60일`);
await sb.auth.signOut();
