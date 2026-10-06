// 계약서 분석 — 공급자와 무관한 스키마 / 프롬프트 / 검증 / 앱 형식 변환.
// 순수 TypeScript (Deno·Node 공용) — 앱 테스트(jest)에서도 같은 파일을 검증한다.
//
// v4 분석 순서 (정해진 칸을 억지로 채우지 않는다):
//  1 분야(category) → 2 구조(contract_type) → 3·4 날짜와 의미 → 5·6 금액과 의미·주기·방향 → 7 유형별 속성
//  → 8 종료·갱신·해지·만기 조건 → 9 PACTO 계약 체크(확인이 필요한 조항, 원문 근거) → 10 사용자 확인용 데이터
// 날짜·금액을 계약 정보·결제 목록으로 바꾸는 일은 앱(src/features/registration/extraction.ts)이 하고, 사용자가 확인한 뒤 저장한다.
// 분야·유형·속성·결제 의미·날짜 의미·체크 주제 목록은 공용 레지스트리(contractRegistry.ts)에서 온다.

import {
  CATEGORY_CODES,
  CATEGORY_DEFS,
  CHECK_TOPIC_CODES,
  CHECK_TOPIC_DEFS,
  CONTRACT_TYPE_CODES,
  CONTRACT_TYPE_DEFS,
  DETAIL_DB_KEYS,
  DETAIL_FIELD_DEFS,
  DIRECTIONS,
  PAYMENT_KIND_CODES,
  PAYMENT_KIND_DEFS,
} from './contractRegistry.ts';

export const PROMPT_VERSION = 'extract-v4';

export { CATEGORY_CODES, CONTRACT_TYPE_CODES, PAYMENT_KIND_CODES } from './contractRegistry.ts';
export const FREQUENCIES = ['monthly', 'bimonthly', 'quarterly', 'semiannual', 'yearly', 'one_time'] as const;
/** 계약서에 나온 날짜의 의미 */
export const DATE_MEANINGS = [
  'contract_signed', // 계약 체결일(작성·서명일)
  'contract_start', // 계약·근로·업무 기간 시작일
  'contract_end', // 계약·근로·업무 기간 종료일
  'service_start', // 이용·서비스 개시일
  'installation', // 설치일
  'activation', // 개통일
  'move_in', // 입주일
  'balance_due', // 잔금일
  'loan_execution', // 대출·할부 실행일
  'first_payment', // 첫 납입·결제일
  'coverage_start', // 보험 시작일
  'maturity', // 만기일
  'renewal', // 갱신일
  'hire', // 입사일
  'delivery', // 납기일
  'inspection', // 검수일
  'handover', // 인도일
  'ownership_transfer', // 소유권 이전일
  'completion', // 계약 완료(이행 완료)일
  'notice_deadline', // 해지·종료 통보기한 날짜
  'other',
] as const;
const CONFIDENCE = ['high', 'medium', 'low'] as const;
const SEVERITY = ['info', 'check', 'caution'] as const;

/** 법적 판단·단정 표현 금지 목록 (앱 src/domain/aiCopy.ts와 동일) */
export const BANNED_PHRASES = [
  '불법', '위법', '무효', '독소조항', '독소 조항', '불공정', '불리합니다', '불리한', '유리합니다', '유리한',
  '손해를 봅니다', '반드시 손해', '위험합니다', '위험한 계약',
];

type FieldType = 'string' | 'integer' | 'boolean';

