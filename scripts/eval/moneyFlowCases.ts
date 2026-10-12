/**
 * 지급자·수령자(payer/payee) 추출 평가 세트 — 전부 가짜(synthetic) 계약서다. 실제 계약서·개인정보를 넣지 않는다.
 * payments[].payer / payee: 계약서 문장이 "누가 누구에게" 밝힌 경우의 역할 코드. null = 계약서에 근거가 없음 → AI가 비워야 한다 (채우면 "추측")
 * payments[].direction: 서버 규칙(F1)을 거친 뒤 기대하는 방향 — 분석 단계에서는 사용자 역할을 모르므로 모두 neutral(방향 확인 필요).
 *   렌탈·구독처럼 사용자가 보통 고객인 종류도 앱이 "추천"만 하고, 사용자가 확인한 역할로 방향을 정한다.
 * payer/payee 기대값은 서버의 같은 자리 연결(렌탈 계약서의 임차인 → 고객) 뒤의 역할 코드다.
 * 금액은 계약마다 서로 달라 금액으로 찾는다.
 */
export interface MoneyFlowExpect {
  amount: number;
  label: string;
  payer: string | null;
  payee: string | null;
  nature: 'ordinary' | 'refundable_deposit';
  direction: 'expense' | 'income' | 'neutral';
}
export interface MoneyFlowCase {
  id: string;
  name: string;
  kind: string;
  text: string;
  payments: MoneyFlowExpect[];
}

