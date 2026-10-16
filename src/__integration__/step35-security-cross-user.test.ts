/*
 * 보안 점검 (Phase 1-B): 계정 A의 데이터에 계정 B가 접근할 수 없는지 — 모든 사용자 테이블·Storage·서버 함수
 * - 읽기·수정·삭제: B의 요청은 0건 처리, A의 행은 그대로 (관리자 권한으로 확인)
 * - 쓰기: B가 A의 계약·결제·묶음에 연결한 행을 만들 수 없음 (42501)
 * - Storage: 목록·다운로드·서명 URL·업로드·덮어쓰기·경로 조작 모두 거부
 * - 서버 함수: 로그인 없이 401, 남의 문서 id는 404
 * - 문서 기록의 storage_path는 본인 폴더만 (남의 파일 경로를 기록해 서버 함수가 대신 읽거나 지우게 할 수 없음)
 * 모든 값은 가짜.
 */
import { randomUUID } from 'node:crypto';

import type { PactoSupabase } from '@/data/supabase/client';
import { SupabaseDocumentStore } from '@/data/supabase/SupabaseDocumentStore';
import type { PreparedFile } from '@/data/supabase/prepareFile';

import { adminClient, anonClient, newUser } from './helpers';

jest.setTimeout(180_000);

const PDF = new TextEncoder().encode('%PDF-1.4 fake contract for security test').buffer;
const docStore = (client: PactoSupabase) =>
  new SupabaseDocumentStore(client, async (): Promise<PreparedFile> => ({ bytes: PDF.slice(0), mimeType: 'application/pdf', ext: 'pdf' }), () => randomUUID());
const file = (name: string) => ({ name, uri: `file:///${name}`, mimeType: 'application/pdf', size: 100 });

type Any = Record<string, unknown>;
type Loose = {
  from: (t: string) => {
    select: (c: string) => { eq: (k: string, v: unknown) => PromiseLike<{ data: Any[] | null; error: { code?: string; message: string } | null }> };
    insert: (row: Any) => { select: (c: string) => PromiseLike<{ data: Any[] | null; error: { code?: string; message: string } | null }> };
    update: (row: Any) => { eq: (k: string, v: unknown) => { select: (c: string) => PromiseLike<{ data: Any[] | null; error: { code?: string; message: string } | null }> } };
    delete: () => { eq: (k: string, v: unknown) => { select: (c: string) => PromiseLike<{ data: Any[] | null; error: { code?: string; message: string } | null }> } };
  };
  rpc: (fn: string, args: Any) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
const loose = (c: unknown) => c as Loose;

/** A의 데이터 한 벌: 계약·결제·묶음·반환·날짜·이벤트·계약별 알림 설정·금액 변경·문서 */
async function seed() {
  const a = await newUser('sec-a');
  const b = await newUser('sec-b');
  const ca = loose(a.client);
  const saved = await ca.rpc('save_contract', {
    p_contract: { title: '보안 점검 임대차', category: 'real_estate', contract_kind: 'lease', deposit_amount: 10_000_000, user_party_role: 'lessee', user_party_relation: 'self' },
    p_funds: [{ key: 'dep', kind: 'deposit', label: '보증금', total_amount: 10_000_000 }],
    p_payments: [
      { kind: 'rent', label: '월세', frequency: 'monthly', day_of_month: 25, starts_on: '2026-10-25', amount: 500_000, direction: 'expense' },
      { kind: 'balance_payment', label: '보증금', frequency: 'one_time', starts_on: '2026-10-10', amount: 10_000_000, direction: 'expense', money_nature: 'refundable_deposit', direction_basis: 'role', fund_key: 'dep' },
    ],
  });
  if (saved.error) throw new Error(saved.error.message);
  const contractId = saved.data as string;
  const admin = loose(adminClient());
  const payment = (await admin.from('contract_payments').select('id').eq('contract_id', contractId)).data![0].id as string;
  const fund = (await admin.from('contract_funds').select('id').eq('contract_id', contractId)).data![0].id as string;
  const must = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const r = await p;
    if (r.error) throw new Error(r.error.message);
  };
  await must(ca.from('contract_dates').insert({ contract_id: contractId, label: '입주일', date: '2026-11-01' }).select('id'));
  await must(ca.from('contract_events').insert({ contract_id: contractId, title: '점검', event_date: '2026-11-02', event_type: 'custom' }).select('id'));
  await must(ca.from('fund_refunds').insert({ fund_id: fund, amount: 1_000, refunded_on: '2026-10-11' }).select('id'));
  await must(ca.from('contract_payment_changes').insert({ payment_id: payment, effective_from: '2027-01-25', amount: 550_000 }).select('id'));
  await must(ca.from('contract_notification_overrides').insert({ contract_id: contractId, categories: {} }).select('contract_id'));
  const doc = await docStore(a.client).upload(file('보안점검.pdf'), { contractId });
  return { a, b, contractId, payment, fund, doc };
}

