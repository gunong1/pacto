/* 계약서 분석 v5 — 서버(Edge Function) 공용 로직 + 앱 변환(toReviewModel) 검증 */
import {
  BANNED_PHRASES as SERVER_BANNED,
  extractionInstructions,
  extractionJsonSchema,
  FIELDS,
  PROMPT_VERSION,
  toAppResult,
} from '../../../supabase/functions/_shared/extraction.ts';
import { buildOpenAIRequest, readOutputText } from '../../../supabase/functions/_shared/ai/openai.ts';
import { MockExtractionProvider } from '../../../supabase/functions/_shared/ai/mock.ts';
import { activateCost, draftToRecord } from '@/data/draft';
import { coreInfo, extraCosts } from '@/domain/coreInfo';
import { BANNED_AI_PHRASES, findBannedPhrases } from '@/domain/aiCopy';
import { detailSchema } from '@/domain/contractTypes';
import { scheduleForRange } from '@/domain/schedule';
import { monthSpending, recurringMonthlyCost } from '@/domain/spending';
import { toReviewModel } from '@/features/registration/extraction';

const TODAY = '2026-10-06';
const q = (quote: string | null = null) => ({ evidence_quote: quote });
const f = (value: unknown, confidence = 'high', quote: string | null = null) => ({ value, confidence, ...q(quote) });
const cls = (value: string, confidence = 'high', alternatives: string[] = [], reason = '') => ({ value, confidence, alternatives, reason });
const date = (d: string, meaning: string, label: string, confidence = 'high') => ({ date: d, meaning, label, confidence, ...q() });
const pay = (p: Record<string, unknown>) => ({ direction: 'expense', day_of_month: null, date: null, end_date: null, installment_count: null, is_variable: false, optional: false, confidence: 'high', ...q(), ...p });
const det = (key: string, v: string | number | boolean, confidence = 'high', source_type = 'explicit') => ({
  key,
  text_value: typeof v === 'string' ? v : null,
  number_value: typeof v === 'number' ? v : null,
  boolean_value: typeof v === 'boolean' ? v : null,
  confidence,
  source_type,
  ...q(),
});
const check = (c: Record<string, unknown>) => ({ severity: 'check', topic: 'other', title: '조항', description: '기재되어 있습니다.', confidence: 'high', related_date: null, evidence_quote: '원문', evidence_page: 1, evidence_file: 1, ...c });

function output(o: { category?: unknown; type?: unknown; fields?: Record<string, unknown>; dates?: unknown[]; payments?: unknown[]; details?: unknown[]; checks?: unknown[] }) {
  const fields: Record<string, unknown> = {};
  for (const k of Object.keys(FIELDS)) fields[k] = f(null, 'low');
  return {
    category: o.category ?? cls('other'),
    contract_type: o.type ?? cls('other'),
    fields: { ...fields, ...o.fields },
    dates: o.dates ?? [],
    payments: o.payments ?? [],
    details: o.details ?? [],
    checks: o.checks ?? [],
  };
}
const review = (o: Parameters<typeof output>[0], docs: string[] = ['doc-1']) => toReviewModel(toAppResult(output(o), 'openai'), docs);
const titlesOn = (m: ReturnType<typeof review>, d: string) => scheduleForRange([draftToRecord(m.draft, 'x', TODAY)], { start: d, end: d }, TODAY).map((i) => i.title).sort();

/** 사용자가 올린 샘플 렌탈 계약서 */
const rental = () => ({
  category: cls('rental'),
  type: cls('recurring', 'high', [], '매월 렌탈료를 내는 계약입니다.'),
  fields: { title: f('공기청정기 렌탈 계약서'), counterparty: f('클린에어코리아 주식회사', 'high', '업체명 클린에어코리아 주식회사'), autoRenewal: f(true), renewalPeriodMonths: f(12), terminationNoticeDays: f(30) },
  dates: [date('2026-10-05', 'contract_signed', '계약 체결일'), date('2026-10-12', 'contract_start', '계약 기간 시작'), date('2029-10-11', 'contract_end', '계약 기간 종료')],
  payments: [pay({ kind: 'recurring_fee', label: '월 렌탈료', amount: 29900, frequency: 'monthly', day_of_month: 12 }), pay({ kind: 'setup_fee', label: '초기 설치비', amount: 20000, frequency: 'one_time' })],
  details: [det('commitment_months', 36), det('ownership_transfer_terms', '계약 종료 후 전액 납부 완료 시 이전')],
  checks: [
    check({ severity: 'caution', topic: 'auto_renewal', title: '자동갱신', description: '계약 종료 30일 전까지 해지 의사를 표시하지 않으면 12개월 자동 연장되는 것으로 기재되어 있습니다.', evidence_quote: '계약 종료 30일 전까지 해지 의사를 표시하지 않으면 동일 조건으로 12개월 자동 연장됩니다.', evidence_page: 1 }),
    check({ severity: 'check', topic: 'early_termination', title: '위약금', description: '이 조항은 명백히 불공정하여 고객에게 불리합니다.', evidence_quote: '잔여 렌탈료 총액의 10%' }),
  ],
});

