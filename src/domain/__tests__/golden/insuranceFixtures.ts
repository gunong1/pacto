/**
 * 보험계약서 회귀 테스트용 모델 출력 (검증 전 JSON) — "새길 안심생활 종합보장보험(갱신형)" 모의 계약서 (2026-10 실전 테스트 PDF).
 * 모든 값은 가짜다 (가상 회사·인물·번호). 실제 모델이 흔히 섞어 답하는 함정을 일부러 넣는다:
 * - 담보별 월 보험료(12,000원 등)를 합계 89,700원과 함께 답함 → 중복 계산되면 안 됨
 * - 보장금액(사망보험금 5,000만원·입원일당)을 수입으로 답함 → 확정 수입이 되면 안 됨
 * - 해약환급금 예시를 수입으로 답함 → 확정 수입이 되면 안 됨
 * - 위험조항 A~F를 체크로 답함 → 모두 남아야 함
 * - 개인정보 동의 항목은 금액이 아니므로 결제가 생기면 안 됨
 */
import { answer } from './classificationFixtures';

const q = (quote: string | null, page = 1) => ({ evidence_quote: quote, evidence_page: quote ? page : null, evidence_file: quote ? 1 : null });
const f = (value: unknown, confidence = 'high', quote: string | null = null, page = 1) => ({ value, confidence, ...q(quote, page) });
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
  evidence_page: 3,
  evidence_file: 1,
  ...c,
});
const detail = (key: string, v: { text_value?: string; number_value?: number; boolean_value?: boolean }, quote: string, page = 1) => ({
  key,
  text_value: null,
  number_value: null,
  boolean_value: null,
  ...v,
  confidence: 'high',
  source_type: 'explicit',
  ...q(quote, page),
});
const party = (role: string, name: string, quote: string) => ({ role, name, confidence: 'high', ...q(quote) });

export const INSURANCE_PREMIUM_QUOTE = '초회보험료 / 월 보험료 89,700원 / 89,700원';
const PERIOD = '보험기간 2026년 11월 01일 00:00 ~ 2046년 10월 31일 24:00';