/** 계약 공통 정보 (날짜·결제·유형별 속성은 목록으로 따로 받는다) */
export const FIELDS: Record<string, { type: FieldType; desc: string }> = {
  title: { type: 'string', desc: '계약명 (예: 근로계약서, 자동차보험, 정수기 렌탈, 전세계약). 계약서 제목이나 상품명을 짧게' },
  counterparty: { type: 'string', desc: '사용자(근로자·고객·임차인·가입자·차주·수행자 등)의 계약 상대방 회사명 또는 이름. 계약서의 정식 명칭 그대로' },
  totalAmount: { type: 'integer', desc: '계약 총액·총 매매금액(원). 명시된 경우만' },
  depositAmount: { type: 'integer', desc: '보증금·전세금 총액(원). 명시된 경우만' },
  autoRenewal: { type: 'boolean', desc: '만료 시 자동으로 연장되는 조건이 있는지 (묵시적 갱신 포함). 언급이 없으면 null' },
  renewalPeriodMonths: { type: 'integer', desc: '자동 연장 시 연장 기간(개월)' },
  terminationNoticeDays: { type: 'integer', desc: '종료·해지하려면 종료 며칠 전까지 알려야 하는지(일). 1개월 전이면 30' },
  earlyTerminationTerms: { type: 'string', desc: '중도해지(중도상환) 조건 요약 (한 문장)' },
  penaltyTerms: { type: 'string', desc: '위약금 조건 요약 (한 문장)' },
};

const evidence = {
  evidence_quote: { type: ['string', 'null'], description: '계약서 원문에서 그대로 옮긴 근거 문장 (120자 이내)' },
};
const evidenceFull = {
  ...evidence,
  evidence_page: { type: ['integer', 'null'], description: '근거가 있는 쪽 번호(1부터, 파일 안에서)' },
  evidence_file: { type: ['integer', 'null'], description: '근거가 있는 파일 번호(1부터, 첨부 순서). 파일이 하나면 1' },
};
const confidence = { type: 'string', enum: [...CONFIDENCE] };
const strictObject = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const classification = (codes: readonly string[], desc: string) =>
  strictObject({
    value: { type: 'string', enum: [...codes], description: desc },
    confidence,
    alternatives: { type: 'array', items: { type: 'string', enum: [...codes] }, description: '가능성이 있는 다른 값 (최대 3개, 없으면 빈 배열)' },
    reason: { type: 'string', description: '이렇게 본 이유 (한 문장, 계약서 내용 기준)' },
  });