describe('분석 v4 — 서버 스키마·프롬프트', () => {
  test('프롬프트 버전 · 분석 순서 · 표현 규칙', () => {
    expect(PROMPT_VERSION).toBe('extract-v6');
    const ins = extractionInstructions(TODAY);
    for (const s of ['1) category', '2) contract_type', 'dates', 'payments', 'details', 'checks', 'employment', 'service', 'sale', '확인이 필요한 조건입니다']) expect(ins).toContain(s);
  });

  test('strict 요건: 모든 객체가 required = 전체 속성, additionalProperties false', () => {
    const walk = (s: Record<string, unknown>, path: string) => {
      if (s.type === 'object') {
        expect([path, (s.required as string[]).sort()]).toEqual([path, Object.keys(s.properties as object).sort()]);
        expect([path, s.additionalProperties]).toEqual([path, false]);
        for (const [k, v] of Object.entries(s.properties as Record<string, Record<string, unknown>>)) walk(v, `${path}.${k}`);
      }
      if (s.type === 'array') walk(s.items as Record<string, unknown>, `${path}[]`);
    };
    walk(extractionJsonSchema() as Record<string, unknown>, '$');
  });

  test('스키마 크기: 객체 속성 100개 이하, 중첩 5단계 이하 — 유형이 늘어도 속성 수는 늘지 않음(키 목록 방식)', () => {
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

  test('금지 표현 목록은 앱과 서버가 동일', () => {
    expect([...SERVER_BANNED].sort()).toEqual([...BANNED_AI_PHRASES].sort());
  });

  test('형식이 틀린 값은 버리거나 낮춤 · 금지 표현은 중립 문장 · 같은 결제 중복 제거 · 근거 없는 체크는 신뢰도 low', () => {
    const r = toAppResult(
      output({
        category: cls('nope'),
        type: cls('weird', 'high', ['loan', 'loan', 'nope'], '위험한 계약입니다'),
        fields: { renewalPeriodMonths: f(999) },
        dates: [date('2026-02-30', 'contract_start', 'x'), date('2026-03-01', 'bogus', '기타')],
        payments: [
          pay({ kind: 'rent', label: '월세', amount: -5, frequency: 'monthly' }),
          pay({ kind: 'salary', label: '월 급여', amount: 3000000, frequency: 'monthly', direction: 'weird', day_of_month: 25 }),
          pay({ kind: 'salary', label: '급여(제5조)', amount: 3000000, frequency: 'monthly', day_of_month: 25 }),
        ],
        details: [det('interest_rate', '4.5%'), det('repayment_method', 'weird'), det('principal', 1000), det('unknown_key', 'x')],
        checks: [check({ description: '이 조항은 무효입니다.' }), check({ evidence_quote: null, related_date: '2027-01-05', evidence_file: 2 })],
      }),
      'openai',
    );
    expect(r.category).toMatchObject({ value: 'other', confidence: 'low' });
    expect(r.contractType).toMatchObject({ value: 'other', confidence: 'low', alternatives: ['loan'], reason: '계약서 내용을 바탕으로 분류했어요.' });
    expect(r.fields.renewalPeriodMonths).toMatchObject({ value: null, confidence: 'low' });
    expect(r.dates).toEqual([{ date: '2026-03-01', meaning: 'other', label: '기타', confidence: 'high', sourceType: 'inferred' }]); // 출처를 모르면 추정으로
    expect(r.payments.map((p) => [p.kind, p.direction, p.amount])).toEqual([['salary', 'income', 3000000]]);
    expect(Object.keys(r.details)).toEqual(['principal']);
    expect(r.checks[0].description).toBe('계약서의 해당 조항을 확인해주세요.');
    expect(r.checks[1]).toMatchObject({ confidence: 'low', evidenceFileIndex: 1, relatedDate: '2027-01-05', suggestion: { kind: 'add_event', eventDate: '2027-01-05' } });
  });

  test('구조가 틀리면 예외', () => {
    expect(() => toAppResult({ foo: 1 }, 'openai')).toThrow('invalid_output_shape');
  });

  test('서버 mock 출력도 같은 검증을 통과', async () => {
    const out = await new MockExtractionProvider().extract([{ mimeType: 'application/pdf', fileName: '렌탈.pdf', base64: '' }]);
    const r = toAppResult(out.json, 'mock');
    expect(r.payments).toHaveLength(2);
    expect(r.category.value).toBe('rental');
    expect(r.checks[0]).toMatchObject({ topic: 'auto_renewal', evidencePage: 1, evidenceFileIndex: 0, suggestion: { kind: 'set_termination_notice' } });
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
  });

  test('OpenAI 응답 파싱 (output 배열 / refusal)', () => {
    expect(readOutputText({ output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] }] })).toBe('{"a":1}');
    expect(() => readOutputText({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] })).toThrow('model_refused');
  });
});

