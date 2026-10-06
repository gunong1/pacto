// 계약서 정보 추출 — 공급자와 무관한 스키마 / 프롬프트 / 검증 / 앱 형식 변환.
// 순수 TypeScript (Deno·Node 공용) — 앱 테스트(jest)에서도 같은 파일을 검증한다.
//
// v3 순서: 계약 유형 분류(신뢰도·대안) → 계약서의 날짜·금액을 "의미"와 함께 모두 나열 → 유형별 속성 → 확인할 조항.
// 정해진 칸을 억지로 채우지 않는다. 날짜/금액을 계약 필드·결제 목록으로 바꾸는 일은 앱(src/features/registration/extraction.ts)이
// 유형별 규칙으로 하고, 사용자가 확인한 뒤 저장한다.
// 아래 enum 목록은 앱 src/domain/contractTypes.ts 와 같아야 한다 (테스트로 검사).

export const PROMPT_VERSION = 'extract-v3';

export const CATEGORIES = ['real_estate', 'vehicle', 'insurance', 'telecom', 'rental', 'finance', 'employment', 'business', 'membership', 'subscription', 'other'] as const;
export const FREQUENCIES = ['monthly', 'bimonthly', 'quarterly', 'semiannual', 'yearly', 'one_time'] as const;
export const CONTRACT_TYPES = ['recurring', 'lease', 'auto_installment', 'loan', 'insurance', 'one_time', 'other'] as const;
export const PAYMENT_KINDS = [
  'recurring_fee', 'setup_fee', 'rent', 'maintenance_fee', 'deposit', 'installment', 'advance_payment',
  'loan_repayment', 'interest', 'premium', 'down_payment', 'interim_payment', 'balance_payment', 'other',
] as const;
/** 계약서에 나온 날짜의 의미 */
export const DATE_MEANINGS = [
  'contract_signed',   // 계약 체결일(작성·서명일)
  'contract_start',    // 계약 기간 시작일
  'contract_end',      // 계약 기간 종료일
  'service_start',     // 이용·서비스 개시일
  'installation',      // 설치일
  'activation',        // 개통일
  'move_in',           // 입주일
  'balance_due',       // 잔금일
  'loan_execution',    // 대출·할부 실행일
  'first_payment',     // 첫 납입·결제일
  'coverage_start',    // 보험 시작일
  'maturity',          // 만기일
  'renewal',           // 갱신일
  'completion',        // 계약 완료(이행 완료)일
  'notice_deadline',   // 해지·종료 통보기한 날짜
  'other',
] as const;
const CONFIDENCE = ['high', 'medium', 'low'] as const;
const SEVERITY = ['info', 'check', 'caution'] as const;
const TOPICS = ['auto_renewal', 'termination', 'penalty', 'deposit', 'payment', 'other'] as const;

/** AI 체크 문구 금지 표현 (앱 src/domain/aiCopy.ts와 동일 목록) */
export const BANNED_PHRASES = ['불법', '위법', '무효', '독소조항', '독소 조항', '불리합니다', '불리한', '유리합니다', '유리한', '손해를 봅니다', '반드시 손해'];

type FieldType = 'string' | 'integer' | 'boolean' | 'category';

/** 계약 공통 정보 (날짜·결제는 dates / payments 목록으로 따로 받는다) */
export const FIELDS: Record<string, { type: FieldType; desc: string }> = {
  title: { type: 'string', desc: '계약명 (예: 자동차보험, 정수기 렌탈, 전세계약). 계약서 제목이나 상품명을 짧게' },
  category: { type: 'category', desc: '사용자가 이해하는 분야 (부동산·자동차·보험·통신·렌탈·금융·근로·사업·회원권·구독·기타)' },
  counterparty: { type: 'string', desc: '사용자(고객·임차인·가입자·차주)의 계약 상대방 회사명 또는 이름. 계약서의 정식 명칭 그대로' },
  totalAmount: { type: 'integer', desc: '계약 총액(원). 명시된 경우만' },
  depositAmount: { type: 'integer', desc: '보증금·전세금 총액(원). 명시된 경우만' },
  autoRenewal: { type: 'boolean', desc: '만료 시 자동으로 연장되는 조건이 있는지 (묵시적 갱신 포함)' },
  renewalPeriodMonths: { type: 'integer', desc: '자동 연장 시 연장 기간(개월)' },
  terminationNoticeDays: { type: 'integer', desc: '종료·해지하려면 종료 며칠 전까지 알려야 하는지(일). 1개월 전이면 30, 2개월 전이면 60' },
  earlyTerminationTerms: { type: 'string', desc: '중도해지 조건 요약 (한 문장)' },
  penaltyTerms: { type: 'string', desc: '위약금 조건 요약 (한 문장)' },
};

