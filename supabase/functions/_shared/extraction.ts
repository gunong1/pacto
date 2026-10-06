// 계약서 분석 — 공급자와 무관한 스키마 / 프롬프트 / 검증 / 앱 형식 변환.
// 순수 TypeScript (Deno·Node 공용) — 앱 테스트(jest)에서도 같은 파일을 검증한다.
//
// v4 분석 순서 (정해진 칸을 억지로 채우지 않는다):
//  1 분야(category) → 2 구조(contract_type) → 3·4 날짜와 의미 → 5·6 금액과 의미·주기·방향 → 7 유형별 속성
//  → 8 종료·갱신·해지·만기 조건 → 9 PACTO 계약 체크(확인이 필요한 조항, 원문 근거) → 10 사용자 확인용 데이터
// 날짜·금액을 계약 정보·결제 목록으로 바꾸는 일은 앱(src/features/registration/extraction.ts)이 하고, 사용자가 확인한 뒤 저장한다.
// 분야·유형·속성·결제 의미·날짜 의미·체크 주제 목록은 공용 레지스트리(contractRegistry.ts)에서 온다.

import {
  AMOUNT_ROLES,
  BUSINESS_DAY_RULES,
  CHECK_BEHAVIORS,
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

export const PROMPT_VERSION = 'extract-v5';

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
/** 모델이 줄 수 있는 출처 (계산·사용자 확인은 앱이 붙인다) */
const MODEL_SOURCES = ['explicit', 'inferred'] as const;
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
  terminationNoticeDays: {
    type: 'integer',
    desc: '계약 종료일(만료일) 기준으로 며칠 전까지 해지·갱신 거절을 알려야 하는지(일). 1개월 전이면 30. 자진 퇴직·중도 해지처럼 사용자가 정한 날 기준 통보는 넣지 않는다 (checks의 conditional_rule)',
  },
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
const sourceType = { type: 'string', enum: [...MODEL_SOURCES], description: 'explicit: 계약서에 그대로 적힌 값 / inferred: 문맥으로 판단한 값' };
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
        source_type: sourceType,
        ...evidence,
      }),
    },
    payments: {
      type: 'array',
      description: '계약에서 오가는 돈을 모두 (정기 결제·급여·대금·일회성 비용·보증금·계약금·중도금·잔금 …)',
      items: strictObject({
        role: {
          type: 'string',
          enum: [...AMOUNT_ROLES],
          description: '실제로 오가는 돈(recurring_cashflow·one_time_cashflow·deposit)인지, 다른 금액의 구성 항목(component)·합계(total)·참고 금액(reference)인지',
        },
        part_of: { type: ['string', 'null'], description: 'component일 때 이 금액이 속한 금액의 label (예: 월 임금)' },
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
        business_day_rule: { type: 'string', enum: [...BUSINESS_DAY_RULES], description: '지급일이 휴일이면: previous 직전 영업일 / next 다음 영업일 / none 언급 없음' },
        confidence,
        source_type: sourceType,
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
        source_type: sourceType,
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
        behavior: {
          type: 'string',
          enum: [...CHECK_BEHAVIORS],
          description: 'info: 알아둘 정보 / fixed_event: 계약서 기준으로 날짜가 정해지는 일 / conditional_rule: 어떤 상황이 생길 때만 생기는 의무 (날짜를 만들지 않음)',
        },
        condition: { type: ['string', 'null'], description: 'conditional_rule의 조건 (예: 근로자가 자진 퇴직하려는 경우)' },
        action: { type: ['string', 'null'], description: 'conditional_rule에서 해야 할 일 (예: 희망 퇴직일 30일 전에 회사에 통보)' },
        offset_days: { type: ['integer', 'null'], description: 'conditional_rule에서 기준일 며칠 전인지 (예: 30)' },
        related_date: { type: ['string', 'null'], description: 'fixed_event이고 챙길 날짜가 계약서에 명시돼 있으면 YYYY-MM-DD. conditional_rule은 null' },
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
    '   severity와 behavior는 아래 의미 해석 원칙을 따릅니다. 확신이 낮으면 confidence를 low로.',
    '   각 항목에는 근거가 된 원문 문장(evidence_quote), 쪽(evidence_page), 파일 번호(evidence_file)를 반드시 넣습니다. 근거가 없는 조항은 넣지 않습니다.',
    '   계약서 기준으로 날짜가 정해지는 일(fixed_event)이고 그 날짜가 명시돼 있을 때만 related_date에 넣습니다.',
    '',
    '의미 해석 원칙 (가장 중요): 숫자와 날짜를 발견했다고 곧바로 결제·일정으로 만들지 않습니다. 의미를 먼저 판단합니다.',
    '- 금액의 role: 실제로 오가는 돈만 recurring_cashflow / one_time_cashflow / deposit. 다른 금액을 이루는 하위 항목은 component(part_of에 상위 금액 이름),',
    '  예) "월 임금 3,600,000원은 기본급 3,280,000원과 고정연장근로수당 320,000원으로 구성" → 월 임금 recurring_cashflow 1건 + 기본급·고정연장근로수당 component 2건 (별도 수입 아님).',
    '  차량가·총 대출한도처럼 오가는 돈이 아닌 금액은 reference.',
    '- 계약서에 없는 값을 계산해 만들지 않습니다: 월 임금만 있으면 연봉(annual_salary)을 넣지 않고, 기간만 있으면 다른 금액을 만들지 않습니다. 숫자 속성은 계약서에 적힌 경우만 explicit로.',
    '- 문맥으로 판단한 값(예: 기간이 정해져 있어 계약직으로 판단)은 source_type=inferred. 계약서에 그 단어가 직접 있으면 explicit.',
    '- 조건부 의무는 날짜로 바꾸지 않습니다: "근로자가 퇴직하고자 하는 경우 30일 전 통보"는 계약 종료일 기준 통보기한이 아닙니다 →',
    '  checks에 behavior=conditional_rule, condition=자진 퇴직하려는 경우, action=희망 퇴직일 30일 전에 회사에 통보, offset_days=30, related_date=null.',
    '  fields.terminationNoticeDays는 "계약 만료 N일 전까지 해지(갱신 거절) 통보"처럼 종료일 기준일 때만 넣습니다.',
    '- 기간 조건(수습기간 N개월, 수습 중 임금 N%)은 속성(probation_months, probation_pay_rate)으로 넣습니다. 시작일만 따로 일정(related_date)으로 만들지 않습니다.',
    '- 지급일이 휴일일 때 규칙("휴일이면 직전 영업일")은 business_day_rule로.',
    '- 자동갱신이 아니고 갱신을 별도 협의로 정하면 autoRenewal=false, 갱신 조건은 renewal_terms 속성(해당 유형) 또는 checks(topic=renewal_terms).',
    '- checks의 severity: info = 핵심 정보(알아두면 되는 계약 정보: 급여일·근로시간·계약기간·수습기간 사실),',
    '  check = 확인 필요(사용자가 조건을 알고 있어야 하는 내용: 회사의 근무장소·업무 변경 가능, 수습 중 임금 감액, 월 임금에 고정수당 포함, 퇴직 사전통보, 갱신 별도 협의, 비밀유지, 자산 반환),',
    '  caution = 주의 필요(책임·비용·권리 제한이 큰 조건: 위약금·손해배상 범위·환불 제한·일방적 변경·연체이율 등). 일반 정보를 모두 확인 필요로 올리지 않습니다.',
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
type ModelSource = (typeof MODEL_SOURCES)[number];

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
  sourceType: ModelSource;
  evidence?: Evidence[];
}

/** 실제로 오가지 않는 금액 — 구성 항목은 상위 결제에 붙이고, 합계·참고 금액은 따로 보여준다 */
export interface ExtractedComponent {
  label: string;
  amount: number;
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
  /** 이 금액을 이루는 하위 항목 (합산하지 않는다) */
  components: ExtractedComponent[];
  businessDayRule: (typeof BUSINESS_DAY_RULES)[number];
  confidence: Confidence;
  sourceType: ModelSource;
  evidence?: Evidence[];
}

export interface ExtractedDetail {
  value: string | number | boolean;
  confidence: Confidence;
  sourceType: ModelSource;
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
  /** info: 알아둘 정보 / fixed_event: 날짜가 정해지는 일 / conditional_rule: 조건이 생길 때만 생기는 의무 */
  behavior: (typeof CHECK_BEHAVIORS)[number];
  /** conditional_rule — 사용자가 기준일(예: 퇴직 예정일)을 입력하면 기준일 − offsetDays 일정을 만든다 */
  rule: { condition: string; action: string; offsetDays: number | null } | null;
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
  /** 합계·참고 금액 (결제·지출에 넣지 않음) */
  references: (ExtractedComponent & { role: 'total' | 'reference' })[];
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

/** 출처를 모르면 계약서에 적힌 값으로 보지 않는다 */
function sourceOf(v: unknown): ModelSource {
  return oneOf(MODEL_SOURCES, v) ?? 'inferred';
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
      sourceType: sourceOf(d.source_type),
      ...quoteOf(d),
    }));

  // 5·6) 금액 — 의미(role)를 먼저 본다. 실제로 오가는 돈만 결제로, 구성 항목은 상위 결제에, 합계·참고 금액은 따로.
  const payments: ExtractedPayment[] = [];
  const pendingComponents: { label: string; amount: number; partOf: string | null; direction: string | null; frequency: string | null }[] = [];
  const references: AppExtractionResult['references'] = [];
  for (const p of Array.isArray(output.payments) ? output.payments : []) {
    if (!isObj(p) || payments.length >= 20) continue;
    const amount = toInt(p.amount, 0, MAX_AMOUNT);
    if (amount === null) continue;
    const role = oneOf(AMOUNT_ROLES, p.role);
    const label = text(p.label, 40) ?? '결제';
    if (role === 'component') {
      pendingComponents.push({ label, amount, partOf: text(p.part_of, 40), direction: oneOf(DIRECTIONS, p.direction), frequency: oneOf(FREQUENCIES, p.frequency) });
      continue;
    }
    if (role === 'total' || role === 'reference') {
      references.push({ label, amount, role });
      continue;
    }
    const frequency = oneOf(FREQUENCIES, p.frequency);
    if (frequency === null) continue;
    const oneTime = frequency === 'one_time';
    const kind = oneOf(PAYMENT_KIND_CODES, p.kind) ?? 'other';
    const date = validDate(p.date) ? p.date.trim() : null;
    if (payments.some((x) => x.kind === kind && x.amount === amount && x.frequency === frequency && x.date === date)) continue;
    const kindDefault = PAYMENT_KIND_DEFS.find((k) => k.code === kind)?.direction ?? 'expense';
    payments.push({
      kind,
      direction: oneOf(DIRECTIONS, p.direction) ?? kindDefault,
      label,
      amount,
      frequency,
      dayOfMonth: oneTime ? null : toInt(p.day_of_month, 1, 31),
      date,
      endDate: !oneTime && validDate(p.end_date) ? p.end_date.trim() : null,
      installmentCount: oneTime ? null : toInt(p.installment_count, 1, 600),
      isVariable: p.is_variable === true,
      optional: p.optional === true,
      components: [],
      businessDayRule: oneTime ? 'none' : (oneOf(BUSINESS_DAY_RULES, p.business_day_rule) ?? 'none'),
      confidence: confidenceOf(p.confidence),
      sourceType: sourceOf(p.source_type),
      ...quoteOf(p),
    });
  }
  // 안전장치: role 없이 "…에 포함"·"…으로 구성"이라고 적힌 정기 금액이 같은 방향·주기의 더 큰 정기 금액과 함께 있으면 구성 항목으로 본다
  // (예: 월 임금 3,600,000 + "월 임금에 포함된" 고정연장근로수당 320,000 → 별도 수입이 아님)
  for (const p of [...payments]) {
    if (p.frequency === 'one_time' || !p.evidence?.some((e) => /포함|구성/.test(e.quote))) continue;
    const parent = payments.find((x) => x !== p && x.direction === p.direction && x.frequency === p.frequency && x.amount > p.amount);
    if (!parent) continue;
    payments.splice(payments.indexOf(p), 1);
    pendingComponents.push({ label: p.label, amount: p.amount, partOf: parent.label, direction: p.direction, frequency: p.frequency });
  }
  // 구성 항목 → 상위 결제 (part_of 이름 → 같은 방향·주기의 정기 금액 → 더 큰 금액 순). 상위를 못 찾으면 참고 금액으로
  for (const c of pendingComponents) {
    const recurring = payments.filter((x) => x.frequency !== 'one_time' && x.amount > c.amount);
    const parent =
      recurring.find((x) => c.partOf && (x.label.includes(c.partOf) || c.partOf.includes(x.label))) ??
      recurring.find((x) => (!c.direction || x.direction === c.direction) && (!c.frequency || x.frequency === c.frequency)) ??
      null;
    if (parent && parent.components.length < 10 && !parent.components.some((x) => x.label === c.label)) parent.components.push({ label: c.label, amount: c.amount });
    else if (!parent) references.push({ label: c.label, amount: c.amount, role: 'reference' });
  }

  // 7) 유형별 속성 — 숫자 속성은 계약서에 적힌 경우만 (추정·계산한 연봉 같은 값은 버린다)
  const monthlyAmounts = new Set(payments.filter((p) => p.frequency === 'monthly').map((p) => p.amount));
  const details: Record<string, ExtractedDetail> = {};
  for (const d of Array.isArray(output.details) ? output.details : []) {
    if (!isObj(d) || typeof d.key !== 'string' || details[d.key]) continue;
    const value = cleanDetail(d.key, d);
    if (value === null) continue;
    const sourceType = sourceOf(d.source_type);
    const def = DETAIL_FIELD_DEFS.find((x) => x.db === d.key);
    const numeric = def?.input === 'amount' || def?.input === 'integer' || def?.input === 'percent';
    if (numeric && sourceType === 'inferred') continue;
    // 연 단위 금액이 월 금액과 같으면 월 금액을 잘못 옮긴 값 (예: 연봉 = 월 임금 3,600,000)
    if (/^annual_/.test(d.key) && typeof value === 'number' && monthlyAmounts.has(value)) continue;
    details[d.key] = { value, confidence: confidenceOf(d.confidence), sourceType, ...quoteOf(d) };
  }

  // 9) PACTO 계약 체크 (원문 근거가 없는 항목은 신뢰도 low)
  const auto = fields.autoRenewal.value as boolean | null;
  const months = fields.renewalPeriodMonths.value as number | null;
  const knownDates = new Set(dates.map((d) => d.date));
  const checks: ExtractedCheck[] = (output.checks as unknown[])
    .filter(isObj)
    .slice(0, 12)
    .map((c) => {
      const topic = oneOf(CHECK_TOPIC_CODES, c.topic) ?? 'other';
      const title = neutralize(text(c.title, 40) ?? '확인할 조항', '확인할 조항');
      const description = neutralize(text(c.description, 300) ?? '', '계약서의 해당 조항을 확인해주세요.') || '계약서의 해당 조항을 확인해주세요.';
      const evidenceQuote = text(c.evidence_quote, 200);
      const fileNo = toInt(c.evidence_file, 1, 50);
      const offsetDays = toInt(c.offset_days, 0, 365);
      const conditional = CHECK_TOPIC_DEFS.find((t) => t.code === topic)?.conditional === true || c.behavior === 'conditional_rule';
      const behavior: ExtractedCheck['behavior'] = conditional ? 'conditional_rule' : (oneOf(CHECK_BEHAVIORS, c.behavior) ?? 'info');
      // 조건부 의무는 날짜를 만들지 않는다
      const relatedDate = !conditional && validDate(c.related_date) ? c.related_date.trim() : null;
      return {
        severity: oneOf(SEVERITY, c.severity) ?? 'info',
        topic,
        title,
        description,
        confidence: evidenceQuote ? confidenceOf(c.confidence) : 'low',
        evidenceQuote,
        evidencePage: typeof c.evidence_page === 'number' && c.evidence_page >= 1 ? Math.round(c.evidence_page) : null,
        evidenceFileIndex: fileNo === null ? null : fileNo - 1,
        behavior,
        rule: conditional
          ? { condition: neutralize(text(c.condition, 100) ?? title, title), action: neutralize(text(c.action, 150) ?? description, description), offsetDays }
          : null,
        relatedDate,
        suggestion: null as ExtractedCheck['suggestion'],
      };
    });

  // 8) 종료일 기준 통보기한 — 자동갱신이 아니고 같은 일수의 조건부 통보(예: 자진 퇴직 30일 전)가 있으면 그 조항을 잘못 옮긴 값
  let notice = fields.terminationNoticeDays.value as number | null;
  const noticeQuote = fields.terminationNoticeDays.evidence?.[0]?.quote ?? '';
  const sameClause = (c: ExtractedCheck) => c.rule?.offsetDays === notice || (!!noticeQuote && !!c.evidenceQuote && (c.evidenceQuote.includes(noticeQuote) || noticeQuote.includes(c.evidenceQuote)));
  if (notice !== null && auto !== true && checks.some((c) => c.behavior === 'conditional_rule' && sameClause(c))) {
    fields.terminationNoticeDays = { value: null, confidence: 'low' };
    notice = null;
  }
  // 24) 관리로 연결: 자동갱신·통보기한 → 해지 통보기한 일정, 계약서에 명시된 (다른 데서 이미 관리하지 않는) 날짜 → 캘린더 일정 제안
  for (const c of checks) {
    if (c.behavior === 'conditional_rule') continue;
    if ((c.topic === 'auto_renewal' || c.topic === 'notice_deadline') && notice !== null) {
      c.behavior = 'fixed_event';
      c.suggestion = { kind: 'set_termination_notice', terminationNoticeDays: notice, autoRenewal: auto ?? c.topic === 'auto_renewal', renewalPeriodMonths: months };
    } else if (c.relatedDate && !knownDates.has(c.relatedDate)) {
      c.behavior = 'fixed_event';
      c.suggestion = { kind: 'add_event', eventType: 'custom', title: c.title, eventDate: c.relatedDate };
    }
  }

  return { category, contractType, fields, dates, payments, references, details, checks, provider, promptVersion: PROMPT_VERSION };
}
