// mock 공급자의 모델 출력(검증 전 JSON) — 앱 테스트(jest)에서도 같은 출력을 toAppResult로 검증한다.

const q = (quote: string | null, page = 1) => ({ evidence_quote: quote, evidence_page: quote ? page : null });
const f = (value: unknown, confidence = 'high', quote: string | null = null) => ({ value, confidence, ...q(quote) });
const pay = (p: Record<string, unknown>) => ({
  role: 'recurring_cashflow', price_basis: 'actual', part_of: null, day_of_month: null, date: null, end_date: null, installment_count: null, is_variable: false, payment_obligation: 'confirmed', condition: null,
  business_day_rule: 'none', confidence: 'high', source_type: 'explicit', evidence_quote: null, ...p,
});
const detail = (key: string, value: string | number | boolean, quote: string | null, source_type = 'explicit') => ({
  key,
  text_value: typeof value === 'string' ? value : null,
  number_value: typeof value === 'number' ? value : null,
  boolean_value: typeof value === 'boolean' ? value : null,
  confidence: 'high',
  source_type,
  ...q(quote),
});
const party = (role: string, name: string, quote: string) => ({ role, name, confidence: 'high', ...q(quote) });
const check = (c: Record<string, unknown>) => ({ confidence: 'high', behavior: 'info', condition: null, action: null, offset_days: null, related_date: null, evidence_page: 1, evidence_file: 1, ...c });

export function rentalOutput(title: string) {
  return {
    classification: { kind: 'rental', subtype: 'appliance', domains: ['appliance'], confidence: 'high', alternatives: [], reason: '공기청정기를 빌려 쓰는 렌탈 계약으로 기재되어 있습니다.', evidence_quote: null, evidence_page: null, evidence_file: null, secondary_elements: [] },
    parties: [party('provider', '테스트렌탈(주)', '렌탈회사: 테스트렌탈 주식회사')],
    fields: {
      title: f(title),
      counterparty: f('테스트렌탈(주)', 'high', '렌탈회사: 테스트렌탈 주식회사'),
      totalAmount: f(null, 'low'),
      depositAmount: f(null, 'high'),
      autoRenewal: f(true, 'medium'),
      renewalPeriodMonths: f(12, 'medium'),
      terminationNoticeDays: f(30, 'medium'),
      earlyTerminationTerms: f(null, 'low'),
      penaltyTerms: f(null, 'low'),
    },
    dates: [
      { date: '2026-10-05', meaning: 'contract_signed', label: '계약 체결일', confidence: 'high', source_type: 'explicit', ...q('계약 체결일 2026년 10월 5일') },
      { date: '2026-10-12', meaning: 'service_start', label: '계약 기간 시작', confidence: 'high', source_type: 'explicit', ...q('계약 기간 2026.10.12 ~ 2029.10.11') },
      { date: '2029-10-11', meaning: 'contract_end', label: '계약 기간 종료', confidence: 'high', source_type: 'explicit', ...q('계약 기간 2026.10.12 ~ 2029.10.11') },
    ],
    payments: [
      pay({ kind: 'recurring_fee', direction: 'expense', label: '월 렌탈료', amount: 29900, frequency: 'monthly', day_of_month: 12, ...q('월 렌탈료 29,900원') }),
      pay({ role: 'one_time_cashflow', kind: 'setup_fee', direction: 'expense', label: '초기 설치비', amount: 20000, frequency: 'one_time', ...q('초기 설치비 20,000원 (1회)') }),
    ],
    details: [
      detail('commitment_months', 36, '계약 기간 36개월'),
      detail('ownership_transfer_terms', '계약 종료 후 전액 납부 완료 시 이전', '계약 종료 후 전액 납부 완료 시 이전'),
    ],
    checks: [
      check({
        severity: 'caution', topic: 'auto_renewal', title: '자동갱신', behavior: 'fixed_event',
        description: '계약 종료 30일 전까지 해지 의사를 표시하지 않으면 12개월 자동 연장되는 것으로 기재되어 있습니다.',
        evidence_quote: '계약 종료 30일 전까지 해지 의사를 표시하지 않으면 동일 조건으로 12개월 자동 연장됩니다.',
      }),
      check({
        severity: 'check', topic: 'early_termination', title: '중도해지 위약금', behavior: 'conditional_rule',
        condition: '의무사용기간 내 중도해지하는 경우', action: '잔여 렌탈료 총액의 10% 위약금',
        description: '의무사용기간 내 중도해지 시 잔여 렌탈료 총액의 10%가 위약금으로 부과되는 것으로 기재되어 있습니다.',
        evidence_quote: '의무사용기간 내 중도해지 시 잔여 렌탈료 총액의 10%가 위약금으로 부과됩니다.',
      }),
    ],
  };
}

