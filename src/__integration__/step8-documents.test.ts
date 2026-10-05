import { randomUUID } from 'node:crypto';

import { EMPTY_DRAFT } from '@/data/draft';
import type { PactoSupabase } from '@/data/supabase/client';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { SupabaseDocumentStore } from '@/data/supabase/SupabaseDocumentStore';
import type { PreparedFile } from '@/data/supabase/prepareFile';

import { adminClient, newUser, testFetch } from './helpers';

const PDF = new TextEncoder().encode('%PDF-1.4\n% PACTO 테스트 계약서\n');
const fakePrepare = async (f: { mimeType: string }): Promise<PreparedFile> =>
  f.mimeType === 'application/pdf'
    ? { bytes: PDF.slice().buffer, mimeType: 'application/pdf', ext: 'pdf' }
    : { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).buffer, mimeType: 'image/jpeg', ext: 'jpg' };
const file = (name: string, mimeType = 'application/pdf') => ({ name, uri: `file:///${name}`, mimeType, size: 100 });

function stores(client: PactoSupabase) {
  return {
    docs: new SupabaseDocumentStore(client, fakePrepare, () => randomUUID()),
    repo: new SupabaseContractRepository(client, () => '2026-10-05'),
  };
}

describe('Step 8 — 계약서 원본 보관 (private Storage + Signed URL)', () => {
  test('업로드 → 계약에 연결 → Signed URL로 원본 열람 → 재로그인 후에도 유지', async () => {
    const a = await newUser('docs');
    const { docs, repo } = stores(a.client);

    const uploaded = await docs.upload(file('자동차보험.pdf'), { sortOrder: 0 });
    expect(uploaded.storagePath).toBe(`${a.user.id}/${uploaded.id}.pdf`);

    const record = await repo.create({ draft: { ...EMPTY_DRAFT, title: '자동차보험' }, source: 'upload', documents: [{ ...uploaded, pageCount: null }], aiChecks: [] });
    expect(record.documents).toHaveLength(1);
    expect(record.documents[0]).toMatchObject({ fileName: '자동차보험.pdf', storagePath: uploaded.storagePath, mimeType: 'application/pdf' });

    const url = await docs.openUrl(record.documents[0]);
    expect(url).toContain('/storage/v1/object/sign/contract-files/');
    const res = await testFetch(url);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);

    // 공개 URL로는 열 수 없음
    const publicUrl = a.client.storage.from('contract-files').getPublicUrl(uploaded.storagePath!).data.publicUrl;
    expect((await testFetch(publicUrl)).ok).toBe(false);
  });

  test('사진은 JPEG로 저장되고 파일명 확장자도 맞춰진다 (HEIC → JPEG)', async () => {
    const a = await newUser('heic');
    const { docs } = stores(a.client);
    const up = await docs.upload(file('계약서_1.heic', 'image/heic'));
    expect(up).toMatchObject({ mimeType: 'image/jpeg', fileName: '계약서_1.jpg' });
    expect(up.storagePath?.endsWith('.jpg')).toBe(true);
  });

  test('다른 계정은 남의 원본을 Signed URL·다운로드·목록으로 볼 수 없고, 남의 폴더에 올릴 수 없다', async () => {
    const a = await newUser('owner');
    const b = await newUser('intruder');
    const up = await stores(a.client).docs.upload(file('전세계약서.pdf'));

    const signed = await b.client.storage.from('contract-files').createSignedUrl(up.storagePath!, 60);
    expect(signed.data).toBeNull();
    const dl = await b.client.storage.from('contract-files').download(up.storagePath!);
    expect(dl.data).toBeNull();
    const list = await b.client.storage.from('contract-files').list(a.user.id);
    expect(list.data ?? []).toEqual([]);
    const sneak = await b.client.storage.from('contract-files').upload(`${a.user.id}/evil.pdf`, PDF, { contentType: 'application/pdf' });
    expect(sneak.error).not.toBeNull();
    // B의 문서 저장소로 A의 경로를 열어도 실패
    await expect(stores(b.client).docs.openUrl({ storagePath: up.storagePath, localUri: null })).rejects.toBeDefined();
  });

  test('저장 전 취소한 업로드는 정리되고, 계약 삭제 시 원본 파일도 삭제된다', async () => {
    const a = await newUser('cleanup');
    const { docs, repo } = stores(a.client);
    const admin = adminClient();

    const orphan = await docs.upload(file('취소.pdf'));
    await docs.discard([orphan.id]);
    expect((await admin.from('contract_documents').select('id').eq('id', orphan.id)).data).toEqual([]);
    expect((await admin.storage.from('contract-files').list(a.user.id)).data).toEqual([]);

    const kept = await docs.upload(file('렌탈.pdf'));
    const r = await repo.create({ draft: { ...EMPTY_DRAFT, title: '렌탈' }, source: 'upload', documents: [{ ...kept, pageCount: null }], aiChecks: [] });
    await docs.discard([kept.id]); // 연결된 문서는 discard로 지워지지 않음
    expect((await admin.storage.from('contract-files').list(a.user.id)).data).toHaveLength(1);

    await repo.remove(r.contract.id);
    expect((await admin.storage.from('contract-files').list(a.user.id)).data).toEqual([]);
    expect((await admin.from('contract_documents').select('id').eq('user_id', a.user.id)).data).toEqual([]);
  });

  test('저장된 계약에 원본 추가 (직접 입력 계약)', async () => {
    const a = await newUser('attach');
    const { docs, repo } = stores(a.client);
    const r = await repo.create({ draft: { ...EMPTY_DRAFT, title: '인터넷' }, source: 'manual', documents: [], aiChecks: [] });
    await docs.upload(file('인터넷약관.pdf'), { contractId: r.contract.id });
    expect((await repo.get(r.contract.id))?.documents.map((d) => d.fileName)).toEqual(['인터넷약관.pdf']);
  });
});
