import { randomUUID } from 'node:crypto';

import { AIConsentRequiredError } from '@/data/ai/provider';
import { EMPTY_DRAFT } from '@/data/draft';
import { SupabaseAIProvider } from '@/data/supabase/SupabaseAIProvider';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { SupabaseDocumentStore } from '@/data/supabase/SupabaseDocumentStore';
import type { PreparedFile } from '@/data/supabase/prepareFile';

import { adminClient, newUser } from './helpers';

// 로컬 Edge Runtime은 AI_PROVIDER=mock (supabase/functions/.env) — 실제 AI 호출 없이 서버 흐름을 검증
const PDF = new TextEncoder().encode('%PDF-1.4\n% 테스트\n');
const prepare = async (): Promise<PreparedFile> => ({ bytes: PDF.slice().buffer, mimeType: 'application/pdf', ext: 'pdf' });
const file = { name: '정수기_렌탈계약서.pdf', uri: 'file:///x.pdf', mimeType: 'application/pdf', size: PDF.length };

describe('Step 9 — 서버 계약서 분석 (analyze-contract)', () => {
  test('동의 없으면 거부 → 동의 후 분석 → 작업 기록 → 저장 시 작업 연결', async () => {
    const a = await newUser('ai');
    const docs = new SupabaseDocumentStore(a.client, prepare, () => randomUUID());
    const ai = new SupabaseAIProvider(a.client);
    const up = await docs.upload(file);

    await expect(ai.extractContract({ files: [file], documentIds: [up.id], today: '2026-10-05' })).rejects.toBeInstanceOf(AIConsentRequiredError);

    await ai.grantConsent();
    const result = await ai.extractContract({ files: [file], documentIds: [up.id], today: '2026-10-05' });
    expect(result.provider).toBe('mock');
    expect(result.fields.title?.value).toBe('정수기_렌탈계약서');
    expect(result.fields.paymentAmount?.value).toBe(29900);
    expect(result.checks[0].suggestion).toMatchObject({ kind: 'set_termination_notice', terminationNoticeDays: 30 });
    expect(result.jobId).toBeTruthy();

    // 작업 기록: 사용자는 조회만 가능, 상태 succeeded
    const { data: job } = await a.client.from('analysis_jobs').select('status, provider, prompt_version').eq('id', result.jobId!).single();
    expect(job).toEqual({ status: 'succeeded', provider: 'mock', prompt_version: 'extract-v2' });
    // 사용자는 작업을 직접 만들 수 없음 (서버 전용)
    const forged = await a.client.from('analysis_jobs').insert({ status: 'succeeded', provider: 'mock', result: {} });
    expect(forged.error).not.toBeNull();

    const repo = new SupabaseContractRepository(a.client, () => '2026-10-05');
    const saved = await repo.create({ draft: { ...EMPTY_DRAFT, title: '정수기' }, source: 'upload', documents: [{ ...up, pageCount: null }], aiChecks: [], analysisJobId: result.jobId });
    const { data: row } = await adminClient().from('contracts').select('analysis_job_id').eq('id', saved.contract.id).single();
    expect(row?.analysis_job_id).toBe(result.jobId);
  });

  test('다른 사람의 계약서 id로는 분석할 수 없다', async () => {
    const a = await newUser('owner');
    const b = await newUser('intruder');
    const up = await new SupabaseDocumentStore(a.client, prepare, () => randomUUID()).upload(file);
    const ai = new SupabaseAIProvider(b.client);
    await ai.grantConsent();
    await expect(ai.extractContract({ files: [file], documentIds: [up.id], today: '2026-10-05' })).rejects.toThrow('계약서 파일을 찾지 못했어요');
  });
});