describe('분석 v4 → 확인 화면 (toReviewModel)', () => {
  test('샘플 렌탈: 분야·유형, 체결·시작·종료 분리, 설치비는 시작일로 계산 + 확인 필요, 10월 49,900원', () => {
    const m = review(rental());
    expect(m.draft).toMatchObject({ category: 'rental', contractType: 'recurring', contractDate: '2026-10-05', startDate: '2026-10-12', endDate: '2029-10-11', autoRenewal: true, terminationNoticeDays: 30 });
    expect(m.draft.payments.map((p) => [p.kind, p.direction, p.amount, p.dayOfMonth, p.startsOn])).toEqual([
      ['recurring_fee', 'expense', 29_900, 12, null],
      ['setup_fee', 'expense', 20_000, null, null],
    ]);
    expect(m.flagged.has('payments.1.startsOn')).toBe(true);
    expect(m.flagged.has('category') || m.flagged.has('contractType')).toBe(false);
    expect(m.draft.details).toEqual({ commitmentMonths: 36, ownershipTransferTerms: '계약 종료 후 전액 납부 완료 시 이전' });
    expect(titlesOn(m, '2026-10-12')).toEqual(['월 렌탈료', '이용 시작', '초기 설치비'].sort());
    expect(monthSpending([draftToRecord(m.draft, 'x', TODAY)], { year: 2026, month: 10 }).total).toBe(49_900);
  });

  test('PACTO 계약 체크: 원문 근거(문서 id·쪽·문장) 연결, 자동갱신 → 해지 통보기한 일정 제안, 금지 표현 없음', () => {
    const m = review(rental(), ['doc-a', 'doc-b']);
    expect(m.checks[0]).toMatchObject({ severity: 'caution', topic: 'auto_renewal', evidenceDocumentId: 'doc-a', evidencePage: 1, confidence: 'high', suggestion: { kind: 'set_termination_notice', terminationNoticeDays: 30 } });
    for (const c of m.checks) expect(findBannedPhrases(c.title + c.description)).toEqual([]);
  });

  test('체결일이 없으면 만들지 않음 (선택값)', () => {
    const o = rental();
    o.dates = o.dates.filter((d) => d.meaning !== 'contract_signed');
    const m = review(o);
    expect(m.draft.contractDate).toBeNull();
    expect(m.flagged.has('contractDate')).toBe(false);
  });

  test('분야·유형 신뢰도가 높지 않으면 확인 필요 + 다른 가능성 (자동차 분야 · 할부?)', () => {
    const m = review({ category: cls('vehicle', 'high'), type: cls('installment', 'medium', ['recurring', 'sale'], '할부원금과 월 납입금이 있습니다.') });
    expect(m.flagged.has('contractType')).toBe(true);
    expect(m.flagged.has('category')).toBe(false);
    expect(m.typeSuggestion).toMatchObject({ value: 'installment', confidence: 'medium', alternatives: ['recurring', 'sale'] });
  });

  test('근로계약: 급여는 수입, 근로 시작일·입사일·급여일, 유형별 속성, 기간 없는 계약은 종료일 없음', () => {
    const m = review({
      category: cls('employment'),
      type: cls('employment'),
      fields: { title: f('근로계약서'), counterparty: f('PACTO 주식회사') },
      dates: [date('2026-10-20', 'contract_signed', '작성일'), date('2026-11-02', 'contract_start', '근로 개시일'), date('2026-11-02', 'hire', '입사일')],
      payments: [pay({ kind: 'salary', direction: 'income', label: '월 급여', amount: 3_500_000, frequency: 'monthly', day_of_month: 25 })],
      details: [det('employment_kind', 'permanent'), det('probation_months', 3), det('work_hours', '09:00~18:00 (휴게 1시간)'), det('annual_salary', 42_000_000)],
      checks: [check({ topic: 'probation', title: '수습기간', description: '수습기간 3개월 동안 급여의 90%를 지급하는 것으로 기재되어 있습니다.' }), check({ topic: 'non_compete', title: '경업금지', description: '퇴직 후 1년간 동종업계 취업을 제한하는 조건이 포함되어 있습니다.' })],
    });
    expect(m.draft).toMatchObject({ category: 'employment', contractType: 'employment', startDate: '2026-11-02', endDate: null, contractDate: '2026-10-20' });
    expect(m.draft.payments[0]).toMatchObject({ kind: 'salary', direction: 'income', dayOfMonth: 25 });
    expect(m.draft.dates).toEqual([{ kind: 'hire', label: '입사일', date: '2026-11-02' }]);
    expect(detailSchema('employment').safeParse(m.draft.details).success).toBe(true);
    expect(m.draft.details).toMatchObject({ employmentKind: 'permanent', probationMonths: 3, annualSalary: 42_000_000 });
    const r = draftToRecord(m.draft, 'j', TODAY);
    expect(monthSpending([r], { year: 2026, month: 11 })).toMatchObject({ total: 0, incomeTotal: 3_500_000 });
    expect(m.flagged.has('endDate')).toBe(false); // 기간 없는 근로계약은 정상
    expect(m.checks.map((c) => c.topic)).toEqual(['probation', 'non_compete']);
  });

  test('용역(프리랜서): 대금은 수입, 납기·검수일은 주요 날짜', () => {
    const m = review({
      category: cls('service'),
      type: cls('service'),
      fields: { title: f('디자인 용역 계약서'), counterparty: f('발주사') },
      dates: [date('2026-10-15', 'contract_start', '착수일'), date('2026-12-31', 'contract_end', '계약 종료'), date('2026-12-15', 'delivery', '납기'), date('2026-12-22', 'inspection', '검수')],
      payments: [
        pay({ kind: 'down_payment', direction: 'income', label: '착수금', amount: 3_000_000, frequency: 'one_time', date: '2026-10-15' }),
        pay({ kind: 'balance_payment', direction: 'income', label: '잔금', amount: 7_000_000, frequency: 'one_time', date: '2026-12-31' }),
      ],
      details: [det('user_role', 'provider'), det('deliverable_ownership', '대금 완납 시 저작권 양도')],
      checks: [check({ topic: 'revision', severity: 'caution', title: '수정 요청', description: '수정 요청 횟수 제한이 기재되어 있지 않습니다. 확인이 필요한 조건입니다.' })],
    });
    expect(m.draft.dates.map((d) => d.kind)).toEqual(['delivery', 'inspection']);
    expect(titlesOn(m, '2026-12-15')).toEqual(['납기']);
    expect(monthSpending([draftToRecord(m.draft, 's', TODAY)], { year: 2026, month: 12 })).toMatchObject({ total: 0, incomeTotal: 7_000_000 });
  });

  test('매매: 계약금·중도금·잔금 각각, 인도·소유권 이전일, 완료일 → 종료', () => {
    const m = review({
      category: cls('sale'),
      type: cls('sale'),
      fields: { title: f('부동산 매매계약서'), counterparty: f('매도인'), totalAmount: f(200_000_000) },
      dates: [date('2026-10-10', 'contract_signed', '계약일'), date('2027-01-31', 'handover', '인도일'), date('2027-02-05', 'ownership_transfer', '소유권 이전'), date('2027-02-05', 'completion', '완료')],
      payments: [
        pay({ kind: 'down_payment', label: '계약금', amount: 20_000_000, frequency: 'one_time', date: '2026-10-10' }),
        pay({ kind: 'interim_payment', label: '중도금', amount: 50_000_000, frequency: 'one_time', date: '2026-11-30' }),
        pay({ kind: 'balance_payment', label: '잔금', amount: 130_000_000, frequency: 'one_time', date: '2027-01-31' }),
      ],
      details: [det('user_role', 'buyer'), det('subject', '아파트')],
    });
    expect(m.draft).toMatchObject({ contractType: 'sale', endDate: '2027-02-05', totalAmount: 200_000_000 });
    expect(m.draft.dates.map((d) => d.kind)).toEqual(['handover', 'ownership_transfer']);
    expect(titlesOn(m, '2027-01-31')).toEqual(['인도일', '잔금']);
  });

  test('전세: 보증금 계약금·잔금은 neutral(지출 제외), 입주일, 금리 같은 다른 유형 속성은 보관만', () => {
    const m = review({
      category: cls('real_estate'),
      type: cls('lease'),
      fields: { title: f('전세계약서'), counterparty: f('김임대'), depositAmount: f(200_000_000) },
      dates: [date('2026-09-01', 'contract_signed', '계약일'), date('2026-11-01', 'contract_start', '시작'), date('2028-10-31', 'contract_end', '종료'), date('2026-11-01', 'balance_due', '잔금일'), date('2026-11-01', 'move_in', '입주일')],
      payments: [
        pay({ kind: 'deposit', direction: 'neutral', label: '계약금', amount: 20_000_000, frequency: 'one_time', date: '2026-09-01' }),
        pay({ kind: 'deposit', direction: 'neutral', label: '잔금', amount: 180_000_000, frequency: 'one_time', date: '2026-11-01' }),
      ],
      details: [det('lease_kind', 'jeonse'), det('interest_rate', 3.1)],
    });
    expect(m.draft.dates).toEqual([{ kind: 'move_in', label: '입주일', date: '2026-11-01' }]);
    expect(m.draft.details).toEqual({ leaseKind: 'jeonse' });
    expect(m.allDetails).toMatchObject({ interestRate: 3.1 });
    expect(monthSpending([draftToRecord(m.draft, 'j', TODAY)], { year: 2026, month: 11 })).toMatchObject({ total: 0, depositTotal: 180_000_000 });
  });

  test('통보기한 날짜만 있으면 일수로 계산하고 확인 필요', () => {
    const o = rental();
    o.fields.terminationNoticeDays = f(null, 'low');
    o.dates.push(date('2029-09-11', 'notice_deadline', '해지 통보기한'));
    const m = review(o);
    expect(m.draft.terminationNoticeDays).toBe(30);
    expect(m.flagged.has('terminationNoticeDays')).toBe(true);
  });
});