/** 유형별 상세 속성 (앱 contractTypes.ts DETAIL_FIELDS의 DB 키와 같음). 해당 유형이 아니거나 없으면 null */
export const DETAIL_KEYS: Record<string, { type: 'string' | 'integer' | 'number' | 'boolean'; desc: string; options?: readonly string[] }> = {
  commitment_months: { type: 'integer', desc: '[월 납입형] 의무 사용기간(개월)' },
  ownership_transfer_terms: { type: 'string', desc: '[월 납입형] 소유권 이전 조건 요약' },
  lease_kind: { type: 'string', desc: '[임대차] 임대 형태', options: ['jeonse', 'monthly', 'semi_jeonse', 'commercial', 'other'] },
  renewal_terms: { type: 'string', desc: '[임대차] 갱신 관련 조건 요약' },
  vehicle_name: { type: 'string', desc: '[자동차 할부] 차량명' },
  vehicle_price: { type: 'integer', desc: '[자동차 할부] 차량가(원)' },
  advance_payment: { type: 'integer', desc: '[자동차 할부] 선수금(원)' },
  principal: { type: 'integer', desc: '[자동차 할부·대출] 할부원금 또는 대출원금(원)' },
  interest_rate: { type: 'number', desc: '[자동차 할부·대출] 연 금리(%) 숫자만. 예: 4.9' },
  total_installments: { type: 'integer', desc: '[자동차 할부] 총 할부기간(개월)' },
  repayment_method: { type: 'string', desc: '[대출] 상환방식', options: ['equal_payment', 'equal_principal', 'bullet', 'other'] },
  prepayment_fee_terms: { type: 'string', desc: '[대출] 중도상환수수료 조건 요약' },
  renewable: { type: 'boolean', desc: '[보험] 갱신형이면 true, 비갱신형이면 false' },
  renewal_cycle_years: { type: 'integer', desc: '[보험] 갱신 주기(년)' },
  coverage_summary: { type: 'string', desc: '[보험] 주요 보장 요약 (한 문장)' },
  subject: { type: 'string', desc: '[일회성] 계약 대상 (예: 아파트 인테리어 공사)' },
};

const nullable = (t: string) => ({ type: [t, 'null'] });
const evidenceProps = {
  evidence_page: { type: ['integer', 'null'], description: '근거가 있는 쪽 번호(1부터)' },
  evidence_quote: { type: ['string', 'null'], description: '계약서 원문에서 그대로 옮긴 근거 문장 (120자 이내)' },
};
// Structured Outputs 스키마 크기 제한(객체 속성 수)을 넉넉히 지키기 위해 공통 필드는 근거 문장만 받는다
const quoteOnly = { evidence_quote: evidenceProps.evidence_quote };
const strictObject = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

function fieldValueSchema(t: FieldType) {
  if (t === 'category') return { type: ['string', 'null'], enum: [...CATEGORIES, null] };
  return nullable(t);
}

