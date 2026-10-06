/* 서버(Edge Function) 추출 로직 v3 + 앱 변환(toReviewModel) 검증 — supabase/functions/_shared 의 순수 TS를 그대로 테스트 */
import {
  BANNED_PHRASES as SERVER_BANNED,
  CONTRACT_TYPES as SERVER_TYPES,
  DETAIL_KEYS,
  extractionJsonSchema,
  FIELDS,
  PAYMENT_KINDS as SERVER_PAYMENT_KINDS,
  PROMPT_VERSION,
  toAppResult,
} from '../../../supabase/functions/_shared/extraction.ts';
import { buildOpenAIRequest, readOutputText } from '../../../supabase/functions/_shared/ai/openai.ts';
import { MockExtractionProvider } from '../../../supabase/functions/_shared/ai/mock.ts';
import { draftToRecord } from '@/data/draft';
import { BANNED_AI_PHRASES } from '@/domain/aiCopy';
import { CONTRACT_TYPES, DETAIL_FIELDS, DETAIL_SCHEMAS, PAYMENT_KINDS } from '@/domain/contractTypes';
import { scheduleForRange } from '@/domain/schedule';
import { monthSpending } from '@/domain/spending';
import { toReviewModel } from '@/features/registration/extraction';

const ev = (quote: string | null = null, page: number | null = null) => ({ evidence_quote: quote, evidence_page: page });
const f = (value: unknown, confidence = 'high', quote: string | null = null) => ({ value, confidence, ...ev(quote, quote ? 1 : null) });
const date = (d: string, meaning: string, label: string, confidence = 'high') => ({ date: d, meaning, label, confidence, ...ev() });
const pay = (p: Record<string, unknown>) => ({ day_of_month: null, date: null, end_date: null, installment_count: null, is_variable: false, confidence: 'high', ...ev(), ...p });

function output(o: { type?: unknown; fields?: Record<string, unknown>; dates?: unknown[]; payments?: unknown[]; details?: Record<string, unknown>; checks?: unknown[] }) {
  const fields: Record<string, unknown> = {};
  for (const k of Object.keys(FIELDS)) fields[k] = f(null, 'low');
  const details: Record<string, unknown> = {};
  for (const k of Object.keys(DETAIL_KEYS)) details[k] = null;
  return {
    contract_type: o.type ?? { value: 'other', confidence: 'high', alternatives: [], reason: '', ...ev() },
    fields: { ...fields, ...o.fields },
    dates: o.dates ?? [],
    payments: o.payments ?? [],
    details: { ...details, ...o.details },
    checks: o.checks ?? [],
  };
}

/** 사용자가 올린 샘플 렌탈 계약서와 같은 내용의 모델 출력 */
const rentalOutput = () =>
  output({
    type: { value: 'recurring', confidence: 'high', alternatives: [], reason: '매월 렌탈료를 내는 계약입니다.', ...ev('월 렌탈료 29,900원', 1) },
    fields: {
      title: f('공기청정기 렌탈 계약서'),
      category: f('rental'),
      counterparty: f('클린에어코리아 주식회사', 'high', '업체명 클린에어코리아 주식회사'),
      autoRenewal: f(true),
      renewalPeriodMonths: f(12),
      terminationNoticeDays: f(30, 'high', '계약 종료 30일 전까지'),
      penaltyTerms: f('잔여 렌탈료 총액의 10%'),
    },
    dates: [date('2026-10-05', 'contract_signed', '계약 체결일'), date('2026-10-12', 'contract_start', '계약 기간 시작'), date('2029-10-11', 'contract_end', '계약 기간 종료')],
    payments: [
      pay({ kind: 'recurring_fee', label: '월 렌탈료', amount: 29900, frequency: 'monthly', day_of_month: 12 }),
      pay({ kind: 'setup_fee', label: '초기 설치비', amount: 20000, frequency: 'one_time' }),
    ],
    details: { commitment_months: 36, ownership_transfer_terms: '계약 종료 후 전액 납부 완료 시 이전' },
    checks: [
      { severity: 'caution', topic: 'auto_renewal', title: '자동갱신', description: '종료 30일 전까지 의사표시가 없으면 12개월 연장되는 것으로 기재되어 있습니다.', evidence_quote: '계약 종료 30일 전까지…', evidence_page: 1 },
      { severity: 'check', topic: 'penalty', title: '위약금', description: '이 조항은 고객에게 불리합니다.', evidence_quote: null, evidence_page: null },
    ],
  });

