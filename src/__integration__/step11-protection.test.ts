/* 민감정보 보호 (Edge Function protect-document) — 원본 보존 · 실제 제거된 보호본 · 권한 · 삭제 정리 (테스트 D·E) */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { EMPTY_DRAFT } from '@/data/draft';
import type { PactoSupabase } from '@/data/supabase/client';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { SupabaseDocumentStore } from '@/data/supabase/SupabaseDocumentStore';
import type { PreparedFile } from '@/data/supabase/prepareFile';

import { adminClient, newUser, testFetch } from './helpers';

jest.setTimeout(120_000);

const ROOT = path.resolve(__dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pacto-protect-'));
const cli = (...args: string[]) => execFileSync('node', ['--experimental-strip-types', '--no-warnings', path.join(ROOT, 'tests/protection/cli.ts'), ...args], { cwd: ROOT, encoding: 'utf8' });
function fixture(kind: 'employment' | 'rental' | 'scan' | 'cmap' | 'repeated' | 'type3'): Uint8Array {
  const out = path.join(tmp, `${kind}.pdf`);
  if (!fs.existsSync(out)) cli('make', kind, out);
  return new Uint8Array(fs.readFileSync(out));
}
/** pdf.js(별도 프로세스)로 추출한 텍스트 */
function textOf(bytes: Uint8Array): string {
  const f = path.join(tmp, `${randomUUID()}.pdf`);
  fs.writeFileSync(f, bytes);
  return cli('text', f).replace(/\s+/g, '');
}

const stores = (client: PactoSupabase, bytes: Uint8Array, mime: 'application/pdf' | 'image/jpeg' = 'application/pdf') => ({
  docs: new SupabaseDocumentStore(client, async (): Promise<PreparedFile> => ({ bytes: bytes.slice().buffer, mimeType: mime, ext: mime === 'application/pdf' ? 'pdf' : 'jpg' }), () => randomUUID()),
  repo: new SupabaseContractRepository(client, () => '2026-10-07'),
});
const file = (name: string, mimeType = 'application/pdf') => ({ name, uri: `file:///${name}`, mimeType, size: 100 });
const download = async (url: string) => new Uint8Array(await (await testFetch(url)).arrayBuffer());

describe('Step 11 — 민감정보 보호', () => {
  test('근로계약서: 보호 → 기본은 보호본(원문 제거) · 원본은 그대로 · DB에는 가린 표시값만', async () => {
    const a = await newUser('protect');
    const original = fixture('employment');
    const { docs } = stores(a.client, original);
    const up = await docs.upload(file('근로계약서.pdf'));

    expect(await docs.protect(up.id)).toEqual({ status: 'protected', detail: null });
    const prot = (await docs.getProtection([up.id]))[up.id];
    expect(prot.status).toBe('protected');
    expect(prot.protectedViewPath).toBe(`${a.user.id}/${up.id}.protected_view.pdf`);
    expect(prot.regions.map((r) => [r.type, r.state, r.maskedPreview, r.confidence])).toEqual([
      ['resident_registration_number', 'masked', '901225-1******', 'high'],
      ['phone', 'masked', '010-****-5678', 'high'],
      ['email', 'masked', 'mi****@example.com', 'high'],
    ]);

    // 보호본: 원문이 추출되지 않음 (F) · 계약 정보는 그대로
    const view = textOf(await download(await docs.openUrl({ ...up, protection: prot }, 'protected_view')));
    expect(view).not.toContain('1234567');
    expect(view).not.toContain('1234-5678');
    expect(view).toContain('901225-1');
    expect(view).toContain('3,600,000원');

    // D. 원본은 업로드한 그대로
    expect(await download(await docs.openUrl(up, 'original'))).toEqual(original);

    // DB 어디에도 원문 값 없음
    const admin = adminClient();
    const { data: rows } = await admin.from('document_sensitive_regions').select('*').eq('document_id', up.id);
    expect(JSON.stringify(rows)).not.toMatch(/1234567|1234-5678|minjun@/);
  });

  test.each([
    ['cmap', '한글 CMap 글꼴(UniKS-UCS2-H) — 스캔본으로 잘못 분류하지 않음', ['1234567', '010-1234-5678', '4111-1111-1111-1111']],
    ['repeated', '반복 숫자(카드·전화가 1111·1234 공유) — 오탐 없이 보호', ['4111111111111111', '5500000000081111', '01022221111', '01012345678', '01012349876']],
    ['type3', 'Chrome형 Type3 글꼴 — 보호', ['4111111111111111', '01012345678']],
  ] as const)('%s: %s (Edge Function · Deno)', async (kind, _name, secrets) => {
    const a = await newUser(`protect-${kind}`);
    const { docs } = stores(a.client, fixture(kind));
    const up = await docs.upload(file(`${kind}.pdf`));
    expect(await docs.protect(up.id)).toEqual({ status: 'protected', detail: null });
    const prot = (await docs.getProtection([up.id]))[up.id];
    const view = textOf(await download(await docs.openUrl({ ...up, protection: prot }, 'protected_view'))).replace(/[-.]/g, '');
    for (const s of secrets) expect(view).not.toContain(s.replace(/[-.]/g, ''));
  });

  test('가리기 해제 → 보호본 다시 생성 (해제한 값만 표시, 사용자 확인으로 기록)', async () => {
    const a = await newUser('unmask');
    const { docs } = stores(a.client, fixture('employment'));
    const up = await docs.upload(file('근로계약서.pdf'));
    await docs.protect(up.id);
    const phone = (await docs.getProtection([up.id]))[up.id].regions.find((r) => r.type === 'phone')!;
    expect(await docs.protect(up.id, [{ id: phone.id, state: 'unmasked' }])).toMatchObject({ status: 'protected' });
    const prot = (await docs.getProtection([up.id]))[up.id];
    expect(prot.regions.find((r) => r.type === 'phone')).toMatchObject({ state: 'unmasked', userConfirmed: true });
    const view = textOf(await download(await docs.openUrl({ ...up, protection: prot }, 'protected_view')));
    expect(view).toContain('010-1234-5678');
    expect(view).not.toContain('1234567');
  });

  test('스캔 PDF는 unsupported_scan, 해석할 수 없는 사진 파일은 failed (보호본·영역 없음 — 보호됨으로 표시하지 않음)', async () => {
    const a = await newUser('scan');
    const photo = stores(a.client, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'image/jpeg').docs;
    const p = await photo.upload(file('계약서.jpg', 'image/jpeg'));
    expect(await photo.protect(p.id)).toEqual({ status: 'failed', detail: 'image_format' });
    const scan = stores(a.client, fixture('scan')).docs;
    const s = await scan.upload(file('스캔.pdf'));
    expect(await scan.protect(s.id)).toEqual({ status: 'unsupported_scan', detail: 'scanned_pages' });
    const prot = await scan.getProtection([p.id, s.id]);
    expect(prot[p.id]).toMatchObject({ status: 'failed', protectedViewPath: null, regions: [] });
    expect(prot[s.id]).toMatchObject({ status: 'unsupported_scan', protectedViewPath: null, regions: [] });
  });

  test('다른 계정은 남의 문서를 보호 처리·조회할 수 없고, 사용자는 보호 상태를 직접 바꿀 수 없다', async () => {
    const a = await newUser('owner');
    const b = await newUser('intruder');
    const { docs } = stores(a.client, fixture('employment'));
    const up = await docs.upload(file('근로계약서.pdf'));
    await docs.protect(up.id);
    const other = stores(b.client, new Uint8Array()).docs;
    expect(await other.protect(up.id)).toEqual({ status: 'failed', detail: 'request_failed' });
    expect(await other.getProtection([up.id])).toEqual({});
    // 보호본 파일도 남이 열 수 없음
    const { error } = await b.client.storage.from('contract-files').createSignedUrl(`${a.user.id}/${up.id}.protected_view.pdf`, 60);
    expect(error).not.toBeNull();
    // 본인도 상태를 "보호됨"으로 위조할 수 없음 (스캔본을 보호됨으로)
    const scan = stores(a.client, fixture('scan')).docs;
    const s = await scan.upload(file('스캔.pdf'));
    await scan.protect(s.id);
    await a.client.from('contract_documents').update({ protection_status: 'protected' }).eq('id', s.id);
    expect((await scan.getProtection([s.id]))[s.id].status).toBe('unsupported_scan');
  });

  test('E. 계약 삭제 → 원본·보호본·민감정보 기록·AI 결과까지 정리 (고아 파일 없음)', async () => {
    const a = await newUser('cleanup');
    const { docs, repo } = stores(a.client, fixture('employment'));
    const up = await docs.upload(file('근로계약서.pdf'));
    await docs.protect(up.id);
    const record = await repo.create({ draft: { ...EMPTY_DRAFT, title: '근로계약' }, source: 'upload', documents: [{ ...up, pageCount: null }], aiChecks: [] });
    expect(record.documents[0].protection?.status).toBe('protected');
    const admin = adminClient();
    const listed = async () => ((await admin.storage.from('contract-files').list(a.user.id)).data ?? []).map((o) => o.name);
    expect((await listed()).sort()).toEqual([`${up.id}.pdf`, `${up.id}.protected_view.pdf`].sort());

    await repo.remove(record.contract.id);
    expect(await listed()).toEqual([]);
    for (const table of ['contract_documents', 'document_sensitive_regions', 'document_derivatives'] as const) {
      const { count } = await admin.from(table).select('id', { count: 'exact', head: true }).eq('user_id', a.user.id);
      expect(count).toBe(0);
    }
  });

  test('E. 저장하지 않고 취소한 업로드도 원본·보호본 함께 정리', async () => {
    const a = await newUser('discard');
    const { docs } = stores(a.client, fixture('rental'));
    const up = await docs.upload(file('렌탈.pdf'));
    expect((await docs.protect(up.id)).status).toBe('protected');
    await docs.discard([up.id]);
    const admin = adminClient();
    expect((await admin.storage.from('contract-files').list(a.user.id)).data).toEqual([]);
    const { count } = await admin.from('document_sensitive_regions').select('id', { count: 'exact', head: true }).eq('user_id', a.user.id);
    expect(count).toBe(0);
  });
});