export function savingsInsurance() {
  return {
    classification: answer({ kind: 'insurance', subtype: 'health', domains: [], reason: '보험료를 내고 상해·질병 시 보험금을 받는 보장성 보험입니다.' }),
    fields: {
      title: f('무배당 새길 안심생활 종합보장보험 (갱신형)'),
      counterparty: f('새길손해보험 주식회사', 'high', '새길손해보험 주식회사 | SAECGIL GENERAL INSURANCE'),
      totalAmount: f(null, 'low'),
      depositAmount: f(null, 'low'),
      // 주계약은 20년 만기, 입원일당 특약만 5년 갱신 — 모델이 계약 전체를 자동갱신으로 답하는 경우
      autoRenewal: f(true, 'medium', '보장성 보험 / 일부 특약 5년 단위 자동갱신'),
      renewalPeriodMonths: f(60, 'medium', '입원일당 특약은 5년마다 갱신한다.', 3),
      terminationNoticeDays: f(null, 'low'),
      noticeKind: f(null, 'low'),
      earlyTerminationTerms: f(null, 'low'),
      penaltyTerms: f(null, 'low'),
    },
    parties: [
      party('policyholder', '김도윤', '계약자 김도윤'),
      party('insured', '김도윤', '피보험자 김도윤'),
      party('beneficiary', '박서연', '사망보험금 수익자 박서연 (배우자)'),
      party('insurer', '새길손해보험 주식회사', '새길손해보험 주식회사'),
    ],
    dates: [
      date('2026-10-16', 'signing', '계약체결일', '청약일 / 계약체결일 2026년 10월 15일 / 2026년 10월 16일'),
      date('2026-11-01', 'coverage_start', '보험 시작일', PERIOD),
      date('2046-10-31', 'contract_end', '보험 종료일', PERIOD),
    ],
    payments: [
      pay({ kind: 'premium', direction: 'expense', label: '월 보험료', amount: 89_700, frequency: 'monthly', day_of_month: 25, date: '2026-11-25', installment_count: 240, ...q('납입기간 / 주기 20년납 / 월납 (매월 25일) · ' + INSURANCE_PREMIUM_QUOTE) }),
      // 함정 1: 담보별 보험료 (합계 89,700원의 구성)
      pay({ role: 'component', part_of: '월 보험료', kind: 'premium', direction: 'expense', label: '일반상해 사망 보험료', amount: 12_000, frequency: 'monthly', ...q('일반상해 사망 5,000만원 / 약관상 상해사망 시 20년 12,000원', 2) }),
      pay({ role: 'component', part_of: '월 보험료', kind: 'premium', direction: 'expense', label: '암 진단비 보험료', amount: 25_000, frequency: 'monthly', ...q('암 진단비 (유사암 제외) 2,000만원 / 최초 1회 20년 25,000원', 2) }),
      pay({ role: 'component', part_of: '월 보험료', kind: 'premium', direction: 'expense', label: '입원일당 갱신형 특약 보험료', amount: 8_000, frequency: 'monthly', ...q('입원일당 갱신형 특약 1일 3만원 / 4일째부터 최대 120일 5년 갱신 8,000원', 2) }),
      // 함정 2: 보장금액을 수입으로 (보험사고가 생겼을 때만)
      pay({ role: 'one_time_cashflow', kind: 'other', direction: 'income', label: '일반상해 사망보험금', amount: 50_000_000, frequency: 'one_time', payment_obligation: 'conditional', condition: '약관상 상해사망 시', ...q('일반상해 사망 5,000만원 / 약관상 상해사망 시', 2) }),
      pay({ role: 'one_time_cashflow', kind: 'other', direction: 'income', label: '암 진단비', amount: 20_000_000, frequency: 'one_time', payment_obligation: 'conditional', condition: '암 진단 확정 시 (최초 1회)', ...q('암 진단비 (유사암 제외) 2,000만원 / 최초 1회', 2) }),
      pay({ role: 'recurring_cashflow', kind: 'other', direction: 'income', label: '입원일당', amount: 30_000, frequency: 'one_time', payment_obligation: 'conditional', condition: '입원 4일째부터 1일당', ...q('입원 4일째부터 1일당 30,000원을 지급하며', 2) }),
      // 함정 3: 해약환급금 예시를 수입으로
      pay({ role: 'reference', kind: 'other', direction: 'income', label: '해약환급금 (5년 경과 예시)', amount: 1_938_000, frequency: 'one_time', ...q('5년 5,382,000원 1,938,000원 약 36.0%', 2) }),
    ],
    details: [
      detail('product_name', { text_value: '무배당 새길 안심생활 종합보장보험 (갱신형)' }, '무배당 새길 안심생활 종합보장보험 (갱신형)'),
      detail('payment_period', { text_value: '20년납 / 월납' }, '20년납 / 월납 (매월 25일)'),
      detail('coverage_period', { text_value: '20년 (2026-11-01 ~ 2046-10-31)' }, PERIOD),
      // 갱신형은 입원일당 특약만 (주계약은 20년 만기)
      detail('renewable', { boolean_value: true }, '입원일당 갱신형 특약 1일 3만원 / 4일째부터 최대 120일 5년 갱신 8,000원', 2),
      detail('renewal_cycle_years', { number_value: 5 }, '입원일당 특약은 5년마다 갱신한다.', 3),
    ],
    checks: [
      check({ severity: 'caution', topic: 'premium_change', title: '갱신 보험료 변경 동의 간주 (A)', description: '갱신 안내 후 7일 안에 서면 이의가 없으면 변경 보험료에 동의한 것으로 보며, 인상률 상한이 없는 것으로 기재되어 있습니다.', evidence_quote: '계약자가 갱신 안내를 받은 날부터 7일 이내에 서면으로 이의를 제기하지 아니하면 변경된 보험료 및 갱신 조건에 모두 동의한 것으로 간주한다.' }),
      check({ severity: 'caution', topic: 'unilateral_change', title: '비공개 내부 심사 기준·이의 제기 제한 (B)', description: '회사 내부 심사 기준을 공개하지 않을 수 있고 최종 심사에 이의를 제기하지 않기로 한 것으로 기재되어 있습니다.', evidence_quote: '계약자는 회사의 최종 심사 결정에 대하여 이의를 제기하지 않기로 한다.' }),
      check({ severity: 'caution', topic: 'exclusion', title: '보험금 청구 30일 제한 (C)', description: '사고일로부터 30일이 지나면 사유를 불문하고 보험금을 지급하지 않는 것으로 기재되어 있습니다.', evidence_quote: '위 기간을 경과한 경우 회사는 사유를 불문하고 보험금 지급 책임을 부담하지 아니한다.' }),
      check({ severity: 'caution', topic: 'surrender', title: '해약환급금 수수료 공제·사전 고지 없는 변경 (D)', description: '중도 해지 시 계약관리 수수료를 공제하고 수수료율을 사전 고지 없이 바꿀 수 있는 것으로 기재되어 있습니다.', evidence_quote: '해당 수수료율은 회사가 사전 고지 없이 변경할 수 있다.' }),
      check({ severity: 'caution', topic: 'other', title: '마케팅 목적 개인정보 포괄 제공·철회 불가 (E)', description: '제휴사에 건강 정보 등을 마케팅 목적으로 제공하는 데 포괄 동의하고 철회할 수 없는 것으로 기재되어 있습니다.', evidence_quote: '마케팅 목적으로 제공하는 데 포괄적으로 동의하며, 별도 철회 신청을 할 수 없다.' }),
      check({ severity: 'caution', topic: 'dispute', title: '소송·민원 제기권 포기 (F)', description: '분쟁은 회사 지정 중재기관 결정에만 따르고 법원 소송·금융감독기관 민원을 포기하는 것으로 기재되어 있습니다.', evidence_quote: '계약자는 법원에 소를 제기하거나 금융감독기관에 민원을 제기할 권리를 포기한다.' }),
    ],
  };
}