/**
 * 보안 회귀 fixture (모든 값은 가짜): AI가 근거·설명에 주민등록번호·전화번호를 그대로 옮긴 출력
 * → 서버가 저장 전에 공통 가림 정책으로 가려야 한다 (analysis_jobs.result·raw_output, 저장 후 contracts.ai_checks).
 */
export const LEAKY_CONTACT_LINE = '임대인 홍길동 / 주민등록번호 800101-1234567 / 010-1234-5678';
export function rentalLeakyContactOutput(title: string) {
  const base = rentalOutput(title);
  return {
    ...base,
    fields: { ...base.fields, counterparty: f('홍길동', 'high', LEAKY_CONTACT_LINE) },
    // 당사자 이름 칸에 연락처가 섞여 와도 공통 가림 정책으로 저장 전에 가린다
    parties: [...base.parties, party('customer', '홍길동 010-1234-5678', LEAKY_CONTACT_LINE)],
    checks: [
      ...base.checks,
      check({ severity: 'check', topic: 'counterparty', title: '임대인 연락처 (010-1234-5678)', description: `임대인 정보: ${LEAKY_CONTACT_LINE}`, evidence_quote: LEAKY_CONTACT_LINE }),
    ],
  };
}

/**
 * 통보기한 일수를 필드로 찾지 못한 렌탈 (모든 값은 가짜) — 자동갱신 체크의 조건부 규칙에만 "종료 30일 전"이 있다
 * → 등록 확인 화면은 기한을 자동 저장하지 않고, 계약 체크 카드에서 "30일 전 넣기"를 고르게 한다.
 */
export function rentalNoticeUnsureOutput(title: string) {
  const base = rentalOutput(title);
  return {
    ...base,
    fields: { ...base.fields, terminationNoticeDays: f(null, 'low') },
    checks: [
      check({
        severity: 'caution', topic: 'auto_renewal', title: '자동갱신', behavior: 'conditional_rule',
        condition: '계약을 연장하지 않으려는 경우', action: '계약 종료 전 해지 의사 표시', offset_days: 30,
        description: '계약 종료 전 정해진 기간까지 해지 의사를 표시하지 않으면 자동 연장되는 것으로 보입니다.',
        evidence_quote: '종료 30일 전까지 별도 의사표시가 없으면 연장됩니다.',
      }),
      ...base.checks.slice(1),
    ],
  };
}

/**
 * 할인이 붙은 정수기 렌탈 (모든 값은 가짜) — 월 렌탈료가 "할인전" 금액, 전체회차 할인·특정 회차 면제·등록비/설치비 면제.
 * 모델이 실수한 경우를 일부러 섞는다: 할인전 금액을 actual로, 할인액을 매월 결제로, 면제된 등록비·설치비를 일회성 결제로 보냄
 * → 서버 안전장치가 결제로 확정하지 않아야 한다.
 */
