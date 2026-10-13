import { randomUUID } from 'node:crypto';

import { AIConsentRequiredError } from '@/data/ai/provider';
import { EMPTY_DRAFT } from '@/data/draft';
import { SupabaseAIProvider } from '@/data/supabase/SupabaseAIProvider';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { SupabaseDocumentStore } from '@/data/supabase/SupabaseDocumentStore';
import type { PreparedFile } from '@/data/supabase/prepareFile';

import { adminClient, markNoSensitiveData, newUser } from './helpers';

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

    await markNoSensitiveData([up.id]); // 가짜 PDF — 분석 흐름만 검증

    await expect(ai.analyze({ files: [file], documentIds: [up.id], today: '2026-10-05' })).rejects.toBeInstanceOf(AIConsentRequiredError);

    await ai.grantConsent();
    const outcome = await ai.analyze({ files: [file], documentIds: [up.id], today: '2026-10-05' });
    expect(outcome.validation).toMatchObject({ role: 'contract', decision: 'proceed' });
    const result = outcome.result!;
    expect(result.provider).toBe('mock');
    expect(result.fields.title?.value).toBe('정수기_렌탈계약서');
    expect(result.category).toMatchObject({ value: 'rental', confidence: 'high' });
    expect(result.contractType).toMatchObject({ value: 'recurring', confidence: 'high' });
    // 분류 개편: 계약 종류(기준값)가 함께 온다 · 자동갱신 + 해지 통보기한은 통보기한 할 일 체크 하나로 (이전 기대: 주제 auto_renewal)
    expect(result.classification).toMatchObject({ kind: 'rental', subtype: 'appliance', confidence: 'high' });
    expect(result.checks[0]).toMatchObject({ topic: 'notice_deadline', semanticKey: 'termination_notice', evidenceFileIndex: 0 });
    expect(result.payments.map((p) => [p.kind, p.amount])).toEqual([['recurring_fee', 29900], ['setup_fee', 20000]]);
    expect(result.checks[0].suggestion).toMatchObject({ kind: 'set_termination_notice', terminationNoticeDays: 30 });
    expect(result.jobId).toBeTruthy();

    // 작업 기록: 사용자는 조회만 가능, 상태 succeeded
    const { data: job } = await a.client.from('analysis_jobs').select('status, provider, prompt_version').eq('id', result.jobId!).single();
    expect(job).toEqual({ status: 'succeeded', provider: 'mock', prompt_version: 'extract-v19' }); // 지시문 v18 (나눠 내는 몫의 상위 금액 part_of)
    // 사용자는 작업을 직접 만들 수 없음 (서버 전용)
    const forged = await a.client.from('analysis_jobs').insert({ status: 'succeeded', provider: 'mock', result: {} });
    expect(forged.error).not.toBeNull();

    const repo = new SupabaseContractRepository(a.client, () => '2026-10-05');
    const saved = await repo.create({ draft: { ...EMPTY_DRAFT, title: '정수기' }, source: 'upload', documents: [{ ...up, pageCount: null }], aiChecks: [], analysisJobId: result.jobId });
    const { data: row } = await adminClient().from('contracts').select('analysis_job_id').eq('id', saved.contract.id).single();
    expect(row?.analysis_job_id).toBe(result.jobId);
  });

  test('민감정보 보호가 끝나지 않은 문서(처리 전·실패)는 분석하지 않는다 — fail-closed, 원본을 대신 보내지 않음', async () => {
    const a = await newUser('ai-gate');
    const docs = new SupabaseDocumentStore(a.client, prepare, () => randomUUID());
    const ai = new SupabaseAIProvider(a.client);
    await ai.grantConsent();
    const up = await docs.upload(file);
    // 처리 전
    await expect(ai.analyze({ files: [file], documentIds: [up.id], today: '2026-10-05' })).rejects.toThrow('민감정보 보호를 완료하지 못해');
    // 보호 실패 (가짜 PDF는 열 수 없어 failed)
    await docs.protect(up.id);
    await expect(ai.analyze({ files: [file], documentIds: [up.id], today: '2026-10-05' })).rejects.toThrow('민감정보 보호를 완료하지 못해');
    // 작업 기록도 결과도 만들지 않음
    const { data: jobs } = await adminClient().from('analysis_jobs').select('id').eq('user_id', a.user.id);
    expect(jobs).toEqual([]);
  });

  test('다른 사람의 계약서 id로는 분석할 수 없다', async () => {
    const a = await newUser('owner');
    const b = await newUser('intruder');
    const up = await new SupabaseDocumentStore(a.client, prepare, () => randomUUID()).upload(file);
    const ai = new SupabaseAIProvider(b.client);
    await ai.grantConsent();
    await expect(ai.analyze({ files: [file], documentIds: [up.id], today: '2026-10-05' })).rejects.toThrow('계약서 파일을 찾지 못했어요');
  });
});