/** Structured Outputs(strict)용 JSON Schema: 모든 속성 required, additionalProperties false */
export function extractionJsonSchema() {
  const fieldProps: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(FIELDS)) {
    fieldProps[key] = strictObject({ value: { ...fieldValueSchema(def.type), description: def.desc }, confidence: { type: 'string', enum: [...CONFIDENCE] }, ...quoteOnly });
  }
  const detailProps: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(DETAIL_KEYS)) {
    detailProps[key] = def.options ? { type: ['string', 'null'], enum: [...def.options, null], description: def.desc } : { ...nullable(def.type), description: def.desc };
  }
  return strictObject({
    contract_type: strictObject({
      value: { type: 'string', enum: [...CONTRACT_TYPES], description: '돈과 날짜가 움직이는 방식으로 본 계약 유형' },
      confidence: { type: 'string', enum: [...CONFIDENCE] },
      alternatives: { type: 'array', items: { type: 'string', enum: [...CONTRACT_TYPES] }, description: '가능성이 있는 다른 유형 (최대 3개, 없으면 빈 배열)' },
      reason: { type: 'string', description: '이 유형으로 본 이유 (한 문장, 계약서 내용 기준)' },
    }),
    fields: strictObject(fieldProps),
    dates: {
      type: 'array',
      description: '계약서에 나온 날짜를 모두. 각 날짜의 의미를 문맥으로 판단한다',
      items: strictObject({
        date: { type: 'string', description: 'YYYY-MM-DD' },
        meaning: { type: 'string', enum: [...DATE_MEANINGS] },
        label: { type: 'string', description: '계약서에서 이 날짜를 부르는 이름 (예: 렌탈 개시일, 잔금일)' },
        confidence: { type: 'string', enum: [...CONFIDENCE] },
        ...evidenceProps,
      }),
    },
    payments: {
      type: 'array',
      description: '사용자가 내는 돈을 모두 (정기 결제·일회성 비용·보증금·계약금·중도금·잔금 …)',
      items: strictObject({
        kind: { type: 'string', enum: [...PAYMENT_KINDS] },
        label: { type: 'string', description: '계약서의 항목 이름 (예: 월 렌탈료, 초기 설치비, 잔금)' },
        amount: { type: 'integer', description: '1회 금액(원)' },
        frequency: { type: 'string', enum: [...FREQUENCIES] },
        day_of_month: { type: ['integer', 'null'], description: '정기 결제일(매월 N일의 N). 계약서에 명시된 경우만' },
        date: { type: ['string', 'null'], description: '일시불의 결제일 또는 정기 결제의 첫 결제일 (YYYY-MM-DD). 계약서에 명시된 경우만' },
        end_date: { type: ['string', 'null'], description: '정기 결제의 마지막 결제일 또는 납입기간 종료일. 명시된 경우만' },
        installment_count: { type: ['integer', 'null'], description: '총 납입 회차 (할부·대출). 명시된 경우만' },
        is_variable: { type: 'boolean', description: '사용량 등으로 매번 금액이 달라지는지' },
        confidence: { type: 'string', enum: [...CONFIDENCE] },
        ...evidenceProps,
      }),
    },
    details: strictObject(detailProps),
    checks: {
      type: 'array',
      items: strictObject({
        severity: { type: 'string', enum: [...SEVERITY] },
        topic: { type: 'string', enum: [...TOPICS] },
        title: { type: 'string' },
        description: { type: 'string' },
        evidence_quote: { type: ['string', 'null'] },
        evidence_page: { type: ['integer', 'null'] },
      }),
    },
  });
}

