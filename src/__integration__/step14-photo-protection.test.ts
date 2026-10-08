/*
 * 사진 계약서 민감정보 보호 (Edge Function protect-document · Deno · 가짜 CLOVA) — 모든 값은 가짜
 * A~D 탐지·가림·protected / H 민감정보 없음(OCR 1회) / 가리기 해제(OCR 다시 안 함) / L 원본 불변 / M 삭제 정리 / N OCR 서버 오류
 * 준비: supabase/functions/.env 에 CLOVA_OCR_URL=http://host.docker.internal:54399/ocr, CLOVA_OCR_SECRET=local-test-secret
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { EMPTY_DRAFT } from '@/data/draft';
import type { PactoSupabase } from '@/data/supabase/client';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { SupabaseDocumentStore } from '@/data/supabase/SupabaseDocumentStore';
import type { PreparedFile } from '@/data/supabase/prepareFile';

import { startFakeClova, type FakeClova } from './fakeClova';
import { adminClient, newUser, testFetch } from './helpers';

jest.setTimeout(180_000);

const FIX = path.resolve(__dirname, '../__fixtures__/photo');
const LEASE = new Uint8Array(fs.readFileSync(path.join(FIX, 'lease.jpg')));
const PLAIN = new Uint8Array(fs.readFileSync(path.join(FIX, 'plain.jpg')));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const stores = (client: PactoSupabase, bytes: Uint8Array) => ({
  docs: new SupabaseDocumentStore(client, async (): Promise<PreparedFile> => ({ bytes: bytes.slice().buffer, mimeType: 'image/jpeg', ext: 'jpg' }), () => randomUUID()),
  repo: new SupabaseContractRepository(client, () => '2026-10-08'),
});
const file = (name: string) => ({ name, uri: `file:///${name}`, mimeType: 'image/jpeg', size: 100 });
const download = async (url: string) => new Uint8Array(await (await testFetch(url)).arrayBuffer());

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

describe('Step 14 — 사진 계약서 보호 (로컬 Edge)', () => {
  test('A~D·K·L: 주민 2 · 전화 2 · 계좌 3 · 카드 1 → 보호본(1600px JPEG) · OCR 2회 · 원본 그대로 · DB에는 가린 표시값만', async () => {
    const a = await newUser('photo');
    const { docs } = stores(a.client, LEASE);
    const up = await docs.upload(file('임대차.jpg'));
    const before = clova.calls;
    expect(await docs.protect(up.id)).toEqual({ status: 'protected', detail: null });
    expect(clova.calls - before).toBe(2);

    const prot = (await docs.getProtection([up.id]))[up.id];
    expect(prot.protectedViewPath).toBe(`${a.user.id}/${up.id}.protected_view.jpg`);
    const count = (t: string) => prot.regions.filter((r) => r.type === t).length;
    expect([count('resident_registration_number'), count('phone'), count('bank_account'), count('credit_card')]).toEqual([2, 2, 3, 1]);

    const view = await download(await docs.openUrl({ ...up, protection: prot }, 'protected_view'));
    expect([view[0], view[1]]).toEqual([0xff, 0xd8]);
    expect(view.length).toBeLessThan(LEASE.length);
    // L. 원본은 업로드한 그대로
    expect(sha(await download(await docs.openUrl(up, 'original')))).toBe(sha(LEASE));

    const { data: rows } = await adminClient().from('document_sensitive_regions').select('*').eq('document_id', up.id);
    expect(rows!.every((r) => r.source === 'ocr')).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/1234567|2345678|1234-5678|9876-5432|789012|321098|678901|9012-3456/);
  });

  test('가리기 해제 → OCR 다시 안 함 · 보호본 다시 그림 · 해제한 항목만 보임', async () => {
    const a = await newUser('photo-unmask');
    const { docs } = stores(a.client, LEASE);
    const up = await docs.upload(file('임대차.jpg'));
    await docs.protect(up.id);
    const phone = (await docs.getProtection([up.id]))[up.id].regions.find((r) => r.type === 'phone')!;
    const before = clova.calls;
    expect(await docs.protect(up.id, [{ id: phone.id, state: 'unmasked' }])).toEqual({ status: 'protected', detail: null });
    expect(clova.calls).toBe(before);
    const prot = (await docs.getProtection([up.id]))[up.id];
    // 영역 기록은 다시 저장되며 id가 바뀐다 — 같은 항목(키)이 해제 상태로 남아 있는지
    expect(prot.regions.filter((r) => r.state === 'unmasked')).toEqual([expect.objectContaining({ type: 'phone', maskedPreview: phone.maskedPreview, userConfirmed: true })]);
    expect(prot.regions.filter((r) => r.state === 'masked')).toHaveLength(7);
  });

  test('H: 민감정보 없는 사진 → no_sensitive_data · OCR 1회 · 보호본 없음', async () => {
    const a = await newUser('photo-plain');
    const { docs } = stores(a.client, PLAIN);
    const up = await docs.upload(file('헬스장.jpg'));
    const before = clova.calls;
    expect(await docs.protect(up.id)).toEqual({ status: 'no_sensitive_data', detail: null });
    expect(clova.calls - before).toBe(1);
    expect((await docs.getProtection([up.id]))[up.id]).toMatchObject({ protectedViewPath: null, regions: [] });
  });

  test('N: CLOVA 서버 오류 → 1번만 다시 시도 → failed (사유 코드만, 보호됨 아님)', async () => {
    const a = await newUser('photo-fail');
    const { docs } = stores(a.client, LEASE);
    const up = await docs.upload(file('임대차.jpg'));
    clova.failWith = 503;
    const before = clova.calls;
    expect(await docs.protect(up.id)).toEqual({ status: 'failed', detail: 'ocr_server' });
    expect(clova.calls - before).toBe(2);
    expect((await docs.getProtection([up.id]))[up.id]).toMatchObject({ status: 'failed', protectedViewPath: null });
  });

  test('M: 계약 삭제 → 원본·보호본·민감정보 기록·파생본 기록 정리', async () => {
    const a = await newUser('photo-delete');
    const { docs, repo } = stores(a.client, LEASE);
    const up = await docs.upload(file('임대차.jpg'));
    await docs.protect(up.id);
    const record = await repo.create({ draft: { ...EMPTY_DRAFT, title: '임대차' }, source: 'upload', documents: [{ ...up, pageCount: null }], aiChecks: [] });
    const admin = adminClient();
    const listed = async () => ((await admin.storage.from('contract-files').list(a.user.id)).data ?? []).map((o) => o.name);
    expect((await listed()).sort()).toEqual([`${up.id}.jpg`, `${up.id}.protected_view.jpg`].sort());
    await repo.remove(record.contract.id);
    expect(await listed()).toEqual([]);
    for (const table of ['contract_documents', 'document_sensitive_regions', 'document_derivatives'] as const) {
      const { count } = await admin.from(table).select('id', { count: 'exact', head: true }).eq('user_id', a.user.id);
      expect(count).toBe(0);
    }
  });
});
