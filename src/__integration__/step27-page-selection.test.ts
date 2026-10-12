/*
 * 분석 대상 페이지 선택 (Edge Function protect-document · analyze-contract · protect-scan-page · 가짜 CLOVA · mock AI) — 모든 값은 가짜
 * 실제 사례 구조: 계약서 스캔 1쪽 + 글자를 거의 읽을 수 없는 메모 스캔 1쪽 (2쪽 PDF)
 * - 선택 없음 → unreadable, 분석 거절 (protection_required)
 * - 사용자가 메모 쪽을 빼면 → 남은 쪽만 보호·검증 → 분석 성공. AI 요청은 1쪽짜리 보호본 (뺀 쪽 없음)
 * - AI 근거 쪽 번호는 원본 기준 (메모가 1쪽이고 계약서가 2쪽이면, AI가 본 1쪽 = 원본 2쪽)
 * - 원본 PDF 그대로 · 분석 기록에 제외 페이지·분석한 원본 페이지 · 선택이 바뀌면 예전 분석을 이어 쓰지 않음
 * - 모든 페이지를 빼면 → no_pages_selected · 앱은 선택을 직접 바꿀 수 없음 (서버만)
 * 준비: supabase/functions/.env 에 AI_PROVIDER=mock, CLOVA_OCR_URL=http://host.docker.internal:54399/ocr, CLOVA_OCR_SECRET=local-test-secret
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PactoSupabase } from '@/data/supabase/client';
import { SupabaseAIProvider } from '@/data/supabase/SupabaseAIProvider';
import { SupabaseDocumentStore } from '@/data/supabase/SupabaseDocumentStore';
import type { PreparedFile } from '@/data/supabase/prepareFile';

import { startFakeClova, type FakeClova } from './fakeClova';
import { adminClient, newUser, testFetch } from './helpers';

jest.setTimeout(300_000);

const ROOT = path.resolve(__dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pacto-sel-'));
const cli = (...args: string[]) => execFileSync('node', ['--experimental-strip-types', '--no-warnings', path.join(ROOT, 'tests/protection/cli.ts'), ...args], { cwd: ROOT, encoding: 'utf8' });
function fixture(kind: 'scan-lease-memo' | 'scan-memo-lease'): Uint8Array {
  const out = path.join(tmp, `${kind}.pdf`);
  if (!fs.existsSync(out)) cli('make', kind, out);
  return new Uint8Array(fs.readFileSync(out));
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const store = (client: PactoSupabase, bytes: Uint8Array) =>
  new SupabaseDocumentStore(client, async (): Promise<PreparedFile> => ({ bytes: bytes.slice().buffer, mimeType: 'application/pdf', ext: 'pdf' }), () => randomUUID());
const file = (name: string) => ({ name, uri: `file:///${name}`, mimeType: 'application/pdf', size: 100 });
const today = '2026-10-12';
const row = async (id: string) =>
  (await adminClient().from('contract_documents').select('protection_status, protection_detail, protection_pages, analysis_excluded_pages, protection_view_pages, storage_path').eq('id', id).single()).data!;
const lastJob = async (userId: string) =>
  (await adminClient().from('analysis_jobs').select('id, raw_output, validation, result').eq('user_id', userId).order('created_at', { ascending: false }).limit(1)).data![0];
const downloadOriginal = async (p: string) => new Uint8Array(await (await adminClient().storage.from('contract-files').download(p)).data!.arrayBuffer());

async function setup(prefix: string, bytes: Uint8Array) {
  const a = await newUser(prefix);
  const docs = store(a.client, bytes);
  const ai = new SupabaseAIProvider(a.client);
  await ai.grantConsent();
  const up = await docs.upload(file('임대차계약서.pdf'));
  return { a, docs, ai, up };
}

let clova: FakeClova;
beforeAll(async () => {
  clova = await startFakeClova();
});
afterAll(async () => {
  await clova.close();
});

describe('Step 27 — 분석 대상 페이지 선택', () => {
  test('정상 1쪽 + 읽기 어려운 2쪽: 빼지 않으면 차단 → 2쪽을 빼면 분석 성공 · AI 요청은 1쪽 · 원본 보존 · 기록', async () => {
    const original = fixture('scan-lease-memo');
    const { a, docs, ai, up } = await setup('sel-a', original);

    // 1) 선택 없음 → unreadable (2쪽 low_ocr_quality, 품질 숫자 기록) · 분석 차단
    expect((await docs.protect(up.id)).status).toBe('unreadable');
    const r1 = await row(up.id);
    expect((r1.protection_pages as { page: number; status: string; detail: string | null; quality?: { reason: string | null } }[]).map((p) => [p.page, p.status, p.detail, p.quality?.reason ?? null])).toEqual([
      [1, 'protected', null, null],
      [2, 'unreadable', 'low_ocr_quality', 'too_few_chars'],
    ]);
    await expect(ai.analyze({ files: [], documentIds: [up.id], today })).rejects.toThrow(/민감정보 보호/);
    expect(await lastJob(a.user.id)).toBeUndefined();

    // 2) 앱은 선택을 직접 바꿀 수 없음 (서버가 검증해서만 저장)
    await a.client.from('contract_documents').update({ analysis_excluded_pages: [2] } as never).eq('id', up.id);
    expect((await row(up.id)).analysis_excluded_pages).toEqual([]);

    // 3) 사용자가 2쪽을 뺌 → 남은 1쪽만 보호·검증 → protected · 보호본 1쪽
    const p2 = await docs.protect(up.id, undefined, { excludePages: [2] });
    expect(p2.status).toBe('protected');
    const r2 = await row(up.id);
    expect([r2.analysis_excluded_pages, r2.protection_view_pages]).toEqual([[2], [1]]);
    expect((r2.protection_pages as { page: number; status: string }[]).map((p) => [p.page, p.status])).toEqual([[1, 'protected'], [2, 'excluded']]);
    const prot = (await docs.getProtection([up.id]))[up.id];
    expect(prot).toMatchObject({ status: 'protected', excludedPages: [2], viewPages: [1] });
    const view = new Uint8Array(await (await testFetch(await docs.openUrl({ storagePath: up.storagePath, localUri: null, protection: prot }, 'protected_view'))).arrayBuffer());

    // 4) 분석 성공 — AI에 보낸 것은 1쪽짜리 보호본 (2쪽 없음, 원본 아님)
    const out = await ai.analyze({ files: [], documentIds: [up.id], today });
    expect(out.validation.decision).toBe('proceed');
    const job = await lastJob(a.user.id);
    const input = (job.raw_output as { _mock_input: { sha256: string; pages: number }[] })._mock_input;
    expect(input).toEqual([expect.objectContaining({ sha256: sha(view), pages: 1 })]);
    expect(input[0].sha256).not.toBe(sha(original));
    // 분석 기록: 제외 페이지 · 실제 분석한 원본 페이지
    expect((job.validation as { selection: unknown }).selection).toEqual([{ documentId: up.id, excludedPages: [2], analyzedPages: [1] }]);

    // 5) 원본 PDF 보존
    expect(sha(await downloadOriginal(r2.storage_path))).toBe(sha(original));
  });

  test('원본 페이지 번호와 AI 근거 연결: 메모 1쪽 + 계약서 2쪽 → 1쪽을 빼면 근거는 원본 2쪽', async () => {
    const { docs, ai, up, a } = await setup('sel-b', fixture('scan-memo-lease'));
    expect((await docs.protect(up.id)).status).toBe('unreadable');
    expect((await docs.protect(up.id, undefined, { excludePages: [1] })).status).toBe('protected');
    const out = await ai.analyze({ files: [], documentIds: [up.id], today });
    expect(out.validation.decision).toBe('proceed');
    // mock AI는 모든 근거를 (AI가 본) 1쪽으로 답한다 → 앱에 오는 결과·저장된 결과는 원본 2쪽
    const pages = (r: unknown) => [...JSON.stringify(r).matchAll(/"page":(\d+|null)/g)].map((m) => m[1]);
    expect(pages(out.result).length).toBeGreaterThan(0);
    expect(new Set(pages(out.result))).toEqual(new Set(['2']));
    expect(new Set(pages((await lastJob(a.user.id)).result))).toEqual(new Set(['2']));
    expect(out.result!.checks.every((c) => c.evidencePage == null || c.evidencePage === 2)).toBe(true);
  });

  test('정상 페이지까지 모두 빼면 → no_pages_selected (보호 상태·선택 그대로) · 분석 대상 변경 시 이전 분석을 이어 쓰지 않음', async () => {
    const { docs, ai, up, a } = await setup('sel-c', fixture('scan-lease-memo'));
    await docs.protect(up.id);
    expect(await docs.protect(up.id, undefined, { excludePages: [1, 2] })).toEqual({ status: 'failed', detail: 'no_pages_selected' });
    expect((await row(up.id)).analysis_excluded_pages).toEqual([]);
    expect((await row(up.id)).protection_status).toBe('unreadable');

    // 2쪽을 빼고 분석한 뒤, 선택을 바꾸면(다시 포함) 예전 분석 기록을 이어 쓰지 않는다
    await docs.protect(up.id, undefined, { excludePages: [2] });
    const out = await ai.analyze({ files: [], documentIds: [up.id], today });
    expect(out.validation.decision).toBe('proceed');
    const job = await lastJob(a.user.id);
    await docs.protect(up.id, undefined, { excludePages: [] });
    expect((await row(up.id)).protection_view_pages).toBeNull();
    await expect(ai.finalize(job.id, { confirmRole: true, includeFiles: [], excludeFiles: [] })).rejects.toThrow(/페이지가 바뀌었어요/);
    // 선택을 다시 풀면 2쪽 때문에 다시 차단
    await expect(ai.analyze({ files: [], documentIds: [up.id], today })).rejects.toThrow(/민감정보 보호/);
  });
});