export function extractionInstructions(today: string): string {
  return [
    '당신은 개인용 계약 관리 앱 PACTO의 계약서 정리 도우미입니다.',
    '첨부된 계약서(PDF 또는 사진)를 읽고, 사용자가 이 계약의 돈과 날짜를 관리할 수 있도록 정리합니다.',
    '',
    '순서:',
    '1) contract_type — 돈과 날짜가 움직이는 방식으로 유형을 고릅니다.',
    '   recurring: 매달·매년 이용료를 내는 계약 (렌탈, 통신, 헬스장, 구독, 자동차 리스·장기렌트)',
    '   lease: 부동산 임대차 (전세, 월세, 반전세, 상가)',
    '   auto_installment: 자동차를 할부로 구매 (할부원금·월 할부금·회차)',
    '   loan: 대출 (원금·금리·상환)',
    '   insurance: 보험 (보험료·보험기간)',
    '   one_time: 계약금·중도금·잔금처럼 정해진 날에 나눠 내고 끝나는 계약 (공사, 매매, 행사 등)',
    '   other: 위에 해당하지 않음',
    '   확실하지 않으면 confidence를 medium/low로 두고, 가능성 있는 다른 유형을 alternatives에 넣습니다. 유형 틀에 맞추려고 내용을 바꾸지 않습니다.',
    '2) dates — 계약서에 나온 날짜를 모두 찾고, 각 날짜가 무엇인지 문맥으로 판단해 meaning을 붙입니다.',
    '   같은 날짜라도 의미가 여러 개면 각각 넣습니다. 계약 체결일(작성·서명일)이 따로 적혀 있지 않으면 contract_signed를 만들지 않습니다.',
    '   기간만 적혀 있으면(예: "개시일로부터 36개월") 시작일 기준으로 종료일을 계산해 넣고 confidence를 medium으로 둡니다.',
    '3) payments — 사용자가 내는 돈을 모두 나열합니다. 월 렌탈료와 초기 설치비처럼 한 계약에 여러 건일 수 있습니다.',
    '   - 임대차의 보증금·전세금과 그 계약금·잔금은 kind=deposit (돌려받는 돈). 월세는 rent, 관리비는 maintenance_fee.',
    '   - 일회성 계약의 계약금/중도금/잔금은 down_payment/interim_payment/balance_payment, 각 날짜를 date에.',
    '   - 연납 보험료는 frequency=yearly, 금액은 1회 납입액 그대로.',
    '   - 결제일·첫 결제일이 계약서에 적혀 있지 않으면 시작일 등에서 추측하지 말고 date·day_of_month를 null로 둡니다.',
    '4) details — 해당 유형의 속성만 채우고 나머지는 null.',
    '5) checks — 사용자가 확인하면 좋은 조항만: 자동갱신·해지(종료) 통보기한, 중도해지·위약금, 보증금 반환, 결제 조건. 없으면 빈 배열.',
    '   severity: 놓치면 계약이 연장되는 조항은 caution, 위약금·중도해지는 check, 단순 안내는 info.',
    '',
    '공통 규칙:',
    '- 계약서에 적힌 내용만 사용합니다. 추측하지 말고, 찾을 수 없으면 null(목록이면 넣지 않음)로 둡니다.',
    `- 날짜는 YYYY-MM-DD, 금액은 원 단위 정수(쉼표·원 없이). 오늘은 ${today}입니다.`,
    '- evidence_quote는 계약서 원문을 그대로 옮긴 짧은 문장(120자 이내), evidence_page는 그 쪽 번호입니다. 원문을 바꾸거나 지어내지 않습니다.',
    '',
    '표현 규칙 (매우 중요): 법률 판단을 하지 않습니다.',
    `- 다음 표현을 쓰지 않습니다: ${BANNED_PHRASES.join(', ')}.`,
    '- "…로 기재되어 있습니다", "…조건이 포함되어 있습니다", "…을 확인해주세요" 처럼 계약서 내용을 그대로 전달하는 문장만 씁니다.',
    '- description과 reason은 한국어 1~2문장.',
  ].join('\n');
}

// ===== 검증 + 앱 형식 변환 =====

type Confidence = (typeof CONFIDENCE)[number];

export interface Evidence {
  page: number;
  quote: string;
}

export interface Extracted {
  value: unknown;
  confidence: Confidence;
  evidence?: Evidence[];
}

export interface ExtractedDate {
  date: string;
  meaning: (typeof DATE_MEANINGS)[number];
  label: string;
  confidence: Confidence;
  evidence?: Evidence[];
}

export interface ExtractedPayment {
  kind: (typeof PAYMENT_KINDS)[number];
  label: string;
  amount: number;
  frequency: (typeof FREQUENCIES)[number];
  dayOfMonth: number | null;
  /** 계약서에 적힌 결제일(일시불) 또는 첫 결제일. 없으면 null — 앱이 시작일을 넣고 "확인 필요"로 표시 */
  date: string | null;
  endDate: string | null;
  installmentCount: number | null;
  isVariable: boolean;
  confidence: Confidence;
  evidence?: Evidence[];
}

