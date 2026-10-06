// 계약서 정보 추출 — 공급자와 무관한 스키마 / 프롬프트 / 검증 / 앱 형식 변환.
// 순수 TypeScript (Deno·Node 공용) — 앱 테스트(jest)에서도 같은 파일을 검증한다.

export const PROMPT_VERSION = 'extract-v2';

export const CATEGORIES = ['real_estate', 'vehicle', 'insurance', 'telecom', 'rental', 'finance', 'employment', 'business', 'membership', 'subscription', 'other'] as const;
export const FREQUENCIES = ['monthly', 'bimonthly', 'quarterly', 'semiannual', 'yearly', 'one_time'] as const;
const CONFIDENCE = ['high', 'medium', 'low'] as const;
const SEVERITY = ['info', 'check', 'caution'] as const;
const TOPICS = ['auto_renewal', 'termination', 'penalty', 'deposit', 'payment', 'other'] as const;

/** AI 체크 문구 금지 표현 (앱 src/domain/aiCopy.ts와 동일 목록) */
export const BANNED_PHRASES = ['불법', '위법', '무효', '독소조항', '독소 조항', '불리합니다', '불리한', '유리합니다', '유리한', '손해를 봅니다', '반드시 손해'];

type FieldType = 'string' | 'date' | 'integer' | 'boolean' | 'category' | 'frequency';

/** 추출 필드 정의 (앱의 ContractDraft 키와 동일) */
export const FIELDS: Record<string, { type: FieldType; desc: string }> = {
  title: { type: 'string', desc: '계약명 (예: 자동차보험, 정수기 렌탈, 전세계약). 계약서 제목이나 상품명을 짧게' },
  category: { type: 'category', desc: '계약 종류' },
  counterparty: { type: 'string', desc: '사용자(고객·임차인·가입자)의 계약 상대방 회사명 또는 이름. 계약서에 적힌 정식 명칭 그대로' },
  contractDate: { type: 'date', desc: '계약 체결일 (서명·작성일). 시작일과 다를 수 있음' },
  startDate: { type: 'date', desc: '계약 효력 시작일 (이용·렌탈 개시일, 보험 개시일, 입주일). 체결일과 다를 수 있음' },
  endDate: { type: 'date', desc: '계약 종료일(만기일). 기간만 적혀 있으면 시작일 기준으로 계산' },
  totalAmount: { type: 'integer', desc: '계약 총액(원). 명시된 경우만' },
  paymentLabel: { type: 'string', desc: '정기 결제 항목 이름 (예: 월 렌탈료, 보험료, 월 회비)' },
  paymentAmount: { type: 'integer', desc: '결제 1회 금액(원, VAT 포함 금액 우선)' },
  paymentFrequency: { type: 'frequency', desc: '결제 주기' },
  paymentDay: { type: 'integer', desc: '정기 결제가 이루어지는 날 (매월 N일의 N, 1~31). 계약서에 명시된 경우만' },
  paymentVariable: { type: 'boolean', desc: '사용량 등으로 매번 금액이 달라지는지' },
  autoRenewal: { type: 'boolean', desc: '만료 시 자동으로 연장되는 조건이 있는지' },
  renewalPeriodMonths: { type: 'integer', desc: '자동 연장 시 연장 기간(개월)' },
  terminationNoticeDays: { type: 'integer', desc: '자동 연장을 막으려면 종료 며칠 전까지 해지 의사를 알려야 하는지(일). 1개월 전이면 30' },
  depositAmount: { type: 'integer', desc: '보증금(원)' },
  earlyTerminationTerms: { type: 'string', desc: '중도해지 조건 요약 (한 문장)' },
  penaltyTerms: { type: 'string', desc: '위약금 조건 요약 (한 문장)' },
};

function valueSchema(t: FieldType) {
  switch (t) {
    case 'string':
    case 'date':
      return { type: ['string', 'null'] };
    case 'integer':
      return { type: ['integer', 'null'] };
    case 'boolean':
      return { type: ['boolean', 'null'] };
    case 'category':
      return { type: ['string', 'null'], enum: [...CATEGORIES, null] };
    case 'frequency':
      return { type: ['string', 'null'], enum: [...FREQUENCIES, null] };
  }
}

