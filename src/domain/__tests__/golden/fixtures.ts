/**
 * Golden 테스트용 대표 계약 7종 — AI 모델 출력(검증 전 JSON) 형식. 모든 값은 가짜다 (실제 계약서·개인정보 아님).
 *
 * 각 계약에는 지금까지 실제로 문제가 됐던 표현을 일부러 넣는다:
 * - 같은 문장의 "연체 시"·"할인전"·"특약"·"이용 시" (확정 금액이 낮아지거나 비워지면 안 됨)
 * - "관리비에 수도 포함" (관리비가 월세 구성항목으로 합쳐지면 안 됨)
 * - 면제 금액을 참고 금액(reference)으로 답함 (지시문대로 답해도 면제로 처리돼야 함)
 * - 총액을 실제 돈으로 답함 (계약금·잔금과 중복 계산되면 안 됨)
 * - 급여·기본급·식대를 각각 실제 돈으로 답함 (급여 한 건 + 구성항목)
 * - 반복 결제일을 날짜(dates)로도 답함 (주요 날짜가 되면 안 됨)
 */

const q = (quote: string | null) => ({ evidence_quote: quote, evidence_page: quote ? 1 : null, evidence_file: quote ? 1 : null });
const f = (value: unknown, confidence = 'high', quote: string | null = null) => ({ value, confidence, ...q(quote) });
const date = (d: string, meaning: string, label: string, quote: string) => ({ date: d, meaning, label, confidence: 'high', source_type: 'explicit', ...q(quote) });
const pay = (p: Record<string, unknown>) => ({
  role: 'recurring_cashflow',
  price_basis: 'actual',
  part_of: null,
  day_of_month: null,
  date: null,
  date_source: 'explicit',
  end_date: null,
  installment_count: null,
  is_variable: false,
  payment_obligation: 'confirmed',
  condition: null,
  business_day_rule: 'none',
  confidence: 'high',
  source_type: 'explicit',
  evidence_quote: null,
  evidence_page: 1,
  evidence_file: 1,
  ...p,
});
const check = (c: Record<string, unknown>) => ({
  confidence: 'high',
  behavior: 'info',
  condition: null,
  action: null,
  offset_days: null,
  related_date: null,
  evidence_page: 1,
  evidence_file: 1,
  ...c,
});
const classification = (value: string, reason: string) => ({ value, confidence: 'high', alternatives: [], reason });
const noFields = {
  title: f(null, 'low'),
  counterparty: f(null, 'low'),
  totalAmount: f(null, 'low'),
  depositAmount: f(null, 'low'),
  autoRenewal: f(null, 'low'),
  renewalPeriodMonths: f(null, 'low'),
  terminationNoticeDays: f(null, 'low'),
  noticeKind: f(null, 'low'),
  earlyTerminationTerms: f(null, 'low'),
  penaltyTerms: f(null, 'low'),
};

