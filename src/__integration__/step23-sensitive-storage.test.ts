/*
 * 민감정보 저장 전 가림 (Edge Function analyze-contract, mock AI) — 모든 값은 가짜다.
 * AI가 근거·설명에 주민등록번호·전화번호를 그대로 옮겨도 DB(analysis_jobs.result·raw_output, contracts.ai_checks)와
 * 등록 확인·계약 상세 화면 모델에는 가린 값만 남는다. 원문 값은 실패 메시지에도 출력하지 않는다 (포함 여부만 검사).
 */
import { randomUUID } from 'node:crypto';

import type { PickedFile } from '@/data/ai/provider';
import { SupabaseAIProvider } from '@/data/supabase/SupabaseAIProvider';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { SupabaseDocumentStore } from '@/data/supabase/SupabaseDocumentStore';
import type { PreparedFile } from '@/data/supabase/prepareFile';
import { toReviewModel } from '@/features/registration/extraction';

import { adminClient, markNoSensitiveData, newUser } from './helpers';

jest.setTimeout(120_000);

const PDF = new TextEncoder().encode('%PDF-1.4\n% 테스트\n');
const prepare = async (): Promise<PreparedFile> => ({ bytes: PDF.slice().buffer, mimeType: 'application/pdf', ext: 'pdf' });
const file: PickedFile = { name: '연락처노출_렌탈계약서.pdf', uri: 'file:///x.pdf', mimeType: 'application/pdf', size: PDF.length };

const RAW = ['800101-1234567', '1234567', '010-1234-5678'];
/** 원문 값이 들어 있는지 — 값 자체는 출력하지 않고 몇 번째 값인지만 */
const leaks = (v: unknown) => {
  const text = JSON.stringify(v);
  return RAW.map((r, i) => (text.includes(r) ? i : -1)).filter((i) => i >= 0);
};

describe('Step 23 — 민감정보 저장 전 가림', () => {
  test('AI 근거 "임대인 홍길동 / 주민등록번호 … / 010-…" → DB·등록 확인·계약 상세 모두 가린 값', async () => {
    const a = await newUser('sec-store');
    const docs = new SupabaseDocumentStore(a.client, prepare, () => randomUUID());
    const ai = new SupabaseAIProvider(a.client);
    await ai.grantConsent();
    const up = await docs.upload(file);
    await markNoSensitiveData([up.id]); // 가짜 PDF — 저장 경로만 검증

    const out = await ai.analyze({ files: [file], documentIds: [up.id], today: '2026-10-11' });
    const result = out.result!;
    // 앱이 받은 결과
    expect(leaks(result)).toEqual([]);
    expect(JSON.stringify(result)).toContain('800101-1******');
    expect(JSON.stringify(result)).toContain('010-****-5678');

    // DB: 분석 작업 결과·모델 원본 출력
    const { data: job } = await adminClient().from('analysis_jobs').select('result, raw_output').eq('id', result.jobId!).single();
    expect(leaks(job!.result)).toEqual([]);
    expect(leaks(job!.raw_output)).toEqual([]);

    // 등록 확인 화면 모델 (근거 "원문" 포함)
    const model = toReviewModel(result, [up.id]);
    expect(leaks(model)).toEqual([]);

    // 저장 → contracts.ai_checks · 계약 상세
    const repo = new SupabaseContractRepository(a.client, () => '2026-10-11');
    const saved = await repo.create({ draft: model.draft, source: 'upload', documents: [{ ...up, pageCount: null }], aiChecks: model.checks.map((c) => ({ ...c, status: 'new' as const })), analysisJobId: result.jobId });
    const { data: row } = await adminClient().from('contracts').select('ai_checks, counterparty').eq('id', saved.contract.id).single();
    expect(leaks(row)).toEqual([]);
    expect(leaks(await repo.get(saved.contract.id))).toEqual([]);
  });
});