/** Structured Outputs(strict)용 JSON Schema: 모든 속성 required, additionalProperties false */
export function extractionJsonSchema() {
  const fieldProps: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(FIELDS)) {
    fieldProps[key] = {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'confidence', 'evidence_page', 'evidence_quote'],
      properties: {
        value: { ...valueSchema(def.type), description: def.desc },
        confidence: { type: 'string', enum: [...CONFIDENCE] },
        evidence_page: { type: ['integer', 'null'], description: '근거가 있는 쪽 번호(1부터)' },
        evidence_quote: { type: ['string', 'null'], description: '계약서 원문에서 그대로 옮긴 근거 문장 (120자 이내)' },
      },
    };
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['fields', 'checks'],
    properties: {
      fields: { type: 'object', additionalProperties: false, required: Object.keys(FIELDS), properties: fieldProps },
      checks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['severity', 'topic', 'title', 'description', 'evidence_quote', 'evidence_page'],
          properties: {
            severity: { type: 'string', enum: [...SEVERITY] },
            topic: { type: 'string', enum: [...TOPICS] },
            title: { type: 'string' },
            description: { type: 'string' },
            evidence_quote: { type: ['string', 'null'] },
            evidence_page: { type: ['integer', 'null'] },
          },
        },
      },
    },
  };
}

export function extractionInstructions(today: string): string {
  return [
    '당신은 개인용 계약 관리 앱 PACTO의 계약서 정리 도우미입니다.',
    '첨부된 계약서(PDF 또는 사진)를 읽고 사용자가 일정·지출·해지 시점을 관리할 수 있도록 정보를 추출합니다.',
    '',
    '규칙:',
    '- 계약서에 적힌 내용만 사용합니다. 추측하지 말고, 찾을 수 없으면 value를 null, confidence를 low로 둡니다.',
    '- 날짜는 YYYY-MM-DD 형식. 금액은 원 단위 정수(쉼표·원 없이). 계약 상대방은 계약서의 정식 명칭 그대로.',
    '- 계약 체결일(서명일), 계약 시작일(효력·개시일), 결제일(매월 납부일), 계약 종료일은 서로 다른 값입니다. 서로 대신 채우지 않습니다.',
    '- 결제일이 따로 적혀 있지 않으면 시작일에서 추측하지 말고 paymentDay를 null로 둡니다.',
    `- 오늘 날짜는 ${today}입니다. "개시일로부터 36개월" 같은 기간 표현은 시작일 기준으로 종료일을 계산하고 confidence를 medium으로 둡니다.`,
    '- evidence_quote는 계약서 원문을 그대로 옮긴 짧은 문장(120자 이내), evidence_page는 그 쪽 번호입니다. 원문을 바꾸거나 지어내지 않습니다.',
    '- checks에는 사용자가 확인하면 좋은 조항만 넣습니다: 자동갱신·해지 통보기한, 중도해지·위약금, 보증금 반환, 결제 조건. 없으면 빈 배열.',
    '- severity: 자동갱신/해지 통보기한처럼 놓치면 계약이 연장되는 조항은 caution, 위약금·중도해지는 check, 단순 안내는 info.',
    '',
    '표현 규칙 (매우 중요): 법률 판단을 하지 않습니다.',
    `- 다음 표현을 쓰지 않습니다: ${BANNED_PHRASES.join(', ')}.`,
    '- "…로 기재되어 있습니다", "…조건이 포함되어 있습니다", "…을 확인해주세요" 처럼 계약서 내용을 그대로 전달하는 문장만 씁니다.',
    '- description은 한국어 1~2문장.',
  ].join('\n');
}

// ===== 검증 + 앱 형식(ExtractionResult) 변환 =====

export interface Extracted {
  value: unknown;
  confidence: 'high' | 'medium' | 'low';
  evidence?: { page: number; quote: string }[];
}

export interface AppExtractionResult {
  fields: Record<string, Extracted>;
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

function validDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1950 || y > 2100 || mo < 1 || mo > 12) return false;
  return d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** 필드 값 정제: 형식이 틀리면 null + 신뢰도 low (사용자 확인 대상) */