export function rentalDiscountOutput(title: string) {
  const base = rentalOutput(title);
  return {
    ...base,
    classification: { ...base.classification, reason: '정수기를 빌려 쓰는 렌탈 계약으로 기재되어 있습니다.' },
    fields: { ...base.fields, counterparty: f('가짜정수기(주)', 'high', '렌탈 서비스 제공: 가짜정수기 주식회사'), autoRenewal: f(false, 'medium'), renewalPeriodMonths: f(null, 'low'), terminationNoticeDays: f(null, 'low') },
    dates: [
      { date: '2026-03-08', meaning: 'service_start', label: '계약 기간 시작', confidence: 'high', source_type: 'explicit', ...q('계약기간 : 2026.03.08 ~ 2031.03.07') },
      { date: '2031-03-07', meaning: 'contract_end', label: '계약 기간 종료', confidence: 'high', source_type: 'explicit', ...q('계약기간 : 2026.03.08 ~ 2031.03.07') },
    ],
    payments: [
      pay({ kind: 'recurring_fee', direction: 'expense', label: '월 렌탈료', amount: 45900, frequency: 'monthly', day_of_month: 15, ...q('월 렌탈료 : 45,900원(할인전)') }),
      pay({ kind: 'recurring_fee', direction: 'expense', label: 'E규정 할인', amount: 14000, frequency: 'monthly', day_of_month: 15, ...q('E규정 : 전체회차 14,000원 할인') }),
      pay({ role: 'one_time_cashflow', kind: 'setup_fee', direction: 'expense', label: '등록비', amount: 100000, frequency: 'one_time', ...q('면제 : 등록비(100,000원), 설치비(30,000원)') }),
      pay({ role: 'one_time_cashflow', kind: 'setup_fee', direction: 'expense', label: '설치비', amount: 30000, frequency: 'one_time', ...q('면제 : 등록비(100,000원), 설치비(30,000원)') }),
    ],
    details: [detail('commitment_months', 60, '의무사용기간 : 60개월')],
    checks: [
      check({ severity: 'check', topic: 'discount_terms', title: '전체회차 할인', description: '월 렌탈료 45,900원(할인전)에 전체회차 14,000원 할인이 적용되는 것으로 기재되어 있습니다.', evidence_quote: 'E규정 : 전체회차 14,000원 할인' }),
      check({ severity: 'check', topic: 'discount_terms', title: '회차 면제 프로모션', description: '1, 13, 25, 38, 48, 59회차 렌탈료가 면제되는 것으로 기재되어 있습니다.', evidence_quote: '7개월 프로모션 : 1, 13, 25, 38, 48, 59회차 면제' }),
    ],
  };
}

/**
 * 근로계약서 예시 (주식회사 네오링크 · 박민준) — 의미를 해석한 출력.
 * 월 임금 1건 + 구성 항목 2건, 지급일 휴일이면 직전 영업일, 수습 3개월 90%, 자동갱신 아님(별도 협의),
 * 자진 퇴직 30일 전 통보 = 조건부 의무 (종료일 기준 통보기한·날짜를 만들지 않음), 연봉 없음.
 */
/** 주택 월세 임대차 (모든 값은 가짜) — 보증금 20,000,000 = 계약금 2,000,000(계약 당일) + 잔금 18,000,000(10/20), 월세 850,000 · 관리비 100,000 (매월 20일) */
export function leaseOutput(title: string) {
  const DEP = '보증금 금 20,000,000원정은 계약 당일 계약금 2,000,000원을 지불하고, 잔금 18,000,000원은 2026년 10월 20일에 지불한다.';
  const RENT = '임차인은 월세 850,000원과 관리비 100,000원을 매월 20일 임대인에게 지불한다.';
  return {
    classification: { kind: 'lease', subtype: 'housing', domains: ['real_estate'], confidence: 'high', alternatives: [], reason: '주택을 빌려 쓰고 보증금과 월세를 내는 임대차 계약으로 기재되어 있습니다.', evidence_quote: null, evidence_page: null, evidence_file: null, secondary_elements: [] },
    parties: [party('lessor', '김민수', '임대인 김민수'), party('lessee', '박지훈', '임차인 박지훈')],
    fields: {
      title: f(title),
      counterparty: f(null, 'low'),
      totalAmount: f(null, 'low'),
      depositAmount: f(20000000, 'high', DEP),
      autoRenewal: f(false, 'high'),
      renewalPeriodMonths: f(null, 'low'),
      terminationNoticeDays: f(null, 'low'),
      earlyTerminationTerms: f(null, 'low'),
      penaltyTerms: f(null, 'low'),
    },
    dates: [
      { date: '2026-10-08', meaning: 'contract_signed', label: '계약일', confidence: 'high', source_type: 'explicit', ...q('계약일 2026년 10월 8일') },
      { date: '2026-10-20', meaning: 'contract_start', label: '임대차 시작일', confidence: 'high', source_type: 'explicit', ...q('2026년 10월 20일부터 2028년 10월 19일까지') },
      { date: '2028-10-19', meaning: 'contract_end', label: '임대차 종료일', confidence: 'high', source_type: 'explicit', ...q('2026년 10월 20일부터 2028년 10월 19일까지') },
    ],
    payments: [
      pay({ role: 'one_time_cashflow', kind: 'down_payment', direction: 'expense', label: '계약금', amount: 2000000, frequency: 'one_time', day_of_month: null, date: '2026-10-08', ...q(DEP) }),
      pay({ role: 'one_time_cashflow', kind: 'balance_payment', direction: 'expense', label: '잔금', amount: 18000000, frequency: 'one_time', day_of_month: null, date: '2026-10-20', ...q(DEP) }),
      pay({ kind: 'rent', direction: 'expense', label: '월세', amount: 850000, frequency: 'monthly', day_of_month: 20, payer_role: 'lessee', payee_role: 'lessor', ...q(RENT) }),
      pay({ kind: 'maintenance_fee', direction: 'expense', label: '관리비', amount: 100000, frequency: 'monthly', day_of_month: 20, payer_role: 'lessee', payee_role: 'lessor', ...q(RENT) }),
    ],
    details: [],
    checks: [],
  };
}

