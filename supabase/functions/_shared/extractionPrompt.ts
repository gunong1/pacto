// 계약서 분석 — 모델에 보내는 JSON Schema(Structured Outputs)와 지시문(프롬프트).
// 정리 규칙은 analysisRules/, 조립은 extraction.ts.
import {
  AMOUNT_ROLES,
  PRICE_BASES,
  BUSINESS_DAY_RULES,
  PAYMENT_OBLIGATIONS,
  CHECK_BEHAVIORS,
  CHECK_TOPIC_CODES,
  CHECK_TOPIC_DEFS,
  CLASSIFICATION_PRIORITY,
  CONTRACT_DOMAIN_CODES,
  CONTRACT_DOMAIN_DEFS,
  CONTRACT_KIND_CODES,
  CONTRACT_KIND_DEFS,
  CONTRACT_SUBTYPE_CODES,
  CONTRACT_TYPE_DEFS,
  DETAIL_DB_KEYS,
  DETAIL_FIELD_DEFS,
  DIRECTIONS,
  PAYMENT_KIND_CODES,
  PAYMENT_KIND_DEFS,
  PARTY_ROLE_CODES,
  partyRolesOf,
} from './contractRegistry.ts';
import { DOCUMENT_CHECK_INSTRUCTIONS, documentCheckJsonSchema } from './documentGate.ts';
import { BANNED_PHRASES, CONFIDENCE, DATE_MEANINGS, DATE_SOURCES, FIELDS, FREQUENCIES, MODEL_SOURCES, SEVERITY } from './analysisRules/vocabulary.ts';

/**
 * v7: document_check(문서 역할·쪽별 판정·계약 신호) + 모든 추출값에 근거 파일·쪽
 * v8: 결제 날짜의 출처(date_source) — "계약 당일 지급"처럼 다른 날짜를 기준으로 하는 금액은 그 기준 날짜를 쓰고, 옆 줄 날짜를 옮기지 않는다
 * v12: 면제는 role=waived · 조건부 비용(위약금·연체료 …)은 결제가 아니라 checks에 금액·계산식과 함께 · 참고 금액은 role=reference 하나로
 *      (payment_obligation은 confirmed·optional·conditional만) · 중도해지·위약금 글 필드 없음 (v11은 배포 전에 되돌림)
 */
/* v13: 계약 종류를 계약의 본질로 하나만 판단 (classification: kind·subtype·domains·confidence·alternatives·근거·secondary_elements).
 *      분야(category)·관리 구조(contract_type)를 따로 고르지 않음 — 결제 방식은 분류 근거가 아님 · 자동차는 종류가 아니라 대상(domains)
 *      계약 체크는 할 일·주의할 위험만 (user_action), 사실은 fields·details·payments에만 */
export const PROMPT_VERSION = 'extract-v17';

/** 모델이 답할 수 있는 의무 수준 — 참고 금액은 role=reference, "발생 가능"은 conditional로 (DB는 이전 값도 읽음) */
const MODEL_OBLIGATIONS = PAYMENT_OBLIGATIONS.filter((o) => o === 'confirmed' || o === 'optional' || o === 'conditional');

