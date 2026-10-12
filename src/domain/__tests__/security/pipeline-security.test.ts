/**
 * 민감정보 보호 Security Golden Test (데이터 흐름 층) — 모든 값은 가짜다.
 * AI가 원문 그대로 인용한 근거 → 서버 정리(저장 전) → 등록 확인 화면 → 저장 레코드 → 계약 상세 어디에도 원문이 없어야 한다.
 * AI 전송 게이트: 보호본 성공 → 보호본만 / 민감정보 없음 검증 → 원본 / 그 밖(실패·읽을 수 없음·미지원·확정 못 함) → 분석하지 않음 (fail-closed)
 */
import { draftToRecord } from '@/data/draft';
import { coreInfo } from '@/domain/coreInfo';
import { toReviewModel } from '@/features/registration/extraction';

import { aiInputPlan } from '../../../../supabase/functions/_shared/protection/aiGate';
import { storableModelOutput } from '../../../../supabase/functions/_shared/protection/sensitive';
import { toAppResult } from '../../../../supabase/functions/_shared/extraction.ts';
import { answer, contract } from '../golden/classificationFixtures';

const RAW_LINE = '임대인 홍길동 / 주민등록번호 800101-1234567 / 010-1234-5678';
const MASKED_LINE = '임대인 홍길동 / 주민등록번호 800101-1****** / 010-****-5678';
const RAWS = ['800101-1234567', '010-1234-5678', '1234-5678', 'hong@example.com'];
const q = (quote: string) => ({ evidence_quote: quote, evidence_page: 1, evidence_file: 1 });

/** AI가 계약 당사자 행을 원문 그대로 인용한 출력 (가짜) */
function leakyOutput() {
  return {
    ...contract({
      cls: { kind: 'lease', subtype: 'housing' },
      title: '주택 월세 임대차계약서',
      fields: { counterparty: { value: '홍길동', confidence: 'high', ...q(RAW_LINE) } },
      checks: [
        {
          severity: 'caution', topic: 'restoration', title: '원상복구', description: `임대인(${RAW_LINE.split(' / ').slice(1).join(', ')})에게 연락해 상태를 확인하세요. 문의 hong@example.com`,
          confidence: 'high', behavior: 'info', condition: null, action: null, offset_days: null, related_date: null, amount: null, amount_basis: null, user_action: null, ...q(RAW_LINE),
        },
      ],
    }),
    classification: answer({ kind: 'lease', subtype: 'housing' }),
  };
}
const noRaw = (s: string) => RAWS.every((r) => !s.includes(r));

describe('1. 저장 전 보호 — 서버 정리 결과(analysis_jobs.result · contracts.ai_checks의 원천)', () => {
  test('근거 문장·설명 어디에도 원문 없음, 가린 형식으로', () => {
    const r = toAppResult(leakyOutput(), 'openai');
    const json = JSON.stringify(r);
    expect(noRaw(json)).toBe(true);
    expect(r.fields.counterparty.evidence?.[0].quote).toBe(MASKED_LINE);
    expect(r.checks.find((c) => c.topic === 'restoration')!.evidenceQuote).toBe(MASKED_LINE);
  });

  test('모델 원본 출력 저장본(analysis_jobs.raw_output)도 저장 전에 Level 1 + 2 모두', () => {
    const stored = JSON.stringify(storableModelOutput(leakyOutput()));
    expect(noRaw(stored)).toBe(true);
    expect(stored).toContain('010-****-5678');
  });
});

describe('2. 화면 — 등록 확인 "원문" · 계약 체크 · 저장 후 상세', () => {
  test('등록 확인 화면의 원문 근거', () => {
    const m = toReviewModel(toAppResult(leakyOutput(), 'openai'), ['doc-1']);
    expect(m.evidence.counterparty?.quote).toBe(MASKED_LINE);
    expect(noRaw(JSON.stringify(m))).toBe(true);
  });

  test('이전 서버가 가리지 않고 보낸 결과(legacy)도 화면 모델에서는 원문 없음 (방어선)', () => {
    const r = toAppResult(leakyOutput(), 'openai');
    // 이전 버전 서버 결과를 흉내: 근거를 원문으로 되돌린다
    r.fields.counterparty = { ...r.fields.counterparty, evidence: [{ page: 1, quote: RAW_LINE }] };
    r.checks[0] = { ...r.checks[0], evidenceQuote: RAW_LINE, description: RAW_LINE };
    const m = toReviewModel(r, ['doc-1']);
    expect(m.evidence.counterparty?.quote).toBe(MASKED_LINE);
    expect(noRaw(JSON.stringify(m.checks))).toBe(true);
  });

  test('저장 레코드·계약 상세 핵심 정보에도 원문 없음', () => {
    const m = toReviewModel(toAppResult(leakyOutput(), 'openai'), ['doc-1']);
    const record = { ...draftToRecord(m.draft, 'c1', '2026-10-12'), aiChecks: m.checks.map((c, i) => ({ ...c, id: `k${i}`, contractId: 'c1', status: 'new' as const })) };
    expect(noRaw(JSON.stringify(record))).toBe(true);
    expect(noRaw(JSON.stringify(coreInfo(record, '2026-10-12')))).toBe(true);
  });
});

describe('3. AI 전송 게이트 (fail-closed)', () => {
  const plan = (protectionStatus: string, o: { encrypted?: boolean; hasProtectedView?: boolean } = {}) => aiInputPlan({ protectionStatus, encrypted: o.encrypted ?? false, hasProtectedView: o.hasProtectedView ?? false });
  test('보호본 생성 성공 → 보호본만 (일반 문서도)', () => {
    expect(plan('protected', { hasProtectedView: true })).toEqual({ kind: 'protected_view' });
    expect(plan('protected', { hasProtectedView: true, encrypted: true })).toEqual({ kind: 'protected_view' });
  });
  test('민감정보 없음으로 검증 → 원본 (암호 PDF는 메모리 복호화 사본)', () => {
    expect(plan('no_sensitive_data')).toEqual({ kind: 'original' });
    expect(plan('no_sensitive_data', { encrypted: true })).toEqual({ kind: 'decrypted_original' });
  });
  test.each([['failed'], ['unreadable'], ['unsupported_scan'], ['unsupported_encryption'], ['pending'], ['processing'], [''], ['알 수 없는 값']])('%s → 분석하지 않음 (원본 전송 금지)', (status) => {
    expect(plan(status)).toEqual({ kind: 'blocked', code: 'protection_required' });
  });
  test('보호됨인데 보호본이 없으면 → 분석하지 않음 (원본으로 대신 보내지 않음)', () => {
    expect(plan('protected', { hasProtectedView: false })).toEqual({ kind: 'blocked', code: 'protection_required' });
  });
});
