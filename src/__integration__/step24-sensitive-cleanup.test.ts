/*
 * ⚠ 임시 함수 sensitive-cleanup-once 검증 (정리가 끝나면 함수와 함께 지운다) — 모든 값은 가짜다.
 * 1단계 dry_run: 표·필드·행 id·유형별 개수만 (원문 없음) / 2단계 apply: 같은 planHash일 때만, AI 파생 텍스트만 가림
 */
import fs from 'node:fs';
import path from 'node:path';

import { EMPTY_DRAFT } from '@/data/draft';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';

import { adminClient, localEnv, newUser, testFetch } from './helpers';

jest.setTimeout(120_000);

const LINE = '임대인 홍길동 / 주민등록번호 800101-1234567 / 010-1234-5678';
const RAW = ['800101-1234567', '1234567', '010-1234-5678', 'renter@example.com'];
const leaks = (v: unknown) => {
  const text = JSON.stringify(v);
  return RAW.map((r, i) => (text.includes(r) ? i : -1)).filter((i) => i >= 0);
};
/** 로컬 전용 비밀값 (supabase/functions/.env, 저장소에 없음) */
const secret = () => /^SENSITIVE_CLEANUP_SECRET=(.+)$/m.exec(fs.readFileSync(path.resolve(__dirname, '../../supabase/functions/.env'), 'utf8'))![1].trim();
const call = async (body: unknown, key = secret()) => {
  const res = await testFetch(`${localEnv().API_URL}/functions/v1/sensitive-cleanup-once`, {
    method: 'POST',
    headers: { 'x-cleanup-secret': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

describe('Step 24 — 기존 데이터 민감정보 정리 (임시 함수)', () => {
  test('전용 비밀값만 · dry_run은 개수만 · apply는 확인한 계획일 때만 AI 파생 텍스트를 가림 · 사용자 입력 칸은 그대로', async () => {
    expect((await call({ mode: 'dry_run' }, localEnv().SERVICE_ROLE_KEY)).status).toBe(401);
    expect((await call({ mode: 'dry_run' }, 'wrong')).status).toBe(401);

    // 예전 정책으로 저장된 데이터 흉내 (가리지 않은 근거·설명)
    const a = await newUser('sec-clean');
    const repo = new SupabaseContractRepository(a.client, () => '2026-10-11');
    const saved = await repo.create({ draft: { ...EMPTY_DRAFT, title: '예전 임대차', counterparty: '연락 renter@example.com' }, source: 'upload', documents: [], aiChecks: [] });
    const id = saved.contract.id;
    const admin = adminClient();
    const checks = [{ severity: 'check', topic: 'other', title: '임대인 정보', description: `계약번호 2026-0001-1234 · ${LINE}`, evidenceQuote: LINE }];
    await admin.from('contracts').update({ ai_checks: checks, classification: { reason: '연락처 010-1234-5678', evidence: { quote: LINE } } } as never).eq('id', id);
    const { data: job } = await admin.from('analysis_jobs').insert({ user_id: a.user.id, status: 'succeeded', provider: 'mock', result: { checks }, raw_output: { checks: [{ evidence_quote: LINE }] } } as never).select('id').single();

    // 1단계 dry_run — 원문 문자열 없음, 행 id·유형·개수만
    const dry = await call({ mode: 'dry_run' });
    expect(dry.status).toBe(200);
    expect(leaks(dry.body)).toEqual([]);
    const mine = (dry.body.rows as { table: string; field: string; id: string; types: Record<string, number>; count: number }[]).filter((r) => r.id === id || r.id === job!.id);
    expect(mine.map((r) => `${r.table}.${r.field}`).sort()).toEqual(['analysis_jobs.raw_output', 'analysis_jobs.result', 'contracts.ai_checks', 'contracts.classification']);
    expect(mine.find((r) => r.field === 'ai_checks')!.types).toEqual({ resident_registration_number: 2, phone: 2 });
    // 사용자 입력 칸은 개수만 보고 (바꾸지 않음)
    expect((dry.body.reportOnly.rows as { id: string; field: string }[]).some((r) => r.id === id && r.field === 'counterparty')).toBe(true);

    // 확인하지 않은 계획(해시 다름)은 거절
    expect((await call({ mode: 'apply', planHash: 'x' })).status).toBe(409);

    // 2단계 apply
    const applied = await call({ mode: 'apply', planHash: dry.body.planHash });
    expect(applied.status).toBe(200);
    expect(leaks(applied.body)).toEqual([]);
    expect(applied.body.failed).toEqual([]);
    expect(applied.body.remaining.rows).toBe(0);

    const { data: row } = await admin.from('contracts').select('ai_checks, classification, counterparty').eq('id', id).single();
    expect(leaks({ ai_checks: row!.ai_checks, classification: row!.classification })).toEqual([]);
    expect(JSON.stringify(row!.ai_checks)).toContain('800101-1****** / 010-****-5678');
    expect(JSON.stringify(row!.ai_checks)).toContain('계약번호 2026-0001-1234'); // 민감정보가 아닌 번호는 그대로
    expect(row!.counterparty).toBe('연락 renter@example.com'); // 사용자 입력 칸은 바꾸지 않음
    const { data: j } = await admin.from('analysis_jobs').select('result, raw_output').eq('id', job!.id).single();
    expect(leaks(j)).toEqual([]);

    // 다시 실행해도 대상 없음 (멱등)
    expect((await call({ mode: 'dry_run' })).body.totals.rows).toBe(0);
  });
});