function cleanValue(key: string, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  const t = FIELDS[key].type;
  switch (t) {
    case 'string': {
      if (typeof raw !== 'string') return null;
      const s = raw.trim().slice(0, key === 'title' || key === 'counterparty' ? 100 : 500);
      return s.length > 0 ? s : null;
    }
    case 'date':
      return typeof raw === 'string' && validDate(raw.trim()) ? raw.trim() : null;
    case 'integer': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(/[^\d]/g, '')) : NaN;
      if (!Number.isFinite(n) || n < 0) return null;
      const i = Math.round(n);
      if (key === 'paymentDay') return i >= 1 && i <= 31 ? i : null;
      if (key === 'renewalPeriodMonths') return i >= 1 && i <= 120 ? i : null;
      if (key === 'terminationNoticeDays') return i <= 365 ? i : null;
      return i <= 100_000_000_000 ? i : null;
    }
    case 'boolean':
      return typeof raw === 'boolean' ? raw : null;
    case 'category':
      return (CATEGORIES as readonly string[]).includes(raw as string) ? raw : null;
    case 'frequency':
      return (FREQUENCIES as readonly string[]).includes(raw as string) ? raw : null;
  }
}

/** 금지 표현이 있으면 해당 체크 문구를 중립 문장으로 대체 */
function neutralize(text: string, fallback: string): string {
  return BANNED_PHRASES.some((p) => text.includes(p)) ? fallback : text;
}

/** 모델 출력(JSON) → 검증된 앱 형식. 구조가 틀리면 예외. */
export function toAppResult(output: unknown, provider: string): AppExtractionResult {
  if (!isObj(output) || !isObj(output.fields) || !Array.isArray(output.checks)) throw new Error('invalid_output_shape');
  const fields: Record<string, Extracted> = {};
  for (const key of Object.keys(FIELDS)) {
    const f = output.fields[key];
    if (!isObj(f)) {
      fields[key] = { value: null, confidence: 'low' };
      continue;
    }
    const raw = f.value;
    const value = cleanValue(key, raw);
    let confidence = (CONFIDENCE as readonly string[]).includes(f.confidence as string) ? (f.confidence as Extracted['confidence']) : 'low';
    if (value === null && raw !== null && raw !== undefined) confidence = 'low'; // 형식 오류로 버린 값
    if (value === null) confidence = 'low';
    const quote = typeof f.evidence_quote === 'string' ? f.evidence_quote.trim().slice(0, 200) : '';
    const page = typeof f.evidence_page === 'number' && f.evidence_page >= 1 ? Math.round(f.evidence_page) : null;
    fields[key] = { value, confidence, ...(quote ? { evidence: [{ page: page ?? 1, quote }] } : {}) };
  }

  const notice = fields.terminationNoticeDays.value as number | null;
  const auto = fields.autoRenewal.value as boolean | null;
  const months = fields.renewalPeriodMonths.value as number | null;

  const checks = output.checks
    .filter(isObj)
    .slice(0, 8)
    .map((c) => {
      const severity = (SEVERITY as readonly string[]).includes(c.severity as string) ? (c.severity as (typeof SEVERITY)[number]) : 'info';
      const topic = (TOPICS as readonly string[]).includes(c.topic as string) ? (c.topic as (typeof TOPICS)[number]) : 'other';
      const title = typeof c.title === 'string' && c.title.trim() ? c.title.trim().slice(0, 40) : '확인할 조항';
      const description = neutralize(typeof c.description === 'string' ? c.description.trim().slice(0, 300) : '', '계약서의 해당 조항을 확인해주세요.');
      return {
        severity,
        topic,
        title: neutralize(title, '확인할 조항'),
        description: description || '계약서의 해당 조항을 확인해주세요.',
        evidenceQuote: typeof c.evidence_quote === 'string' && c.evidence_quote.trim() ? c.evidence_quote.trim().slice(0, 200) : null,
        evidencePage: typeof c.evidence_page === 'number' && c.evidence_page >= 1 ? Math.round(c.evidence_page) : null,
        // 자동갱신 조항 → 해지 통보기한을 일정으로 연결하는 제안
        suggestion:
          topic === 'auto_renewal' && notice !== null
            ? { kind: 'set_termination_notice' as const, terminationNoticeDays: notice, autoRenewal: auto ?? true, renewalPeriodMonths: months }
            : null,
      };
    });

  return { fields, checks, provider, promptVersion: PROMPT_VERSION };
}
