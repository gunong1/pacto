/**
 * 계약 종류 분류 golden — AI 모델 출력(v13, 검증 전 JSON) 형식의 대표 계약 14종. 모든 값은 가짜다 (실제 계약서·개인정보 아님).
 *
 * 이 테스트 층은 "AI가 이렇게 답했다"고 가정하고, 그 뒤의 처리(서버 검증·저장·표시·일정)가 계약 종류를 바꾸지 않는지만 본다.
 * AI가 실제로 맞게 분류하는지는 모델 평가 스크립트(scripts/eval-classification)에서 따로 잰다 — 두 층을 섞지 않는다.
 *
 * 일부러 넣은 헷갈리는 표현 (서버·앱이 이 단어로 종류를 바꾸면 안 됨):
 * - SaaS: "서비스" 단어 · 매월 청구 · 초기 설정비 (용역·렌탈로 바뀌면 안 됨)
 * - 자동차보험·장기렌트·매매: "자동차" 단어 (자동차라는 종류는 없음 — domain=vehicle로만)
 * - 개발 외주: "서비스 개발" (구독으로 바뀌면 안 됨)
 */

const q = (quote: string | null) => ({ evidence_quote: quote, evidence_page: quote ? 1 : null, evidence_file: quote ? 1 : null });
const f = (value: unknown, confidence = 'high', quote: string | null = null) => ({ value, confidence, ...q(quote) });
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
export const pay = (p: Record<string, unknown>) => ({
  kind: 'recurring_fee',
  direction: 'expense',
  frequency: 'monthly',
  role: 'recurring_cashflow',
  price_basis: 'actual',
  part_of: null,
  day_of_month: 25,
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
const date = (d: string, meaning: string, label: string) => ({ date: d, meaning, label, confidence: 'high', source_type: 'explicit', ...q(`${label} ${d}`) });

export interface ClassificationAnswer {
  kind: string;
  subtype: string | null;
  domains?: string[];
  confidence?: 'high' | 'medium' | 'low';
  alternatives?: string[];
  reason?: string;
  secondary?: { kind: string; note: string }[];
}

/** AI의 분류 답 (v13 classification 객체) */
export const answer = (a: ClassificationAnswer) => ({
  kind: a.kind,
  subtype: a.subtype ?? 'none',
  domains: a.domains ?? [],
  confidence: a.confidence ?? 'high',
  alternatives: a.alternatives ?? [],
  reason: a.reason ?? '계약서 내용을 바탕으로 판단했습니다.',
  ...q('제1조 (목적)'),
  secondary_elements: (a.secondary ?? []).map((s) => ({ kind: s.kind, note: s.note })),
});

/** 계약 하나의 모델 출력 */
export function contract(o: { cls: ClassificationAnswer; title: string; payments?: Record<string, unknown>[]; fields?: Record<string, unknown>; dates?: unknown[]; checks?: unknown[]; details?: unknown[] }) {
  return {
    classification: answer(o.cls),
    fields: { ...noFields, title: f(o.title, 'high', o.title), ...(o.fields ?? {}) },
    dates: o.dates ?? [date('2026-11-01', 'contract_start', '계약 시작일'), date('2027-10-31', 'contract_end', '계약 종료일')],
    payments: o.payments ?? [],
    details: o.details ?? [],
    checks: o.checks ?? [],
  };
}

/** SaaS — 이번에 "용역·프리랜서"로 잘못 분류됐던 계약과 같은 구조 (값은 가짜) */
export function saas(payment: Record<string, unknown> = {}) {
  return contract({
    cls: { kind: 'subscription_membership', subtype: 'software_saas', domains: ['software'], reason: '업무 협업 소프트웨어의 사용권을 제공하고 계약 기간 동안 월 이용료를 청구하는 계약' },
    title: '업무 협업 서비스 이용계약서',
    payments: [
      pay({ label: '월 이용료', amount: 180000, evidence_quote: '서비스 이용료는 월 180,000원이며 매월 25일 정기 청구한다.', ...payment }),
      pay({ kind: 'setup_fee', label: '초기 설정비', amount: 300000, frequency: 'one_time', role: 'one_time_cashflow', day_of_month: null, date: '2026-11-01', evidence_quote: '초기 설정비 300,000원은 별도로 청구한다.' }),
    ],
  });
}

export interface ClassificationCase {
  name: string;
  output: ReturnType<typeof contract>;
  kind: string;
  subtype: string | null;
  domains?: string[];
}

/** 대표 계약 14종 (요청된 최소 테스트 목록) */
export const CASES: ClassificationCase[] = [
  {
    name: '근로: 회사와 근로자 · 월급',
    kind: 'employment',
    subtype: 'full_time',
    output: contract({ cls: { kind: 'employment', subtype: 'full_time' }, title: '근로계약서', payments: [pay({ kind: 'salary', direction: 'income', label: '월 급여', amount: 3000000 })] }),
  },
  {
    name: '주택 월세: 보증금 · 월세 · 임대인/임차인',
    kind: 'lease',
    subtype: 'housing',
    domains: ['real_estate'],
    output: contract({ cls: { kind: 'lease', subtype: 'housing', domains: ['real_estate'] }, title: '주택 월세 임대차계약서', payments: [pay({ kind: 'rent', label: '월세', amount: 700000, day_of_month: 5 })], fields: { depositAmount: f(50000000) } }),
  },
  {
    name: '신용대출: 원금 · 금리 · 상환',
    kind: 'loan',
    subtype: 'credit',
    output: contract({ cls: { kind: 'loan', subtype: 'credit' }, title: '신용대출 약정서', payments: [pay({ kind: 'loan_repayment', label: '월 원리금', amount: 450000, day_of_month: 10 })] }),
  },
  {
    name: '자동차보험: 보험료 · 피보험자동차 · 보장',
    kind: 'insurance',
    subtype: 'auto',
    domains: ['vehicle'],
    output: contract({ cls: { kind: 'insurance', subtype: 'auto', domains: ['vehicle'] }, title: '개인용 자동차보험 가입증명서', payments: [pay({ kind: 'premium', label: '연 보험료', amount: 820000, frequency: 'yearly', role: 'recurring_cashflow', day_of_month: 1 })] }),
  },
  {
    name: '자동차 장기렌트: 차량 사용 · 월 렌탈료 · 반납',
    kind: 'rental',
    subtype: 'vehicle',
    domains: ['vehicle'],
    output: contract({ cls: { kind: 'rental', subtype: 'vehicle', domains: ['vehicle'] }, title: '자동차 장기렌트 계약서', payments: [pay({ label: '월 대여료', amount: 590000 })] }),
  },
  {
    name: '정수기: 제품 사용 · 월 렌탈료 · 의무사용기간',
    kind: 'rental',
    subtype: 'appliance',
    domains: ['appliance'],
    output: contract({ cls: { kind: 'rental', subtype: 'appliance', domains: ['appliance'] }, title: '정수기 렌탈 계약서', payments: [pay({ label: '월 렌탈료', amount: 31900, day_of_month: 15 })] }),
  },
  { name: 'SaaS: 소프트웨어 계정 사용 · 월 이용료', kind: 'subscription_membership', subtype: 'software_saas', domains: ['software'], output: saas() },
  {
    name: '개발 외주: 기능 개발 · 결과물 납품 · 용역비',
    kind: 'service',
    subtype: 'development',
    domains: ['software'],
    output: contract({
      cls: { kind: 'service', subtype: 'development', domains: ['software'] },
      title: '모바일 서비스 개발 용역계약서',
      payments: [pay({ kind: 'service_fee', direction: 'income', label: '용역비', amount: 15000000, frequency: 'one_time', role: 'one_time_cashflow', day_of_month: null, date: '2027-01-31' })],
    }),
  },
  {
    name: '헬스장: 시설 이용권 · 연 회원권',
    kind: 'subscription_membership',
    subtype: 'fitness_membership',
    output: contract({ cls: { kind: 'subscription_membership', subtype: 'fitness_membership' }, title: '피트니스 회원 가입 신청서', payments: [pay({ label: '1년 회원권', amount: 660000, frequency: 'one_time', role: 'one_time_cashflow', day_of_month: null, date: '2026-11-01' })] }),
  },
  {
    name: '자동차 매매: 차량 인도 · 매매대금 · 소유권 이전',
    kind: 'sale',
    subtype: 'vehicle',
    domains: ['vehicle'],
    output: contract({
      cls: { kind: 'sale', subtype: 'vehicle', domains: ['vehicle'] },
      title: '중고 자동차 매매계약서',
      payments: [pay({ kind: 'balance_payment', label: '매매대금', amount: 12000000, frequency: 'one_time', role: 'one_time_cashflow', day_of_month: null, date: '2026-11-10' })],
    }),
  },
  {
    name: '상품 24개월 할부: 구매 · 소유권 취득 · 24회 분납',
    kind: 'installment',
    subtype: 'goods',
    domains: ['appliance'],
    output: contract({ cls: { kind: 'installment', subtype: 'goods', domains: ['appliance'] }, title: '가전제품 할부 구매 계약서', payments: [pay({ kind: 'installment', label: '월 할부금', amount: 125000, installment_count: 24 })] }),
  },
  {
    name: '온라인 교육: 강의 제공이 핵심',
    kind: 'education',
    subtype: 'online_course',
    output: contract({ cls: { kind: 'education', subtype: 'online_course', confidence: 'medium', alternatives: ['subscription_membership'] }, title: '자격증 온라인 강의 수강 계약', payments: [pay({ label: '수강료', amount: 390000, frequency: 'one_time', role: 'one_time_cashflow', day_of_month: null, date: '2026-11-01' })] }),
  },
  {
    name: '온라인 교육 플랫폼: 콘텐츠 이용권이 핵심',
    kind: 'subscription_membership',
    subtype: 'content_subscription',
    output: contract({ cls: { kind: 'subscription_membership', subtype: 'content_subscription', confidence: 'medium', alternatives: ['education'] }, title: '학습 콘텐츠 플랫폼 이용약관 동의서', payments: [pay({ label: '월 이용료', amount: 19900 })] }),
  },
  {
    name: '통신: 휴대전화 회선 이용료',
    kind: 'telecom',
    subtype: 'mobile',
    output: contract({ cls: { kind: 'telecom', subtype: 'mobile' }, title: '이동전화 서비스 가입신청서', payments: [pay({ label: '월 요금', amount: 69000 })] }),
  },
  {
    name: 'B2B 공급 기본계약: 장기 공급 관계',
    kind: 'business',
    subtype: 'supply',
    output: contract({ cls: { kind: 'business', subtype: 'supply', confidence: 'medium', alternatives: ['sale'] }, title: '물품 공급 기본계약서' }),
  },
];