/** Structured Outputs(strict)용 JSON Schema: 모든 속성 required, additionalProperties false */
export function extractionJsonSchema() {
  const fieldProps: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(FIELDS)) {
    fieldProps[key] = strictObject({ value: { type: [def.type, 'null'], description: def.desc }, confidence, ...evidence });
  }
  return strictObject({
    category: classification(CATEGORY_CODES, '무슨 계약인가 (분야)'),
    contract_type: classification(CONTRACT_TYPE_CODES, '돈·날짜·의무가 움직이는 구조 (관리 방식)'),
    fields: strictObject(fieldProps),
    dates: {
      type: 'array',
      description: '계약서에 나온 중요한 날짜를 모두. 각 날짜의 의미를 문맥으로 판단한다',
      items: strictObject({
        date: { type: 'string', description: 'YYYY-MM-DD' },
        meaning: { type: 'string', enum: [...DATE_MEANINGS] },
        label: { type: 'string', description: '계약서에서 이 날짜를 부르는 이름 (예: 렌탈 개시일, 잔금일, 입사일)' },
        confidence,
        ...evidence,
      }),
    },
    payments: {
      type: 'array',
      description: '계약에서 오가는 돈을 모두 (정기 결제·급여·대금·일회성 비용·보증금·계약금·중도금·잔금 …)',
      items: strictObject({
        kind: { type: 'string', enum: [...PAYMENT_KIND_CODES] },
        direction: { type: 'string', enum: [...DIRECTIONS], description: '사용자 기준: 내는 돈 expense / 받는 돈 income / 돌려받는 보증금 등 neutral' },
        label: { type: 'string', description: '계약서의 항목 이름 (예: 월 렌탈료, 초기 설치비, 월 급여, 잔금)' },
        amount: { type: 'integer', description: '1회 금액(원)' },
        frequency: { type: 'string', enum: [...FREQUENCIES] },
        day_of_month: { type: ['integer', 'null'], description: '정기 결제·지급일(매월 N일의 N). 명시된 경우만' },
        date: { type: ['string', 'null'], description: '일시불의 지급일 또는 정기 결제의 첫 결제일 (YYYY-MM-DD). 명시된 경우만' },
        end_date: { type: ['string', 'null'], description: '정기 결제의 마지막 결제일 또는 납입기간 종료일. 명시된 경우만' },
        installment_count: { type: ['integer', 'null'], description: '총 납입 회차 (할부·대출). 명시된 경우만' },
        is_variable: { type: 'boolean', description: '사용량 등으로 매번 금액이 달라지는지' },
        optional: { type: 'boolean', description: '"(선택)", "신청 시"처럼 신청한 경우에만 청구되는 항목이면 true' },
        confidence,
        ...evidence,
      }),
    },
    details: {
      type: 'array',
      description: '계약 유형별 주요 속성 중 계약서에 실제로 있는 것만',
      items: strictObject({
        key: { type: 'string', enum: [...DETAIL_DB_KEYS] },
        text_value: { type: ['string', 'null'], description: '글·선택값 (enum 속성은 정해진 코드)' },
        number_value: { type: ['number', 'null'], description: '금액(원)·개월·년·금리(%) 숫자' },
        boolean_value: { type: ['boolean', 'null'] },
        confidence,
        ...evidence,
      }),
    },
    checks: {
      type: 'array',
      description: 'PACTO 계약 체크 — 사용자가 놓치기 쉬운, 확인이 필요한 조항',
      items: strictObject({
        severity: { type: 'string', enum: [...SEVERITY] },
        topic: { type: 'string', enum: [...CHECK_TOPIC_CODES] },
        title: { type: 'string', description: '짧은 이름 (예: 자동갱신, 중도해지 위약금)' },
        description: { type: 'string', description: '계약서에 무엇이 어떻게 적혀 있는지 1~2문장. 판단하지 않고 전달만' },
        confidence,
        related_date: { type: ['string', 'null'], description: '이 조항과 관련해 챙길 날짜가 계약서에 명시돼 있으면 YYYY-MM-DD' },
        ...evidenceFull,
      }),
    },
  });
}

/** 유형별 속성 키 안내 (프롬프트용) */
function detailGuide(): string {
  return CONTRACT_TYPE_DEFS.filter((t) => DETAIL_FIELD_DEFS.some((d) => d.type === t.code))
    .map((t) => {
      const keys = DETAIL_FIELD_DEFS.filter((d) => d.type === t.code).map((d) => {
        const value = d.options ? `text_value: ${d.options.map((o) => o.value).join('|')}` : d.input === 'boolean' ? 'boolean_value' : d.input === 'text' ? 'text_value' : 'number_value';
        return `${d.db}(${d.label}, ${value})`;
      });
      return `   - ${t.code}: ${keys.join(', ')}`;
    })
    .join('\n');
}

function topicGuide(): string {
  const common = CHECK_TOPIC_DEFS.filter((t) => t.types.length === 0 && t.code !== 'other').map((t) => `${t.code}(${t.label})`);
  const byType = CONTRACT_TYPE_DEFS.map((ty) => {
    const ts = CHECK_TOPIC_DEFS.filter((t) => t.types.includes(ty.code)).map((t) => `${t.code}(${t.label})`);
    return ts.length ? `   - ${ty.code}: ${ts.join(', ')}` : null;
  }).filter(Boolean);
  return [`   - 모든 계약: ${common.join(', ')}`, ...byType].join('\n');
}