/**
 * 자동차 장기렌트 (모든 값은 가짜) — 계약서는 "임대인·임차인"이라고 쓴다 (렌탈 종류의 역할은 렌탈회사·고객)
 * 보증금 5,000,000(10/20) · 월 렌트료 649,000(매월 20일, 임차인이 자동이체) · 초기 등록대행비 120,000(10/20) · 탁송비 70,000(선택)
 */
export function longRentOutput(title: string) {
  const RENT = '임차인은 매월 20일 월 렌트료 649,000원을 지정 계좌에서 자동이체한다.';
  const DEP = '보증금 5,000,000원 2026년 10월 20일 1회 지급 / 계약 종료 후 정산 반환';
  return {
    classification: { kind: 'rental', subtype: 'vehicle', domains: ['vehicle'], confidence: 'high', alternatives: [], reason: '차량을 일정 기간 빌려 쓰고 월 렌트료를 내는 자동차 장기렌트 계약으로 기재되어 있습니다.', evidence_quote: null, evidence_page: null, evidence_file: null, secondary_elements: [] },
    parties: [party('lessor', '주식회사 팩토렌터카 / 대표 박지훈', '임대인 주식회사 팩토렌터카 / 대표 박지훈'), party('lessee', '김도윤', '임차인 김도윤')],
    fields: {
      title: f(title),
      counterparty: f(null, 'low'),
      totalAmount: f(null, 'low'),
      depositAmount: f(5000000, 'high', DEP),
      autoRenewal: f(false, 'high', '자동 갱신은 적용되지 않는다.'),
      renewalPeriodMonths: f(null, 'low'),
      terminationNoticeDays: f(null, 'low'),
      earlyTerminationTerms: f(null, 'low'),
      penaltyTerms: f(null, 'low'),
    },
    dates: [
      { date: '2026-10-09', meaning: 'contract_signed', label: '계약 체결일', confidence: 'high', source_type: 'explicit', ...q('계약 체결일 2026년 10월 9일') },
      { date: '2026-10-20', meaning: 'contract_start', label: '계약 시작일', confidence: 'high', source_type: 'explicit', ...q('계약 시작일 2026년 10월 20일') },
      { date: '2030-10-19', meaning: 'contract_end', label: '계약 종료일', confidence: 'high', source_type: 'explicit', ...q('계약 종료일 2030년 10월 19일') },
    ],
    payments: [
      pay({ role: 'deposit', kind: 'deposit', direction: 'neutral', label: '보증금', amount: 5000000, frequency: 'one_time', day_of_month: null, date: '2026-10-20', payer_role: 'lessee', payee_role: 'lessor', ...q(DEP) }),
      pay({ kind: 'rent', direction: 'expense', label: '월 렌트료', amount: 649000, frequency: 'monthly', day_of_month: 20, payer_role: 'lessee', payee_role: 'lessor', ...q(RENT) }),
      pay({ role: 'one_time_cashflow', kind: 'setup_fee', direction: 'expense', label: '초기 등록대행비', amount: 120000, frequency: 'one_time', day_of_month: null, date: '2026-10-20', payer_role: 'lessee', payee_role: 'lessor', ...q('초기 등록대행비 120,000원 2026년 10월 20일 1회 지급') }),
      pay({ role: 'one_time_cashflow', kind: 'other', direction: 'expense', label: '탁송비', amount: 70000, frequency: 'one_time', day_of_month: null, date: null, payment_obligation: 'optional', condition: '차량 탁송을 이용하는 경우', ...q('탁송비 70,000원 차량 직접 수령 시 발생하지 않는 선택 비용') }),
    ],
    details: [],
    checks: [],
  };
}