const evidenceQuote = {
  evidence_quote: { type: ['string', 'null'], description: '계약서 원문에서 그대로 옮긴 근거 문장 (120자 이내)' },
};
// v7: 모든 추출값에 근거 파일·쪽 — 사용자가 제외한 사진이나 계약과 무관한 쪽에서 온 값을 지울 수 있도록
const evidence = {
  ...evidenceQuote,
  evidence_page: { type: ['integer', 'null'], description: '근거가 있는 쪽 번호(1부터, 파일 안에서)' },
  evidence_file: { type: ['integer', 'null'], description: '근거가 있는 파일 번호(1부터, 첨부 순서). 파일이 하나면 1' },
};
const confidence = { type: 'string', enum: [...CONFIDENCE] };
const sourceType = { type: 'string', enum: [...MODEL_SOURCES], description: 'explicit: 계약서에 그대로 적힌 값 / inferred: 문맥으로 판단한 값' };
const strictObject = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
/** 계약 종류 분류 — 계약의 본질 하나 (결제 방식과 무관) */
const classificationSchema = () =>
  strictObject({
    kind: { type: 'string', enum: [...CONTRACT_KIND_CODES], description: '주 계약 종류 — 계약을 통해 실제로 무엇을 제공받거나 어떤 법률관계를 맺는가' },
    subtype: { type: 'string', enum: [...CONTRACT_SUBTYPE_CODES, 'none'], description: '상세 분류 (그 종류의 목록에서만, 맞는 것이 없으면 none)' },
    domains: { type: 'array', items: { type: 'string', enum: [...CONTRACT_DOMAIN_CODES] }, description: '계약 대상 (자동차·부동산·소프트웨어 …). 없으면 빈 배열' },
    confidence,
    alternatives: { type: 'array', items: { type: 'string', enum: [...CONTRACT_KIND_CODES] }, description: '애매할 때 가능한 다른 종류 (최대 2개, 주 종류 제외, 없으면 빈 배열)' },
    reason: { type: 'string', description: '이렇게 본 이유 — 무엇을 제공·사용·보장·대여·이전하는 계약인지 (한 문장, 계약서 내용 기준)' },
    ...evidence,
    secondary_elements: {
      type: 'array',
      description: '혼합 계약에서 함께 포함된 다른 계약 요소 (예: 통신 + 단말기 할부). 없으면 빈 배열',
      items: strictObject({ kind: { type: 'string', enum: [...CONTRACT_KIND_CODES] }, note: { type: 'string', description: '무엇인지 짧게 (예: 단말기 24개월 할부)' } }),
    },
  });

/** Structured Outputs(strict)용 JSON Schema: 모든 속성 required, additionalProperties false */
// 스키마 크기 한도(객체 속성 100개·중첩 5단계) 안에서 근거 파일·쪽을 모든 값에 넣기 위해, v7부터 공통 필드도 "키 목록" 방식
const FIELD_GUIDE = Object.entries(FIELDS)
  .map(([k, d]) => `${k}(${d.type === 'integer' ? 'number_value' : d.type === 'boolean' ? 'boolean_value' : 'text_value'}): ${d.desc}`)
  .join(' / ');