export function extractionInstructions(today: string): string {
  return [
    '당신은 개인용 계약 관리 앱 PACTO의 계약서 분석 도우미입니다.',
    'PACTO는 계약이 어떤 종류인지 이해하고, 그 계약에서 중요한 돈·날짜·의무·주의할 조건을 찾아 계약이 끝날 때까지 관리하도록 돕습니다.',
    '계약서가 좋은지 나쁜지 판정하지 않습니다. 첨부된 계약서(PDF 또는 사진)를 다음 순서로 분석합니다.',
    '',
    `1) category — 무슨 계약인가: ${CATEGORY_DEFS.map((c) => `${c.code}(${c.label})`).join(', ')}`,
    '2) contract_type — 돈·날짜·의무가 움직이는 구조. 분야가 아니라 실제 계약 내용으로 정합니다 (자동차 분야라도 할부·리스·보험·매매는 다름):',
    ...CONTRACT_TYPE_DEFS.map((t) => `   - ${t.code}: ${t.guide} (예: ${t.examples})`),
    '   확실하지 않으면 confidence를 medium/low로 두고 alternatives에 다른 가능성을 넣습니다.',
    '3·4) dates — 계약서에 나온 중요한 날짜를 모두 찾고, 각 날짜의 의미를 문맥으로 판단합니다.',
    '   같은 날짜라도 의미가 여러 개면 각각 넣습니다. 체결일(작성·서명일)이 따로 적혀 있지 않으면 contract_signed를 만들지 않습니다.',
    '   다른 날짜를 체결일로 대신 넣지 않습니다. 기간만 적혀 있으면(예: "개시일로부터 36개월") 종료일을 계산해 넣고 confidence를 medium으로.',
    '5·6) payments — 계약에서 오가는 돈을 모두 나열하고 의미(kind)·주기·방향(direction)을 정합니다. 한 계약에 여러 건일 수 있습니다.',
    `   kind: ${PAYMENT_KIND_DEFS.map((k) => `${k.code}(${k.label})`).join(', ')}`,
    '   direction은 사용자 기준입니다 (사용자 = 근로자·고객·임차인·가입자·차주·프리랜서 수행자 등 개인 쪽). 급여·용역 대금처럼 받는 돈은 income,',
    '   임대차 보증금·전세금과 그 계약금·잔금은 kind=deposit, direction=neutral. 매매·용역은 사용자가 어느 쪽인지 보고 정하고, 알 수 없으면 confidence를 low로.',
    '   연납 보험료는 frequency=yearly, 1회 납입액 그대로. 일회성 계약의 계약금/중도금/잔금은 각각 따로, 날짜는 date에.',
    '   결제일이 적혀 있지 않으면 추측하지 말고 null. 다른 결제와 "함께 청구"되면 같은 day_of_month. 같은 돈을 두 번 넣지 않습니다.',
    '   "(선택)", "신청 시" 항목은 optional=true.',
    '7) details — 해당 유형의 속성 중 계약서에 실제로 있는 것만 (없는 속성은 넣지 않음):',
    detailGuide(),
    '8) fields — 계약명·상대방·총액·보증금, 종료·갱신·해지·만기 조건(자동갱신, 연장 기간, 통보기한 일수, 중도해지·위약금).',
    '9) checks — PACTO 계약 체크: 사용자가 놓치기 쉬운, 확인이 필요한 조항을 찾습니다. 주제(topic):',
    topicGuide(),
    '   severity: 놓치면 계약이 연장되거나 비용이 생기는 조항(자동갱신·통보기한·위약금·환불 제한·연체 등)은 caution,',
    '   조건을 확인하면 좋은 조항은 check, 단순 안내는 info. 확신이 낮으면 confidence를 low로.',
    '   각 항목에는 근거가 된 원문 문장(evidence_quote), 쪽(evidence_page), 파일 번호(evidence_file)를 반드시 넣습니다. 근거가 없는 조항은 넣지 않습니다.',
    '   관련해 챙길 날짜가 계약서에 명시돼 있으면 related_date에 넣습니다.',
    '',
    '공통 규칙:',
    '- 계약서에 적힌 내용만 사용합니다. 유형 템플릿에 맞추려고 없는 정보를 만들지 않습니다 (임대차라도 월세가 없을 수 있고, 보험이 월납이 아닐 수 있고, 근로계약이 기간 없이 체결될 수 있음).',
    `- 날짜는 YYYY-MM-DD, 금액은 원 단위 정수(쉼표·원 없이). 오늘은 ${today}입니다.`,
    '- evidence_quote는 계약서 원문을 그대로 옮긴 짧은 문장(120자 이내)입니다. 원문을 바꾸거나 지어내지 않습니다.',
    '',
    '표현 규칙 (매우 중요): 법률 판단을 하지 않습니다.',
    `- 다음 표현을 쓰지 않습니다: ${BANNED_PHRASES.join(', ')}.`,
    '- "…로 기재되어 있습니다", "…조건이 포함되어 있습니다", "확인이 필요한 조건입니다", "중도해지 비용이 발생할 수 있습니다",',
    '  "책임 범위를 확인할 필요가 있습니다", "계약 종료 전에 확인이 필요한 내용입니다" 처럼 계약서 내용을 전달하는 문장만 씁니다.',
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

export interface Classification<T extends string> {
  value: T;
  confidence: Confidence;
  alternatives: T[];
  reason: string | null;
}

export interface ExtractedDate {
  date: string;
  meaning: (typeof DATE_MEANINGS)[number];
  label: string;
  confidence: Confidence;
  evidence?: Evidence[];
}

export interface ExtractedPayment {
  kind: (typeof PAYMENT_KIND_CODES)[number];
  direction: (typeof DIRECTIONS)[number];
  label: string;
  amount: number;
  frequency: (typeof FREQUENCIES)[number];
  dayOfMonth: number | null;
  /** 계약서에 적힌 지급일(일시불) 또는 첫 결제일. 없으면 null — 앱이 시작일로 계산하고 "확인 필요"로 표시 */
  date: string | null;
  endDate: string | null;
  installmentCount: number | null;
  isVariable: boolean;
  /** 신청한 경우에만 청구되는 선택 항목 (예: 락커 이용료) */
  optional: boolean;
  confidence: Confidence;
  evidence?: Evidence[];
}

export interface ExtractedDetail {
  value: string | number | boolean;
  confidence: Confidence;
  evidence?: Evidence[];
}

export interface ExtractedCheck {
  severity: (typeof SEVERITY)[number];
  topic: string;
  title: string;
  description: string;
  confidence: Confidence;
  evidenceQuote: string | null;
  evidencePage: number | null;
  /** 근거 파일 순서(0부터) — 앱이 보관된 원본 id로 바꾼다 */
  evidenceFileIndex: number | null;
  relatedDate: string | null;
  suggestion:
    | null
    | { kind: 'set_termination_notice'; terminationNoticeDays: number; autoRenewal: boolean; renewalPeriodMonths: number | null }
    | { kind: 'add_event'; eventType: 'custom'; title: string; eventDate: string };
}

export interface AppExtractionResult {
  category: Classification<(typeof CATEGORY_CODES)[number]>;
  contractType: Classification<(typeof CONTRACT_TYPE_CODES)[number]>;
  fields: Record<string, Extracted>;
  dates: ExtractedDate[];
  payments: ExtractedPayment[];
  /** 유형별 속성 (DB 키 snake_case) — 앱이 선택된 유형의 스키마로 다시 검증한다 */
  details: Record<string, ExtractedDetail>;
  checks: ExtractedCheck[];
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

function quoteOf(o: Record<string, unknown>): { evidence?: Evidence[] } {
  const quote = typeof o.evidence_quote === 'string' ? o.evidence_quote.trim().slice(0, 200) : '';
  const page = typeof o.evidence_page === 'number' && o.evidence_page >= 1 ? Math.round(o.evidence_page) : null;
  return quote ? { evidence: [{ page: page ?? 1, quote }] } : {};
}

const MAX_AMOUNT = 100_000_000_000;

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
  }
}

/** 상세 속성 값 정제 — 해당 키의 형식(레지스트리)에 맞지 않으면 버린다. 유형별 허용 여부는 앱이 확인 */
function cleanDetail(key: string, o: Record<string, unknown>): string | number | boolean | null {
  const def = DETAIL_FIELD_DEFS.find((d) => d.db === key);
  if (!def) return null;
  switch (def.input) {
    case 'enum': {
      const v = o.text_value;
      return DETAIL_FIELD_DEFS.some((d) => d.db === key && d.options?.some((x) => x.value === v)) ? (v as string) : null;
    }
    case 'text':
      return text(o.text_value, 500);
    case 'boolean':
      return typeof o.boolean_value === 'boolean' ? o.boolean_value : null;
    case 'percent': {
      const n = typeof o.number_value === 'number' ? o.number_value : NaN;
      return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 1000) / 1000 : null;
    }
    default:
      return toInt(o.number_value, 0, MAX_AMOUNT);
  }
}