export function employmentOutput(title: string) {
  const wage = '월 임금은 3,600,000원으로 하며, 기본급 3,280,000원과 고정연장근로수당 320,000원으로 구성한다.';
  const payday = '임금은 매월 25일에 지급하며, 지급일이 휴일인 경우 그 전일에 지급한다.';
  const period = '근로계약기간: 2026년 10월 1일부터 2027년 9월 30일까지';
  return {
    classification: { kind: 'employment', subtype: 'fixed_term', domains: [], confidence: 'high', alternatives: [], reason: '근로 제공과 임금 지급을 정한 고용 계약으로 기재되어 있습니다.', evidence_quote: null, evidence_page: null, evidence_file: null, secondary_elements: [] },
    parties: [party('employer', '주식회사 네오링크', '사용자: 주식회사 네오링크')],
    fields: {
      title: f(title),
      counterparty: f('주식회사 네오링크', 'high', '사용자: 주식회사 네오링크'),
      totalAmount: f(null, 'low'),
      depositAmount: f(null, 'high'),
      autoRenewal: f(false, 'high', '계약기간 만료 후 갱신 여부는 업무평가, 조직운영 상황 및 당사자 협의에 따라 별도로 정한다.'),
      renewalPeriodMonths: f(null, 'low'),
      terminationNoticeDays: f(null, 'low'),
      earlyTerminationTerms: f(null, 'low'),
      penaltyTerms: f(null, 'low'),
    },
    dates: [
      { date: '2026-09-25', meaning: 'contract_signed', label: '계약 체결일', confidence: 'high', source_type: 'explicit', ...q('2026년 9월 25일', 3) },
      { date: '2026-10-01', meaning: 'contract_start', label: '근로계약 시작일', confidence: 'high', source_type: 'explicit', ...q(period) },
      { date: '2026-10-01', meaning: 'hire', label: '입사일', confidence: 'high', source_type: 'explicit', ...q(period) },
      { date: '2027-09-30', meaning: 'contract_end', label: '근로계약 종료일', confidence: 'high', source_type: 'explicit', ...q(period) },
    ],
    payments: [
      pay({ kind: 'salary', direction: 'income', label: '월 임금', amount: 3600000, frequency: 'monthly', day_of_month: 25, business_day_rule: 'previous', ...q(wage) }),
      pay({ role: 'component', part_of: '월 임금', kind: 'salary', direction: 'income', label: '기본급', amount: 3280000, frequency: 'monthly', ...q(wage) }),
      pay({ role: 'component', part_of: '월 임금', kind: 'salary', direction: 'income', label: '고정연장근로수당', amount: 320000, frequency: 'monthly', ...q(wage) }),
    ],
    details: [
      detail('employee_name', '박민준', '근로자: 박민준 (주민등록번호 901225-1234567)'),
      detail('employment_kind', 'fixed_term', period, 'inferred'),
      detail('job_title', '백엔드 개발', '담당업무: 백엔드 개발'),
      detail('probation_months', 3, '입사일로부터 3개월간 수습기간을 둔다.'),
      detail('probation_pay_rate', 90, '수습기간 중 임금은 월 임금의 90%로 한다.'),
      detail('renewal_terms', '업무평가·조직운영 상황·당사자 협의에 따라 별도로 정함', '계약기간 만료 후 갱신 여부는 업무평가, 조직운영 상황 및 당사자 협의에 따라 별도로 정한다.'),
    ],
    checks: [
      check({ severity: 'info', topic: 'wage', title: '급여일', description: '임금은 매월 25일에 근로자 명의 계좌(국민은행 123456-01-234567)로 지급하고, 지급일이 휴일이면 그 전일에 지급하는 것으로 기재되어 있습니다.', evidence_quote: payday }),
      check({ severity: 'check', topic: 'work_change', title: '근무장소·업무 변경', description: '회사가 업무상 필요에 따라 근무장소나 담당업무를 변경할 수 있는 조건이 포함되어 있습니다.', evidence_quote: '회사는 업무상 필요한 경우 근무장소 및 담당업무를 변경할 수 있다.' }),
      check({ severity: 'check', topic: 'fixed_overtime', title: '고정연장근로수당 포함', description: '월 임금 3,600,000원에 고정연장근로수당 320,000원이 포함되어 있는 것으로 기재되어 있습니다.', evidence_quote: wage }),
      check({ severity: 'check', topic: 'probation', title: '수습기간 임금 90%', description: '입사일부터 3개월은 수습기간이며, 이 기간 임금은 월 임금의 90%로 기재되어 있습니다.', evidence_quote: '수습기간 중 임금은 월 임금의 90%로 한다.', related_date: '2026-10-01' }),
      check({
        severity: 'check', topic: 'resignation_notice', title: '퇴직 사전통보', behavior: 'conditional_rule',
        condition: '근로자가 자진 퇴직하려는 경우', action: '희망 퇴직일 30일 전까지 회사에 통보', offset_days: 30,
        description: '근로자가 퇴직하려는 경우 30일 전에 회사에 통보하는 것으로 기재되어 있습니다.',
        evidence_quote: '근로자가 퇴직하고자 하는 경우 30일 전에 회사에 통보하여야 한다.',
      }),
      check({ severity: 'check', topic: 'renewal_terms', title: '갱신 별도 협의', description: '계약 만료 후 갱신 여부는 업무평가·조직운영 상황·당사자 협의에 따라 별도로 정하는 것으로 기재되어 있습니다.', evidence_quote: '계약기간 만료 후 갱신 여부는 업무평가, 조직운영 상황 및 당사자 협의에 따라 별도로 정한다.' }),
      check({ severity: 'check', topic: 'confidentiality', title: '비밀유지', description: '재직 중 및 퇴직 후에도 업무상 알게 된 비밀을 누설하지 않아야 하는 조건이 포함되어 있습니다.', evidence_quote: '근로자는 재직 중은 물론 퇴직 후에도 업무상 알게 된 회사의 비밀을 누설하여서는 아니 된다.', evidence_page: 2 }),
      check({ severity: 'check', topic: 'asset_return', title: '자산·자료 반환', description: '퇴직 시 회사 자산과 업무 자료를 반환하는 조건이 포함되어 있습니다.', evidence_quote: '근로자는 퇴직 시 회사로부터 지급받은 장비 및 업무 자료 일체를 반환하여야 한다.', evidence_page: 2 }),
    ],
  };
}