describe('헬스장 샘플 계약서: 락커 이용료(선택, 결제일 없음 · 월 이용료와 함께 청구)', () => {
  const gym = (lockerTwice = false) => ({
    category: cls('membership'),
    type: cls('recurring'),
    fields: { title: f('헬스장 회원권 이용 계약서'), counterparty: f('바디핏 피트니스 둔산점'), autoRenewal: f(true), renewalPeriodMonths: f(1), terminationNoticeDays: f(7) },
    dates: [date('2026-11-01', 'contract_signed', '계약 체결일'), date('2026-11-03', 'service_start', '이용 시작일'), date('2027-11-02', 'contract_end', '이용 종료일')],
    payments: [
      pay({ kind: 'recurring_fee', label: '월 이용료', amount: 55_000, frequency: 'monthly', day_of_month: 5 }),
      pay({ kind: 'recurring_fee', label: '락커 이용료', amount: 5_000, frequency: 'monthly', optional: true }),
      ...(lockerTwice ? [pay({ kind: 'recurring_fee', label: '락커 이용료 (제2조)', amount: 5_000, frequency: 'monthly', optional: true })] : []),
    ],
  });

  test('락커 이용료는 선택형 — 결제 일정·지출에 넣지 않고, 이용하게 되면 쓸 결제일(월 이용료와 같은 5일)만 준비', () => {
    const m = review(gym());
    expect(m.draft.payments.map((p) => [p.label, p.obligation, p.dayOfMonth])).toEqual([['월 이용료', 'confirmed', 5], ['락커 이용료', 'optional', 5]]);
    expect(m.notes['payments.1.obligation']).toContain('선택 항목');
    expect(m.flagged.has('payments.1.obligation')).toBe(true);
    expect(titlesOn(m, '2026-11-03')).toEqual(['이용 시작']);
    expect(titlesOn(m, '2026-11-05')).toEqual(['월 이용료']);
    expect(monthSpending([draftToRecord(m.draft, 'g', TODAY)], { year: 2026, month: 12 }).total).toBe(55_000);
  });

  test('같은 결제가 두 번 나와도 한 번만', () => {
    expect(toAppResult(output(gym(true)), 'openai').payments.map((p) => p.label)).toEqual(['월 이용료', '락커 이용료']);
  });
});