export interface AppExtractionResult {
  contractType: {
    value: (typeof CONTRACT_TYPES)[number];
    confidence: Confidence;
    alternatives: (typeof CONTRACT_TYPES)[number][];
    reason: string | null;
    evidence?: Evidence[];
  };
  fields: Record<string, Extracted>;
  dates: ExtractedDate[];
  payments: ExtractedPayment[];
  /** 유형별 속성 (DB 키 snake_case). 앱이 선택된 유형의 스키마로 다시 검증한다 */
  details: Record<string, string | number | boolean>;
  checks: {
    severity: (typeof SEVERITY)[number];
    topic: (typeof TOPICS)[number];
    title: string;
    description: string;
    evidenceQuote: string | null;
    evidencePage: number | null;
    suggestion: null | { kind: 'set_termination_notice'; terminationNoticeDays: number; autoRenewal: boolean; renewalPeriodMonths: number | null };
  }[];
  provider: string;
  promptVersion: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => ((list as readonly string[]).includes(v as string) ? (v as T) : null);

function validDate(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1950 || y > 2100 || mo < 1 || mo > 12) return false;
  return d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

function toInt(raw: unknown, min: number, max: number): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.replace(/[^\d.-]/g, '')) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return i >= min && i <= max ? i : null;
}

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().slice(0, max);
  return s.length > 0 ? s : null;
}

function evidenceOf(o: Record<string, unknown>): { evidence?: Evidence[] } {
  const quote = typeof o.evidence_quote === 'string' ? o.evidence_quote.trim().slice(0, 200) : '';
  const page = typeof o.evidence_page === 'number' && o.evidence_page >= 1 ? Math.round(o.evidence_page) : null;
  return quote ? { evidence: [{ page: page ?? 1, quote }] } : {};
}

const MAX_AMOUNT = 100_000_000_000;

/** 필드 값 정제: 형식이 틀리면 null (→ 신뢰도 low, 사용자 확인 대상) */
function cleanField(key: string, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  switch (FIELDS[key].type) {
    case 'string':
      return text(raw, key === 'title' || key === 'counterparty' ? 100 : 500);
    case 'integer':
      if (key === 'renewalPeriodMonths') return toInt(raw, 1, 120);
      if (key === 'terminationNoticeDays') return toInt(raw, 0, 365);
      return toInt(raw, 0, MAX_AMOUNT);
    case 'boolean':
      return typeof raw === 'boolean' ? raw : null;
    case 'category':
      return oneOf(CATEGORIES, raw);
  }
}

function cleanDetail(key: string, raw: unknown): string | number | boolean | null {
  const def = DETAIL_KEYS[key];
  if (!def || raw === null || raw === undefined) return null;
  if (def.options) return oneOf(def.options, raw);
  switch (def.type) {
    case 'string':
      return text(raw, 500);
    case 'integer':
      return toInt(raw, 0, MAX_AMOUNT);
    case 'number': {
      const n = typeof raw === 'number' ? raw : NaN;
      return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 1000) / 1000 : null;
    }
    case 'boolean':
      return typeof raw === 'boolean' ? raw : null;
  }
}

/** 금지 표현이 있으면 해당 문구를 중립 문장으로 대체 */
function neutralize(value: string, fallback: string): string {
  return BANNED_PHRASES.some((p) => value.includes(p)) ? fallback : value;
}

function confidenceOf(v: unknown): Confidence {
  return oneOf(CONFIDENCE, v) ?? 'low';
}