/**
 * 헬스장 1년권 예시 — 금액마다 의무 수준을 판단한 출력.
 * 1년 회원권 660,000원 일시불(확정) / 회원권 양도 시 수수료 30,000원(조건부) / 락커 이용 시 월 5,000원(선택형)
 */
export function gymYearOutput(title: string) {
  const term = '이용기간: 2026년 10월 10일부터 2027년 10월 9일까지 (1년)';
  return {
    classification: { kind: 'subscription_membership', subtype: 'fitness_membership', domains: [], confidence: 'high', alternatives: [], reason: '헬스장 시설을 1년 동안 이용할 권리를 받는 회원권 계약으로 기재되어 있습니다.', evidence_quote: null, evidence_page: null, evidence_file: null, secondary_elements: [] },
    parties: [party('provider', '바디핏 피트니스', '사업장: 바디핏 피트니스')],
    fields: {
      title: f(title),
      counterparty: f('바디핏 피트니스', 'high', '사업장: 바디핏 피트니스'),
      totalAmount: f(660000, 'high', '1년 회원권 660,000원 (계약 시 일시불 결제)'),
      depositAmount: f(null, 'high'),
      autoRenewal: f(false, 'high', '이용기간 만료 시 계약은 종료되며 재등록은 별도로 한다.'),
      renewalPeriodMonths: f(null, 'low'),
      terminationNoticeDays: f(null, 'low'),
      earlyTerminationTerms: f(null, 'low'),
      penaltyTerms: f(null, 'low'),
    },
    dates: [
      { date: '2026-10-06', meaning: 'contract_signed', label: '계약일', confidence: 'high', source_type: 'explicit', ...q('계약일: 2026년 10월 6일') },
      { date: '2026-10-10', meaning: 'service_start', label: '이용 시작일', confidence: 'high', source_type: 'explicit', ...q(term) },
      { date: '2027-10-09', meaning: 'contract_end', label: '이용 종료일', confidence: 'high', source_type: 'explicit', ...q(term) },
    ],
    payments: [
      pay({ role: 'one_time_cashflow', kind: 'recurring_fee', direction: 'expense', label: '1년 회원권', amount: 660000, frequency: 'one_time', date: '2026-10-06', ...q('1년 회원권 660,000원 (계약 시 일시불 결제)') }),
      pay({ role: 'one_time_cashflow', kind: 'other', direction: 'expense', label: '양도 수수료', amount: 30000, frequency: 'one_time', payment_obligation: 'conditional', condition: '회원권을 양도하는 경우', ...q('회원권 양도 시 양도 수수료 30,000원을 부과한다.') }),
      pay({ kind: 'recurring_fee', direction: 'expense', label: '락커 이용료', amount: 5000, frequency: 'monthly', payment_obligation: 'optional', condition: '락커를 이용하는 경우', ...q('락커 이용 시 월 5,000원') }),
    ],
    details: [],
    checks: [
      check({
        severity: 'check', topic: 'other', title: '회원권 양도 수수료', behavior: 'conditional_rule',
        condition: '회원권을 다른 사람에게 양도하는 경우', action: '양도 수수료 30,000원 납부',
        description: '회원권을 양도하는 경우 양도 수수료 30,000원이 부과되는 것으로 기재되어 있습니다.',
        evidence_quote: '회원권 양도 시 양도 수수료 30,000원을 부과한다.',
      }),
      check({
        severity: 'caution', topic: 'refund_limit', title: '환불 제한',
        description: '이용 개시 후 환불 시 이용일수와 위약금을 공제하는 것으로 기재되어 있습니다.',
        evidence_quote: '이용 개시 후 환불 시 이용일수에 해당하는 금액과 위약금(10%)을 공제한다.',
      }),
    ],
  };
}

