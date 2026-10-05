/* 서버(Edge Function) 추출 로직 검증 — supabase/functions/_shared 의 순수 TS를 그대로 테스트 */
import { BANNED_PHRASES as SERVER_BANNED, extractionJsonSchema, FIELDS, toAppResult } from '../../../supabase/functions/_shared/extraction.ts';
import { buildOpenAIRequest, readOutputText } from '../../../supabase/functions/_shared/ai/openai.ts';
import { toReviewModel } from '@/features/registration/extraction';
import { BANNED_AI_PHRASES } from '@/domain/aiCopy';
import type { ExtractionResult } from '@/data/ai/provider';

const f = (value: unknown, confidence = 'high', quote: string | null = null, page: number | null = null) => ({ value, confidence, evidence_quote: quote, evidence_page: page });

function sampleOutput(overrides: Record<string, unknown> = {}) {
  const fields: Record<string, unknown> = {};
  for (const k of Object.keys(FIELDS)) fields[k] = f(null, 'low');
  Object.assign(fields, {
    title: f('공기청정기 렌탈'),
    category: f('rental'),
    counterparty: f('클린에어코리아(주)', 'high', '렌탈회사: 클린에어코리아 주식회사', 1),
    startDate: f('2026-10-10'),
    endDate: f('2029-10-09', 'medium', '의무사용기간: 개시일로부터 36개월', 1),
    paymentAmount: f(29900, 'high', '월 렌탈료 29,900원', 1),
    paymentFrequency: f('monthly'),
    paymentDay: f(10),
    autoRenewal: f(true),
    renewalPeriodMonths: f(12),
    terminationNoticeDays: f(30),
    ...overrides,
  });
  return {
    fields,
    checks: [
      { severity: 'caution', topic: 'auto_renewal', title: '자동갱신', description: '만료 1개월 전까지 의사표시가 없으면 12개월 연장되는 것으로 기재되어 있습니다.', evidence_quote: '만료 1개월 전까지…', evidence_page: 3 },
      { severity: 'check', topic: 'penalty', title: '위약금', description: '이 조항은 고객에게 불리합니다.', evidence_quote: null, evidence_page: null },
    ],
  };
}

describe('계약서 추출 (서버 공용 로직)', () => {
  test('스키마: 모든 필드 required + additionalProperties false (OpenAI strict 요건)', () => {
    const s = extractionJsonSchema() as { properties: { fields: { required: string[]; additionalProperties: boolean } } };
    expect(s.properties.fields.required.sort()).toEqual(Object.keys(FIELDS).sort());
    expect(s.properties.fields.additionalProperties).toBe(false);
  });

  test('금지 표현 목록은 앱과 서버가 동일', () => {
    expect([...SERVER_BANNED].sort()).toEqual([...BANNED_AI_PHRASES].sort());
  });

  test('정상 출력 → 앱 형식, 근거 문구 유지, 자동갱신 체크는 해지 통보기한 일정 제안으로 연결', () => {
    const r = toAppResult(sampleOutput(), 'openai');
    expect(r.fields.counterparty).toEqual({ value: '클린에어코리아(주)', confidence: 'high', evidence: [{ page: 1, quote: '렌탈회사: 클린에어코리아 주식회사' }] });
    expect(r.fields.paymentAmount.value).toBe(29900);
    expect(r.checks[0].suggestion).toEqual({ kind: 'set_termination_notice', terminationNoticeDays: 30, autoRenewal: true, renewalPeriodMonths: 12 });
    // 금지 표현은 중립 문장으로 대체
    expect(r.checks[1].description).toBe('계약서의 해당 조항을 확인해주세요.');
  });

  test('형식이 틀린 값은 버리고 "확인 필요"(low)로', () => {
    const r = toAppResult(sampleOutput({ endDate: f('2029-02-30'), paymentDay: f(45), category: f('weird'), paymentAmount: f(-5) }), 'openai');
    expect(r.fields.endDate).toMatchObject({ value: null, confidence: 'low' });
    expect(r.fields.paymentDay).toMatchObject({ value: null, confidence: 'low' });
    expect(r.fields.category.value).toBeNull();
    expect(r.fields.paymentAmount.value).toBeNull();
    const review = toReviewModel(r as unknown as ExtractionResult);
    expect(review.flagged.has('endDate')).toBe(true);
    expect(review.draft.counterparty).toBe('클린에어코리아(주)');
  });

  test('구조가 틀리면 예외', () => {
    expect(() => toAppResult({ foo: 1 }, 'openai')).toThrow('invalid_output_shape');
  });

  test('OpenAI 요청: PDF는 input_file, 사진은 input_image, strict json_schema, store:false', () => {
    const req = buildOpenAIRequest('gpt-5.4-mini', [
      { mimeType: 'application/pdf', fileName: 'a.pdf', base64: 'QUJD' },
      { mimeType: 'image/jpeg', fileName: 'b.jpg', base64: 'REVG' },
    ], '2026-10-05');
    expect(req.store).toBe(false);
    expect(req.text.format).toMatchObject({ type: 'json_schema', strict: true, name: 'contract_extraction' });
    const content = req.input[0].content as { type: string; file_data?: string; image_url?: string }[];
    expect(content[0]).toMatchObject({ type: 'input_file', file_data: 'data:application/pdf;base64,QUJD' });
    expect(content[1]).toMatchObject({ type: 'input_image', image_url: 'data:image/jpeg;base64,REVG' });
    expect(req.instructions).toContain('2026-10-05');
  });

  test('OpenAI 응답 파싱 (output 배열 / refusal)', () => {
    expect(readOutputText({ output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] }] })).toBe('{"a":1}');
    expect(() => readOutputText({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] })).toThrow('model_refused');
  });
});
