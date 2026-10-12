// PACTO 계약 레지스트리 — 앱과 서버(Edge Function)가 함께 쓰는 단일 정의. 순수 TypeScript, import 없음.
//
// 새 계약 분야·유형·속성·결제 의미·날짜 의미·계약 체크 주제를 추가하는 곳은 여기 한 곳이다.
//   1) 이 파일에 항목 추가
//   2) supabase/migrations 에 같은 행을 룩업 테이블에 넣는 마이그레이션 추가 (통합 테스트가 일치 여부를 검사)
//   3) (선택) 앱 src/domain/contractTypes.ts 의 유형 프로필에 일정 이름·문구 추가 — 없으면 '기타' 프로필로 동작
// DB는 enum이 아니라 text + 룩업 테이블(FK)이라 컬럼 변경 없이 행 추가만으로 확장된다.

/** 분야 — 무슨 계약인가 (사용자가 이해하는 분류, 아이콘·필터) */
export const CATEGORY_DEFS = [
  { code: 'employment', label: '근로' },
  { code: 'real_estate', label: '부동산' },
  { code: 'insurance', label: '보험' },
  { code: 'vehicle', label: '자동차' },
  { code: 'finance', label: '금융' },
  { code: 'rental', label: '렌탈' },
  { code: 'telecom', label: '통신' },
  { code: 'membership', label: '회원권' },
  { code: 'subscription', label: '구독' },
  { code: 'education', label: '교육' },
  { code: 'service', label: '용역·프리랜서' },
  { code: 'business', label: '사업·거래' },
  { code: 'sale', label: '매매' },
  { code: 'other', label: '기타' },
] as const;

/** 유형 — 돈·날짜·의무가 움직이는 구조 (이 계약을 어떤 방식으로 관리할지) */
export const CONTRACT_TYPE_DEFS = [
  { code: 'recurring', label: '월 납입형', examples: '렌탈 · 통신 · 헬스장 · 구독 · 자동차 리스 · 장기렌트', guide: '매달·매년 이용료를 내는 계약' },
  { code: 'lease', label: '임대차', examples: '전세 · 월세 · 반전세 · 상가 임대차', guide: '부동산을 빌리는 계약 (보증금·월세)' },
  { code: 'installment', label: '할부', examples: '자동차 할부 · 물품 할부 구매', guide: '물건(주로 자동차)을 할부로 사는 계약 (할부원금·월 할부금·회차)' },
  { code: 'loan', label: '대출', examples: '신용 · 담보 · 전세자금 대출', guide: '돈을 빌리는 계약 (원금·금리·상환)' },
  { code: 'insurance', label: '보험', examples: '자동차 · 실손 · 종신 · 화재 보험', guide: '보험 (보험료·보험기간·납입기간·갱신)' },
  { code: 'employment', label: '근로', examples: '정규직 · 계약직 · 아르바이트', guide: '근로계약 (급여·근로기간·근무조건)' },
  { code: 'service', label: '용역·프리랜서', examples: '외주 · 프리랜서 · 위탁 업무 · 유지보수', guide: '일을 해주고 대금을 받거나 맡기는 계약 (업무·납기·검수·대금)' },
  { code: 'sale', label: '매매', examples: '부동산 · 자동차 · 사업 양수도 · 자산 매매', guide: '물건·자산을 사고파는 계약 (계약금·중도금·잔금·인도)' },
  { code: 'one_time', label: '일회성 계약', examples: '공사 · 행사 · 일회성 구매', guide: '정해진 날에 나눠 내고 끝나는 계약 (계약금·중도금·잔금)' },
  { code: 'other', label: '기타', examples: '위에 해당하지 않는 계약', guide: '위에 해당하지 않음' },
] as const;

export type DetailInput = 'amount' | 'integer' | 'percent' | 'text' | 'enum' | 'boolean';

/**
 * 유형별 상세 속성 (contracts.contract_details JSONB). key = 앱(camelCase), db = 저장 키(snake_case, 정식 컬럼 승격 시 이름)
 * role — 계약 정보에서의 역할 (계약 정보 = 사실, 계약 체크 = 행동·기한·주의·위험):
 *   fact(기본): 기본 정보로 보여주는 객관적 사실 (임대인·근무시간·금리 …)
 *   condition: 중요한 계약 조건 문장 — 보존하되 기본 화면이 아니라 "상세 조건"(접힘)에서. 행동·기한·위험은 계약 체크가 맡는다
 * semanticKey — 같은 의미의 계약 체크(SEMANTIC_KEY_DEFS)와 연결. 같은 문장을 두 곳에 반복하지 않도록 체크는 할 일·이유로 쓴다 (checkScope S5)
 */