/**
 * 근로계약서 (주식회사 네오링크 · 박민준) — 숫자·날짜의 의미를 먼저 해석한다.
 * 1) mock 공급자 근로 예시(의미를 해석한 출력) 2) 실제로 관찰된 잘못된 출력(v4 형태)도 서버 안전장치가 바로잡는지
 */
describe('분석 v5 — 의미 해석 (근로계약)', () => {
  const employmentReview = async () => {
    const out = await new MockExtractionProvider().extract([{ mimeType: 'application/pdf', fileName: '근로계약서.pdf', base64: '' }]);
    return toReviewModel(toAppResult(out.json, 'mock'), ['doc-1']);
  };

  test('월 임금 1건 + 구성 항목(합산 안 함) · 직전 영업일 · 연봉 없음 · 고용 형태는 추정', async () => {
    const m = await employmentReview();
    expect(m.draft.payments).toHaveLength(1);
    expect(m.draft.payments[0]).toMatchObject({
      label: '월 임금', amount: 3_600_000, direction: 'income', dayOfMonth: 25, businessDayRule: 'previous', obligation: 'confirmed', conditionNote: null,
      components: [{ label: '기본급', amount: 3_280_000 }, { label: '고정연장근로수당', amount: 320_000 }],
    });
    expect(m.notes['payments.0.amount']).toContain('따로 더하지 않아요');
    expect(m.draft.details.annualSalary).toBeUndefined();
    expect(m.draft.details).toMatchObject({ probationMonths: 3, probationPayRate: 90, employmentKind: 'fixed_term' });
    expect(m.draft.valueSources['details.employmentKind']).toBe('inferred');
    expect(m.flagged.has('details.employmentKind')).toBe(true);
    expect(m.draft.valueSources['details.probationPayRate']).toBe('explicit');
    expect(m.draft.autoRenewal).toBe(false);
    expect(m.draft.terminationNoticeDays).toBeNull();
  });

  test('퇴직 사전통보는 조건부 규칙 (날짜·제안 없음), 수습 체크는 이미 있는 날짜로 일정 제안을 만들지 않음', async () => {
    const m = await employmentReview();
    const resign = m.checks.find((c) => c.topic === 'resignation_notice')!;
    expect(resign).toMatchObject({ behavior: 'conditional_rule', relatedDate: null, suggestion: null, rule: { offsetDays: 30 } });
    expect(m.checks.find((c) => c.topic === 'probation')!.suggestion).toBeNull();
    expect(m.checks.every((c) => c.suggestion === null)).toBe(true);
    // 계약 체크 분류: 급여일은 핵심 정보, 나머지 7개는 확인 필요, 주의 필요 없음
    expect(m.checks.map((c) => c.severity)).toEqual(['info', 'check', 'check', 'check', 'check', 'check', 'check', 'check']);
    expect(m.checks.map((c) => c.topic)).toEqual(expect.arrayContaining(['work_change', 'fixed_overtime', 'probation', 'resignation_notice', 'renewal_terms', 'confidentiality', 'asset_return']));
  });

  test('관리 데이터: 2027-08-31 통보기한 없음, 수습 중 3,240,000 → 이후 3,600,000, 휴일 지급일 조정', async () => {
    const m = await employmentReview();
    const r = draftToRecord(m.draft, 'e', TODAY);
    const on = (d: string) => scheduleForRange([r], { start: d, end: d }, TODAY).map((i) => `${i.title}${i.amount != null ? ` ${i.amount}` : ''}`);
    expect(on('2027-08-31')).toEqual([]);
    expect(on('2026-10-23')).toEqual(['월 임금 (수습기간 90%) 3240000']);
    expect(on('2026-12-31')).toEqual(['수습기간 종료 예정']);
    expect(on('2027-01-25')).toEqual(['월 임금 3600000']);
    expect(monthSpending([r], { year: 2027, month: 1 })).toMatchObject({ incomeTotal: 3_600_000, total: 0 });
  });

  test('잘못된 출력(관찰된 v4 형태)도 서버가 바로잡음: 수당 별도 수입·연봉=월 임금·퇴직 통보를 종료일 통보기한으로', () => {
    const wage = '월 임금은 3,600,000원으로 하며, 기본급 3,280,000원과 고정연장근로수당 320,000원으로 구성한다.';
    const resignQuote = '근로자가 퇴직하고자 하는 경우 30일 전에 회사에 통보하여야 한다.';
    const r = toAppResult(
      output({
        category: cls('employment'),
        type: cls('employment'),
        fields: { counterparty: f('주식회사 네오링크'), autoRenewal: f(false), terminationNoticeDays: f(30, 'medium', resignQuote) },
        dates: [date('2026-10-01', 'contract_start', '근로 시작'), date('2027-09-30', 'contract_end', '근로 종료')],
        payments: [
          pay({ kind: 'salary', direction: 'income', label: '월 임금', amount: 3600000, frequency: 'monthly', day_of_month: 25, ...q(wage) }),
          pay({ kind: 'salary', direction: 'income', label: '고정연장근로수당', amount: 320000, frequency: 'monthly', day_of_month: 25, ...q('고정연장근로수당 320,000원은 월 임금에 포함된다.') }),
        ],
        details: [det('annual_salary', 3600000), det('probation_months', 3), det('employment_kind', 'fixed_term', 'high', 'inferred')],
        checks: [
          check({ topic: 'resignation_notice', title: '퇴직 통보', evidence_quote: resignQuote, related_date: '2027-08-31' }),
          check({ topic: 'probation', title: '수습기간', related_date: '2026-10-01' }),
        ],
      }),
      'openai',
    );
    expect(r.payments.map((p) => [p.label, p.amount])).toEqual([['월 임금', 3600000]]);
    expect(r.payments[0].components).toEqual([{ label: '고정연장근로수당', amount: 320000 }]);
    expect(r.details.annual_salary).toBeUndefined();
    expect(r.details.probation_months?.value).toBe(3);
    expect(r.fields.terminationNoticeDays.value).toBeNull();
    expect(r.checks[0]).toMatchObject({ behavior: 'conditional_rule', relatedDate: null, suggestion: null });
    expect(r.checks[1].suggestion).toBeNull(); // 2026-10-01은 이미 근로 시작일
    const m = toReviewModel(r, ['doc-1']);
    const rec = draftToRecord(m.draft, 'n', TODAY);
    expect(scheduleForRange([rec], { start: '2027-08-31', end: '2027-08-31' }, TODAY)).toEqual([]);
  });

  test('자동갱신 계약의 종료일 기준 통보기한은 유지 (조건부 규칙과 일수가 달라도)', () => {
    const r = toAppResult(output({ ...rental(), checks: [...rental().checks, check({ topic: 'early_termination', behavior: 'conditional_rule', offset_days: 30 })] }), 'openai');
    expect(r.fields.terminationNoticeDays.value).toBe(30);
    expect(r.checks.find((c) => c.topic === 'auto_renewal')!.suggestion).toMatchObject({ kind: 'set_termination_notice', terminationNoticeDays: 30 });
  });

  test('합계·참고 금액은 결제가 아니라 참고로', () => {
    const r = toAppResult(output({ payments: [pay({ role: 'reference', kind: 'other', label: '차량가', amount: 30000000, frequency: 'one_time' }), pay({ kind: 'installment', label: '월 할부금', amount: 500000, frequency: 'monthly' })] }), 'openai');
    expect(r.payments.map((p) => p.label)).toEqual(['월 할부금']);
    expect(r.references).toEqual([{ label: '차량가', amount: 30000000, role: 'reference' }]);
  });

  test('스키마 크기 제한 (속성 100개 이하, 중첩 5단계 이하)', () => {
    let props = 0;
    let depth = 0;
    const walk = (s: Record<string, unknown>, d: number) => {
      depth = Math.max(depth, d);
      if (s.properties) for (const v of Object.values(s.properties as Record<string, Record<string, unknown>>)) {
        props++;
        walk(v, d + 1);
      }
      if (s.items) walk(s.items as Record<string, unknown>, d + 1);
    };
    walk(extractionJsonSchema() as unknown as Record<string, unknown>, 0);
    expect(props).toBeLessThanOrEqual(100);
    expect(depth).toBeLessThanOrEqual(10);
  });
});