/** 금지 표현이 있으면 해당 문구를 중립 문장으로 대체 */
function neutralize(value: string, fallback: string): string {
  return BANNED_PHRASES.some((p) => value.includes(p)) ? fallback : value;
}

function confidenceOf(v: unknown): Confidence {
  return oneOf(CONFIDENCE, v) ?? 'low';
}

function classify<T extends string>(raw: unknown, codes: readonly T[], fallback: T): Classification<T> {
  const o = isObj(raw) ? raw : {};
  const value = oneOf(codes, o.value);
  const reason = text(o.reason, 200);
  return {
    value: value ?? fallback,
    confidence: value ? confidenceOf(o.confidence) : 'low',
    alternatives: (Array.isArray(o.alternatives) ? o.alternatives : [])
      .map((a) => oneOf(codes, a))
      .filter((a): a is T => !!a && a !== value)
      .filter((a, i, arr) => arr.indexOf(a) === i)
      .slice(0, 3),
    reason: reason ? neutralize(reason, '계약서 내용을 바탕으로 분류했어요.') : null,
  };
}

/** 모델 출력(JSON) → 검증된 앱 형식. 구조가 틀리면 예외. 형식이 틀린 항목은 버리거나 low로 낮춘다. */
export function toAppResult(output: unknown, provider: string): AppExtractionResult {
  if (!isObj(output) || !isObj(output.fields) || !Array.isArray(output.checks) || !isObj(output.contract_type)) throw new Error('invalid_output_shape');
  const fieldsIn = output.fields as Record<string, unknown>;

  // 1·2) 분야·유형
  const category = classify(output.category, CATEGORY_CODES, 'other');
  const contractType = classify(output.contract_type, CONTRACT_TYPE_CODES, 'other');

  // 8) 공통 필드
  const fields: Record<string, Extracted> = {};
  for (const key of Object.keys(FIELDS)) {
    const f = fieldsIn[key];
    if (!isObj(f)) {
      fields[key] = { value: null, confidence: 'low' };
      continue;
    }
    const value = cleanField(key, f.value);
    fields[key] = { value, confidence: value === null ? 'low' : confidenceOf(f.confidence), ...quoteOf(f) };
  }

  // 3·4) 날짜 (형식이 틀린 날짜는 버림)
  const dates: ExtractedDate[] = (Array.isArray(output.dates) ? output.dates : [])
    .filter(isObj)
    .filter((d) => validDate(d.date))
    .slice(0, 40)
    .map((d) => ({
      date: (d.date as string).trim(),
      meaning: oneOf(DATE_MEANINGS, d.meaning) ?? 'other',
      label: text(d.label, 40) ?? '날짜',
      confidence: confidenceOf(d.confidence),
      ...quoteOf(d),
    }));

  // 5·6) 결제 (금액·주기가 틀린 항목은 버림, 같은 돈 중복 제거)
  const payments: ExtractedPayment[] = [];
  for (const p of Array.isArray(output.payments) ? output.payments : []) {
    if (!isObj(p) || payments.length >= 20) continue;
    const amount = toInt(p.amount, 0, MAX_AMOUNT);
    const frequency = oneOf(FREQUENCIES, p.frequency);
    if (amount === null || frequency === null) continue;
    const oneTime = frequency === 'one_time';
    const kind = oneOf(PAYMENT_KIND_CODES, p.kind) ?? 'other';
    const date = validDate(p.date) ? p.date.trim() : null;
    if (payments.some((x) => x.kind === kind && x.amount === amount && x.frequency === frequency && x.date === date)) continue;
    const kindDefault = PAYMENT_KIND_DEFS.find((k) => k.code === kind)?.direction ?? 'expense';
    payments.push({
      kind,
      direction: oneOf(DIRECTIONS, p.direction) ?? kindDefault,
      label: text(p.label, 40) ?? '결제',
      amount,
      frequency,
      dayOfMonth: oneTime ? null : toInt(p.day_of_month, 1, 31),
      date,
      endDate: !oneTime && validDate(p.end_date) ? p.end_date.trim() : null,
      installmentCount: oneTime ? null : toInt(p.installment_count, 1, 600),
      isVariable: p.is_variable === true,
      optional: p.optional === true,
      confidence: confidenceOf(p.confidence),
      ...quoteOf(p),
    });
  }

  // 7) 유형별 속성
  const details: Record<string, ExtractedDetail> = {};
  for (const d of Array.isArray(output.details) ? output.details : []) {
    if (!isObj(d) || typeof d.key !== 'string' || details[d.key]) continue;
    const value = cleanDetail(d.key, d);
    if (value !== null) details[d.key] = { value, confidence: confidenceOf(d.confidence), ...quoteOf(d) };
  }

  // 9) PACTO 계약 체크 (원문 근거가 없는 항목은 신뢰도 low)
  const notice = fields.terminationNoticeDays.value as number | null;
  const auto = fields.autoRenewal.value as boolean | null;
  const months = fields.renewalPeriodMonths.value as number | null;
  const checks: ExtractedCheck[] = (output.checks as unknown[])
    .filter(isObj)
    .slice(0, 12)
    .map((c) => {
      const topic = oneOf(CHECK_TOPIC_CODES, c.topic) ?? 'other';
      const title = neutralize(text(c.title, 40) ?? '확인할 조항', '확인할 조항');
      const description = neutralize(text(c.description, 300) ?? '', '계약서의 해당 조항을 확인해주세요.') || '계약서의 해당 조항을 확인해주세요.';
      const evidenceQuote = text(c.evidence_quote, 200);
      const relatedDate = validDate(c.related_date) ? c.related_date.trim() : null;
      const fileNo = toInt(c.evidence_file, 1, 50);
      return {
        severity: oneOf(SEVERITY, c.severity) ?? 'info',
        topic,
        title,
        description,
        confidence: evidenceQuote ? confidenceOf(c.confidence) : 'low',
        evidenceQuote,
        evidencePage: typeof c.evidence_page === 'number' && c.evidence_page >= 1 ? Math.round(c.evidence_page) : null,
        evidenceFileIndex: fileNo === null ? null : fileNo - 1,
        relatedDate,
        // 24) 관리로 연결: 자동갱신·통보기한 → 해지 통보기한 일정, 명시된 날짜 → 캘린더 일정 제안
        suggestion:
          (topic === 'auto_renewal' || topic === 'notice_deadline') && notice !== null
            ? { kind: 'set_termination_notice' as const, terminationNoticeDays: notice, autoRenewal: auto ?? topic === 'auto_renewal', renewalPeriodMonths: months }
            : relatedDate
              ? { kind: 'add_event' as const, eventType: 'custom' as const, title, eventDate: relatedDate }
              : null,
      };
    });

  return { category, contractType, fields, dates, payments, details, checks, provider, promptVersion: PROMPT_VERSION };
}