/** 모델 출력(JSON) → 검증된 앱 형식. 구조가 틀리면 예외. 형식이 틀린 항목은 버리거나 low로 낮춘다. */
export function toAppResult(output: unknown, provider: string): AppExtractionResult {
  if (!isObj(output) || !isObj(output.fields) || !Array.isArray(output.checks) || !isObj(output.contract_type)) throw new Error('invalid_output_shape');
  const fieldsIn = output.fields as Record<string, unknown>;
  const checksIn = output.checks as unknown[];
  const ct = output.contract_type as Record<string, unknown>;

  // 1) 유형
  const typeValue = oneOf(CONTRACT_TYPES, ct.value);
  const reason = text(ct.reason, 200);
  const contractType: AppExtractionResult['contractType'] = {
    value: typeValue ?? 'other',
    confidence: typeValue ? confidenceOf(ct.confidence) : 'low',
    alternatives: (Array.isArray(ct.alternatives) ? ct.alternatives : [])
      .map((a) => oneOf(CONTRACT_TYPES, a))
      .filter((a): a is (typeof CONTRACT_TYPES)[number] => !!a && a !== typeValue)
      .filter((a, i, arr) => arr.indexOf(a) === i)
      .slice(0, 3),
    reason: reason ? neutralize(reason, '계약서 내용을 바탕으로 분류했어요.') : null,
    ...evidenceOf(ct),
  };

  // 2) 공통 필드
  const fields: Record<string, Extracted> = {};
  for (const key of Object.keys(FIELDS)) {
    const f = fieldsIn[key];
    if (!isObj(f)) {
      fields[key] = { value: null, confidence: 'low' };
      continue;
    }
    const value = cleanField(key, f.value);
    fields[key] = { value, confidence: value === null ? 'low' : confidenceOf(f.confidence), ...evidenceOf(f) };
  }

  // 3) 날짜 (형식이 틀린 날짜는 버림)
  const dates: ExtractedDate[] = (Array.isArray(output.dates) ? output.dates : [])
    .filter(isObj)
    .filter((d) => validDate(d.date))
    .slice(0, 30)
    .map((d) => ({
      date: (d.date as string).trim(),
      meaning: oneOf(DATE_MEANINGS, d.meaning) ?? 'other',
      label: text(d.label, 40) ?? '날짜',
      confidence: confidenceOf(d.confidence),
      ...evidenceOf(d),
    }));

  // 4) 결제 (금액·주기가 틀린 항목은 버림)
  const payments: ExtractedPayment[] = [];
  for (const p of Array.isArray(output.payments) ? output.payments : []) {
    if (!isObj(p) || payments.length >= 20) continue;
    const amount = toInt(p.amount, 0, MAX_AMOUNT);
    const frequency = oneOf(FREQUENCIES, p.frequency);
    if (amount === null || frequency === null) continue;
    const oneTime = frequency === 'one_time';
    payments.push({
      kind: oneOf(PAYMENT_KINDS, p.kind) ?? 'other',
      label: text(p.label, 40) ?? '결제',
      amount,
      frequency,
      dayOfMonth: oneTime ? null : toInt(p.day_of_month, 1, 31),
      date: validDate(p.date) ? p.date.trim() : null,
      endDate: !oneTime && validDate(p.end_date) ? p.end_date.trim() : null,
      installmentCount: oneTime ? null : toInt(p.installment_count, 1, 600),
      isVariable: p.is_variable === true,
      confidence: confidenceOf(p.confidence),
      ...evidenceOf(p),
    });
  }

  // 5) 유형별 속성
  const details: Record<string, string | number | boolean> = {};
  if (isObj(output.details)) {
    const detailsIn = output.details as Record<string, unknown>;
    for (const key of Object.keys(DETAIL_KEYS)) {
      const v = cleanDetail(key, detailsIn[key]);
      if (v !== null) details[key] = v;
    }
  }

  // 6) 확인할 조항
  const notice = fields.terminationNoticeDays.value as number | null;
  const auto = fields.autoRenewal.value as boolean | null;
  const months = fields.renewalPeriodMonths.value as number | null;
  const checks = checksIn
    .filter(isObj)
    .slice(0, 8)
    .map((c) => {
      const topic = oneOf(TOPICS, c.topic) ?? 'other';
      const description = neutralize(text(c.description, 300) ?? '', '계약서의 해당 조항을 확인해주세요.');
      return {
        severity: oneOf(SEVERITY, c.severity) ?? 'info',
        topic,
        title: neutralize(text(c.title, 40) ?? '확인할 조항', '확인할 조항'),
        description: description || '계약서의 해당 조항을 확인해주세요.',
        evidenceQuote: text(c.evidence_quote, 200),
        evidencePage: typeof c.evidence_page === 'number' && c.evidence_page >= 1 ? Math.round(c.evidence_page) : null,
        // 자동갱신 조항 → 해지 통보기한을 일정으로 연결하는 제안
        suggestion:
          topic === 'auto_renewal' && notice !== null
            ? { kind: 'set_termination_notice' as const, terminationNoticeDays: notice, autoRenewal: auto ?? true, renewalPeriodMonths: months }
            : null,
      };
    });

  return { contractType, fields, dates, payments, details, checks, provider, promptVersion: PROMPT_VERSION };
}