/** 1. 렌탈 — 월 렌탈료 31,900원(할인전 45,900원, 연체 시 연체료) + 등록비·설치비 면제 + 위약금·연체 */
export function rental() {
  const rent = '월 렌탈료 31,900원(할인전 45,900원)은 매월 15일 자동이체되며, 연체 시 연체료가 부과됩니다.';
  const waived = '면제 : 등록비(100,000원), 설치비(30,000원)';
  return {
    category: classification('rental', '정수기 렌탈 계약으로 기재되어 있습니다.'),
    contract_type: classification('recurring', '매월 렌탈료를 내는 계약입니다.'),
    fields: {
      ...noFields,
      title: f('정수기 렌탈 계약'),
      counterparty: f('가짜정수기(주)', 'high', '렌탈 서비스 제공: 가짜정수기 주식회사'),
      autoRenewal: f(true, 'high', '계약 종료 30일 전까지 해지 의사를 표시하지 않으면 12개월 자동 연장됩니다.'),
      renewalPeriodMonths: f(12, 'high', '계약 종료 30일 전까지 해지 의사를 표시하지 않으면 12개월 자동 연장됩니다.'),
      terminationNoticeDays: f(30, 'high', '계약 종료 30일 전까지 해지 의사를 표시하지 않으면 12개월 자동 연장됩니다.'),
      noticeKind: f('termination_notice', 'high', '계약 종료 30일 전까지 해지 의사를 표시하지 않으면 12개월 자동 연장됩니다.'),
      earlyTerminationTerms: f('의무사용기간 내 해지 시 위약금 부과', 'high', '의무사용기간 내 중도해지 시 잔여 렌탈료의 10%를 위약금으로 청구합니다.'),
      penaltyTerms: f('잔여 렌탈료의 10%', 'high', '의무사용기간 내 중도해지 시 잔여 렌탈료의 10%를 위약금으로 청구합니다.'),
    },
    dates: [
      date('2026-10-05', 'contract_signed', '계약일', '계약일 2026년 10월 5일'),
      date('2026-10-12', 'service_start', '렌탈 개시일', '렌탈 기간 2026.10.12 ~ 2029.10.11 (36개월)'),
      date('2029-10-11', 'contract_end', '렌탈 종료일', '렌탈 기간 2026.10.12 ~ 2029.10.11 (36개월)'),
      date('2026-10-12', 'installation', '설치일', '설치 예정일 2026년 10월 12일'),
    ],
    payments: [
      pay({ kind: 'recurring_fee', direction: 'expense', label: '월 렌탈료', amount: 31900, frequency: 'monthly', day_of_month: 15, ...q(rent) }),
      pay({ role: 'reference', kind: 'recurring_fee', direction: 'expense', label: '월 렌탈료(할인전)', amount: 45900, frequency: 'monthly', price_basis: 'before_discount', ...q(rent) }),
      // 지시문대로 면제를 참고 금액(reference)으로 답한 경우
      pay({ role: 'reference', kind: 'setup_fee', direction: 'expense', label: '등록비', amount: 100000, frequency: 'one_time', ...q(waived) }),
      // 면제를 일회성 결제로 답한 경우
      pay({ role: 'one_time_cashflow', kind: 'setup_fee', direction: 'expense', label: '설치비', amount: 30000, frequency: 'one_time', ...q(waived) }),
      // 위약금을 조건부 결제로 답한 경우 (금액만 계약 체크로)
      pay({ role: 'one_time_cashflow', kind: 'other', direction: 'expense', label: '중도해지 위약금', amount: 200000, frequency: 'one_time', payment_obligation: 'conditional', condition: '의무사용기간 내 중도해지하는 경우', ...q('의무사용기간 내 중도해지 시 잔여 렌탈료의 10%를 위약금으로 청구합니다.') }),
    ],
    details: [],
    checks: [
      check({ severity: 'caution', topic: 'auto_renewal', title: '자동갱신', behavior: 'fixed_event', description: '계약 종료 30일 전까지 해지 의사를 표시하지 않으면 12개월 자동 연장되는 것으로 기재되어 있습니다.', evidence_quote: '계약 종료 30일 전까지 해지 의사를 표시하지 않으면 12개월 자동 연장됩니다.' }),
      check({ severity: 'caution', topic: 'early_termination', title: '중도해지 위약금', behavior: 'conditional_rule', condition: '의무사용기간 내 중도해지하는 경우', action: '잔여 렌탈료의 10% 위약금', description: '의무사용기간 내 중도해지 시 잔여 렌탈료의 10%가 위약금으로 청구되는 것으로 기재되어 있습니다.', evidence_quote: '의무사용기간 내 중도해지 시 잔여 렌탈료의 10%를 위약금으로 청구합니다.' }),
      check({ severity: 'check', topic: 'overdue', title: '연체료', behavior: 'conditional_rule', condition: '렌탈료를 연체하는 경우', action: '연체료 부과', description: '렌탈료 연체 시 연체료가 부과되는 것으로 기재되어 있습니다.', evidence_quote: rent }),
    ],
  };
}

