// 분석 어휘 — 모델 스키마·프롬프트·정리 규칙이 함께 쓰는 코드 목록 (한 곳에서 관리).

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
export type DateMeaning = (typeof DATE_MEANINGS)[number];

/**
 * 결제 날짜의 출처: explicit 계약서에 날짜가 직접 적힘 / contract_date·balance_date·move_in_date·start_date·end_date 그 날짜를 기준으로 함
 * ("계약 당일 지급" → contract_date) / calculated 문구로 계산(예: 계약일로부터 7일 이내) / inferred 문맥으로 추정
 */
export const DATE_SOURCES = ['explicit', 'contract_date', 'balance_date', 'move_in_date', 'start_date', 'end_date', 'calculated', 'inferred'] as const;
export type DateSource = (typeof DATE_SOURCES)[number];

export const CONFIDENCE = ['high', 'medium', 'low'] as const;
/** 모델이 줄 수 있는 출처 (계산·사용자 확인은 앱이 붙인다) */
export const MODEL_SOURCES = ['explicit', 'inferred'] as const;
export const SEVERITY = ['info', 'check', 'caution'] as const;

/** 법적 판단·단정 표현 금지 목록 (앱 src/domain/aiCopy.ts와 동일) */
export const BANNED_PHRASES = [
  '불법', '위법', '무효', '독소조항', '독소 조항', '불공정', '불리합니다', '불리한', '유리합니다', '유리한',
  '손해를 봅니다', '반드시 손해', '위험합니다', '위험한 계약',
];

/** 통보기한의 의미 (앱 src/domain/noticeKind.ts와 동일) */
export const NOTICE_KIND_CODES = ['termination_notice', 'renewal_notice', 'renewal_decision', 'unknown'] as const;

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
  noticeKind: {
    type: 'string',
    desc: 'terminationNoticeDays의 의미 (일수와 같은 조항). termination_notice: 해지·종료 의사를 통지해야 하는 기한 / renewal_notice: 갱신 또는 갱신 거절 의사를 통지해야 하는 기한 / renewal_decision: 갱신 여부를 확인·협의·결정하는 시점 / unknown: 의미가 불확실. 일수가 없으면 null',
  },
};
// 중도해지·위약금 조건은 공통 필드(글)로 받지 않는다 — 계약 체크(금액·조건·근거)에만 담는다 (같은 조항을 두 곳에 저장하지 않음)
