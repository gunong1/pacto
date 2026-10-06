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

/** 유형별 상세 속성 (contracts.contract_details JSONB). key = 앱(camelCase), db = 저장 키(snake_case, 정식 컬럼 승격 시 이름) */
export const DETAIL_FIELD_DEFS: readonly {
  type: string;
  key: string;
  db: string;
  label: string;
  input: DetailInput;
  suffix?: string;
  options?: readonly { value: string; label: string }[];
}[] = [
  // 월 납입형
  { type: 'recurring', key: 'commitmentMonths', db: 'commitment_months', label: '최소 이용기간', input: 'integer', suffix: '개월' },
  { type: 'recurring', key: 'equipmentReturnTerms', db: 'equipment_return_terms', label: '장비 반환 조건', input: 'text' },
  { type: 'recurring', key: 'ownershipTransferTerms', db: 'ownership_transfer_terms', label: '소유권 이전 조건', input: 'text' },
  // 임대차
  {
    type: 'lease', key: 'leaseKind', db: 'lease_kind', label: '임대 형태', input: 'enum',
    options: [{ value: 'jeonse', label: '전세' }, { value: 'monthly', label: '월세' }, { value: 'semi_jeonse', label: '반전세' }, { value: 'commercial', label: '상가' }, { value: 'other', label: '기타' }],
  },
  { type: 'lease', key: 'landlord', db: 'landlord', label: '임대인', input: 'text' },
  { type: 'lease', key: 'tenant', db: 'tenant', label: '임차인', input: 'text' },
  { type: 'lease', key: 'renewalTerms', db: 'renewal_terms', label: '갱신 관련 조건', input: 'text' },
  { type: 'lease', key: 'depositReturnTerms', db: 'deposit_return_terms', label: '보증금 반환 조건', input: 'text' },
  // 할부
  { type: 'installment', key: 'vehicleName', db: 'vehicle_name', label: '차량·물품명', input: 'text' },
  { type: 'installment', key: 'vehiclePrice', db: 'vehicle_price', label: '차량·물품 가격', input: 'amount', suffix: '원' },
  { type: 'installment', key: 'advancePayment', db: 'advance_payment', label: '선수금', input: 'amount', suffix: '원' },
  { type: 'installment', key: 'principal', db: 'principal', label: '할부원금', input: 'amount', suffix: '원' },
  { type: 'installment', key: 'interestRate', db: 'interest_rate', label: '금리', input: 'percent', suffix: '%' },
  { type: 'installment', key: 'totalInstallments', db: 'total_installments', label: '총 할부기간', input: 'integer', suffix: '개월' },
  { type: 'installment', key: 'prepaymentTerms', db: 'prepayment_terms', label: '중도상환 조건', input: 'text' },
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
  { type: 'loan', key: 'prepaymentFeeTerms', db: 'prepayment_fee_terms', label: '중도상환수수료', input: 'text' },
  { type: 'loan', key: 'overdueTerms', db: 'overdue_terms', label: '연체 관련 조건', input: 'text' },
  // 보험
  { type: 'insurance', key: 'productName', db: 'product_name', label: '보험 상품명', input: 'text' },
  { type: 'insurance', key: 'paymentPeriod', db: 'payment_period', label: '납입기간', input: 'text' },
  { type: 'insurance', key: 'coveragePeriod', db: 'coverage_period', label: '보장기간', input: 'text' },
  { type: 'insurance', key: 'renewable', db: 'renewable', label: '갱신형', input: 'boolean' },
  { type: 'insurance', key: 'renewalCycleYears', db: 'renewal_cycle_years', label: '갱신 주기', input: 'integer', suffix: '년' },
  { type: 'insurance', key: 'coverageSummary', db: 'coverage_summary', label: '주요 보장', input: 'text' },
  { type: 'insurance', key: 'surrenderTerms', db: 'surrender_terms', label: '해지환급 조건', input: 'text' },
  { type: 'insurance', key: 'exclusions', db: 'exclusions', label: '면책·보장 제외', input: 'text' },
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
  { type: 'employment', key: 'leaveTerms', db: 'leave_terms', label: '휴가 관련 조건', input: 'text' },
  { type: 'employment', key: 'severanceTerms', db: 'severance_terms', label: '퇴직 관련 조건', input: 'text' },
  { type: 'employment', key: 'renewalTerms', db: 'renewal_terms', label: '갱신 관련 조건', input: 'text' },
  // 용역·프리랜서
  {
    type: 'service', key: 'userRole', db: 'user_role', label: '나의 역할', input: 'enum',
    options: [{ value: 'provider', label: '수행자 (대금을 받음)' }, { value: 'client', label: '발주자 (대금을 냄)' }],
  },
  { type: 'service', key: 'workScope', db: 'work_scope', label: '업무 내용', input: 'text' },
  { type: 'service', key: 'acceptanceTerms', db: 'acceptance_terms', label: '검수 조건', input: 'text' },
  { type: 'service', key: 'deliverableOwnership', db: 'deliverable_ownership', label: '결과물 소유권·저작권', input: 'text' },
  { type: 'service', key: 'revisionTerms', db: 'revision_terms', label: '수정 요청 조건', input: 'text' },
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

/** 계약서 금액의 역할 — 실제 현금 흐름(결제)이 되는 것은 recurring·one_time·deposit 뿐 */
export const AMOUNT_ROLES = ['recurring_cashflow', 'one_time_cashflow', 'deposit', 'component', 'total', 'reference'] as const;

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
  { code: 'other', label: '기타', types: [] },
];

export const CATEGORY_CODES = CATEGORY_DEFS.map((d) => d.code);
export const CONTRACT_TYPE_CODES = CONTRACT_TYPE_DEFS.map((d) => d.code);
export const PAYMENT_KIND_CODES = PAYMENT_KIND_DEFS.map((d) => d.code);
export const DATE_KIND_CODES = DATE_KIND_DEFS.map((d) => d.code);
export const CHECK_TOPIC_CODES = CHECK_TOPIC_DEFS.map((d) => d.code);
/** 상세 속성 저장 키 전체 (유형 무관, 중복 제거) */
export const DETAIL_DB_KEYS = [...new Set(DETAIL_FIELD_DEFS.map((d) => d.db))];
