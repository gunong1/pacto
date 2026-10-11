/**
 * 계약 종류 (contract_kind) — 분류 개편 후 기준값. 이전 테스트는 "종류 → 내부 유형·분야" 변환을 검사했다.
 * 바뀐 기대: 종류는 13개(자동차는 대상이라 없음), 내부 유형·분야는 하위 호환값일 뿐 종류를 다시 정하지 않는다.
 */
import { CONTRACT_CATEGORIES, CONTRACT_TYPES } from '../contractTypes';
import { CONTRACT_KINDS, kindDisplay, legacyKindLabel, legacyOf, profileKeyOf } from '../contractKinds';

test('13개 종류, 순서대로 (자동차 없음)', () => {
  expect(CONTRACT_KINDS.map((k) => k.label)).toEqual(['근로', '부동산·임대차', '대출', '보험', '통신', '구독·회원권', '렌탈', '할부', '매매', '용역·프리랜서', '교육', '사업·거래', '기타']);
});

test('하위 호환값·관리 프로필은 기존 유형·분야 코드 (DB 구조 그대로)', () => {
  for (const k of CONTRACT_KINDS) {
    expect(CONTRACT_TYPES).toContain(k.legacy.type);
    expect(CONTRACT_CATEGORIES).toContain(k.legacy.category);
    expect(CONTRACT_TYPES).toContain(k.profile);
  }
  expect(legacyOf('subscription_membership')).toEqual({ contractType: 'recurring', category: 'subscription' });
});

test('계약 종류가 있으면 종류로 표시·프로필, 없으면(기존 계약) 예전 이름', () => {
  expect(kindDisplay({ contractKind: 'insurance', contractSubtype: 'auto', contractType: 'insurance', category: 'insurance' })).toEqual({ label: '보험', subtypeLabel: '자동차보험', legacy: false });
  expect(profileKeyOf({ contractKind: 'rental', contractType: 'other' })).toBe('recurring');
  expect(profileKeyOf({ contractKind: null, contractType: 'loan' })).toBe('loan');
  // 예전 화면 이름 그대로 (모든 유형·분야 조합이 이름 하나로 보인다)
  expect(legacyKindLabel('recurring', 'vehicle')).toBe('자동차');
  expect(legacyKindLabel('installment', 'finance')).toBe('할부');
  expect(legacyKindLabel('one_time', 'other')).toBe('기타');
  for (const t of CONTRACT_TYPES) for (const c of CONTRACT_CATEGORIES) expect(legacyKindLabel(t, c)).toBeTruthy();
});