export const MONEY_FLOW_CASES: MoneyFlowCase[] = [
  {
    id: 'lease_explicit',
    name: '임대차 — 지급자·수령자 명시',
    kind: 'lease',
    text: `주택 월세 임대차계약서
임대인 김가상(이하 "임대인")과 임차인 이가상(이하 "임차인")은 아래 주택에 관하여 임대차계약을 체결한다.
소재지: 서울특별시 가상구 가상로 1, 101호
제1조 보증금은 금 20,000,000원으로 한다. 임차인은 계약금 2,000,000원을 계약 시에 임대인에게 지급하고, 잔금 18,000,000원은 2026년 11월 20일 임대인에게 지급한다.
제2조 임차인은 차임(월세) 금 850,000원을 매월 20일 임대인에게 지급한다.
제3조 임대차기간은 2026년 11월 20일부터 2028년 11월 19일까지로 한다.
제4조 임대인은 계약이 종료되면 보증금을 임차인에게 반환한다.`,
    payments: [
      { amount: 2_000_000, label: '보증금 계약금', payer: 'lessee', payee: 'lessor', nature: 'refundable_deposit', direction: 'neutral' },
      { amount: 18_000_000, label: '보증금 잔금', payer: 'lessee', payee: 'lessor', nature: 'refundable_deposit', direction: 'neutral' },
      { amount: 850_000, label: '월세', payer: 'lessee', payee: 'lessor', nature: 'ordinary', direction: 'neutral' },
    ],
  },
  {
    id: 'lease_guarantor',
    name: '임대차 — 보증금 잔금을 연대보증인이 지급',
    kind: 'lease',
    text: `상가 임대차계약서
임대인 박가상, 임차인 최가상, 연대보증인 정가상은 다음과 같이 계약한다.
제1조 보증금 금 30,000,000원 중 계약금 3,000,000원은 임차인이 계약 시 임대인에게 지급하고, 잔금 27,000,000원은 연대보증인이 2026년 12월 1일 임대인에게 지급한다.
제2조 월 차임 1,200,000원은 임차인이 매월 1일 임대인에게 지급한다.
제3조 임대차기간: 2026년 12월 1일부터 2028년 11월 30일까지.`,
    payments: [
      { amount: 3_000_000, label: '보증금 계약금', payer: 'lessee', payee: 'lessor', nature: 'refundable_deposit', direction: 'neutral' },
      { amount: 27_000_000, label: '보증금 잔금', payer: 'guarantor', payee: 'lessor', nature: 'refundable_deposit', direction: 'neutral' },
      { amount: 1_200_000, label: '월 차임', payer: 'lessee', payee: 'lessor', nature: 'ordinary', direction: 'neutral' },
    ],
  },
  {
    id: 'lease_silent',
    name: '임대차 — 누가 내는지 문장 없음 (근거 부족)',
    kind: 'lease',
    text: `임대차계약서 (요약형)
임대인 한가상 / 임차인 윤가상
목적물: 경기도 가상시 가상동 2, 202호
보증금: 10,000,000원
월세: 700,000원 (매월 5일)
기간: 2026년 11월 5일 ~ 2028년 11월 4일`,
    payments: [
      { amount: 10_000_000, label: '보증금', payer: null, payee: null, nature: 'refundable_deposit', direction: 'neutral' },
      { amount: 700_000, label: '월세', payer: null, payee: null, nature: 'ordinary', direction: 'neutral' },
    ],
  },
  {
    id: 'employment',
    name: '근로계약 — 사용자가 근로자에게 지급',
    kind: 'employment',
    text: `근로계약서
가나다상사(이하 "사용자")와 홍가상(이하 "근로자")은 다음과 같이 근로계약을 체결한다.
1. 근로개시일: 2026년 11월 2일
2. 업무: 회계 사무 / 근무시간 09:00~18:00, 주 5일
3. 임금: 사용자는 근로자에게 월 3,100,000원을 매월 25일 근로자 명의 계좌로 지급한다.`,
    payments: [{ amount: 3_100_000, label: '월 급여', payer: 'employer', payee: 'employee', nature: 'ordinary', direction: 'neutral' }],
  },
  {
    id: 'sale_car',
    name: '중고차 매매 — 매수인이 매도인에게',
    kind: 'sale',
    text: `자동차 양도증명서 겸 매매계약서
매도인 서가상, 매수인 남가상은 아래 자동차를 매매한다. (차종: 가상 소형 승용, 2021년식)
1. 매매대금은 금 12,000,000원으로 한다.
2. 매수인은 계약금 1,000,000원을 계약일에 매도인에게 지급하고, 잔금 11,000,000원은 2026년 11월 15일 차량 인도와 동시에 매도인에게 지급한다.`,
    payments: [
      { amount: 1_000_000, label: '계약금', payer: 'buyer', payee: 'seller', nature: 'ordinary', direction: 'neutral' },
      { amount: 11_000_000, label: '잔금', payer: 'buyer', payee: 'seller', nature: 'ordinary', direction: 'neutral' },
    ],
  },
  {
    id: 'service',
    name: '용역 — 발주자가 수급자에게',
    kind: 'service',
    text: `웹사이트 제작 용역계약서
발주자 주식회사 가상물산(이하 "갑")과 수급자 가상디자인(이하 "을")은 다음과 같이 용역계약을 체결한다.
제1조 용역 내용: 회사 소개 웹사이트 제작
제2조 계약금액은 금 6,600,000원(부가세 포함)으로 하며, 갑은 착수금 2,200,000원을 계약 후 7일 이내에, 잔금 4,400,000원을 2026년 12월 20일 검수 완료 후 을에게 지급한다.`,
    payments: [
      { amount: 2_200_000, label: '착수금', payer: 'client', payee: 'contractor', nature: 'ordinary', direction: 'neutral' },
      { amount: 4_400_000, label: '잔금', payer: 'client', payee: 'contractor', nature: 'ordinary', direction: 'neutral' },
    ],
  },
  {
    id: 'rental',
    name: '정수기 렌탈 — 고객이 회사에 (사용자가 언제나 고객)',
    kind: 'rental',
    text: `정수기 렌탈 서비스 계약서
렌탈회사 가상워터(이하 "회사")와 고객 장가상(이하 "고객")은 아래와 같이 렌탈계약을 체결한다.
1. 제품: 가상 냉온정수기 1대 / 의무사용기간 36개월 (2026년 11월 ~ 2029년 10월)
2. 고객은 월 렌탈료 29,900원을 매월 10일 회사에 납부한다.
3. 고객은 등록비 100,000원을 설치일에 회사에 납부한다.`,
    payments: [
      { amount: 29_900, label: '월 렌탈료', payer: 'customer', payee: 'provider', nature: 'ordinary', direction: 'neutral' },
      { amount: 100_000, label: '등록비', payer: 'customer', payee: 'provider', nature: 'ordinary', direction: 'neutral' },
    ],
  },
  {
    id: 'rental_deposit_silent',
    name: '렌탈 — 보증금 문장에 누가 내는지 없음 (계약 구조로만 방향)',
    kind: 'rental',
    text: `안마의자 렌탈 약정서
회사: 가상헬스 / 고객: 오가상
렌탈 기간: 2026년 11월 1일 ~ 2028년 10월 31일 (24개월)
월 렌탈료: 59,000원 (매월 15일)
보증금: 300,000원 (계약 종료 시 반환)`,
    payments: [
      { amount: 59_000, label: '월 렌탈료', payer: null, payee: null, nature: 'ordinary', direction: 'neutral' },
      { amount: 300_000, label: '보증금', payer: null, payee: null, nature: 'refundable_deposit', direction: 'neutral' },
    ],
  },
  {
    id: 'rental_lease_terms',
    name: '자동차 장기렌트 — 계약서가 "임대인·임차인"이라고 씀 (렌탈회사·고객으로 연결)',
    kind: 'rental',
    text: `자동차 장기렌트 계약서 (가상)
임대인: 주식회사 가상렌터카 / 대표 가대표    임차인: 나가상
계약기간: 2026년 11월 20일 ~ 2030년 11월 19일 (48개월)
보증금: 4,000,000원 (2026년 11월 20일 1회 지급, 계약 종료 후 정산 반환)
월 렌트료: 589,000원 — 임차인은 매월 20일 월 렌트료를 지정 계좌에서 자동이체한다.
초기 등록대행비: 110,000원 (2026년 11월 20일 1회 지급)
탁송비: 60,000원 (차량 직접 수령 시 발생하지 않는 선택 비용)`,
    payments: [
      { amount: 4_000_000, label: '보증금', payer: null, payee: null, nature: 'refundable_deposit', direction: 'neutral' },
      { amount: 589_000, label: '월 렌트료', payer: 'customer', payee: null, nature: 'ordinary', direction: 'neutral' },
      { amount: 110_000, label: '초기 등록대행비', payer: null, payee: null, nature: 'ordinary', direction: 'neutral' },
    ],
  },
  {
    id: 'loan',
    name: '금전소비대차 — 차주가 대주에게 상환',
    kind: 'loan',
    text: `금전소비대차계약서
대주 문가상(이하 "대주")은 차주 신가상(이하 "차주")에게 금 5,000,000원을 2026년 11월 1일 대여한다.
차주는 2026년 12월부터 매월 1일 원리금 430,000원을 대주에게 상환한다. 이자는 연 5%로 한다.`,
    payments: [{ amount: 430_000, label: '월 원리금 상환', payer: 'borrower', payee: 'lender', nature: 'ordinary', direction: 'neutral' }],
  },
];