/** 2. 근로 — 월 급여 1,270,000 = 기본급 1,200,000 + 식대 70,000 (세 금액을 각각 실제 돈으로 답함), 지급일 있음/없음 */
export function employment(payday: number | null) {
  const wage = `월 급여 1,270,000원 (기본급 1,200,000원, 식대 70,000원)${payday ? `, 매월 ${payday}일 지급` : ''}`;
  const income = (label: string, amount: number, kind: string, day: number | null) =>
    pay({ kind, direction: 'income', label, amount, frequency: 'monthly', day_of_month: day, ...q(wage) });
  return {
    category: classification('employment', '근로계약서로 기재되어 있습니다.'),
    contract_type: classification('employment', '근로 계약입니다.'),
    fields: { ...noFields, title: f('근로계약서'), counterparty: f('가짜상사(주)', 'high', '사업주: 가짜상사 주식회사') },
    dates: [
      date('2026-07-20', 'contract_start', '근로 시작일', '근로개시일: 2026년 7월 20일'),
      date('2026-07-20', 'hire', '입사일', '근로개시일: 2026년 7월 20일'),
    ],
    payments: [income('월 급여', 1_270_000, 'salary', payday), income('기본급', 1_200_000, 'salary', null), income('식대', 70_000, 'bonus', null)],
    details: [],
    checks: [
      check({ severity: 'check', topic: 'resignation_notice', title: '퇴직 사전통보', behavior: 'conditional_rule', condition: '근로자가 퇴직하려는 경우', action: '퇴직 희망일 30일 전 통보', offset_days: 30, description: '퇴직하려면 30일 전에 통보하도록 기재되어 있습니다.', evidence_quote: '근로자가 퇴직하고자 하는 경우 30일 전에 통보하여야 한다.' }),
    ],
  };
}

/** 3. 월세 — 보증금 5천만(계약금 1천만 + 잔금 4천만), 월세 70만 + 관리비 7만(수도 등 포함), 입주일 = 시작일, 월세 지급일을 날짜로도 답함 */
export function lease() {
  return {
    category: classification('real_estate', '주택 월세 임대차계약서로 기재되어 있습니다.'),
    contract_type: classification('lease', '임대차 계약입니다.'),
    fields: {
      ...noFields,
      title: f('주택 월세 임대차계약서'),
      counterparty: f('홍길동', 'high', '임대인 성명: 홍길동'),
      depositAmount: f(50_000_000, 'high', '보증금 금 50,000,000원'),
      autoRenewal: f(false, 'high', '계약기간 만료 시 임차인이 계속 거주하고자 하는 경우, 임대인과 협의하여 갱신할 수 있다.'),
    },
    dates: [
      date('2026-02-10', 'contract_signed', '계약일', '2026년 2월 10일'),
      date('2026-03-01', 'contract_start', '계약 시작일', '계약기간 2026년 3월 1일부터 2028년 2월 29일까지 (2년)'),
      date('2028-02-29', 'contract_end', '계약 종료일', '계약기간 2026년 3월 1일부터 2028년 2월 29일까지 (2년)'),
      date('2026-03-01', 'move_in', '입주일', '입주일 2026년 3월 1일'),
      date('2026-03-01', 'balance_due', '잔금일', '잔금 금 40,000,000원 지급일 2026년 3월 1일'),
      date('2026-03-05', 'other', '월세 지급일', '월세 지급일 매월 5일 (임차인 명의 계좌로 자동이체)'),
    ],
    payments: [
      // 총액(보증금)을 실제 돈으로 답한 경우
      pay({ role: 'deposit', kind: 'deposit', direction: 'neutral', label: '보증금', amount: 50_000_000, frequency: 'one_time', ...q('보증금 금 50,000,000원') }),
      pay({ role: 'deposit', kind: 'deposit', direction: 'neutral', label: '계약금', amount: 10_000_000, frequency: 'one_time', date: '2026-02-10', ...q('계약금 금 10,000,000원 지급일 2026년 2월 10일') }),
      pay({ role: 'deposit', kind: 'deposit', direction: 'neutral', label: '잔금', amount: 40_000_000, frequency: 'one_time', date: '2026-03-01', ...q('잔금 금 40,000,000원 지급일 2026년 3월 1일') }),
      pay({ kind: 'rent', direction: 'expense', label: '월세', amount: 700_000, frequency: 'monthly', day_of_month: 5, ...q('월세 금 700,000원, 월세 지급일 매월 5일') }),
      pay({ kind: 'maintenance_fee', direction: 'expense', label: '관리비', amount: 70_000, frequency: 'monthly', day_of_month: 5, ...q('관리비 월 70,000원 (월세와 함께 매월 5일 납부) ※ 수도, 공용전기, 청소비 등 포함') }),
    ],
    details: [],
    checks: [
      check({ severity: 'check', topic: 'renewal_terms', title: '갱신 협의', description: '계약 만료 시 임대인과 협의하여 갱신할 수 있다고 기재되어 있습니다.', evidence_quote: '계약기간 만료 시 임차인이 계속 거주하고자 하는 경우, 임대인과 협의하여 갱신할 수 있다.' }),
      check({ severity: 'check', topic: 'restoration', title: '원상복구', description: '계약 만료 시 목적물을 원상대로 반환하는 것으로 기재되어 있습니다.', evidence_quote: '계약 만료 시 임차인은 목적물을 원상대로 반환한다.' }),
    ],
  };
}

