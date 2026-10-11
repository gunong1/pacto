/** 계약 종류 하나 → 내부 유형·분야 (사용자는 한 번만 고른다) */
import { CONTRACT_CATEGORIES, CONTRACT_TYPES } from '../contractTypes';
import { CONTRACT_KINDS, contractKind, kindForCategory, kindOf } from '../contractKinds';

test('요청한 14개 종류, 순서대로', () => {
  expect(CONTRACT_KINDS.map((k) => k.label)).toEqual(['근로', '부동산·임대차', '대출', '보험', '자동차', '통신', '구독·회원권', '렌탈', '할부', '매매', '용역·프리랜서', '교육', '사업·거래', '기타']);
});

test.each([
  ['insurance', 'insurance', 'insurance'],
  ['loan', 'loan', 'finance'],
  ['lease', 'lease', 'real_estate'],
  ['subscription', 'recurring', 'subscription'],
  ['vehicle', 'recurring', 'vehicle'],
  ['installment', 'installment', 'vehicle'],
  ['employment', 'employment', 'employment'],
])('%s → contract_type %s · category %s', (code, type, category) => {
  expect(contractKind(code)).toMatchObject({ type, category });
});

test('모든 종류의 내부 값은 기존 유형·분야 코드 (DB 구조 그대로)', () => {
  for (const k of CONTRACT_KINDS) {
    expect(CONTRACT_TYPES).toContain(k.type);
    expect(CONTRACT_CATEGORIES).toContain(k.category);
  }
});

test('저장된 값 → 종류 (기본값과 같으면 그대로, 다르면 "상세 분류"로 정한 값)', () => {
  expect(kindOf('insurance', 'insurance')).toMatchObject({ kind: { code: 'insurance' }, exact: true });
  expect(kindOf('recurring', 'membership')).toMatchObject({ kind: { code: 'subscription' }, exact: true });
  // 물품 할부 (분야 금융) → 할부, 상세 분류
  expect(kindOf('installment', 'finance')).toMatchObject({ kind: { code: 'installment' }, exact: false });
  // 일회성 공사 계약 → 기타, 상세 분류
  expect(kindOf('one_time', 'other')).toMatchObject({ kind: { code: 'other' }, exact: false });
  // 월 납입형 + 부동산(관리 용역 등) → 분야 기준 부동산·임대차, 상세 분류
  expect(kindOf('recurring', 'real_estate')).toMatchObject({ kind: { code: 'lease' }, exact: false });
  // 모든 유형·분야 조합이 종류 하나로 보인다
  for (const t of CONTRACT_TYPES) for (const c of CONTRACT_CATEGORIES) expect(kindOf(t, c).kind).toBeDefined();
});

test('계약명 추천 분야 → 종류', () => {
  expect(kindForCategory('membership')?.code).toBe('subscription');
  expect(kindForCategory('insurance')?.code).toBe('insurance');
  expect(kindForCategory('other')).toBeNull();
  expect(kindForCategory(null)).toBeNull();
});
