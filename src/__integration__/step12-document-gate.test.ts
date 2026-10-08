/* 문서 확인 게이트 (Edge Function analyze-contract · cleanup-orphans, mock AI) — 계약이 아닌 파일로 계약·일정이 만들어지지 않는다 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { EMPTY_DRAFT } from '@/data/draft';
import type { PickedFile } from '@/data/ai/provider';
import { SupabaseAIProvider } from '@/data/supabase/SupabaseAIProvider';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { SupabaseDocumentStore } from '@/data/supabase/SupabaseDocumentStore';
import type { PreparedFile } from '@/data/supabase/prepareFile';

import { adminClient, localEnv, newUser, testFetch } from './helpers';

jest.setTimeout(120_000);

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const prepare = async (): Promise<PreparedFile> => ({ bytes: JPG.slice().buffer, mimeType: 'image/jpeg', ext: 'jpg' });
const photo = (name: string): PickedFile => ({ name, uri: `file:///${name}`, mimeType: 'image/jpeg', size: JPG.length, width: 2000, height: 2800 });
const amounts = (r: { payments: { amount: number }[] } | null) => (r ? r.payments.map((p) => p.amount) : []);

async function setup(prefix: string, names: string[]) {
  const a = await newUser(prefix);
  const docs = new SupabaseDocumentStore(a.client, prepare, () => randomUUID());
  const ai = new SupabaseAIProvider(a.client);
  await ai.grantConsent();
  const files = names.map(photo);
  const uploaded = [];
  for (let i = 0; i < files.length; i++) uploaded.push(await docs.upload(files[i], { sortOrder: i }));
  const input = { files, documentIds: uploaded.map((d) => d.id), today: '2026-10-07' };
  return { a, docs, ai, files, uploaded, input };
}

const roles = async (ids: string[]) => {
  const { data } = await adminClient().from('contract_documents').select('id, document_role, role_confirmed_by_user').in('id', ids);
  return ids.map((id) => data!.find((d) => d.id === id)).map((d) => [d!.document_role, d!.role_confirmed_by_user]);
};

describe('Step 12 — 문서 확인 게이트', () => {
  test('B. 계약서 사진 → contract · 분석 진행 · 보호 실패(해석할 수 없는 테스트용 사진)는 분석과 별개 상태', async () => {
    const { docs, ai, uploaded, input } = await setup('gate-b', ['렌탈계약서_1.jpg', '렌탈계약서_2.jpg']);
    for (const d of uploaded) await docs.protect(d.id);
    const out = await ai.analyze(input);
    expect(out.validation).toMatchObject({ role: 'contract', decision: 'proceed' });
    expect(amounts(out.result)).toContain(29_900);
    expect(await roles(uploaded.map((d) => d.id))).toEqual([['contract', false], ['contract', false]]);
    const prot = await docs.getProtection(uploaded.map((d) => d.id));
    // 보호 상태와 문서 확인(분석)은 서로 독립 — 이 테스트 사진은 픽셀이 없어 보호는 실패, 분석은 진행
    expect(uploaded.map((d) => [prot[d.id].status, prot[d.id].detail])).toEqual([['failed', 'image_format'], ['failed', 'image_format']]);
  });

  test('C·I. 음식 사진 / 신분증 → 분석 중단 · 결과 없음 · 계약에 연결 불가(서버가 막음)', async () => {
    for (const name of ['음식.jpg', '신분증.jpg']) {
      const { a, ai, uploaded, input } = await setup('gate-c', [name]);
      const out = await ai.analyze(input);
      expect(out.validation).toMatchObject({ role: 'non_contract', decision: 'stop_non_contract' });
      expect(out.result).toBeNull();
      const { data: job } = await adminClient().from('analysis_jobs').select('result').eq('id', out.jobId!).single();
      expect(job?.result).toBeNull();
      expect(await roles([uploaded[0].id])).toEqual([['non_contract', false]]);
      // 계약이 아니라고 판정된 파일은 계약에 붙일 수 없다 → 그 파일로 결제·일정·알림이 생기지 않는다
      const repo = new SupabaseContractRepository(a.client, () => '2026-10-07');
      await expect(repo.create({ draft: { ...EMPTY_DRAFT, title: '가짜 계약' }, source: 'upload', documents: [{ ...uploaded[0], pageCount: null }], aiChecks: [] })).rejects.toBeTruthy();
      const { count } = await adminClient().from('contracts').select('id', { count: 'exact', head: true }).eq('user_id', a.user.id);
      expect(count).toBe(0);
    }
  });

  test('E. 흐릿한 사진 → unreadable · 결과 없음', async () => {
    const { ai, input } = await setup('gate-e', ['계약서_흐림.jpg']);
    const out = await ai.analyze(input);
    expect(out.validation).toMatchObject({ role: 'unreadable', decision: 'stop_unreadable' });
    expect(out.result).toBeNull();
  });

  test('F. 계약서 4장 + 책상 사진 → 쪽 선택 전 결과 없음 → 3번째 제외 → 그 사진의 3,000,000원·종료일이 결과에 없음', async () => {
    const { ai, uploaded, input } = await setup('gate-f', ['계약서_1.jpg', '계약서_2.jpg', '책상.jpg', '계약서_3.jpg', '계약서_4.jpg']);
    const first = await ai.analyze(input);
    expect(first.validation.decision).toBe('choose_pages');
    expect(first.validation.suspiciousPages.map((p) => p.file)).toEqual([3]);
    expect(first.result).toBeNull();
    const fin = await ai.finalize(first.jobId, { confirmRole: false, includeFiles: [], excludeFiles: [3] });
    expect(fin.validation.decision).toBe('proceed');
    expect(fin.excludedFiles).toEqual([3]);
    expect(amounts(fin.result)).not.toContain(3_000_000);
    expect(fin.result!.dates.map((d) => d.date)).not.toContain('2027-03-15');
    expect(amounts(fin.result)).toContain(29_900);
    // 서버에 저장된 결과에도 남지 않음
    const { data: job } = await adminClient().from('analysis_jobs').select('result').eq('id', first.jobId!).single();
    expect(JSON.stringify(job?.result)).not.toContain('3000000');
    expect((await roles(uploaded.map((d) => d.id)))[2]).toEqual(['non_contract', false]);
  });

  test('F-2. 근거 위치를 모르는 값이 있으면 제외한 사진을 빼고 다시 분석 (새 작업, 남은 사진만)', async () => {
    const { ai, input } = await setup('gate-f2', ['계약서_1.jpg', '책상.jpg', '계약서_출처불명.jpg']);
    const first = await ai.analyze(input);
    const fin = await ai.finalize(first.jobId, { confirmRole: false, includeFiles: [], excludeFiles: [2] });
    expect(fin.jobId).not.toBe(first.jobId);
    expect(fin.excludedFiles).toEqual([2]);
    expect(fin.validation.decision).toBe('proceed');
    expect(amounts(fin.result)).not.toContain(3_000_000);
    const { data: docs } = await adminClient().from('contract_documents').select('id').eq('analysis_job_id', fin.jobId!);
    expect(docs).toHaveLength(2);
  });

  test('관련 자료(견적서)만 → 사용자 확인 필요 · 확인 없이 마무리 불가 · 확인하면 진행 + 확인 기록', async () => {
    const { ai, uploaded, input } = await setup('gate-sup', ['견적서.jpg']);
    const first = await ai.analyze(input);
    expect(first.validation).toMatchObject({ role: 'supporting', decision: 'confirm_role' });
    expect(first.result).toBeNull();
    await expect(ai.finalize(first.jobId, { confirmRole: false, includeFiles: [], excludeFiles: [] })).rejects.toThrow('계약 관련 문서인지 먼저 확인해주세요');
    const fin = await ai.finalize(first.jobId, { confirmRole: true, includeFiles: [], excludeFiles: [] });
    expect(fin.validation).toMatchObject({ decision: 'proceed', userConfirmedRole: true });
    expect(await roles([uploaded[0].id])).toEqual([['supporting', true]]);
  });

  test('L. 계약 신호 부족 → 정보 부족 · 결과 없음', async () => {
    const { ai, input } = await setup('gate-l', ['정보부족.jpg']);
    const out = await ai.analyze(input);
    expect(out.validation.decision).toBe('stop_insufficient');
    expect(out.result).toBeNull();
  });

  test('사용자는 문서 역할을 바꾸거나 모델 원본 출력을 읽을 수 없다', async () => {
    const { a, ai, uploaded, input } = await setup('gate-guard', ['음식.jpg']);
    const out = await ai.analyze(input);
    await a.client.from('contract_documents').update({ document_role: 'contract', role_confirmed_by_user: true } as never).eq('id', uploaded[0].id);
    expect(await roles([uploaded[0].id])).toEqual([['non_contract', false]]);
    const raw = await a.client.from('analysis_jobs').select('raw_output' as never).eq('id', out.jobId!);
    expect(raw.error).not.toBeNull();
    const ok = await a.client.from('analysis_jobs').select('status, validation').eq('id', out.jobId!).single();
    expect(ok.data?.status).toBe('succeeded');
  });
});

describe('고아 파일 자동 정리 (cleanup-orphans)', () => {
  const secret = () => {
    const env = fs.readFileSync(path.resolve(__dirname, '../../supabase/functions/.env'), 'utf8');
    return /^CLEANUP_SECRET=(.+)$/m.exec(env)![1].trim();
  };
  const call = (headers: Record<string, string>) => testFetch(`${localEnv().API_URL}/functions/v1/cleanup-orphans`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
  const backdate = (ids: string[]) => adminClient().from('contract_documents').update({ created_at: new Date(Date.now() - 25 * 3600_000).toISOString() }).in('id', ids);
  const exists = async (ids: string[]) => ((await adminClient().from('contract_documents').select('id').in('id', ids)).data ?? []).map((d) => d.id);
  const storageHas = async (p: string) => {
    const [folder, name] = p.split('/');
    const { data } = await adminClient().storage.from('contract-files').list(folder);
    return (data ?? []).some((o) => o.name === name);
  };

  test('비밀값이 없거나 틀리면 거부', async () => {
    expect((await call({})).status).toBe(401);
    expect((await call({ 'x-cleanup-secret': 'wrong' })).status).toBe(401);
  });

  test('24시간 지난 연결 안 된 업로드만 삭제 (원본·파생본·영역), 최근 업로드·저장된 계약 문서·진행 중 분석은 보존', async () => {
    // 오래된 고아 문서 (PDF 보호 파생본 포함)
    const a = await newUser('orphan');
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pacto-orphan-')), 'employment.pdf');
    const root = path.resolve(__dirname, '../..');
    execFileSync('node', ['--experimental-strip-types', '--no-warnings', path.join(root, 'tests/protection/cli.ts'), 'make', 'employment', out], { cwd: root });
    const pdf = fs.readFileSync(out);
    const pdfPrep = async (): Promise<PreparedFile> => ({ bytes: new Uint8Array(pdf).buffer, mimeType: 'application/pdf', ext: 'pdf' });
    const store = new SupabaseDocumentStore(a.client, pdfPrep, () => randomUUID());
    const old = await store.upload({ name: '근로계약서.pdf', uri: 'file:///x.pdf', mimeType: 'application/pdf', size: pdf.length });
    await store.protect(old.id);
    const { data: derivs } = await adminClient().from('document_derivatives').select('storage_path').eq('document_id', old.id);
    expect(derivs?.length).toBe(1);
    const recent = await store.upload({ name: '최근.pdf', uri: 'file:///y.pdf', mimeType: 'application/pdf', size: pdf.length });
    // 저장된 계약에 연결된 오래된 문서
    const linked = await store.upload({ name: '저장됨.pdf', uri: 'file:///z.pdf', mimeType: 'application/pdf', size: pdf.length });
    await new SupabaseContractRepository(a.client, () => '2026-10-07').create({ draft: { ...EMPTY_DRAFT, title: '저장된 계약' }, source: 'upload', documents: [{ ...linked, pageCount: null }], aiChecks: [] });
    await backdate([old.id, linked.id]);
    // 다른 사용자: 진행 중인 분석이 있으면 오래된 고아도 보존
    const b = await newUser('orphan-busy');
    const bStore = new SupabaseDocumentStore(b.client, pdfPrep, () => randomUUID());
    const busy = await bStore.upload({ name: '분석중.pdf', uri: 'file:///w.pdf', mimeType: 'application/pdf', size: pdf.length });
    await backdate([busy.id]);
    await adminClient().from('analysis_jobs').insert({ user_id: b.user.id, status: 'processing' });

    const res = await call({ 'x-cleanup-secret': secret() });
    expect(res.status).toBe(200);
    expect(await exists([old.id, recent.id, linked.id, busy.id])).toEqual(expect.arrayContaining([recent.id, linked.id, busy.id]));
    expect(await exists([old.id])).toEqual([]);
    expect(await storageHas(old.storagePath!)).toBe(false);
    expect(await storageHas(derivs![0].storage_path)).toBe(false);
    expect(await storageHas(recent.storagePath!)).toBe(true);
    expect(await storageHas(linked.storagePath!)).toBe(true);
    const { count } = await adminClient().from('document_sensitive_regions').select('id', { count: 'exact', head: true }).eq('document_id', old.id);
    expect(count).toBe(0);
  });

  test('24시간 지난 연결 안 된 분석 작업 삭제 · 남는 작업의 모델 원본 출력은 비움', async () => {
    const { ai, input } = await setup('orphan-job', ['음식.jpg']);
    const out = await ai.analyze(input);
    const old = new Date(Date.now() - 25 * 3600_000).toISOString();
    await adminClient().from('analysis_jobs').update({ created_at: old }).eq('id', out.jobId!);
    await backdate(input.documentIds);
    await call({ 'x-cleanup-secret': secret() });
    const { data } = await adminClient().from('analysis_jobs').select('id').eq('id', out.jobId!);
    expect(data).toEqual([]);
  });
});