// ───────── 문서 확인 시나리오 (mock 공급자 · 테스트 공용) ─────────
type Role = 'contract' | 'addendum' | 'supporting' | 'non_contract' | 'uncertain' | 'unreadable';
const NON_CONTRACT = /음식|강아지|고양이|반려|책상|풍경|food|dog|cat|desk/i;

function pageRole(name: string): { role: Role; reason: string | null } {
  if (NON_CONTRACT.test(name)) return { role: 'non_contract', reason: 'photo_not_document' };
  if (/영수증|receipt/i.test(name)) return { role: 'non_contract', reason: 'receipt' };
  if (/신분증/.test(name)) return { role: 'non_contract', reason: 'id_card' };
  if (/흐림|blur/i.test(name)) return { role: 'unreadable', reason: 'blurry' };
  if (/특약/.test(name)) return { role: 'addendum', reason: 'addendum_terms' };
  if (/견적서/.test(name)) return { role: 'supporting', reason: 'supporting_material' };
  return { role: 'contract', reason: 'contract_terms' };
}

const ALL_SIGNALS = { parties: true, dates: true, amounts: true, obligations: true, purpose: true, termination_renewal: true, signature: true, contract_language: true };
const NO_SIGNALS = { parties: false, dates: false, amounts: false, obligations: false, purpose: false, termination_renewal: false, signature: false, contract_language: false };

/** 계약 정보를 만들지 않는 출력 (계약이 아니거나 읽을 수 없을 때 — 추측하지 않는다) */
function emptyExtraction() {
  return {
    classification: { kind: 'other', subtype: 'none', domains: [], confidence: 'low', alternatives: [], reason: '계약 문서로 확인되지 않았습니다.', evidence_quote: null, evidence_page: null, evidence_file: null, secondary_elements: [] },
    parties: [],
    fields: Object.fromEntries(['title', 'counterparty', 'totalAmount', 'depositAmount', 'autoRenewal', 'renewalPeriodMonths', 'terminationNoticeDays', 'earlyTerminationTerms', 'penaltyTerms'].map((k) => [k, f(null, 'low')])),
    dates: [],
    payments: [],
    details: [],
    checks: [],
  };
}

