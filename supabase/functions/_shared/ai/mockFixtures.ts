// mock 공급자의 모델 출력(검증 전 JSON) — 앱 테스트(jest)에서도 같은 출력을 toAppResult로 검증한다.

const q = (quote: string | null, page = 1) => ({ evidence_quote: quote, evidence_page: quote ? page : null });
const f = (value: unknown, confidence = 'high', quote: string | null = null) => ({ value, confidence, ...q(quote) });
const pay = (p: Record<string, unknown>) => ({
  role: 'recurring_cashflow', part_of: null, day_of_month: null, date: null, end_date: null, installment_count: null, is_variable: false, optional: false,
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
const check = (c: Record<string, unknown>) => ({ confidence: 'high', behavior: 'info', condition: null, action: null, offset_days: null, related_date: null, evidence_page: 1, evidence_file: 1, ...c });

export function rentalOutput(title: string) {
  return {
    category: { value: 'rental', confidence: 'high', alternatives: [], reason: '공기청정기 렌탈 계약으로 기재되어 있습니다.' },
    contract_type: { value: 'recurring', confidence: 'high', alternatives: ['other'], reason: '매월 렌탈료를 내는 계약으로 기재되어 있습니다.' },
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
 * 근로계약서 예시 (주식회사 네오링크 · 박민준) — 의미를 해석한 출력.
 * 월 임금 1건 + 구성 항목 2건, 지급일 휴일이면 직전 영업일, 수습 3개월 90%, 자동갱신 아님(별도 협의),
 * 자진 퇴직 30일 전 통보 = 조건부 의무 (종료일 기준 통보기한·날짜를 만들지 않음), 연봉 없음.
 */
export function employmentOutput(title: string) {
  const wage = '월 임금은 3,600,000원으로 하며, 기본급 3,280,000원과 고정연장근로수당 320,000원으로 구성한다.';
  const payday = '임금은 매월 25일에 지급하며, 지급일이 휴일인 경우 그 전일에 지급한다.';
  const period = '근로계약기간: 2026년 10월 1일부터 2027년 9월 30일까지';
  return {
    category: { value: 'employment', confidence: 'high', alternatives: [], reason: '근로계약서로 기재되어 있습니다.' },
    contract_type: { value: 'employment', confidence: 'high', alternatives: [], reason: '근로 제공과 임금 지급을 정한 계약으로 기재되어 있습니다.' },
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
      detail('employee_name', '박민준', '근로자: 박민준'),
      detail('employment_kind', 'fixed_term', period, 'inferred'),
      detail('job_title', '백엔드 개발', '담당업무: 백엔드 개발'),
      detail('probation_months', 3, '입사일로부터 3개월간 수습기간을 둔다.'),
      detail('probation_pay_rate', 90, '수습기간 중 임금은 월 임금의 90%로 한다.'),
      detail('renewal_terms', '업무평가·조직운영 상황·당사자 협의에 따라 별도로 정함', '계약기간 만료 후 갱신 여부는 업무평가, 조직운영 상황 및 당사자 협의에 따라 별도로 정한다.'),
    ],
    checks: [
      check({ severity: 'info', topic: 'wage', title: '급여일', description: '임금은 매월 25일에 지급하고, 지급일이 휴일이면 그 전일에 지급하는 것으로 기재되어 있습니다.', evidence_quote: payday }),
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