export type DetailRole = 'fact' | 'condition';
export const DETAIL_FIELD_DEFS: readonly {
  type: string;
  key: string;
  db: string;
  label: string;
  input: DetailInput;
  suffix?: string;
  options?: readonly { value: string; label: string }[];
  role?: DetailRole;
  semanticKey?: string;
}[] = [
  // 월 납입형
  { type: 'recurring', key: 'commitmentMonths', db: 'commitment_months', label: '최소 이용기간', input: 'integer', suffix: '개월' },
  { type: 'recurring', key: 'equipmentReturnTerms', db: 'equipment_return_terms', label: '장비 반환 조건', input: 'text', role: 'condition', semanticKey: 'equipment_return' },
  { type: 'recurring', key: 'ownershipTransferTerms', db: 'ownership_transfer_terms', label: '소유권 이전 조건', input: 'text', role: 'condition', semanticKey: 'ownership' },
  // 임대차
  {
    type: 'lease', key: 'leaseKind', db: 'lease_kind', label: '임대 형태', input: 'enum',
    options: [{ value: 'jeonse', label: '전세' }, { value: 'monthly', label: '월세' }, { value: 'semi_jeonse', label: '반전세' }, { value: 'commercial', label: '상가' }, { value: 'other', label: '기타' }],
  },
  { type: 'lease', key: 'landlord', db: 'landlord', label: '임대인', input: 'text' },
  { type: 'lease', key: 'tenant', db: 'tenant', label: '임차인', input: 'text' },
  { type: 'lease', key: 'renewalTerms', db: 'renewal_terms', label: '갱신 관련 조건', input: 'text', role: 'condition', semanticKey: 'renewal_decision' },
  { type: 'lease', key: 'depositReturnTerms', db: 'deposit_return_terms', label: '보증금 반환 조건', input: 'text', role: 'condition', semanticKey: 'deposit_return' },
  // 할부
  { type: 'installment', key: 'vehicleName', db: 'vehicle_name', label: '차량·물품명', input: 'text' },
  { type: 'installment', key: 'vehiclePrice', db: 'vehicle_price', label: '차량·물품 가격', input: 'amount', suffix: '원' },
  { type: 'installment', key: 'advancePayment', db: 'advance_payment', label: '선수금', input: 'amount', suffix: '원' },
  { type: 'installment', key: 'principal', db: 'principal', label: '할부원금', input: 'amount', suffix: '원' },
  { type: 'installment', key: 'interestRate', db: 'interest_rate', label: '금리', input: 'percent', suffix: '%' },
  { type: 'installment', key: 'totalInstallments', db: 'total_installments', label: '총 할부기간', input: 'integer', suffix: '개월' },
  { type: 'installment', key: 'prepaymentTerms', db: 'prepayment_terms', label: '중도상환 조건', input: 'text', role: 'condition', semanticKey: 'prepayment' },
  // 대출
  { type: 'loan', key: 'principal', db: 'principal', label: '대출원금', input: 'amount', suffix: '원' },
  { type: 'loan', key: 'interestRate', db: 'interest_rate', label: '금리', input: 'percent', suffix: '%' },
  {
    type: 'loan', key: 'rateType', db: 'rate_type', label: '금리 방식', input: 'enum',
    options: [{ value: 'fixed', label: '고정금리' }, { value: 'variable', label: '변동금리' }, { value: 'mixed', label: '혼합' }],
  },
  {
    type: 'loan', key: 'repaymentMethod', db: 'repayment_method', label: '상환방식', input: 'enum',
    options: [{ value: 'equal_payment', label: '원리금균등' }, { value: 'equal_principal', label: '원금균등' }, { value: 'bullet', label: '만기일시' }, { value: 'other', label: '기타' }],
  },
  { type: 'loan', key: 'prepaymentFeeTerms', db: 'prepayment_fee_terms', label: '중도상환수수료', input: 'text', role: 'condition', semanticKey: 'prepayment' },
  { type: 'loan', key: 'overdueTerms', db: 'overdue_terms', label: '연체 관련 조건', input: 'text', role: 'condition', semanticKey: 'overdue' },
  // 보험
  { type: 'insurance', key: 'productName', db: 'product_name', label: '보험 상품명', input: 'text' },
  { type: 'insurance', key: 'paymentPeriod', db: 'payment_period', label: '납입기간', input: 'text' },
  { type: 'insurance', key: 'coveragePeriod', db: 'coverage_period', label: '보장기간', input: 'text' },
  { type: 'insurance', key: 'renewable', db: 'renewable', label: '갱신형', input: 'boolean' },
  { type: 'insurance', key: 'renewalCycleYears', db: 'renewal_cycle_years', label: '갱신 주기', input: 'integer', suffix: '년' },
  { type: 'insurance', key: 'coverageSummary', db: 'coverage_summary', label: '주요 보장', input: 'text' },
  { type: 'insurance', key: 'surrenderTerms', db: 'surrender_terms', label: '해지환급 조건', input: 'text', role: 'condition', semanticKey: 'surrender' },
  { type: 'insurance', key: 'exclusions', db: 'exclusions', label: '면책·보장 제외', input: 'text', role: 'condition', semanticKey: 'exclusion' },
  // 근로
  { type: 'employment', key: 'employeeName', db: 'employee_name', label: '근로자', input: 'text' },
  {
    type: 'employment', key: 'employmentKind', db: 'employment_kind', label: '고용 형태', input: 'enum',
    options: [{ value: 'permanent', label: '정규직' }, { value: 'fixed_term', label: '계약직' }, { value: 'part_time', label: '단시간·아르바이트' }, { value: 'other', label: '기타' }],
  },
  { type: 'employment', key: 'jobTitle', db: 'job_title', label: '직무', input: 'text' },
  { type: 'employment', key: 'annualSalary', db: 'annual_salary', label: '연봉', input: 'amount', suffix: '원' },
  { type: 'employment', key: 'probationMonths', db: 'probation_months', label: '수습기간', input: 'integer', suffix: '개월' },
  { type: 'employment', key: 'probationPayRate', db: 'probation_pay_rate', label: '수습기간 임금 비율', input: 'percent', suffix: '%' },
  { type: 'employment', key: 'workHours', db: 'work_hours', label: '근무시간', input: 'text' },
  { type: 'employment', key: 'workDays', db: 'work_days', label: '근무일', input: 'text' },
  { type: 'employment', key: 'holidays', db: 'holidays', label: '휴일', input: 'text' },
  { type: 'employment', key: 'leaveTerms', db: 'leave_terms', label: '휴가 관련 조건', input: 'text', role: 'condition' },
  { type: 'employment', key: 'severanceTerms', db: 'severance_terms', label: '퇴직 관련 조건', input: 'text', role: 'condition' },
  { type: 'employment', key: 'renewalTerms', db: 'renewal_terms', label: '갱신 관련 조건', input: 'text', role: 'condition', semanticKey: 'renewal_decision' },
  // 용역·프리랜서
  {
    type: 'service', key: 'userRole', db: 'user_role', label: '나의 역할', input: 'enum',
    options: [{ value: 'provider', label: '수행자 (대금을 받음)' }, { value: 'client', label: '발주자 (대금을 냄)' }],
  },
  { type: 'service', key: 'workScope', db: 'work_scope', label: '업무 내용', input: 'text' },
  { type: 'service', key: 'acceptanceTerms', db: 'acceptance_terms', label: '검수 조건', input: 'text', role: 'condition' },
  { type: 'service', key: 'deliverableOwnership', db: 'deliverable_ownership', label: '결과물 소유권·저작권', input: 'text', role: 'condition' },
  { type: 'service', key: 'revisionTerms', db: 'revision_terms', label: '수정 요청 조건', input: 'text', role: 'condition' },
  // 매매
  {
    type: 'sale', key: 'userRole', db: 'user_role', label: '나의 역할', input: 'enum',
    options: [{ value: 'buyer', label: '매수인 (사는 쪽)' }, { value: 'seller', label: '매도인 (파는 쪽)' }],
  },
  { type: 'sale', key: 'subject', db: 'subject', label: '매매 대상', input: 'text' },
  // 일회성
  { type: 'one_time', key: 'subject', db: 'subject', label: '계약 대상', input: 'text' },
];