/** 모든 추출값의 근거 파일 번호를 채운다 (모델이 v7에서 하는 일) */
function stampFile(out: Record<string, unknown>, file: number, skipPayments = false) {
  const stamp = (o: Record<string, unknown>) => ({ ...o, evidence_file: typeof o.evidence_file === 'number' ? o.evidence_file : file, evidence_page: o.evidence_page ?? 1 });
  const fields = out.fields as Record<string, Record<string, unknown>>;
  for (const k of Object.keys(fields)) if (fields[k].value !== null) fields[k] = stamp(fields[k]);
  for (const key of ['dates', 'payments', 'details', 'checks', 'parties']) {
    if (key === 'payments' && skipPayments) {
      out[key] = (out[key] as Record<string, unknown>[]).map((p) => ({ ...p, evidence_file: null, evidence_page: null }));
      continue;
    }
    out[key] = (out[key] as Record<string, unknown>[]).map(stamp);
  }
  return out;
}

export function mockDocumentOutput(names: string[]) {
  const pages = names.map((n, i) => ({ file: i + 1, page: 1, ...pageRole(n), dup: /중복|dup/i.test(n) && i > 0 ? i : null }));
  const roles = new Set(pages.map((p) => p.role));
  const reasons = [...new Set(pages.map((p) => p.reason).filter(Boolean))].slice(0, 4);
  const page = (p: (typeof pages)[number]) => ({ file: p.file, page: p.page, role: p.role, duplicate_of_file: p.dup, duplicate_of_page: p.dup ? 1 : null });
  const check = (role: Role, confidence: string, signals: Record<string, boolean>, extra: string[] = []) => ({
    role, confidence, reasons: [...reasons, ...extra].slice(0, 4), signals, pages: pages.map(page),
  });

  if (pages.every((p) => p.role === 'unreadable')) return { document_check: check('unreadable', 'high', NO_SIGNALS), ...emptyExtraction() };
  if (pages.every((p) => p.role === 'non_contract')) return { document_check: check('non_contract', 'high', NO_SIGNALS), ...emptyExtraction() };

  const main = pages.find((p) => p.role === 'contract') ?? pages.find((p) => p.role === 'addendum') ?? pages[0];
  const name = names[main.file - 1];
  const title = name.replace(/\.[^.]+$/, '') || '계약서';
  // 계약 신호가 거의 없는 문서 — 억지로 계약을 만들지 않는지 확인용
  if (/정보부족|sparse/i.test(name)) {
    return { document_check: check('contract', 'low', { ...NO_SIGNALS, contract_language: true }), ...emptyExtraction() };
  }
  if (main.role === 'supporting') {
    const out = stampFile(rentalOutput(title) as Record<string, unknown>, main.file);
    return { document_check: check('supporting', 'medium', { ...NO_SIGNALS, parties: true, amounts: true, dates: true }), ...out };
  }
  const base = /근로/.test(name) ? employmentOutput(title) : /장기렌트/.test(name) ? longRentOutput(title) : /임대차/.test(name) ? leaseOutput(title) : /헬스/.test(name) ? gymYearOutput(title) : /할인/.test(name) ? rentalDiscountOutput(title) : /통보미확인/.test(name) ? rentalNoticeUnsureOutput(title) : /연락처노출/.test(name) ? rentalLeakyContactOutput(title) : rentalOutput(title);
  const out = stampFile(base as Record<string, unknown>, main.file, /출처불명/.test(names.join(' ')));
  // 계약과 무관한 쪽(예: 책상 사진의 가격표)에서 읽힌 값 — 그 쪽을 제외하면 결과에 남으면 안 된다
  for (const junk of pages.filter((p) => p.role === 'non_contract')) {
    (out.payments as unknown[]).push({ ...pay({ kind: 'other', direction: 'expense', label: '월 납입액', amount: 3_000_000, frequency: 'monthly', day_of_month: 15 }), evidence_quote: '가격 3,000,000원', evidence_file: junk.file, evidence_page: 1 });
    (out.dates as unknown[]).push({ date: '2027-03-15', meaning: 'contract_end', label: '종료일', confidence: 'medium', source_type: 'explicit', evidence_quote: '2027.03.15', evidence_file: junk.file, evidence_page: 1 });
  }
  const role: Role = main.role === 'addendum' && !roles.has('contract') ? 'addendum' : 'contract';
  return { document_check: check(role, 'high', ALL_SIGNALS, pages.length > 1 && pages.some((p) => p.role !== 'contract' && p.role !== 'addendum') ? ['mixed_pages'] : []), ...out };
}