export function extractionJsonSchema() {
  return strictObject({
    document_check: documentCheckJsonSchema(),
    classification: classificationSchema(),
    parties: {
      type: 'array',
      description: '계약서에 실제로 적힌 계약 당사자 (사람·회사). 역할마다 한 명씩, 공동 당사자는 각각. 찾지 못한 당사자는 넣지 않음',
      items: strictObject({
        role: { type: 'string', enum: [...PARTY_ROLE_CODES], description: '계약서가 밝힌 역할 (그 계약 종류의 역할 목록에서). 역할을 알 수 없으면 party' },
        name: { type: 'string', description: '계약서에 적힌 이름·회사명 그대로 (연락처·주민번호·주소는 넣지 않음). 회사의 대표자가 함께 적혀 있으면 "회사명 / 대표 이름"' },
        confidence,
        ...evidence,
      }),
    },
    fields: {
      type: 'array',
      description: `계약 공통 정보 중 계약서에 있는 것만 key마다 한 번 (없으면 넣지 않음). ${FIELD_GUIDE}`,
      items: strictObject({
        key: { type: 'string', enum: Object.keys(FIELDS) },
        text_value: { type: ['string', 'null'] },
        number_value: { type: ['integer', 'null'] },
        boolean_value: { type: ['boolean', 'null'] },
        confidence,
        ...evidence,
      }),
    },
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
          description: '실제로 오가는 돈(recurring_cashflow·one_time_cashflow·deposit)인지, 다른 금액의 구성 항목(component)·합계(total)·참고 금액(reference: 차량가·대출금액·할인 전 금액·예상·최대 금액)·면제(waived: 면제·무료·무상·0원)인지',
        },
        part_of: { type: ['string', 'null'], description: 'component일 때 이 금액이 속한 금액의 label (예: 월 임금)' },
        kind: { type: 'string', enum: [...PAYMENT_KIND_CODES] },
        direction: { type: 'string', enum: [...DIRECTIONS], description: '참고값 (서버가 계약 당사자 역할로 다시 정함). 모르면 neutral' },
        payer_role: { type: 'string', enum: [...PARTY_ROLE_CODES, 'unknown'], description: '이 돈을 내는 쪽의 역할 — 계약서 문장이 밝힐 때만 (예: "임차인은 월세를 지급" → lessee). 문장에 없으면 unknown' },
        payee_role: { type: 'string', enum: [...PARTY_ROLE_CODES, 'unknown'], description: '이 돈을 받는 쪽의 역할 — 계약서 문장이 밝힐 때만. 없으면 unknown' },
        label: { type: 'string', description: '계약서의 항목 이름 (예: 월 렌탈료, 초기 설치비, 월 급여, 잔금)' },
        amount: { type: 'integer', description: '1회 금액(원)' },
        price_basis: {
          type: 'string',
          enum: [...PRICE_BASES],
          description: 'actual: 실제로 내는(받는) 금액 / before_discount: "할인전·할인 전·정상가·프로모션 적용 전"처럼 할인을 적용하기 전 금액 (실제 결제액이 아님)',
        },
        frequency: { type: 'string', enum: [...FREQUENCIES] },
        day_of_month: { type: ['integer', 'null'], description: '정기 결제·지급일(매월 N일의 N). 명시된 경우만' },
        date: { type: ['string', 'null'], description: '일시불의 지급일 또는 정기 결제의 첫 결제일 (YYYY-MM-DD). 이 금액의 문구에 날짜가 직접 적혀 있을 때만. 기준 날짜(date_source)를 따르면 그 기준 날짜 또는 null' },
        date_source: {
          type: 'string',
          enum: [...DATE_SOURCES],
          description:
            'date의 출처. explicit: 이 금액의 문구에 날짜가 직접 적힘 / contract_date: "계약 당일·계약 시·계약 체결 시" / balance_date: "잔금일에" / move_in_date: "입주일에·입주 시" / start_date: "계약 시작일·개시일에" / end_date: "종료일·만기에" / calculated: 기준 날짜에서 계산(…로부터 N일 이내) / inferred: 문맥으로 추정. 정기 결제가 "매월 N일"뿐이면 explicit, date=null',
        },
        end_date: { type: ['string', 'null'], description: '정기 결제의 마지막 결제일 또는 납입기간 종료일. 명시된 경우만' },
        installment_count: { type: ['integer', 'null'], description: '총 납입 회차 (할부·대출). 명시된 경우만' },
        is_variable: { type: 'boolean', description: '사용량 등으로 매번 금액이 달라지는지' },
        payment_obligation: {
          type: 'string',
          enum: [...MODEL_OBLIGATIONS],
          description:
            'confirmed: 계약을 정상적으로 유지하는 동안 내거나 받는 돈 (월 렌탈료·월세·보험료·상환금·급여 …) / optional: 사용자가 선택(신청·이용)했을 때만 / conditional: 특정 상황(양도·해지·연체·파손·분실 등)이 생겼을 때만',
        },
        condition: { type: ['string', 'null'], description: 'confirmed가 아니면 언제 내는 돈인지 짧게 (예: 회원권을 양도하는 경우, 락커를 이용하는 경우)' },
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
      description: 'PACTO 계약 체크 — 사용자가 해야 할 일이나 주의할 위험이 있는 조항만 (단순 사실은 넣지 않음)',
      items: strictObject({
        severity: { type: 'string', enum: [...SEVERITY] },
        topic: { type: 'string', enum: [...CHECK_TOPIC_CODES] },
        title: { type: 'string', description: '짧은 이름 (예: 중도해지 위약금, 원상복구)' },
        description: { type: 'string', description: '왜 챙겨야 하는지 짧은 이유 한 문장 (원문 조항을 그대로 옮기지 않음 — 원문은 evidence_quote에). 판단하지 않고 전달만' },
        user_action: { type: ['string', 'null'], description: '사용자가 해야 할 일 (예: 퇴거 전 원상복구 범위 확인). 주의만 필요하면 null' },
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
        amount: { type: ['integer', 'null'], description: '이 조항의 금액(원)이 계약서에 적혀 있으면 (예: 위약금 200,000원). 없거나 비율로만 적혀 있으면 null' },
        amount_basis: { type: ['string', 'null'], description: '금액 계산식·기준 (예: 잔여 렌탈료의 10%, 상환금액의 1.2%). 없으면 null' },
        ...evidence,
      }),
    },
  });
}