/**
 * 값의 출처 — 계약서에 직접 적힌 값인지, AI가 문맥으로 추론했는지, PACTO가 계산했는지, 사용자가 확인했는지.
 * 추정·계산 값은 명시값처럼 보이지 않게 화면에서 구분한다.
 */
export const SOURCE_TYPES = ['explicit', 'inferred', 'calculated', 'user_confirmed'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * 계약서 금액의 역할 — 실제 현금 흐름(결제)이 되는 것은 recurring·one_time·deposit 뿐
 * waived: 면제·무료·0원 (등록비 면제 등) — 결제가 아니라 참고 금액(면제)
 */
export const AMOUNT_ROLES = ['recurring_cashflow', 'one_time_cashflow', 'deposit', 'component', 'total', 'reference', 'waived'] as const;

/**
 * 금액의 의무 수준 — 계약서에 금액이 있다고 모두 결제가 되지 않는다. 캘린더·지출·알림에는 confirmed만.
 * confirmed: 지급 의무·시점 확정 / optional: 사용자가 선택했을 때만 (락커 이용 시) /
 * conditional: 특정 상황이 생겼을 때만 (양도 수수료·위약금·연체이자·파손비) / potential: 생길 수 있으나 미확정 /
 * informational: 금액 정보일 뿐 현금흐름이 아님
 */
export const PAYMENT_OBLIGATIONS = ['confirmed', 'optional', 'conditional', 'potential', 'informational'] as const;
export type PaymentObligation = (typeof PAYMENT_OBLIGATIONS)[number];

/** 지급일이 휴일일 때 실제 지급일 규칙 */
export const BUSINESS_DAY_RULES = ['none', 'previous', 'next'] as const;
/** 금액의 기준: 실제 결제액 / 할인 전(정상가) 금액 */
export const PRICE_BASES = ['actual', 'before_discount'] as const;
export type BusinessDayRule = (typeof BUSINESS_DAY_RULES)[number];

/**
 * 계약 체크의 성격 — 일정으로 바꿀 수 있는지.
 * info: 알아둘 정보 / fixed_event: 계약서 기준으로 날짜가 정해지는 일 (계약 종료 기준 통보기한, 명시된 지급일 등)
 * conditional_rule: 어떤 상황이 생겼을 때만 생기는 의무 (자진 퇴직 시 30일 전 통보 등) — 사용자가 기준 날짜를 정하기 전까지 일정·다음 행동으로 만들지 않는다
 */
export const CHECK_BEHAVIORS = ['info', 'fixed_event', 'conditional_rule'] as const;
export type CheckBehavior = (typeof CHECK_BEHAVIORS)[number];

/** 결제 방향 — 사용자 기준 */
export const DIRECTIONS = ['expense', 'income', 'neutral'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** 결제 의미 + 기본 방향 (보증금 = neutral: 돌려받는 돈이라 지출·수입 합계에 넣지 않음) */
export const PAYMENT_KIND_DEFS = [
  { code: 'recurring_fee', label: '정기 이용료', direction: 'expense' },
  { code: 'setup_fee', label: '설치비·가입비', direction: 'expense' },
  { code: 'rent', label: '월세', direction: 'expense' },
  { code: 'maintenance_fee', label: '관리비', direction: 'expense' },
  { code: 'deposit', label: '보증금', direction: 'neutral' },
  { code: 'installment', label: '할부금', direction: 'expense' },
  { code: 'advance_payment', label: '선수금', direction: 'expense' },
  { code: 'loan_repayment', label: '원리금 상환', direction: 'expense' },
  { code: 'interest', label: '이자', direction: 'expense' },
  { code: 'premium', label: '보험료', direction: 'expense' },
  { code: 'salary', label: '급여', direction: 'income' },
  { code: 'bonus', label: '상여·수당', direction: 'income' },
  { code: 'service_fee', label: '용역 대금', direction: 'income' },
  { code: 'down_payment', label: '계약금', direction: 'expense' },
  { code: 'interim_payment', label: '중도금', direction: 'expense' },
  { code: 'balance_payment', label: '잔금', direction: 'expense' },
  { code: 'other', label: '기타 결제', direction: 'expense' },
] as const;

/** 주요 날짜 의미 (시작일·종료일·체결일은 계약 공통 필드) */
export const DATE_KIND_DEFS = [
  { code: 'installation', label: '설치일' },
  { code: 'activation', label: '개통일' },
  { code: 'move_in', label: '입주일' },
  { code: 'balance_due', label: '잔금일' },
  { code: 'renewal', label: '갱신일' },
  { code: 'hire', label: '입사일' },
  { code: 'delivery', label: '납기일' },
  { code: 'inspection', label: '검수일' },
  { code: 'handover', label: '인도일' },
  { code: 'ownership_transfer', label: '소유권 이전일' },
  { code: 'other', label: '기타 날짜' },
] as const;

/**
 * PACTO 계약 체크 주제 (주의할 조항 · 확인이 필요한 조건).
 * types: 이 주제를 특히 살펴볼 유형 (비어 있으면 모든 유형 공통). 법적 판단이 아니라 확인을 돕는 분류다.
 */
/**
 * 계약 체크 주제. conditional: 어떤 상황이 생길 때만 생기는 의무(퇴직 사전통보·중도해지 위약금·연체·중도상환 …) —
 * 모델이 날짜로 바꿔 오더라도 서버가 조건부 규칙으로 되돌린다 (계약서 기준 날짜를 만들지 않음).
 */
export const CHECK_TOPIC_DEFS: readonly { code: string; label: string; types: readonly string[]; conditional?: boolean }[] = [
  { code: 'auto_renewal', label: '자동갱신', types: [] },
  { code: 'early_termination', label: '중도해지·위약금', types: [], conditional: true },
  { code: 'refund_limit', label: '환불 제한', types: [] },
  { code: 'unilateral_change', label: '일방적 변경', types: [] },
  { code: 'damages', label: '손해배상', types: [] },
  { code: 'termination_right', label: '계약해지 권한', types: [] },
  { code: 'deposit_return', label: '보증금·금액 반환', types: [] },
  { code: 'overdue', label: '연체', types: [], conditional: true },
  { code: 'dispute', label: '관할·분쟁', types: [] },
  { code: 'notice_deadline', label: '통보기한', types: [] },
  { code: 'renewal_terms', label: '갱신 조건', types: [] },
  { code: 'wage', label: '급여·지급일', types: ['employment'] },
  { code: 'working_hours', label: '근로시간·휴일', types: ['employment'] },
  { code: 'probation', label: '수습기간', types: ['employment'] },
  { code: 'confidentiality', label: '비밀유지', types: ['employment', 'service'] },
  { code: 'non_compete', label: '경업금지', types: ['employment'] },
  { code: 'work_change', label: '근무장소·업무 변경', types: ['employment'] },
  { code: 'fixed_overtime', label: '고정연장근로수당', types: ['employment'] },
  { code: 'resignation_notice', label: '퇴직 사전통보', types: ['employment'], conditional: true },
  { code: 'asset_return', label: '자산·자료 반환', types: ['employment', 'recurring', 'service'] },
  { code: 'restoration', label: '원상복구', types: ['lease'] },
  { code: 'repair', label: '수선 책임', types: ['lease'] },
  { code: 'maintenance_fee', label: '관리비', types: ['lease'] },
  { code: 'variable_rate', label: '변동금리', types: ['loan'] },
  { code: 'acceleration', label: '기한이익 상실', types: ['loan', 'installment'], conditional: true },
  { code: 'maturity_extension', label: '만기연장', types: ['loan'] },
  { code: 'prepayment', label: '중도상환', types: ['loan', 'installment'], conditional: true },
  { code: 'collateral', label: '담보', types: ['installment', 'loan'] },
  { code: 'ownership', label: '소유권', types: ['installment', 'recurring', 'sale'] },
  { code: 'premium_change', label: '보험료 변경', types: ['insurance'] },
  { code: 'exclusion', label: '면책·보장 제외', types: ['insurance'] },
  { code: 'waiting_period', label: '대기기간', types: ['insurance'] },
  { code: 'surrender', label: '해지환급', types: ['insurance'] },
  { code: 'minimum_term', label: '최소 이용기간', types: ['recurring'] },
  { code: 'equipment_return', label: '장비 반환', types: ['recurring'] },
  { code: 'fee_change', label: '요금 변경', types: ['recurring'] },
  { code: 'payment_terms', label: '대금 지급', types: ['service', 'sale', 'one_time'] },
  { code: 'acceptance', label: '검수', types: ['service'] },
  { code: 'revision', label: '수정 요구', types: ['service'] },
  { code: 'copyright', label: '저작권·결과물', types: ['service'] },
  { code: 'handover', label: '인도·이전', types: ['sale'] },
  { code: 'discount_terms', label: '할인·면제 조건', types: [] },
  { code: 'other', label: '기타', types: [] },
];

export const CATEGORY_CODES = CATEGORY_DEFS.map((d) => d.code);
export const CONTRACT_TYPE_CODES = CONTRACT_TYPE_DEFS.map((d) => d.code);
export const PAYMENT_KIND_CODES = PAYMENT_KIND_DEFS.map((d) => d.code);
export const DATE_KIND_CODES = DATE_KIND_DEFS.map((d) => d.code);
export const CHECK_TOPIC_CODES = CHECK_TOPIC_DEFS.map((d) => d.code);
/** 상세 속성 저장 키 전체 (유형 무관, 중복 제거) */
export const DETAIL_DB_KEYS = [...new Set(DETAIL_FIELD_DEFS.map((d) => d.db))];

// ===================================================================================================
// 계약 종류 (contract_kind) — 사용자에게 보여주는 단일 기준값 (2026-10 분류 개편)
//
// 계약 종류 = 계약의 본질 (무엇을 제공·사용·보장·대여·이전하는 관계인가). 결제 방식(월납·연납·일시불·분납)과 무관하다.
// 자동 분석(AI)·직접 입력 추천·수정 화면이 모두 이 정의 하나를 쓴다.
// - subtypes: 상세 분류 (AI 내부·"+ 상세 분류"에서만 보여줌)
// - profile: 화면 이름·유형별 속성·날짜 우선순위 묶음 (contractTypes.ts PROFILES 키). 결제 방식을 뜻하지 않는다
// - legacy: 하위 호환값 (contracts.contract_type·category). 예전 앱·예전 데이터용 — 새 코드는 계약 종류가 있으면 읽지 않는다
// - nameHints: 직접 입력 계약명 추천 단서 (공백 없이 소문자, 추천일 뿐 확정 아님 — categorySuggestion.ts)
// "자동차"는 종류가 아니라 대상(domain)이다: 자동차보험 = 보험/auto, 장기렌트 = 렌탈/vehicle, 할부 = 할부/vehicle …
// ===================================================================================================
export interface ContractKindDef {
  code: string;
  label: string;
  /** AI 판단 기준 (지시문에 그대로 들어감) */
  guide: string;
  examples: string;
  subtypes: readonly { code: string; label: string }[];
  profile: (typeof CONTRACT_TYPE_DEFS)[number]['code'];
  legacy: { type: (typeof CONTRACT_TYPE_DEFS)[number]['code']; category: (typeof CATEGORY_DEFS)[number]['code'] };
  nameHints?: readonly string[];
}

export const CONTRACT_KIND_DEFS: readonly ContractKindDef[] = [
  {
    code: 'employment', label: '근로', examples: '정규직 · 계약직 · 아르바이트',
    guide: '사용자가 근로자로서 회사·고용주에게 노동을 제공하고 임금을 받는 고용 관계 (근로자/사용자, 임금·근무시간·근무장소·휴가·수습·퇴직·4대보험). 사람이 일을 한다는 이유만으로 용역으로 보지 않는다 — 고용 관계가 핵심이면 근로',
    subtypes: [{ code: 'full_time', label: '정규직' }, { code: 'fixed_term', label: '계약직' }, { code: 'part_time', label: '단시간·아르바이트' }],
    profile: 'employment', legacy: { type: 'employment', category: 'employment' },
  },
  {
    code: 'lease', label: '부동산·임대차', examples: '전세 · 월세 · 반전세 · 상가 임대차',
    guide: '토지·주택·상가·사무실 등 부동산의 사용·점유를 제공하는 계약 (임대인/임차인, 보증금·월세·차임·전세, 목적물·입주·임대차기간). 정수기·기계 같은 물건 대여는 렌탈',
    subtypes: [{ code: 'housing', label: '주택' }, { code: 'commercial', label: '상가' }, { code: 'office', label: '사무실' }, { code: 'land', label: '토지' }],
    profile: 'lease', legacy: { type: 'lease', category: 'real_estate' },
  },
  {
    code: 'loan', label: '대출', examples: '신용 · 담보 · 전세자금 · 자동차 대출',
    guide: '금전을 빌리고 원금(+이자)을 상환하는 계약 (대출원금·금리·원리금·상환·만기·대출 실행일). 담보가 자동차·부동산이어도 본질이 자금 대여면 대출',
    subtypes: [{ code: 'credit', label: '신용대출' }, { code: 'mortgage', label: '주택담보대출' }, { code: 'jeonse_loan', label: '전세자금대출' }, { code: 'auto_loan', label: '자동차 대출' }, { code: 'auto_lease', label: '자동차 금융리스' }],
    profile: 'loan', legacy: { type: 'loan', category: 'finance' },
  },
  {
    code: 'insurance', label: '보험', examples: '자동차 · 실손 · 종신 · 화재 보험',
    guide: '보험료를 내고 특정 위험이 생기면 보장·보험금을 받는 계약 (보험계약자·피보험자·보험료·보험기간·보장·보험금·특약). 자동차보험도 보험',
    subtypes: [{ code: 'auto', label: '자동차보험' }, { code: 'health', label: '건강·실손보험' }, { code: 'life', label: '생명보험' }, { code: 'fire', label: '화재보험' }, { code: 'liability', label: '배상책임보험' }, { code: 'travel', label: '여행자보험' }],
    profile: 'insurance', legacy: { type: 'insurance', category: 'insurance' },
    nameHints: ['보험', '실손', '실비', '삼성화재', '메리츠화재', '현대해상', 'db손해', 'kb손해', '삼성생명', '한화생명', '교보생명'],
  },
  {
    code: 'telecom', label: '통신', examples: '휴대폰 · 인터넷 · IPTV',
    guide: '통신망·통신 서비스 이용이 핵심인 계약 (휴대전화 요금제·인터넷·IPTV·유선전화·알뜰폰·회선). 단말기 할부가 함께 있어도 주된 대상이 통신 서비스면 통신 (할부는 함께 포함된 요소)',
    subtypes: [{ code: 'mobile', label: '휴대전화' }, { code: 'internet', label: '인터넷' }, { code: 'iptv', label: 'IPTV' }, { code: 'landline', label: '유선전화' }],
    profile: 'recurring', legacy: { type: 'recurring', category: 'telecom' },
    nameHints: ['skt', 'sk텔레콤', 'kt', 'lgu+', 'lg유플러스', '유플러스', '알뜰폰', '통신', '휴대폰요금', '핸드폰요금'],
  },
  {
    code: 'subscription_membership', label: '구독·회원권', examples: 'OTT · 음악 · SaaS · 헬스장 · 필라테스',
    guide: '서비스·콘텐츠·플랫폼·소프트웨어·시설을 계속 이용할 권한(사용권·접근권)을 받는 계약 (서비스 이용·계정·구독·회원권·이용권·플랫폼·SaaS). 월 결제라서가 아니라 지속적인 이용 권한을 받기 때문에 구독·회원권. 소프트웨어 사용권은 렌탈이 아님',
    subtypes: [{ code: 'software_saas', label: '소프트웨어·SaaS' }, { code: 'streaming', label: '영상·음악 스트리밍' }, { code: 'fitness_membership', label: '피트니스·운동' }, { code: 'online_platform', label: '온라인 플랫폼' }, { code: 'content_subscription', label: '콘텐츠 구독' }],
    profile: 'recurring', legacy: { type: 'recurring', category: 'subscription' },
    nameHints: ['구독', '유튜브', 'youtube', '넷플릭스', 'netflix', '티빙', 'tving', '디즈니+', '디즈니플러스', 'disney+', 'disneyplus', '왓챠', 'watcha', '웨이브', 'wavve', '쿠팡플레이', '스포티파이', 'spotify', '멜론', '지니뮤직', '애플뮤직', 'applemusic', '애플tv', 'appletv', '헬스', '피트니스', 'fitness', 'pt', '퍼스널트레이닝', '필라테스', '요가', '크로스핏', '회원권'],
  },
  {
    code: 'rental', label: '렌탈', examples: '정수기 · 비데 · 복합기 · 자동차 장기렌트',
    guide: '물리적인 물건·장비를 소유하지 않고 일정 기간 빌려 쓰는 계약 (렌탈·대여·렌탈기간·렌탈료·반납·설치·장비 회수, 만료 후 소유권 이전 조건이 있을 수 있음). 렌탈료를 36회 내도 렌탈 (할부 아님)',
    subtypes: [{ code: 'appliance', label: '가전·생활기기' }, { code: 'vehicle', label: '자동차' }, { code: 'vehicle_lease', label: '자동차 운용리스' }, { code: 'equipment', label: '장비·기계' }, { code: 'office_device', label: '사무기기' }],
    profile: 'recurring', legacy: { type: 'recurring', category: 'rental' },
    nameHints: ['렌탈', '정수기', '비데', '안마의자', '코웨이', '청호나이스', 'sk매직'],
  },
  {
    code: 'installment', label: '할부', examples: '자동차 할부 · 물품 할부 구매',
    guide: '상품·자산을 사면서(소유권 취득) 대금을 여러 회차로 나눠 내는 것이 핵심인 계약 (할부원금·할부기간·총 회차·월 할부금). 서비스 이용료를 매월 내는 것은 할부가 아님',
    subtypes: [{ code: 'vehicle', label: '자동차' }, { code: 'goods', label: '물품' }, { code: 'device', label: '휴대폰·단말' }],
    profile: 'installment', legacy: { type: 'installment', category: 'vehicle' },
  },
  {
    code: 'sale', label: '매매', examples: '부동산 · 자동차 · 물품 매매',
    guide: '상품·자산의 소유권을 대가를 받고 최종적으로 넘기는 계약 (매도인/매수인·매매대금·소유권 이전·계약금/중도금/잔금·인도). 부동산 매매도 매매',
    subtypes: [{ code: 'real_estate', label: '부동산' }, { code: 'vehicle', label: '자동차' }, { code: 'goods', label: '물품' }, { code: 'business_transfer', label: '사업 양수도' }],
    profile: 'sale', legacy: { type: 'sale', category: 'sale' },
  },
  {
    code: 'service', label: '용역·프리랜서', examples: '외주 개발 · 디자인 · 컨설팅 · 유지보수 위탁',
    guide: '사람·업체가 특정 업무·작업·프로젝트·결과물을 수행해 주고 대가를 받는 계약 (용역 수행·업무 위탁·결과물·납품·업무 범위·완료 기준·용역비). "서비스"라는 단어만으로 용역이 아님: 서비스를 이용하면 구독·회원권, 업무를 수행해 주면 용역',
    subtypes: [{ code: 'development', label: '개발' }, { code: 'design', label: '디자인' }, { code: 'consulting', label: '컨설팅' }, { code: 'maintenance', label: '유지보수' }, { code: 'content_production', label: '콘텐츠 제작' }],
    profile: 'service', legacy: { type: 'service', category: 'service' },
  },
  {
    code: 'education', label: '교육', examples: '학원 · 과외 · 온라인 강의 · 직업교육',
    guide: '교육·강의 제공 자체가 핵심인 계약 (학원·과외·수강·교육 프로그램). 강의가 아니라 콘텐츠 플랫폼 이용권이 핵심이면 구독·회원권',
    subtypes: [{ code: 'academy', label: '학원' }, { code: 'tutoring', label: '과외' }, { code: 'online_course', label: '온라인 강의' }, { code: 'vocational', label: '직업교육' }],
    profile: 'recurring', legacy: { type: 'recurring', category: 'education' },
  },
  {
    code: 'business', label: '사업·거래', examples: '공급 기본계약 · 제휴 · 유통 · 판매대행',
    guide: '기업 간 포괄적 거래 관계로 매매·용역·렌탈·구독 중 하나로 보기 어려운 경우 (공급 기본계약·장기 거래·제휴·유통·판매대행). B2B라는 이유만으로 고르지 않고, 더 구체적인 종류가 있으면 그쪽',
    subtypes: [{ code: 'supply', label: '공급' }, { code: 'partnership', label: '제휴' }, { code: 'distribution', label: '유통' }, { code: 'agency', label: '판매대행' }],
    profile: 'other', legacy: { type: 'other', category: 'business' },
  },
  {
    code: 'other', label: '기타', examples: '위에 해당하지 않는 계약',
    guide: '위 종류 어느 것으로도 본질을 표현하기 어려울 때만. 확신이 없다는 이유로 고르지 않는다 (먼저 상위 후보 2개를 비교)',
    subtypes: [],
    profile: 'other', legacy: { type: 'other', category: 'other' },
  },
];

/** 판단 우선순위 — 단어 수가 아니라 주된 법률관계·경제적 목적 (지시문에 그대로) */
export const CLASSIFICATION_PRIORITY: readonly string[] = [
  '보험 관계가 핵심 → insurance',
  '자금 대여가 핵심 → loan',
  '고용 관계가 핵심 → employment',
  '소유권 이전이 핵심 → sale',
  '부동산 사용권 → lease',
  '물리적 자산 대여 → rental',
  '상품 구매의 분할 지급 → installment',
  '통신망 이용 → telecom',
  '서비스·플랫폼·시설 이용권 → subscription_membership',
  '업무 수행·결과물 제공 → service',
  '교육 제공 → education',
  '대상(자동차·부동산·소프트웨어)보다 계약 관계(보험·대출·렌탈·매매)가 더 구체적이면 계약 관계를 주 분류로, 대상은 domains에',
];

/** 계약 대상 (domain) — 종류와 관계없이 "자동차 관련 계약 전체"처럼 찾기 위한 내부 메타데이터. 사용자가 입력하지 않는다 */
export const CONTRACT_DOMAIN_DEFS = [
  { code: 'vehicle', label: '자동차' },
  { code: 'real_estate', label: '부동산' },
  { code: 'software', label: '소프트웨어' },
  { code: 'mobile_device', label: '휴대폰·단말' },
  { code: 'appliance', label: '가전·생활기기' },
  { code: 'health', label: '건강·의료' },
] as const;

export const CONTRACT_KIND_CODES = CONTRACT_KIND_DEFS.map((d) => d.code);
export const CONTRACT_DOMAIN_CODES = CONTRACT_DOMAIN_DEFS.map((d) => d.code);
/** 상세 분류 코드 전체 (종류가 달라도 같은 코드가 있을 수 있다 — 저장·검증은 (종류, 상세 분류) 쌍으로) */
export const CONTRACT_SUBTYPE_CODES = [...new Set(CONTRACT_KIND_DEFS.flatMap((k) => k.subtypes.map((s) => s.code)))];

export const contractKindDef = (code: string | null | undefined): ContractKindDef | undefined => CONTRACT_KIND_DEFS.find((k) => k.code === code);
export const contractKindLabel = (code: string | null | undefined): string => contractKindDef(code)?.label ?? '기타';
export const contractSubtypeLabel = (kind: string | null | undefined, subtype: string | null | undefined): string | null =>
  contractKindDef(kind)?.subtypes.find((s) => s.code === subtype)?.label ?? null;
export const isSubtypeOf = (kind: string, subtype: string): boolean => !!contractKindDef(kind)?.subtypes.some((s) => s.code === subtype);

// ===================================================================================================
// 계약 정보 ↔ PACTO 계약 체크 — 의미 키(semantic key)와 체크 정책
//
// 계약 정보 = 사실 / 계약 체크 = 그 사실 때문에 사용자가 해야 할 일·주의할 위험.
// 체크는 의미 키 하나로 묶인다 (문장이 달라도 같은 의미면 하나). 정책:
//   none: 사실 — 같은 의미의 계약 정보(facts)가 있고 행동·금액·위험·날짜가 없으면 체크를 만들지 않는다
//   deadline: 날짜까지 해야 할 일 — 구조화 값(통보기한 일수 + 종료일)이 있으면 체크가 없어도 서버가 하나 파생 (derivedFrom 기록)
//   caution: 주의할 위험 (원상복구·손해배상 …) / conditional: 상황이 생길 때만 (중도해지·연체 …) / actionable: 해야 할 일
// topics: 이 의미에 해당하는 체크 주제. facts: 같은 사실을 담는 계약 정보 (details.<db키> · payments.<kind>)
// ===================================================================================================
export const CHECK_POLICIES = ['none', 'actionable', 'caution', 'deadline', 'conditional'] as const;
export type CheckPolicy = (typeof CHECK_POLICIES)[number];

/**
 * reason — 체크 카드의 짧은 이유 (계약 정보의 조건 문장을 그대로 반복하지 않을 때 쓴다, checkScope S5·S6)
 */
export const SEMANTIC_KEY_DEFS: readonly { key: string; label: string; policy: CheckPolicy; topics: readonly string[]; facts?: readonly string[]; action?: string; reason?: string }[] = [
  { key: 'renewal_decision', label: '갱신 여부 확인', policy: 'deadline', topics: ['renewal_terms'], action: '갱신 여부 확인', reason: '계약을 이어갈지 정해진 기한까지 확인·협의해야 해요.' },
  { key: 'termination_notice', label: '해지·갱신 통보', policy: 'deadline', topics: [], action: '해지 여부 결정·통보' },
  { key: 'auto_renewal', label: '자동갱신', policy: 'caution', topics: ['auto_renewal'] },
  { key: 'deposit_return', label: '보증금 반환', policy: 'none', topics: ['deposit_return'], facts: ['details.deposit_return_terms'] },
  { key: 'prepayment', label: '중도상환', policy: 'conditional', topics: ['prepayment'], action: '조기 상환 전 수수료 발생 조건 확인', reason: '미리 갚으면 수수료가 생길 수 있어요.' },
  { key: 'exclusion', label: '면책·보장 제외', policy: 'caution', topics: ['exclusion'], action: '보장되지 않는 경우 확인', reason: '보장받지 못하는 경우가 정해져 있어요.' },
  { key: 'surrender', label: '해지환급', policy: 'caution', topics: ['surrender'], action: '해지할 때 돌려받는 금액 확인', reason: '중도에 해지할 때 돌려받는 금액 조건이 있어요.' },
  { key: 'equipment_return', label: '장비 반환', policy: 'caution', topics: ['equipment_return'], action: '종료 후 반납 조건 확인', reason: '계약이 끝나면 장비를 반납해야 하는 조건이 있어요.' },
  { key: 'ownership', label: '소유권', policy: 'none', topics: ['ownership'], facts: ['details.ownership_transfer_terms'] },
  { key: 'maintenance_fee', label: '관리비', policy: 'none', topics: ['maintenance_fee'], facts: ['payments.maintenance_fee'] },
  { key: 'wage', label: '급여', policy: 'none', topics: ['wage'], facts: ['payments.salary'] },
  { key: 'working_hours', label: '근로시간', policy: 'none', topics: ['working_hours'], facts: ['details.work_hours'] },
  // 수습기간은 임금 감액 등 주의할 조건이 함께 있는 경우가 많아 사실 전용(none)으로 두지 않는다
  { key: 'probation', label: '수습기간', policy: 'caution', topics: ['probation'] },
  { key: 'early_termination', label: '중도해지', policy: 'conditional', topics: ['early_termination'] },
  { key: 'overdue', label: '연체', policy: 'conditional', topics: ['overdue'], action: '늦게 낼 때 추가 비용 확인', reason: '늦게 내면 추가 비용이 생길 수 있어요.' },
  { key: 'penalty', label: '손해배상·위약금', policy: 'caution', topics: ['damages'] },
  { key: 'restoration', label: '원상복구', policy: 'caution', topics: ['restoration'], action: '퇴거 시 원상복구 범위 확인', reason: '퇴거할 때 원래 상태로 되돌리는 부담이 생길 수 있어요.' },
];

/** 통보기한 의미(noticeKind)별 체크 의미 키 — 갱신 협의는 renewal_decision, 그 외 통보는 termination_notice */
export const NOTICE_SEMANTIC_KEY: Record<string, string> = {
  renewal_decision: 'renewal_decision',
  termination_notice: 'termination_notice',
  renewal_notice: 'termination_notice',
  unknown: 'termination_notice',
};
export const semanticKeyDef = (key: string | null | undefined) => SEMANTIC_KEY_DEFS.find((d) => d.key === key);