/**
 * 헬스장 1년권 — 금액이 적혀 있다고 모두 결제가 아니다.
 * 1년 회원권 660,000원(일시불) = 확정 결제 1회 / 양도 수수료 30,000원 = 조건부 / 락커 월 5,000원 = 선택형
 */
describe('분석 v6 — 금액의 의무 수준 (헬스장 1년권)', () => {
  const gymReview = async () => {
    const out = await new MockExtractionProvider().extract([{ mimeType: 'application/pdf', fileName: '헬스장_1년권_계약서.pdf', base64: '' }]);
    return toReviewModel(toAppResult(out.json, 'mock'), ['doc-1']);
  };
  /** 회귀 5항목 — 캘린더(1년치)·지출 */
  const verify = (m: ReturnType<typeof review>) => {
    const r = draftToRecord(m.draft, 'gym', TODAY);
    const year = scheduleForRange([r], { start: '2026-10-01', end: '2027-10-31' }, TODAY).filter((i) => i.type === 'payment');
    // 1·3) 양도 수수료·락커비는 캘린더에 없음
    expect(year.map((i) => i.title)).toEqual(['1년 회원권']);
    // 4·5) 회원권 660,000원만 확정 결제, 한 번만 (월 12회로 나누지 않음)
    expect(year.map((i) => [i.date, i.amount])).toEqual([['2026-10-06', 660_000]]);
    // 2) 지출 합계: 결제한 달만 660,000, 이후 달은 0, 연간 660,000
    expect(monthSpending([r], { year: 2026, month: 10 }).total).toBe(660_000);
    for (let mo = 11; mo <= 12; mo++) expect(monthSpending([r], { year: 2026, month: mo }).total).toBe(0);
    expect(monthSpending([r], { year: 2027, month: 6 }).total).toBe(0);
    // 홈 "매달 나가는 정기 계약비": 1년권 일시불은 매달 나가는 돈이 아님
    expect(recurringMonthlyCost([r], TODAY)).toBe(0);
    // 상세: 결제와 "추가로 발생할 수 있는 비용"을 나눠 보여줌
    expect(extraCosts(r).map((x) => [x.label, x.value, x.obligation])).toEqual([
      ['양도 수수료', '30,000원', 'conditional'],
      ['락커 이용료', '월 5,000원', 'optional'],
    ]);
    return r;
  };

  test('mock 공급자(의미를 해석한 출력): 회원권 확정 1회 · 양도 수수료 조건부 · 락커 선택형', async () => {
    const m = await gymReview();
    const r = verify(m);
    expect(extraCosts(r).map((x) => x.condition)).toEqual(['회원권을 양도하는 경우', '락커를 이용하는 경우']);
    expect(coreInfo(r, TODAY).filter((x) => x.key.startsWith('pay:')).map((x) => x.label)).toEqual(['1년 회원권']);
  });

  test('잘못된 출력(모두 확정 결제 · 1년권을 월납으로)도 서버 안전장치가 바로잡음', () => {
    const r = toAppResult(
      output({
        category: cls('membership'),
        type: cls('recurring'),
        fields: { title: f('헬스장 1년권'), counterparty: f('바디핏 피트니스') },
        dates: [date('2026-10-06', 'contract_signed', '계약일'), date('2026-10-10', 'service_start', '이용 시작일'), date('2027-10-09', 'contract_end', '이용 종료일')],
        payments: [
          pay({ kind: 'recurring_fee', label: '1년 회원권', amount: 660000, frequency: 'monthly', day_of_month: 6, date: '2026-10-06', ...q('1년 회원권 660,000원 (계약 시 일시불 결제)') }),
          pay({ kind: 'other', label: '양도 수수료', amount: 30000, frequency: 'one_time', date: '2026-10-06', ...q('회원권 양도 시 양도 수수료 30,000원을 부과한다.') }),
          pay({ kind: 'recurring_fee', label: '락커 이용료', amount: 5000, frequency: 'monthly', ...q('락커 이용 시 월 5,000원') }),
        ],
      }),
      'openai',
    );
    expect(r.payments.map((p) => [p.label, p.frequency, p.obligation])).toEqual([
      ['1년 회원권', 'one_time', 'confirmed'],
      ['양도 수수료', 'one_time', 'conditional'],
      ['락커 이용료', 'monthly', 'optional'],
    ]);
    verify(toReviewModel(r, ['doc-1']));
  });

  test('다른 계약도 같은 원칙: 초과주행료·연체이자·파손비·원상복구비·중도상환수수료는 조건부, 특약 보험료는 선택형', () => {
    const r = toAppResult(
      output({
        payments: [
          pay({ kind: 'recurring_fee', label: '월 리스료', amount: 450000, frequency: 'monthly', day_of_month: 10 }),
          pay({ kind: 'other', label: '초과주행료', amount: 150, frequency: 'one_time' }),
          pay({ kind: 'other', label: '연체이자', amount: 12000, frequency: 'one_time' }),
          pay({ kind: 'other', label: '제품 파손비', amount: 300000, frequency: 'one_time' }),
          pay({ kind: 'other', label: '원상복구비', amount: 500000, frequency: 'one_time' }),
          pay({ kind: 'other', label: '중도상환수수료', amount: 200000, frequency: 'one_time' }),
          pay({ kind: 'premium', label: '운전자 특약 보험료', amount: 8000, frequency: 'monthly' }),
        ],
      }),
      'openai',
    );
    expect(r.payments.map((p) => p.obligation)).toEqual(['confirmed', 'conditional', 'conditional', 'conditional', 'conditional', 'conditional', 'optional']);
  });

  test('조건이 실제로 생기면 결제로 전환: 양도 결정(2027-03-15) → 그날 30,000원 지출, 락커 이용(2026-11-01부터) → 월 5,000원', async () => {
    const m = await gymReview();
    const r = draftToRecord(m.draft, 'gym', TODAY);
    const fee = r.payments.find((p) => p.label === '양도 수수료')!;
    const locker = r.payments.find((p) => p.label === '락커 이용료')!;
    const afterFee = draftToRecord(activateCost(r, fee.id, '2027-03-15'), 'gym', TODAY);
    expect(monthSpending([afterFee], { year: 2027, month: 3 }).total).toBe(30_000);
    expect(scheduleForRange([afterFee], { start: '2027-03-15', end: '2027-03-15' }, TODAY).map((i) => i.title)).toEqual(['양도 수수료']);
    const afterLocker = draftToRecord(activateCost(r, locker.id, '2026-11-01'), 'gym', TODAY);
    expect(monthSpending([afterLocker], { year: 2026, month: 11 }).total).toBe(5_000);
    expect(monthSpending([afterLocker], { year: 2026, month: 10 }).total).toBe(660_000);
    expect(extraCosts(afterLocker).map((x) => x.label)).toEqual(['양도 수수료']);
  });
});