/** 계약 종류별 당사자 역할 안내 (프롬프트용) */
function partyGuide(): string {
  return CONTRACT_KIND_DEFS.map((k) => `   - ${k.code}: ${partyRolesOf(k.code).map((r) => `${r.code}(${r.label})`).join(', ')}`).join('\n');
}

/** 유형별 속성 키 안내 (프롬프트용) */
function detailGuide(): string {
  // 당사자 칸(party)은 parties로 묻는다 (같은 이름을 두 곳에 넣지 않게)
  return CONTRACT_TYPE_DEFS.filter((t) => DETAIL_FIELD_DEFS.some((d) => d.type === t.code && !d.party))
    .map((t) => {
      const keys = DETAIL_FIELD_DEFS.filter((d) => d.type === t.code && !d.party).map((d) => {
        const value = d.options ? `text_value: ${d.options.map((o) => o.value).join('|')}` : d.input === 'boolean' ? 'boolean_value' : d.input === 'text' ? 'text_value' : 'number_value';
        return `${d.db}(${d.label}, ${value})`;
      });
      return `   - ${t.code} (${profileKinds(t.code)}): ${keys.join(', ')}`;
    })
    .join('\n');
}

/** 관리 묶음(profile)을 쓰는 계약 종류 이름 (프롬프트 안내용) */
function profileKinds(profile: string): string {
  return CONTRACT_KIND_DEFS.filter((k) => k.profile === profile).map((k) => k.code).join('·') || profile;
}

/** 계약 종류 정의 (프롬프트용) */
function kindGuide(): string {
  return CONTRACT_KIND_DEFS.map((k) => `   - ${k.code}(${k.label}): ${k.guide}${k.subtypes.length ? ` / subtype: ${k.subtypes.map((s) => `${s.code}(${s.label})`).join(', ')}` : ''}`).join('\n');
}

function topicGuide(): string {
  const common = CHECK_TOPIC_DEFS.filter((t) => t.types.length === 0 && t.code !== 'other').map((t) => `${t.code}(${t.label})`);
  const byType = CONTRACT_TYPE_DEFS.map((ty) => {
    const ts = CHECK_TOPIC_DEFS.filter((t) => t.types.includes(ty.code)).map((t) => `${t.code}(${t.label})`);
    return ts.length ? `   - ${ty.code} (${profileKinds(ty.code)}): ${ts.join(', ')}` : null;
  }).filter(Boolean);
  return [`   - 모든 계약: ${common.join(', ')}`, ...byType].join('\n');
}