/** 4. 자동차보험 — 연 보험료 1,200,000원 일시납(특약 포함) — 모델이 매월로 잘못 답함 + 선택 특약 */
export function carInsurance() {
  const premium = '보험료 1,200,000원 (특약 포함, 일시납 2026.10.20 납입)';
  return {
    category: classification('insurance', '자동차보험 계약입니다.'),
    contract_type: classification('insurance', '보험 계약입니다.'),
    fields: { ...noFields, title: f('자동차보험'), counterparty: f('가짜손해보험(주)', 'high', '보험회사: 가짜손해보험'), autoRenewal: f(false, 'high', '보험기간 만료 시 재가입하여야 합니다.') },
    dates: [
      date('2026-10-20', 'coverage_start', '보험 시작일', '보험기간 2026.10.20 ~ 2027.10.20'),
      date('2027-10-20', 'contract_end', '보험 종료일', '보험기간 2026.10.20 ~ 2027.10.20'),
    ],
    payments: [
      pay({ kind: 'premium', direction: 'expense', label: '보험료', amount: 1_200_000, frequency: 'monthly', date: '2026-10-20', ...q(premium) }),
      pay({ role: 'one_time_cashflow', kind: 'premium', direction: 'expense', label: '렌터카 비용 지원 특약', amount: 50_000, frequency: 'one_time', payment_obligation: 'optional', condition: '특약에 가입하는 경우', ...q('(선택) 렌터카 비용 지원 특약 50,000원') }),
    ],
    details: [],
    checks: [check({ severity: 'check', topic: 'exclusion', title: '보상하지 않는 손해', description: '무면허 운전 중 사고는 보상하지 않는 것으로 기재되어 있습니다.', evidence_quote: '무면허 운전 중 생긴 손해는 보상하지 않습니다.' })],
  };
}

/** 5. 대출 — 월 원리금 312,000원 36회 (같은 문장에 "연체 시"), 대출금액은 참고 금액, 중도상환·연체는 체크 */
export function loan() {
  const repay = '매월 25일 원리금 312,000원을 36회 상환합니다 (연체 시 지연배상금 부과).';
  return {
    category: classification('finance', '신용대출 약정서입니다.'),
    contract_type: classification('loan', '대출 계약입니다.'),
    fields: { ...noFields, title: f('신용대출 약정서'), counterparty: f('가짜은행', 'high', '대출기관: 가짜은행') },
    dates: [
      date('2026-09-25', 'loan_execution', '대출 실행일', '대출 실행일 2026년 9월 25일'),
      date('2029-09-25', 'maturity', '만기일', '만기일 2029년 9월 25일'),
    ],
    payments: [
      pay({ kind: 'loan_repayment', direction: 'expense', label: '월 원리금 상환', amount: 312_000, frequency: 'monthly', day_of_month: 25, installment_count: 36, date: '2026-10-25', ...q(repay) }),
      pay({ role: 'reference', kind: 'other', direction: 'neutral', label: '대출금액', amount: 10_000_000, frequency: 'one_time', ...q('대출금액 10,000,000원') }),
    ],
    details: [],
    checks: [
      check({ severity: 'caution', topic: 'prepayment', title: '중도상환수수료', behavior: 'conditional_rule', condition: '만기 전에 상환하는 경우', action: '상환금액의 1.2% 수수료', description: '만기 전 상환 시 상환금액의 1.2%가 수수료로 부과되는 것으로 기재되어 있습니다.', evidence_quote: '중도상환 시 상환금액의 1.2%를 중도상환수수료로 부과합니다.' }),
      check({ severity: 'caution', topic: 'overdue', title: '연체 지연배상금', behavior: 'conditional_rule', condition: '상환을 연체하는 경우', action: '지연배상금 부과', description: '연체 시 지연배상금이 부과되는 것으로 기재되어 있습니다.', evidence_quote: repay }),
    ],
  };
}

