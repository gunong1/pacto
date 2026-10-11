// 계약서 분석 — 모델에 보내는 JSON Schema(Structured Outputs)와 지시문(프롬프트).
// 정리 규칙은 analysisRules/, 조립은 extraction.ts.
import {
  AMOUNT_ROLES,
  PRICE_BASES,
  BUSINESS_DAY_RULES,
  PAYMENT_OBLIGATIONS,
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
import { DOCUMENT_CHECK_INSTRUCTIONS, documentCheckJsonSchema } from './documentGate.ts';
import { BANNED_PHRASES, CONFIDENCE, DATE_MEANINGS, DATE_SOURCES, FIELDS, FREQUENCIES, MODEL_SOURCES, SEVERITY } from './analysisRules/vocabulary.ts';

/**
 * v7: document_check(문서 역할·쪽별 판정·계약 신호) + 모든 추출값에 근거 파일·쪽
 * v8: 결제 날짜의 출처(date_source) — "계약 당일 지급"처럼 다른 날짜를 기준으로 하는 금액은 그 기준 날짜를 쓰고, 옆 줄 날짜를 옮기지 않는다
 */
export const PROMPT_VERSION = 'extract-v10';

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
const classification = (codes: readonly string[], desc: string) =>
  strictObject({
    value: { type: 'string', enum: [...codes], description: desc },
    confidence,
    alternatives: { type: 'array', items: { type: 'string', enum: [...codes] }, description: '가능성이 있는 다른 값 (최대 3개, 없으면 빈 배열)' },
    reason: { type: 'string', description: '이렇게 본 이유 (한 문장, 계약서 내용 기준)' },
  });

/** Structured Outputs(strict)용 JSON Schema: 모든 속성 required, additionalProperties false */
// 스키마 크기 한도(객체 속성 100개·중첩 5단계) 안에서 근거 파일·쪽을 모든 값에 넣기 위해, v7부터 공통 필드도 "키 목록" 방식
const FIELD_GUIDE = Object.entries(FIELDS)
  .map(([k, d]) => `${k}(${d.type === 'integer' ? 'number_value' : d.type === 'boolean' ? 'boolean_value' : 'text_value'}): ${d.desc}`)
  .join(' / ');

export function extractionJsonSchema() {
  return strictObject({
    document_check: documentCheckJsonSchema(),
    category: classification(CATEGORY_CODES, '무슨 계약인가 (분야)'),
    contract_type: classification(CONTRACT_TYPE_CODES, '돈·날짜·의무가 움직이는 구조 (관리 방식)'),
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
          description: '실제로 오가는 돈(recurring_cashflow·one_time_cashflow·deposit)인지, 다른 금액의 구성 항목(component)·합계(total)·참고 금액(reference)인지',
        },
        part_of: { type: ['string', 'null'], description: 'component일 때 이 금액이 속한 금액의 label (예: 월 임금)' },
        kind: { type: 'string', enum: [...PAYMENT_KIND_CODES] },
        direction: { type: 'string', enum: [...DIRECTIONS], description: '사용자 기준: 내는 돈 expense / 받는 돈 income / 돌려받는 보증금 등 neutral' },
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
          enum: [...PAYMENT_OBLIGATIONS],
          description:
            'confirmed: 지금 계약으로 지급 의무와 시점이 확정 / optional: 사용자가 선택(신청·이용)했을 때만 / conditional: 특정 상황(양도·해지·연체·파손·분실 등)이 생겼을 때만 / potential: 생길 수 있으나 미확정 / informational: 금액 정보일 뿐 현금흐름 아님',
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
        ...evidence,
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
    '계약서가 좋은지 나쁜지 판정하지 않습니다. 첨부된 파일(PDF 또는 사진)을 다음 순서로 분석합니다.',
    '',
    DOCUMENT_CHECK_INSTRUCTIONS,
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
    '   보증금·전세금·매매대금 총액을 계약금·중도금·잔금으로 나눠 내면, 총액은 role=total(fields의 depositAmount·totalAmount)이고 실제로 오가는 계약금·중도금·잔금만 결제로 넣습니다 (같은 돈을 두 번 넣지 않음).',
    '   임대차 보증금·전세금과 그 계약금·잔금은 kind=deposit, direction=neutral. 매매·용역은 사용자가 어느 쪽인지 보고 정하고, 알 수 없으면 confidence를 low로.',
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
    '   면제된 비용(예: "등록비 100,000원 면제", "설치비 무료")은 role=reference로 넣습니다 (결제 일정 아님).',
    '7) details — 해당 유형의 속성 중 계약서에 실제로 있는 것만 (없는 속성은 넣지 않음):',
    detailGuide(),
    '8) fields — 계약명·상대방·총액·보증금, 종료·갱신·해지·만기 조건(자동갱신, 연장 기간, 통보기한 일수, 중도해지·위약금). 계약서에 있는 key만 목록으로.',
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
    '- 금액의 의무 수준(payment_obligation): 금액이 적혀 있다는 이유만으로 결제가 아닙니다. 금액 발견 → 의미 → 실제 의무인지 → 조건이 있는지 순서로 판단합니다.',
    '  confirmed만 캘린더·지출에 들어갑니다. "…하는 경우/…시/…할 때" 내는 돈은 조건부(conditional)이고, "(선택)·신청 시·이용 시" 비용은 사용자가 실제로 신청했다는 기재가 없으면 optional.',
    '  예) 회원권 양도 시 수수료 30,000원 → conditional(condition=회원권을 양도하는 경우). 락커 이용 시 월 5,000원 → optional(condition=락커를 이용하는 경우).',
    '  예) 초과주행료·차량 손상 비용·반납 지연 비용·중도해지수수료·중도상환수수료·연체이자·분실/파손비·미반환 비용·원상복구비·손해배상금·조건부 수당 → conditional.',
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