export function extractionInstructions(today: string): string {
  return [
    '당신은 개인용 계약 관리 앱 PACTO의 계약서 분석 도우미입니다.',
    'PACTO는 계약이 어떤 종류인지 이해하고, 그 계약에서 중요한 돈·날짜·의무·주의할 조건을 찾아 계약이 끝날 때까지 관리하도록 돕습니다.',
    '계약서가 좋은지 나쁜지 판정하지 않습니다. 첨부된 파일(PDF 또는 사진)을 다음 순서로 분석합니다.',
    '',
    DOCUMENT_CHECK_INSTRUCTIONS,
    '1·2) classification — 계약 종류는 "돈을 어떻게 내는가"가 아니라 "계약을 통해 실제로 무엇을 제공받거나 어떤 법률관계를 맺는가"로 정합니다.',
    '   계약서 전체 문맥에서 본질적인 목적을 먼저 판단합니다: 무엇을 제공·사용·보장·대여·이전하는 계약인가 → 주된 법률관계·경제적 목적 → kind → subtype.',
    '   결제 주기(월납·연납·일시불·분납)와 금액 구조는 종류의 근거가 아닙니다 (구독도 연납·일시불일 수 있고, 보험도 월납일 수 있고, 렌탈도 선납일 수 있음).',
    '   단어 하나로 정하지 않습니다: "서비스" → 용역, "월 이용료" → 렌탈, "자동차" → 자동차, "매월" → 구독, "할부" 한 번 등장 → 할부 같은 판단을 하지 않습니다.',
    '   kind (주 종류 하나):',
    kindGuide(),
    '   판단 우선순위 (여러 성격이 함께 있으면 등장 단어 수가 아니라 주된 관계로):',
    ...CLASSIFICATION_PRIORITY.map((l) => `   - ${l}`),
    `   domains: 계약 대상 — ${CONTRACT_DOMAIN_DEFS.map((d) => `${d.code}(${d.label})`).join(', ')}. 자동차는 종류가 아니라 대상입니다 (자동차보험 = insurance/auto + domains [vehicle], 장기렌트 = rental/vehicle, 자동차 매매 = sale/vehicle).`,
    '   secondary_elements: 혼합 계약(휴대전화 서비스 + 단말 할부, SaaS + 초기 구축 용역, 제품 매매 + 유지보수)이면 주 종류 하나 + 함께 포함된 요소. 각 돈은 payments에 그대로 따로 넣습니다.',
    '   confidence: 본질이 분명하면 high. 가장 가능성 높은 종류가 있지만 다른 해석도 가능하면 medium + alternatives. 두 종류 사이에서 정할 수 없으면 low + alternatives(상위 후보) + reason에 왜 애매한지.',
    '   기타(other)는 상위 후보 2개를 비교한 뒤에도 맞는 종류가 없을 때만. 확신이 없다는 이유만으로 고르지 않습니다. reason과 근거 문장(evidence_quote)을 반드시 넣습니다.',
    '3·4) dates — 계약서에 나온 중요한 날짜를 모두 찾고, 각 날짜의 의미를 문맥으로 판단합니다.',
    '   같은 날짜라도 의미가 여러 개면 각각 넣습니다. 체결일(작성·서명일)이 따로 적혀 있지 않으면 contract_signed를 만들지 않습니다.',
    '   다른 날짜를 체결일로 대신 넣지 않습니다. 기간만 적혀 있으면(예: "개시일로부터 36개월") 종료일을 계산해 넣고 confidence를 medium으로.',
    '5·6) payments — 계약에서 오가는 돈을 모두 나열하고 의미(kind)·주기·방향(direction)을 정합니다. 한 계약에 여러 건일 수 있습니다.',
    `   kind: ${PAYMENT_KIND_DEFS.map((k) => `${k.code}(${k.label})`).join(', ')}`,
    '   이 앱 사용자가 어느 쪽인지는 판단하지 않습니다. 대신 계약서 문장이 "누가 누구에게" 지급하는지 밝히면 payer_role·payee_role에 그 역할 코드를 넣습니다',
    '   (계약상 역할과 실제로 돈을 내는 사람이 다르면 문장대로 — 예: "보증금은 연대보증인이 지급" → payer_role=guarantor). 문장에 없으면 unknown. direction은 참고값입니다.',
    '   보증금·전세금·매매대금 총액을 계약금·중도금·잔금으로 나눠 내면, 총액은 role=total(fields의 depositAmount·totalAmount)이고 실제로 오가는 계약금·중도금·잔금만 결제로 넣습니다 (같은 돈을 두 번 넣지 않음).',
    '   임대차 보증금·전세금(돌려받을/돌려줄 돈)과 그 계약금·잔금은 kind=deposit. 매매대금·용역대금의 계약금·잔금은 보증금이 아닙니다.',
    '   연납 보험료는 frequency=yearly, 1회 납입액 그대로. 일회성 계약의 계약금/중도금/잔금은 각각 따로, 날짜는 date에.',
    '   결제일이 적혀 있지 않으면 추측하지 말고 null. 다른 결제와 "함께 청구"되면 같은 day_of_month. 같은 돈을 두 번 넣지 않습니다.',
    '   결제 날짜 해석 (중요): 날짜는 그 금액의 문구만 보고 정합니다. 같은 표·같은 섹션의 다른 줄에 날짜가 있다는 이유로 그 날짜를 옮겨 쓰지 않습니다.',
    '   - 그 금액의 문구에 날짜가 직접 적혀 있으면 date=그 날짜, date_source=explicit.',
    '   - "계약 당일·계약 시·계약 체결 시 지급" → date_source=contract_date, date=계약 체결일(dates의 contract_signed, 없으면 null). 예) 계약금 "계약 당일 지급" 바로 아래 줄에 잔금 "2026년 10월 20일 지급"이 있어도 계약금 날짜는 계약 체결일.',
    '   - "잔금일에 지급" → balance_date, "입주일에·입주 시" → move_in_date, "계약 시작일·개시일에" → start_date, "종료일·만기에" → end_date (date=그 기준 날짜, 없으면 null).',
    '   - "계약일로부터 7일 이내"처럼 기준 날짜에서 계산하면 calculated, 문맥으로 추정하면 inferred (confidence medium 이하).',
    '   - "매월 20일"은 정기 결제의 day_of_month=20 (date_source=explicit, date는 첫 결제일이 적혀 있을 때만).',
    '   - 급여·용역 대금 같은 정기 수입의 지급일은 "매월 25일 지급"처럼 적혀 있을 때만 day_of_month. 근로 시작일·계약 시작일의 날짜를 지급일로 쓰지 않습니다(없으면 null). day_of_month를 넣으면 evidence_quote에 지급일 문장을 포함합니다.',
    '   금액마다 payment_obligation을 판단합니다 (아래 원칙).',
    '   할인 (중요): "할인전·할인 전·정상가·프로모션 적용 전"이 붙은 금액은 실제 결제액이 아닙니다 → price_basis=before_discount (실제 결제액을 계산해 넣지 않음).',
    '   그 외에는 price_basis=actual. 할인액 자체(예: "전체회차 14,000원 할인")는 결제로 넣지 않고 checks(topic=discount_terms)에 원문 그대로 넣습니다.',
    '   특정 회차 면제·무료(예: "1, 13, 25회차 면제")도 결제를 나누지 말고 checks(topic=discount_terms)에 넣습니다.',
    '   면제된 비용(예: "등록비 100,000원 면제", "설치비 무료", "0원")은 role=waived로 넣습니다 (결제 일정 아님).',
    '   조건부 비용(위약금·연체료·지연배상금·파손/분실 배상금·초과 사용료·양도 수수료·중도상환수수료)은 payments에 넣지 않고 checks에 넣습니다:',
    '   금액이 적혀 있으면 checks.amount, 계산식이면 checks.amount_basis (예: 잔여 렌탈료의 10%). behavior=conditional_rule, condition=언제 내는지.',
    '   같은 문장에 실제 납입금과 조건부 비용이 함께 있어도(예: "월 렌탈료 31,900원, 연체 시 연체료 부과") 월 렌탈료는 confirmed 결제입니다.',
    '7) details — 해당 유형의 속성 중 계약서에 실제로 있는 것만 (없는 속성은 넣지 않음):',
    detailGuide(),
    '7-1) parties — 계약 당사자: 계약서에 이름이 적힌 당사자만, 계약서가 쓴 역할로 (예: 임대인 김OO, 임차인 박OO). 계약 종류별 역할:',
    partyGuide(),
    '   공동 임대인·공동 임차인처럼 같은 역할이 여럿이면 각각 넣습니다. 한쪽만 적혀 있으면 그쪽만 넣고 다른 쪽을 짐작해 채우지 않습니다.',
    '   보증인(guarantor)·대리인(agent)이 이름과 함께 적혀 있으면 그 역할로 따로 넣습니다 (계약 당사자 역할과 섞지 않음).',
    '   역할은 계약서가 쓴 말 그대로 고릅니다 (예: 렌탈 계약서가 "임대인·임차인"이라고 쓰면 lessor·lessee). 계약 종류의 역할로 연결하는 것은 서버가 합니다.',
    '   회사(법인) 당사자에 대표자가 함께 적혀 있으면 name을 "회사명 / 대표 이름"으로 넣습니다. 대표자를 같은 역할의 당사자로 따로 넣지 않습니다 (회사와 대표자는 다른 사람).',
    '   이 앱 사용자가 어느 쪽인지는 판단하지 않습니다. 이름 칸이 비어 있거나 서명란만 있으면 넣지 않습니다. 연락처·주민등록번호·주소는 name에 넣지 않습니다.',
    '8) fields — 계약명·상대방·총액·보증금, 종료·갱신·만기 조건(자동갱신, 연장 기간, 통보기한 일수). 계약서에 있는 key만 목록으로. 중도해지·위약금 조건은 checks에만.',
    '9) checks — PACTO 계약 체크: 계약 정보는 사실, 계약 체크는 그 사실 때문에 사용자가 해야 할 일·주의할 위험입니다.',
    '   단순 사실(관리비 금액·급여일·근로시간·계약기간·보증금을 종료 시 돌려받는다는 사실)은 fields·details·payments에만 넣고 checks에 넣지 않습니다.',
    '   행동이 필요하거나(기한까지 갱신 여부 확인·해지 통보, 반납·원상복구 준비) 놓치면 불이익이 있거나(위약금·연체료·자동 연장·추가 정산) 사용자에게 불리한 조건만 넣습니다.',
    '   description은 원문을 옮기지 말고 왜 챙겨야 하는지 짧은 이유 한 문장, user_action은 해야 할 일 (원문은 evidence_quote에만). 같은 의미의 체크를 두 번 만들지 않습니다. 주제(topic):',
    topicGuide(),
    '   severity와 behavior는 아래 의미 해석 원칙을 따릅니다. 확신이 낮으면 confidence를 low로.',
    '   각 항목에는 근거가 된 원문 문장(evidence_quote), 쪽(evidence_page), 파일 번호(evidence_file)를 반드시 넣습니다. 근거가 없는 조항은 넣지 않습니다.',
    '   계약서 기준으로 날짜가 정해지는 일(fixed_event)이고 그 날짜가 명시돼 있을 때만 related_date에 넣습니다.',
    '',
    '의미 해석 원칙 (가장 중요): 숫자와 날짜를 발견했다고 곧바로 결제·일정으로 만들지 않습니다. 의미를 먼저 판단합니다.',
    '- 금액의 role: 실제로 오가는 돈만 recurring_cashflow / one_time_cashflow / deposit. 다른 금액을 이루는 하위 항목은 component(part_of에 상위 금액 이름),',
    '  예) "월 임금 3,600,000원은 기본급 3,280,000원과 고정연장근로수당 320,000원으로 구성" → 월 임금 recurring_cashflow 1건 + 기본급·고정연장근로수당 component 2건 (별도 수입 아님).',
    '  차량가·총 대출한도처럼 오가는 돈이 아닌 금액은 reference.',
    '- 금액의 의무 수준(payment_obligation): 금액이 적혀 있다는 이유만으로 결제가 아닙니다. 금액 발견 → 의미 → 실제 의무인지 → 조건이 있는지 순서로 판단합니다.',
    '  confirmed만 캘린더·지출에 들어갑니다. "월 렌탈료·월 이용료·월 납입금·월 보험료·월 통신요금·월 구독료·월세·대출 상환금·급여"처럼 정상적으로 계약을 유지하는 동안 내거나 받는 돈은 confirmed.',
    '  "…하는 경우/…시/…할 때" 내는 돈은 조건부이고 checks로 갑니다. "(선택)·신청 시·가입 시" 부가 비용은 사용자가 실제로 신청했다는 기재가 없으면 optional ("특약 포함" 보험료처럼 실제 납입액은 confirmed).',
    '  예) 회원권 양도 시 수수료 30,000원 → checks(amount=30000, condition=회원권을 양도하는 경우). 락커 이용 시 월 5,000원 → payments optional(condition=락커를 이용하는 경우).',
    '  예) 초과주행료·차량 손상 비용·반납 지연 비용·중도해지수수료·중도상환수수료·연체이자·분실/파손비·미반환 비용·원상복구비·손해배상금 → checks (조건부).',
    '  보험 특약의 선택 보험료는 가입했다는 기재가 없으면 optional.',
    '- 이용 기간과 결제 주기는 다릅니다: "1년 회원권 660,000원(일시불)"은 one_time 1건이며 월 12회로 나누지 않습니다. 매월 낸다고 적혀 있을 때만 monthly.',
    '- 계약서에 없는 값을 계산해 만들지 않습니다: 월 임금만 있으면 연봉(annual_salary)을 넣지 않고, 기간만 있으면 다른 금액을 만들지 않습니다. 숫자 속성은 계약서에 적힌 경우만 explicit로.',
    '- 문맥으로 판단한 값(예: 기간이 정해져 있어 계약직으로 판단)은 source_type=inferred. 계약서에 그 단어가 직접 있으면 explicit.',
    '- 조건부 의무는 날짜로 바꾸지 않습니다: "근로자가 퇴직하고자 하는 경우 30일 전 통보"는 계약 종료일 기준 통보기한이 아닙니다 →',
    '  checks에 behavior=conditional_rule, condition=자진 퇴직하려는 경우, action=희망 퇴직일 30일 전에 회사에 통보, offset_days=30, related_date=null.',
    '  fields.terminationNoticeDays는 "계약 만료 N일 전까지 해지(갱신 거절) 통보"처럼 종료일 기준일 때만 넣습니다.',
    '- 통보기한의 의미(fields.noticeKind)는 숫자만 보고 정하지 않고 원문 표현 그대로 고릅니다. 원문보다 강한 의미로 바꾸지 않습니다.',
    '  "갱신 여부를 협의/확인/결정" → renewal_decision (통지 의무로 바꾸지 않음). "해지 의사를 통지/통보" → termination_notice.',
    '  "갱신하지 않으려면(갱신을 원하지 않으면) 통지/통보" → 문맥에 따라 termination_notice 또는 renewal_notice. "갱신 의사를 통지" → renewal_notice.',
    '  어느 쪽인지 원문으로 판단할 수 없으면 unknown (확신이 없을 때 해지 통보기한으로 단정하지 않음). 근거 문장은 terminationNoticeDays와 같은 조항.',
    '- 기간 조건(수습기간 N개월, 수습 중 임금 N%)은 속성(probation_months, probation_pay_rate)으로 넣습니다. 시작일만 따로 일정(related_date)으로 만들지 않습니다.',
    '- 지급일이 휴일일 때 규칙("휴일이면 직전 영업일")은 business_day_rule로.',
    '- 자동갱신이 아니고 갱신을 별도 협의로 정하면 autoRenewal=false, 갱신 조건(사실)은 renewal_terms 속성(해당 유형)에. 종료 N일 전까지 협의하는 기한이면 terminationNoticeDays와 noticeKind=renewal_decision (기한 체크는 PACTO가 만듭니다).',
    '- checks의 severity: check = 확인·행동 필요(회사의 근무장소·업무 변경 가능, 수습 중 임금 감액, 월 임금에 고정수당 포함, 퇴직 사전통보, 비밀유지, 자산 반환, 추가 정산),',
    '  caution = 주의 필요(책임·비용·권리 제한이 큰 조건: 위약금·손해배상 범위·환불 제한·일방적 변경·연체이율·원상복구 등). info는 쓰지 않습니다 (사실은 계약 정보에).',
    '',
    '공통 규칙:',
    '- 첨부된 쪽에 적혀 있지 않은 값은 추측해 채우지 않습니다. 일부 쪽이 빠져 있을 수 있으니(읽지 못해 제외한 쪽 등) 앞뒤 쪽 내용으로 빠진 조항·금액·날짜·당사자를 짐작해 만들지 않습니다.',
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
