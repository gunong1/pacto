/*
 * 스캔 PDF 민감정보 보호 (Edge Function protect-document → protect-scan-page worker · Deno · 가짜 CLOVA) — 모든 값은 가짜
 * 스캔 페이지: 페이지 이미지를 worker로 보내 OCR → 가린 이미지 한 장으로 새 페이지 (숨은 OCR 글자층 제거)
 * worker는 서버 내부 인증(service_role)으로만 호출 가능 — 앱(사용자 토큰·anon 키)으로는 401
 * 준비: supabase/functions/.env 에 CLOVA_OCR_URL=http://host.docker.internal:54399/ocr, CLOVA_OCR_SECRET=local-test-secret
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PactoSupabase } from '@/data/supabase/client';
import { SupabaseDocumentStore } from '@/data/supabase/SupabaseDocumentStore';
import type { PreparedFile } from '@/data/supabase/prepareFile';

import { startFakeClova, type FakeClova } from './fakeClova';
import { adminClient, localEnv, newUser, testFetch } from './helpers';

jest.setTimeout(240_000);

const ROOT = path.resolve(__dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pacto-scan-'));
const cli = (...args: string[]) => execFileSync('node', ['--experimental-strip-types', '--no-warnings', path.join(ROOT, 'tests/protection/cli.ts'), ...args], { cwd: ROOT, encoding: 'utf8' });
function fixture(kind: 'scan-lease' | 'scan-mixed' | 'scan-ccitt'): Uint8Array {
  const out = path.join(tmp, `${kind}.pdf`);
  if (!fs.existsSync(out)) cli('make', kind, out);
  return new Uint8Array(fs.readFileSync(out));
}
const textOf = (bytes: Uint8Array) => {
  const f = path.join(tmp, `${randomUUID()}.pdf`);
  fs.writeFileSync(f, bytes);
  return cli('text', f).replace(/\s+/g, '');
};
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const store = (client: PactoSupabase, bytes: Uint8Array) =>
  new SupabaseDocumentStore(client, async (): Promise<PreparedFile> => ({ bytes: bytes.slice().buffer, mimeType: 'application/pdf', ext: 'pdf' }), () => randomUUID());
const file = (name: string) => ({ name, uri: `file:///${name}`, mimeType: 'application/pdf', size: 100 });
const download = async (url: string) => new Uint8Array(await (await testFetch(url)).arrayBuffer());
const SECRETS = /800101-?1234567|950505-?2345678|1234567|2345678|901225-?1234567/;

let clova: FakeClova;
beforeAll(async () => {
  clova = await startFakeClova();
});
afterAll(async () => {
  await clova.close();
});
beforeEach(() => {
  clova.failWith = null;
  clova.delayMs = 0;
});

describe('Step 15 — 스캔 PDF 보호 (로컬 Edge)', () => {
  test('스캔 1쪽(숨은 OCR 글자층 포함) → protected · OCR 2회 · 보호본 텍스트 추출에 주민번호 없음 · 원본 그대로 · 페이지별 상태 저장', async () => {
    const a = await newUser('scan');
    const original = fixture('scan-lease');
    expect(textOf(original)).toContain('800101-1234567'); // fixture: 원본에는 숨은 글자층
    const docs = store(a.client, original);
    const up = await docs.upload(file('스캔계약서.pdf'));
    const before = clova.calls;
    expect(await docs.protect(up.id)).toEqual({ status: 'protected', detail: null });
    expect(clova.calls - before).toBe(2);

    const prot = (await docs.getProtection([up.id]))[up.id];
    expect(prot.protectedViewPath).toBe(`${a.user.id}/${up.id}.protected_view.pdf`);
    expect(prot.pages).toEqual([{ page: 1, kind: 'scan', status: 'protected' }]);
    expect(prot.regions.filter((r) => r.type === 'resident_registration_number')).toHaveLength(2);
    const view = await download(await docs.openUrl({ ...up, protection: prot }, 'protected_view'));
    expect(String.fromCharCode(...view.subarray(0, 5))).toBe('%PDF-');
    expect(textOf(view)).not.toMatch(SECRETS);
    expect(Buffer.from(view).toString('latin1')).not.toMatch(SECRETS);
    expect(sha(await download(await docs.openUrl(up, 'original')))).toBe(sha(original));

    const { data: rows } = await adminClient().from('document_sensitive_regions').select('*').eq('document_id', up.id);
    expect(rows!.every((r) => r.source === 'ocr' && r.page_number === 1)).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(SECRETS);
    const { data: docRow } = await adminClient().from('contract_documents').select('protection_pages').eq('id', up.id).single();
    expect(docRow!.protection_pages).toEqual([{ page: 1, kind: 'scan', status: 'protected', detail: null }]);
  });

  test('혼합 A(텍스트 + 스캔) → protected · 가리기 해제 시 OCR 다시 안 함 · 해제한 항목만 보임', async () => {
    const a = await newUser('scan-mixed');
    const docs = store(a.client, fixture('scan-mixed'));
    const up = await docs.upload(file('혼합.pdf'));
    expect(await docs.protect(up.id)).toEqual({ status: 'protected', detail: null });
    let prot = (await docs.getProtection([up.id]))[up.id];
    expect(prot.pages).toEqual([
      { page: 1, kind: 'text', status: 'protected' },
      { page: 2, kind: 'scan', status: 'protected' },
    ]);
    const { data: rows } = await adminClient().from('document_sensitive_regions').select('page_number, source').eq('document_id', up.id);
    expect(new Set(rows!.map((r) => `${r.page_number}:${r.source}`))).toEqual(new Set(['1:pattern', '2:ocr']));
    const view = textOf(await download(await docs.openUrl({ ...up, protection: prot }, 'protected_view')));
    expect(view).toContain('근로계약서');
    expect(view).not.toMatch(SECRETS);

    const phone = prot.regions.find((r) => r.page === 2 && r.type === 'phone')!;
    const before = clova.calls;
    expect(await docs.protect(up.id, [{ id: phone.id, state: 'unmasked' }])).toEqual({ status: 'protected', detail: null });
    expect(clova.calls).toBe(before);
    prot = (await docs.getProtection([up.id]))[up.id];
    expect(prot.regions.filter((r) => r.state === 'unmasked')).toEqual([expect.objectContaining({ page: 2, type: 'phone', maskedPreview: phone.maskedPreview })]);
    expect(prot.regions.filter((r) => r.page === 2 && r.type === 'resident_registration_number' && r.state === 'masked')).toHaveLength(2);
  });

  test('특수 형식(CCITT) 스캔 → unsupported_scan · OCR 호출 없음 · 보호본 없음', async () => {
    const a = await newUser('scan-ccitt');
    const docs = store(a.client, fixture('scan-ccitt'));
    const up = await docs.upload(file('팩스.pdf'));
    const before = clova.calls;
    expect(await docs.protect(up.id)).toEqual({ status: 'unsupported_scan', detail: 'scan_format' });
    expect(clova.calls).toBe(before);
    expect((await docs.getProtection([up.id]))[up.id]).toMatchObject({ protectedViewPath: null, regions: [], pages: [{ page: 1, kind: 'unsupported', status: 'unsupported_scan' }] });
  });

  test('CLOVA 서버 오류 → failed (스캔 페이지 상태 failed, 보호본 없음)', async () => {
    const a = await newUser('scan-fail');
    const docs = store(a.client, fixture('scan-lease'));
    const up = await docs.upload(file('스캔.pdf'));
    clova.failWith = 503;
    expect(await docs.protect(up.id)).toEqual({ status: 'failed', detail: 'ocr_server' });
    expect((await docs.getProtection([up.id]))[up.id]).toMatchObject({ protectedViewPath: null, pages: [{ page: 1, kind: 'scan', status: 'failed' }] });
  });

  test('protect-scan-page는 앱에서 직접 호출할 수 없다 (사용자 토큰·anon 키 → 401, OCR 호출 없음)', async () => {
    const a = await newUser('scan-direct');
    const { data } = await a.client.auth.getSession();
    const env = localEnv();
    const before = clova.calls;
    for (const token of [data.session!.access_token, env.ANON_KEY]) {
      const res = await testFetch(`${env.API_URL}/functions/v1/protect-scan-page`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, apikey: env.ANON_KEY, 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(16),
      });
      expect(res.status).toBe(401);
    }
    const { error } = await a.client.functions.invoke('protect-scan-page', { body: new Uint8Array(16) });
    expect(error).not.toBeNull();
    expect(clova.calls).toBe(before);
  });
});