/** user_id 열로 A의 행을 찾는 테이블 (profiles는 id) */
const USER_TABLES = [
  'contracts',
  'contract_payments',
  'contract_funds',
  'fund_refunds',
  'contract_dates',
  'contract_events',
  'contract_payment_changes',
  'contract_notification_overrides',
  'contract_documents',
  'notification_preferences',
  'scheduled_notifications',
  'push_tokens',
  'analysis_jobs',
  'document_derivatives',
  'document_sensitive_regions',
  'notification_deliveries',
  'notification_plan_queue',
] as const;

describe('Step 35 — 계정 간 접근 차단 (A/B)', () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeAll(async () => {
    s = await seed();
  });

  test('B는 A의 행을 어떤 테이블에서도 읽을 수 없다 (전체 조회 0건)', async () => {
    const admin = loose(adminClient());
    const cb = loose(s.b.client);
    const seeded: string[] = [];
    for (const t of USER_TABLES) {
      const own = (await admin.from(t).select('*').eq('user_id', s.a.user.id)).data ?? [];
      if (own.length) seeded.push(t);
      const seen = await cb.from(t).select('*').eq('user_id', s.a.user.id);
      expect([t, seen.data ?? []]).toEqual([t, []]);
    }
    // 핵심 테이블은 실제로 A의 행이 있는 상태에서 확인했다
    expect(seeded).toEqual(expect.arrayContaining(['contracts', 'contract_payments', 'contract_funds', 'fund_refunds', 'contract_dates', 'contract_events', 'contract_payment_changes', 'contract_notification_overrides', 'contract_documents']));
    expect((await cb.from('profiles').select('*').eq('id', s.a.user.id)).data).toEqual([]);
  });

  test('B는 A의 행을 수정·삭제할 수 없다 (0건 처리, A의 행 그대로)', async () => {
    const admin = loose(adminClient());
    const cb = loose(s.b.client);
    const targets: [string, string, Any][] = [
      ['contracts', s.contractId, { title: '탈취' }],
      ['contract_payments', s.payment, { amount: 1 }],
      ['contract_funds', s.fund, { label: '탈취' }],
      ['contract_documents', s.doc.id, { original_filename: 'x.pdf' }],
    ];
    for (const [t, id, patch] of targets) {
      const up = await cb.from(t).update(patch).eq('id', id).select('id');
      expect([t, up.data ?? []]).toEqual([t, []]);
      const del = await cb.from(t).delete().eq('id', id).select('id');
      expect([t, del.data ?? []]).toEqual([t, []]);
      expect([t, (await admin.from(t).select('id').eq('id', id)).data]).toEqual([t, [{ id }]]);
    }
    // user_id로 지우기·소유자 바꾸기 시도도 0건
    for (const t of ['contract_dates', 'contract_events', 'fund_refunds', 'contract_notification_overrides', 'contract_payment_changes']) {
      const up = await cb.from(t).update({ user_id: s.b.user.id }).eq('user_id', s.a.user.id).select('user_id');
      expect([t, up.data ?? []]).toEqual([t, []]);
      const del = await cb.from(t).delete().eq('user_id', s.a.user.id).select('user_id');
      expect([t, del.data ?? []]).toEqual([t, []]);
      expect([t, ((await admin.from(t).select('user_id').eq('user_id', s.a.user.id)).data ?? []).length > 0]).toEqual([t, true]);
    }
    const prof = await cb.from('profiles').update({ display_name: '탈취' }).eq('id', s.a.user.id).select('id');
    expect(prof.data ?? []).toEqual([]);
  });

  test('B는 A의 계약·결제·묶음에 연결된 행을 만들 수 없고, A 명의로 행을 만들 수 없다', async () => {
    const cb = loose(s.b.client);
    const attempts: [string, Any][] = [
      ['contracts', { user_id: s.a.user.id, title: '가짜', category: 'other' }],
      ['contract_payments', { contract_id: s.contractId, kind: 'other', label: '가짜', frequency: 'one_time', starts_on: '2026-10-10', amount: 1 }],
      ['contract_funds', { contract_id: s.contractId, kind: 'deposit', label: '가짜' }],
      ['fund_refunds', { fund_id: s.fund, amount: 1, refunded_on: '2026-10-11' }],
      ['contract_dates', { contract_id: s.contractId, label: '가짜', date: '2026-11-01' }],
      ['contract_events', { contract_id: s.contractId, title: '가짜', event_date: '2026-11-01', event_type: 'custom' }],
      ['contract_payment_changes', { payment_id: s.payment, effective_from: '2027-02-25', amount: 1 }],
      ['contract_notification_overrides', { contract_id: s.contractId, categories: {} }],
      ['contract_documents', { contract_id: s.contractId, storage_path: `${s.b.user.id}/${randomUUID()}.pdf`, mime_type: 'application/pdf', size_bytes: 1, original_filename: 'x.pdf' }],
      ['notification_preferences', { user_id: s.a.user.id }],
    ];
    for (const [t, row] of attempts) {
      const r = await cb.from(t).insert(row).select('*');
      expect([t, r.data ?? null, r.error?.code]).toEqual([t, null, '42501']);
    }
  });

  test('로그인하지 않은 요청은 어떤 사용자 데이터도 읽지 못한다', async () => {
    const anon = loose(anonClient());
    for (const t of [...USER_TABLES, 'profiles']) {
      const r = await anon.from(t).select('*').eq(t === 'profiles' ? 'id' : 'user_id', s.a.user.id);
      expect([t, r.data ?? []]).toEqual([t, []]);
    }
    const st = await anonClient().storage.from('contract-files').download(s.doc.storagePath!);
    expect(st.data).toBeNull();
  });

  test('Storage: B는 A의 파일을 목록·다운로드·서명 URL·덮어쓰기·삭제할 수 없고, 경로 조작도 막힌다', async () => {
    const bucket = s.b.client.storage.from('contract-files');
    expect((await bucket.list(s.a.user.id)).data ?? []).toEqual([]);
    expect((await bucket.download(s.doc.storagePath!)).data).toBeNull();
    expect((await bucket.createSignedUrl(s.doc.storagePath!, 60)).data).toBeNull();
    expect((await bucket.upload(s.doc.storagePath!, PDF, { contentType: 'application/pdf', upsert: true })).error).not.toBeNull();
    expect((await bucket.upload(`${s.b.user.id}/../${s.a.user.id}/evil.pdf`, PDF, { contentType: 'application/pdf' })).error).not.toBeNull();
    await bucket.remove([s.doc.storagePath!]);
    const still = await adminClient().storage.from('contract-files').list(s.a.user.id);
    expect((still.data ?? []).map((o) => o.name)).toContain(s.doc.storagePath!.split('/')[1]);
    // 버킷 공개 아님 — 공개 URL로 받을 수 없음
    const pub = bucket.getPublicUrl(s.doc.storagePath!).data.publicUrl;
    expect((await fetch(pub)).ok).toBe(false);
  });

  test('서버 함수: 로그인 없이 401 · 남의 문서 id로 보호 처리·분석 불가', async () => {
    const anon = anonClient();
    const noAuth = await anon.functions.invoke('protect-document', { body: { documentId: s.doc.id } });
    expect((noAuth.error as { context?: { status?: number } } | null)?.context?.status).toBe(401);
    const protect = await s.b.client.functions.invoke('protect-document', { body: { documentId: s.doc.id } });
    expect((protect.error as { context?: { status?: number } } | null)?.context?.status).toBe(404);
    // 분석: B가 A의 문서 id를 보내도 A의 파일을 읽지 않는다 (동의 전이면 403, 동의 후엔 not_found 류)
    const analyze = await s.b.client.functions.invoke('analyze-contract', { body: { documentIds: [s.doc.id] } });
    expect(analyze.data ?? null).toBeNull();
    expect([401, 403, 404, 409, 422, 503]).toContain((analyze.error as { context?: { status?: number } } | null)?.context?.status);
  });

  test('문서 기록의 파일 경로는 본인 폴더만 — 남의 파일 경로를 기록할 수 없다 (서버 함수가 대신 읽거나 지우지 않게)', async () => {
    const cb = loose(s.b.client);
    const forged = await cb
      .from('contract_documents')
      .insert({ storage_path: s.doc.storagePath, mime_type: 'application/pdf', size_bytes: 1, original_filename: 'forged.pdf' })
      .select('id');
    expect(forged.data ?? null).toBeNull();
    expect(forged.error).not.toBeNull();
    // 경로 조작 형태도 거부
    for (const p of [`${s.b.user.id}/../${s.a.user.id}/x.pdf`, `/${s.a.user.id}/x.pdf`, `${s.b.user.id}`, `${s.b.user.id}/`]) {
      const r = await cb.from('contract_documents').insert({ storage_path: p, mime_type: 'application/pdf', size_bytes: 1, original_filename: 'x.pdf' }).select('id');
      expect([p, r.data ?? null]).toEqual([p, null]);
    }
    // 자기 문서의 경로를 나중에 남의 경로로 바꾸는 것도 거부
    const own = await docStore(s.b.client).upload(file('내것.pdf'));
    const moved = await cb.from('contract_documents').update({ storage_path: s.doc.storagePath }).eq('id', own.id).select('id');
    expect(moved.data ?? null).toBeNull();
    expect(moved.error).not.toBeNull();
    const still = (await loose(adminClient()).from('contract_documents').select('storage_path').eq('id', own.id)).data;
    expect(still).toEqual([{ storage_path: own.storagePath }]);
  });

  test('로그아웃 후에는 같은 클라이언트로 데이터를 읽을 수 없다', async () => {
    const u = await newUser('sec-out');
    await docStore(u.client).upload(file('로그아웃.pdf'));
    expect(((await loose(u.client).from('contract_documents').select('id').eq('user_id', u.user.id)).data ?? []).length).toBe(1);
    await u.client.auth.signOut();
    expect((await u.client.auth.getSession()).data.session).toBeNull();
    expect((await loose(u.client).from('contract_documents').select('id').eq('user_id', u.user.id)).data ?? []).toEqual([]);
  });
});
