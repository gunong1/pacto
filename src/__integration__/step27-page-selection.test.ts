/*
 * 분석 대상 페이지 (공통 페이지 정책) — Edge Function protect-document · analyze-contract · protect-scan-page · 가짜 CLOVA · mock AI. 모든 값은 가짜
 * 실제 사례 구조: 계약서 스캔 1쪽 + 글자를 거의 읽을 수 없는 메모 스캔 1쪽 (2쪽 PDF)
 * - 읽지 못한 페이지(unreadable)만 서버가 자동으로 빼고, 남은 페이지로 보호·분석 (버튼을 누르지 않아도)
 * - 자동 제외된 페이지는 AI 요청에 없음 (AI에는 1쪽짜리 보호본) · 원본 그대로 · 자동/직접 제외 구분 기록
 * - AI 근거 쪽 번호는 원본 기준 · 저장 후에도 문서 기록에 부분 분석 이력이 남음
 * - 모든 페이지를 읽지 못하면 자동 제외하지 않고 분석 중단 · 사진도 같은 정책
 * - 사용자가 직접 뺀 페이지도 같은 구조 · 선택이 바뀌면 이전 분석을 이어 쓰지 않음 · 앱은 선택을 직접 못 바꿈
 * 준비: supabase/functions/.env 에 AI_PROVIDER=mock, CLOVA_OCR_URL=http://host.docker.internal:54399/ocr, CLOVA_OCR_SECRET=local-test-secret
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import jpeg from 'jpeg-js';

import { EMPTY_DRAFT } from '@/data/draft';
import type { PactoSupabase } from '@/data/supabase/client';
import { SupabaseAIProvider } from '@/data/supabase/SupabaseAIProvider';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { SupabaseDocumentStore } from '@/data/supabase/SupabaseDocumentStore';
import type { PreparedFile } from '@/data/supabase/prepareFile';
import { partialAnalysis } from '@/features/documents/protectionCopy';

import { startFakeClova, type FakeClova } from './fakeClova';
import { adminClient, newUser, testFetch } from './helpers';

jest.setTimeout(300_000);

const ROOT = path.resolve(__dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pacto-sel-'));
const cli = (...args: string[]) => execFileSync('node', ['--experimental-strip-types', '--no-warnings', path.join(ROOT, 'tests/protection/cli.ts'), ...args], { cwd: ROOT, encoding: 'utf8' });
function fixture(kind: 'scan-lease-memo' | 'scan-memo-lease' | 'scan-memos'): Uint8Array {
  const out = path.join(tmp, `${kind}.pdf`);
  if (!fs.existsSync(out)) cli('make', kind, out);
  return new Uint8Array(fs.readFileSync(out));
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const pdfStore = (client: PactoSupabase, bytes: Uint8Array) =>
  new SupabaseDocumentStore(client, async (): Promise<PreparedFile> => ({ bytes: bytes.slice().buffer, mimeType: 'application/pdf', ext: 'pdf' }), () => randomUUID());
const file = (name: string, mimeType = 'application/pdf') => ({ name, uri: `file:///${name}`, mimeType, size: 100 });
const today = '2026-10-12';
type PageRow = { page: number; status: string; detail: string | null; quality?: { reason: string | null } };
const row = async (id: string) =>
  (await adminClient().from('contract_documents').select('protection_status, protection_pages, analysis_excluded_pages, analysis_auto_excluded_pages, protection_view_pages, storage_path').eq('id', id).single()).data!;
const lastJob = async (userId: string) =>
  (await adminClient().from('analysis_jobs').select('id, raw_output, validation, result').eq('user_id', userId).order('created_at', { ascending: false }).limit(1)).data![0];
const downloadOriginal = async (p: string) => new Uint8Array(await (await adminClient().storage.from('contract-files').download(p)).data!.arrayBuffer());

async function setup(prefix: string, bytes: Uint8Array) {
  const a = await newUser(prefix);
  const docs = pdfStore(a.client, bytes);
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

describe('Step 27 — 읽지 못한 페이지 자동 제외 · 사용자 제외', () => {
  test('정상 1쪽 + 읽기 어려운 2쪽 → 2쪽 자동 제외 · 부분 분석 진행 · AI 요청 1쪽 · 원본 보존 · 저장 후에도 이력', async () => {
    const original = fixture('scan-lease-memo');
    const { a, docs, ai, up } = await setup('auto-a', original);

    // 보호: 버튼 없이 2쪽만 자동으로 빼고 1쪽으로 보호 완료 (자동 제외 기록 · 2쪽 글자 인식 품질 숫자 유지)
    const s = await docs.protect(up.id);
    expect(s.status).toBe('protected');
    const r = await row(up.id);
    expect([r.analysis_excluded_pages, r.analysis_auto_excluded_pages, r.protection_view_pages]).toEqual([[2], [2], [1]]);
    expect((r.protection_pages as PageRow[]).map((p) => [p.page, p.status, p.detail, p.quality?.reason ?? null])).toEqual([
      [1, 'protected', null, null],
      [2, 'excluded', 'auto_unreadable', 'too_few_chars'],
    ]);
    // 앱은 선택을 직접 바꿀 수 없음
    await a.client.from('contract_documents').update({ analysis_excluded_pages: [], analysis_auto_excluded_pages: [] } as never).eq('id', up.id);
    expect((await row(up.id)).analysis_auto_excluded_pages).toEqual([2]);

    // 분석: AI에 1쪽짜리 보호본만 · 기록에 자동 제외
    const out = await ai.analyze({ files: [], documentIds: [up.id], today });
    expect(out.validation.decision).toBe('proceed');
    const job = await lastJob(a.user.id);
    expect((job.raw_output as { _mock_input: { pages: number }[] })._mock_input).toEqual([expect.objectContaining({ pages: 1 })]);
    expect((job.validation as { selection: unknown }).selection).toEqual([{ documentId: up.id, excludedPages: [2], autoExcludedPages: [2], analyzedPages: [1] }]);
    expect(sha(await downloadOriginal(r.storage_path))).toBe(sha(original));

    // 결과 화면 안내와 같은 규칙
    const prot = (await docs.getProtection([up.id]))[up.id];
    expect(partialAnalysis([{ fileName: '임대차계약서.pdf', isPdf: true, protection: prot }])!.title).toBe('전체 2쪽 중 1쪽만 분석했어요.');

    // 저장 후: 계약 상세의 문서 기록에도 부분 분석 이력
    const repo = new SupabaseContractRepository(a.client, () => today);
    const created = await repo.create({
      draft: { ...EMPTY_DRAFT, title: '임대차', contractKind: 'lease', contractType: 'lease', category: 'real_estate' },
      source: 'upload',
      documents: [{ id: up.id, fileName: '임대차계약서.pdf', mimeType: 'application/pdf', sizeBytes: up.sizeBytes, storagePath: up.storagePath, localUri: null, pageCount: null }],
      aiChecks: [],
      analysisJobId: job.id,
    });
    const saved = (await repo.get(created.contract.id))!;
    expect(saved.documents[0].protection).toMatchObject({ excludedPages: [2], autoExcludedPages: [2] });
    expect(partialAnalysis(saved.documents.map((d) => ({ fileName: d.fileName, isPdf: true, protection: d.protection })))!.items[0].auto).toBe(true);
  });

  test('원본 페이지 번호와 AI 근거 연결: 메모 1쪽(자동 제외) + 계약서 2쪽 → 근거는 원본 2쪽', async () => {
    const { docs, ai, up, a } = await setup('auto-b', fixture('scan-memo-lease'));
    expect((await docs.protect(up.id)).status).toBe('protected');
    expect((await row(up.id)).analysis_auto_excluded_pages).toEqual([1]);
    const out = await ai.analyze({ files: [], documentIds: [up.id], today });
    expect(out.validation.decision).toBe('proceed');
    const pages = (r: unknown) => [...JSON.stringify(r).matchAll(/"page":(\d+|null)/g)].map((m) => m[1]);
    expect(pages(out.result).length).toBeGreaterThan(0);
    expect(new Set(pages(out.result))).toEqual(new Set(['2']));
    expect(new Set(pages((await lastJob(a.user.id)).result))).toEqual(new Set(['2']));
  });

  test('모든 페이지 unreadable → 자동 제외하지 않음 · 문서 unreadable · 분석 중단', async () => {
    const { docs, ai, up, a } = await setup('auto-c', fixture('scan-memos'));
    expect((await docs.protect(up.id)).status).toBe('unreadable');
    const r = await row(up.id);
    expect([r.analysis_excluded_pages, r.analysis_auto_excluded_pages]).toEqual([[], []]);
    await expect(ai.analyze({ files: [], documentIds: [up.id], today })).rejects.toThrow(/민감정보 보호/);
    expect(await lastJob(a.user.id)).toBeUndefined();
  });

  test('사진도 같은 정책: 읽지 못한 사진은 자동으로 분석에서 뺌 · 그 사진만 있으면 분석 중단 (no_pages_selected)', async () => {
    const a = await newUser('auto-photo');
    const blank = new Uint8Array(jpeg.encode({ width: 800, height: 800, data: Buffer.alloc(800 * 800 * 4, 245) }, 90).data);
    const docs = new SupabaseDocumentStore(a.client, async (): Promise<PreparedFile> => ({ bytes: blank.slice().buffer, mimeType: 'image/jpeg', ext: 'jpg' }), () => randomUUID());
    const ai = new SupabaseAIProvider(a.client);
    await ai.grantConsent();
    const up = await docs.upload(file('메모.jpg', 'image/jpeg'));
    expect((await docs.protect(up.id)).status).toBe('unreadable');
    expect([(await row(up.id)).analysis_excluded_pages, (await row(up.id)).analysis_auto_excluded_pages]).toEqual([[1], [1]]);
    await expect(ai.analyze({ files: [], documentIds: [up.id], today })).rejects.toThrow(/분석할 페이지가 남아 있지 않아요/);
  });

  test('사용자 직접 제외: 모든 페이지를 빼면 no_pages_selected · 선택이 바뀌면 이전 분석을 이어 쓰지 않음', async () => {
    const { docs, ai, up, a } = await setup('auto-d', fixture('scan-lease-memo'));
    await docs.protect(up.id);
    expect(await docs.protect(up.id, undefined, { excludePages: [1, 2] })).toEqual({ status: 'failed', detail: 'no_pages_selected' });
    expect((await row(up.id)).analysis_auto_excluded_pages).toEqual([2]);

    const out = await ai.analyze({ files: [], documentIds: [up.id], today });
    expect(out.validation.decision).toBe('proceed');
    const job = await lastJob(a.user.id);
    // 사용자가 1쪽(계약서)을 빼면 남은 2쪽은 읽지 못함 → 자동 제외하지 않고 문서 unreadable · 기록은 사용자 제외
    expect((await docs.protect(up.id, undefined, { excludePages: [1] })).status).toBe('unreadable');
    const r = await row(up.id);
    expect([r.analysis_excluded_pages, r.analysis_auto_excluded_pages]).toEqual([[1], []]);
    expect((r.protection_pages as PageRow[]).find((p) => p.page === 1)?.detail).toBe('user');
    await expect(ai.finalize(job.id, { confirmRole: true, includeFiles: [], excludeFiles: [] })).rejects.toThrow(/페이지가 바뀌었어요/);
    await expect(ai.analyze({ files: [], documentIds: [up.id], today })).rejects.toThrow(/민감정보 보호/);
  });
});