describe('추출 v3 — 서버 스키마', () => {
  test('프롬프트 버전', () => expect(PROMPT_VERSION).toBe('extract-v3'));

  test('strict 요건: 모든 객체가 required = 전체 속성, additionalProperties false', () => {
    const walk = (s: Record<string, unknown>, path: string) => {
      if (s.type === 'object') {
        const props = Object.keys(s.properties as object);
        expect([path, (s.required as string[]).sort()]).toEqual([path, props.sort()]);
        expect([path, s.additionalProperties]).toEqual([path, false]);
        for (const [k, v] of Object.entries(s.properties as Record<string, Record<string, unknown>>)) walk(v, `${path}.${k}`);
      }
      if (s.type === 'array') walk(s.items as Record<string, unknown>, `${path}[]`);
    };
    walk(extractionJsonSchema() as Record<string, unknown>, '$');
  });

  test('스키마 크기: 객체 속성 100개 이하, 중첩 5단계 이하 (Structured Outputs 제한을 보수적으로 적용)', () => {
    let props = 0;
    let depth = 0;
    const walk = (s: Record<string, unknown>, d: number) => {
      depth = Math.max(depth, d);
      for (const v of Object.values((s.properties as Record<string, Record<string, unknown>>) ?? {})) {
        props++;
        walk(v, d + 1);
      }
      if (s.items) walk(s.items as Record<string, unknown>, d + 1);
    };
    walk(extractionJsonSchema() as Record<string, unknown>, 0);
    expect(props).toBeLessThanOrEqual(100);
    expect(depth).toBeLessThanOrEqual(5);
  });

  test('앱과 서버 목록이 같음: 유형 · 결제 의미 · 상세 속성 키 · 금지 표현', () => {
    expect([...SERVER_TYPES]).toEqual([...CONTRACT_TYPES]);
    expect([...SERVER_PAYMENT_KINDS]).toEqual([...PAYMENT_KINDS]);
    const appDbKeys = [...new Set(CONTRACT_TYPES.flatMap((t) => DETAIL_FIELDS[t].map((d) => d.db)))].sort();
    expect(Object.keys(DETAIL_KEYS).sort()).toEqual(appDbKeys);
    expect([...SERVER_BANNED].sort()).toEqual([...BANNED_AI_PHRASES].sort());
  });

  test('형식이 틀린 날짜·금액·유형은 버리거나 낮춤, 금지 표현은 중립 문장으로', () => {
    const r = toAppResult(
      output({
        type: { value: 'weird', confidence: 'high', alternatives: ['loan', 'loan', 'nope'], reason: '불리한 계약입니다', ...ev() },
        fields: { renewalPeriodMonths: f(999), category: f('weird') },
        dates: [date('2026-02-30', 'contract_start', 'x'), date('2026-03-01', 'bogus', '기타')],
        payments: [pay({ kind: 'rent', label: '월세', amount: -5, frequency: 'monthly' }), pay({ kind: 'x', label: 'a', amount: 100, frequency: 'one_time', day_of_month: 5, installment_count: 3 })],
        details: { interest_rate: '4.5%', repayment_method: 'weird', principal: 1000 },
        checks: rentalOutput().checks,
      }),
      'openai',
    );
    expect(r.contractType).toMatchObject({ value: 'other', confidence: 'low', alternatives: ['loan'], reason: '계약서 내용을 바탕으로 분류했어요.' });
    expect(r.fields.renewalPeriodMonths).toMatchObject({ value: null, confidence: 'low' });
    expect(r.fields.category.value).toBeNull();
    expect(r.dates).toEqual([{ date: '2026-03-01', meaning: 'other', label: '기타', confidence: 'high' }]);
    expect(r.payments).toEqual([expect.objectContaining({ kind: 'other', amount: 100, frequency: 'one_time', dayOfMonth: null, installmentCount: null })]);
    expect(r.details).toEqual({ principal: 1000 });
    expect(r.checks[1].description).toBe('계약서의 해당 조항을 확인해주세요.');
  });

  test('구조가 틀리면 예외', () => {
    expect(() => toAppResult({ foo: 1 }, 'openai')).toThrow('invalid_output_shape');
  });

  test('서버 mock 출력도 같은 검증을 통과', async () => {
    const out = await new MockExtractionProvider().extract([{ mimeType: 'application/pdf', fileName: '렌탈.pdf', base64: '' }]);
    const r = toAppResult(out.json, 'mock');
    expect(r.payments).toHaveLength(2);
    expect(r.contractType.value).toBe('recurring');
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

describe('추출 v3 → 확인 화면 (toReviewModel)', () => {
  test('샘플 렌탈 계약서: 날짜 의미로 체결·시작·종료 분리, 설치비는 날짜가 없어 시작일 + 확인 필요', () => {
    const m = toReviewModel(toAppResult(rentalOutput(), 'openai'));
    expect(m.draft).toMatchObject({ contractType: 'recurring', category: 'rental', contractDate: '2026-10-05', startDate: '2026-10-12', endDate: '2029-10-11', autoRenewal: true, terminationNoticeDays: 30 });
    expect(m.draft.payments).toEqual([
      expect.objectContaining({ kind: 'recurring_fee', amount: 29_900, frequency: 'monthly', dayOfMonth: 12, startsOn: null }),
      expect.objectContaining({ kind: 'setup_fee', amount: 20_000, frequency: 'one_time', startsOn: null }),
    ]);
    expect(m.flagged.has('payments.1.startsOn')).toBe(true);
    expect(m.notes['payments.1.startsOn']).toContain('계약 시작일로 계산했어요');
    expect(m.flagged.has('contractType')).toBe(false);
    expect(m.draft.dates).toEqual([]);
    expect(m.draft.details).toEqual({ commitmentMonths: 36, ownershipTransferTerms: '계약 종료 후 전액 납부 완료 시 이전' });
    expect(m.evidence.counterparty).toBe('업체명 클린에어코리아 주식회사');

    // 저장하면: 10/12 시작 + 렌탈료 + 설치비, 10월 지출 49,900원
    const r = draftToRecord(m.draft, 'x', '2026-10-06');
    expect(scheduleForRange([r], { start: '2026-10-12', end: '2026-10-12' }, '2026-10-06').map((i) => i.title).sort()).toEqual(['월 렌탈료', '이용 시작', '초기 설치비'].sort());
    expect(monthSpending([r], { year: 2026, month: 10 }).total).toBe(49_900);
  });

  test('체결일이 없으면 만들지 않음 (선택값)', () => {
    const o = rentalOutput();
    o.dates = o.dates.filter((d) => (d as { meaning: string }).meaning !== 'contract_signed');
    const m = toReviewModel(toAppResult(o, 'openai'));
    expect(m.draft.contractDate).toBeNull();
    expect(m.flagged.has('contractDate')).toBe(false);
  });

  test('유형 신뢰도가 높지 않으면 확인 필요 + 대안 유형', () => {
    const o = output({ type: { value: 'auto_installment', confidence: 'medium', alternatives: ['recurring', 'loan'], reason: '할부원금과 월 납입금이 있습니다.', ...ev() } });
    const m = toReviewModel(toAppResult(o, 'openai'));
    expect(m.flagged.has('contractType')).toBe(true);
    expect(m.typeSuggestion).toMatchObject({ value: 'auto_installment', confidence: 'medium', alternatives: ['recurring', 'loan'] });
  });

  test('전세: 계약금·잔금(보증금)은 결제 목록, 입주일은 주요 날짜, 잔금일 중복 제거', () => {
    const o = output({
      type: { value: 'lease', confidence: 'high', alternatives: [], reason: '', ...ev() },
      fields: { title: f('전세계약서'), category: f('real_estate'), counterparty: f('김임대'), depositAmount: f(200_000_000) },
      dates: [
        date('2026-09-01', 'contract_signed', '계약일'),
        date('2026-11-01', 'contract_start', '임대차 기간 시작'),
        date('2028-10-31', 'contract_end', '임대차 기간 종료'),
        date('2026-11-01', 'balance_due', '잔금일'),
        date('2026-11-01', 'move_in', '입주일'),
      ],
      payments: [
        pay({ kind: 'deposit', label: '계약금', amount: 20_000_000, frequency: 'one_time', date: '2026-09-01' }),
        pay({ kind: 'deposit', label: '잔금', amount: 180_000_000, frequency: 'one_time', date: '2026-11-01' }),
      ],
      details: { lease_kind: 'jeonse', interest_rate: 3.1 },
    });
    const m = toReviewModel(toAppResult(o, 'openai'));
    expect(m.draft).toMatchObject({ contractType: 'lease', contractDate: '2026-09-01', startDate: '2026-11-01', endDate: '2028-10-31', depositAmount: 200_000_000 });
    expect(m.draft.dates).toEqual([{ kind: 'move_in', label: '입주일', date: '2026-11-01' }]);
    expect(m.draft.details).toEqual({ leaseKind: 'jeonse' }); // 임대차에 없는 금리는 제외
    expect(m.allDetails).toMatchObject({ interestRate: 3.1 }); // 유형을 바꾸면 다시 쓸 수 있게 보관
    expect(monthSpending([draftToRecord(m.draft, 'j', '2026-10-06')], { year: 2026, month: 11 }).total).toBe(0);
  });

  test('대출: 실행일 → 시작, 만기 → 종료, 첫 상환일 → 결제 시작, 회차', () => {
    const o = output({
      type: { value: 'loan', confidence: 'high', alternatives: [], reason: '', ...ev() },
      fields: { title: f('신용대출 약정서'), counterparty: f('PACTO은행') },
      dates: [date('2026-10-15', 'loan_execution', '대출 실행일'), date('2031-10-15', 'maturity', '만기일'), date('2026-11-15', 'first_payment', '최초 상환일')],
      payments: [pay({ kind: 'loan_repayment', label: '월 원리금', amount: 948_000, frequency: 'monthly', day_of_month: 15, installment_count: 60 })],
      details: { principal: 50_000_000, interest_rate: 5.2, repayment_method: 'equal_payment' },
    });
    const m = toReviewModel(toAppResult(o, 'openai'));
    expect(m.draft).toMatchObject({ startDate: '2026-10-15', endDate: '2031-10-15' });
    expect(m.draft.payments[0]).toMatchObject({ startsOn: '2026-11-15', installmentCount: 60 });
    expect(m.draft.dates).toEqual([]);
    expect(DETAIL_SCHEMAS.loan.safeParse(m.draft.details).success).toBe(true);
  });

  test('일회성: 계약금·중도금·잔금 각 날짜, 완료일 → 종료', () => {
    const o = output({
      type: { value: 'one_time', confidence: 'high', alternatives: [], reason: '', ...ev() },
      fields: { title: f('인테리어 공사 계약'), counterparty: f('PACTO인테리어') },
      dates: [date('2026-10-10', 'contract_start', '착공일'), date('2026-12-20', 'completion', '완공일')],
      payments: [
        pay({ kind: 'down_payment', label: '계약금', amount: 3_000_000, frequency: 'one_time', date: '2026-10-10' }),
        pay({ kind: 'interim_payment', label: '중도금', amount: 5_000_000, frequency: 'one_time', date: '2026-11-15' }),
        pay({ kind: 'balance_payment', label: '잔금', amount: 2_000_000, frequency: 'one_time', date: '2026-12-20' }),
      ],
    });
    const m = toReviewModel(toAppResult(o, 'openai'));
    expect(m.draft).toMatchObject({ startDate: '2026-10-10', endDate: '2026-12-20' });
    expect(m.draft.payments.map((p) => p.startsOn)).toEqual(['2026-10-10', '2026-11-15', '2026-12-20']);
    expect([...m.flagged].filter((k) => k.startsWith('payments'))).toEqual([]);
  });

  test('통보기한 날짜만 있으면 일수로 계산하고 확인 필요', () => {
    const o = rentalOutput();
    o.fields.terminationNoticeDays = f(null, 'low');
    o.dates.push(date('2029-09-11', 'notice_deadline', '해지 통보기한'));
    const m = toReviewModel(toAppResult(o, 'openai'));
    expect(m.draft.terminationNoticeDays).toBe(30);
    expect(m.flagged.has('terminationNoticeDays')).toBe(true);
  });
});
