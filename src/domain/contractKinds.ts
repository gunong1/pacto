import type { ContractCategory, ContractType } from './contractTypes';

/**
 * 사용자가 고르는 "계약 종류" 하나 → 내부 계약 유형(contract_type) + 분야(category).
 * 화면에는 종류만 보여주고 유형·분야를 따로 고르게 하지 않는다 (예: 보험 → insurance/insurance).
 * DB의 contract_type·category는 그대로 — 애매한 계약만 "상세 분류"에서 내부 값을 직접 바꾼다.
 */
export interface ContractKindDef {
  code: string;
  label: string;
  type: ContractType;
  category: ContractCategory;
  examples: string;
}

export const CONTRACT_KINDS: readonly ContractKindDef[] = [
  { code: 'employment', label: '근로', type: 'employment', category: 'employment', examples: '정규직 · 계약직 · 아르바이트' },
  { code: 'lease', label: '부동산·임대차', type: 'lease', category: 'real_estate', examples: '전세 · 월세 · 반전세 · 상가 임대차' },
  { code: 'loan', label: '대출', type: 'loan', category: 'finance', examples: '신용 · 담보 · 전세자금 대출' },
  { code: 'insurance', label: '보험', type: 'insurance', category: 'insurance', examples: '자동차 · 실손 · 종신 · 화재 보험' },
  { code: 'vehicle', label: '자동차', type: 'recurring', category: 'vehicle', examples: '자동차 리스 · 장기렌트 (할부 구매는 "할부")' },
  { code: 'telecom', label: '통신', type: 'recurring', category: 'telecom', examples: '휴대폰 · 인터넷 · IPTV' },
  { code: 'subscription', label: '구독·회원권', type: 'recurring', category: 'subscription', examples: 'OTT · 음악 · 헬스장 · 필라테스' },
  { code: 'rental', label: '렌탈', type: 'recurring', category: 'rental', examples: '정수기 · 비데 · 안마의자' },
  { code: 'installment', label: '할부', type: 'installment', category: 'vehicle', examples: '자동차 할부 · 물품 할부 구매' },
  { code: 'sale', label: '매매', type: 'sale', category: 'sale', examples: '부동산 · 자동차 · 자산 매매' },
  { code: 'service', label: '용역·프리랜서', type: 'service', category: 'service', examples: '외주 · 프리랜서 · 위탁 업무 · 유지보수' },
  { code: 'education', label: '교육', type: 'recurring', category: 'education', examples: '학원 · 과외 · 온라인 강의' },
  { code: 'business', label: '사업·거래', type: 'other', category: 'business', examples: '공급 · 대리점 · 업무 제휴' },
  { code: 'other', label: '기타', type: 'other', category: 'other', examples: '위에 해당하지 않는 계약' },
];

const BY_CODE = new Map(CONTRACT_KINDS.map((k) => [k.code, k]));

export function contractKind(code: string): ContractKindDef | undefined {
  return BY_CODE.get(code);
}

/** 구조가 분명한 유형은 유형으로, 월 납입형·일회성·기타는 분야로 종류를 정한다 */
const KIND_BY_TYPE: Partial<Record<string, string>> = {
  employment: 'employment',
  lease: 'lease',
  loan: 'loan',
  insurance: 'insurance',
  installment: 'installment',
  sale: 'sale',
  service: 'service',
};
const KIND_BY_CATEGORY: Partial<Record<string, string>> = {
  employment: 'employment',
  real_estate: 'lease',
  finance: 'loan',
  insurance: 'insurance',
  vehicle: 'vehicle',
  telecom: 'telecom',
  subscription: 'subscription',
  membership: 'subscription',
  rental: 'rental',
  sale: 'sale',
  service: 'service',
  education: 'education',
  business: 'business',
};

export interface KindMatch {
  kind: ContractKindDef;
  /** 저장된 유형·분야가 종류의 기본값과 정확히 같음 (아니면 "상세 분류"로 따로 정한 값) */
  exact: boolean;
}

/** 저장된 유형·분야 → 화면에 보여줄 종류 */
export function kindOf(type: ContractType, category: ContractCategory): KindMatch {
  const exact = CONTRACT_KINDS.find((k) => k.type === type && k.category === category);
  if (exact) return { kind: exact, exact: true };
  // 회원권은 "구독·회원권"의 다른 분야 — 상세 분류가 아니라 같은 종류로 본다
  if (type === 'recurring' && category === 'membership') return { kind: BY_CODE.get('subscription')!, exact: true };
  const code = KIND_BY_TYPE[type] ?? KIND_BY_CATEGORY[category] ?? 'other';
  return { kind: BY_CODE.get(code)!, exact: false };
}

/** 계약명 추천 분야 → 종류 (추천이 없으면 null) */
export function kindForCategory(category: ContractCategory | null | undefined): ContractKindDef | null {
  if (!category || category === 'other') return null;
  const code = KIND_BY_CATEGORY[category];
  return code ? BY_CODE.get(code)! : null;
}