/** 6. 구독·회원권 — 월 이용료 59,000원("이용 시 매월 10일") + 락커 선택(결제일 없음) + 가입비 면제 + 양도 수수료(조건부) */
export function membership() {
  return {
    category: classification('membership', '헬스장 회원권 계약입니다.'),
    contract_type: classification('recurring', '매월 이용료를 내는 계약입니다.'),
    fields: {
      ...noFields,
      title: f('헬스장 회원권'),
      counterparty: f('가짜피트니스', 'high', '가짜피트니스 센터'),
      autoRenewal: f(true, 'high', '해지 신청이 없으면 매월 자동 결제됩니다.'),
    },
    dates: [date('2026-10-01', 'service_start', '이용 시작일', '이용 시작일 2026년 10월 1일')],
    payments: [
      pay({ kind: 'recurring_fee', direction: 'expense', label: '월 이용료', amount: 59_000, frequency: 'monthly', day_of_month: 10, ...q('월 이용료 59,000원은 이용 시 매월 10일 결제됩니다.') }),
      pay({ kind: 'recurring_fee', direction: 'expense', label: '락커 이용료', amount: 5_000, frequency: 'monthly', payment_obligation: 'optional', condition: '락커를 이용하는 경우', ...q('락커 이용 시 월 5,000원') }),
      pay({ role: 'one_time_cashflow', kind: 'setup_fee', direction: 'expense', label: '가입비', amount: 30_000, frequency: 'one_time', ...q('가입비 30,000원 무료') }),
      pay({ role: 'one_time_cashflow', kind: 'other', direction: 'expense', label: '회원권 양도 수수료', amount: 30_000, frequency: 'one_time', payment_obligation: 'potential', condition: '회원권을 양도하는 경우', ...q('회원권 양도 시 수수료 30,000원') }),
    ],
    details: [],
    checks: [check({ severity: 'check', topic: 'refund_limit', title: '환불 제한', description: '이용 개시 후에는 환불이 제한되는 것으로 기재되어 있습니다.', evidence_quote: '이용 개시 후 환불은 불가합니다.' })],
  };
}

/** 7. 서비스(용역) — 총 계약금액 9,000,000원을 실제 돈으로 답함 = 착수금 3,000,000 + 잔금 6,000,000 (받는 돈), 납기일 */
export function service() {
  return {
    category: classification('service', '웹사이트 제작 용역 계약입니다.'),
    contract_type: classification('service', '용역 계약입니다.'),
    fields: { ...noFields, title: f('웹사이트 제작 용역 계약'), counterparty: f('가짜디자인(주)', 'high', '발주자: 가짜디자인 주식회사'), totalAmount: f(9_000_000, 'high', '총 계약금액 9,000,000원') },
    dates: [
      date('2026-10-14', 'contract_signed', '계약일', '계약일 2026년 10월 14일'),
      date('2026-10-15', 'contract_start', '용역 시작일', '용역기간 2026.10.15 ~ 2026.12.31'),
      date('2026-12-31', 'contract_end', '용역 종료일', '용역기간 2026.10.15 ~ 2026.12.31'),
      date('2026-12-15', 'delivery', '납품일', '결과물 납품일 2026년 12월 15일'),
    ],
    payments: [
      pay({ role: 'one_time_cashflow', kind: 'service_fee', direction: 'income', label: '총 계약금액', amount: 9_000_000, frequency: 'one_time', ...q('총 계약금액 9,000,000원') }),
      pay({ role: 'one_time_cashflow', kind: 'service_fee', direction: 'income', label: '착수금', amount: 3_000_000, frequency: 'one_time', date: '2026-10-15', ...q('착수금 3,000,000원 (2026.10.15 지급)') }),
      pay({ role: 'one_time_cashflow', kind: 'service_fee', direction: 'income', label: '잔금', amount: 6_000_000, frequency: 'one_time', date: '2026-12-31', ...q('잔금 6,000,000원 (검수 완료 후 2026.12.31 지급)') }),
    ],
    details: [],
    checks: [
      check({ severity: 'check', topic: 'acceptance', title: '검수', description: '납품 후 7일 이내 검수하는 것으로 기재되어 있습니다.', evidence_quote: '발주자는 납품 후 7일 이내에 검수한다.' }),
      check({ severity: 'check', topic: 'copyright', title: '저작권 귀속', description: '결과물의 저작권은 잔금 지급 후 발주자에게 귀속되는 것으로 기재되어 있습니다.', evidence_quote: '결과물 저작권은 잔금 지급 완료 시 발주자에게 귀속된다.' }),
    ],
  };
}
