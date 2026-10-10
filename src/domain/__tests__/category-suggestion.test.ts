/** 계약명으로 분야 추천 — 확신할 때만 추천, 애매하면 null(기타 유지) */
import { CATEGORY_KEYWORD_RULES, suggestCategory, withRo } from '@/domain/categorySuggestion';
import { CONTRACT_CATEGORIES } from '@/domain/types';

const cat = (t: string) => suggestCategory(t)?.category ?? null;

test.each([
  ['유튜브 프리미엄', 'subscription'],
  ['YouTube Premium', 'subscription'],
  ['넷플릭스', 'subscription'],
  ['티빙', 'subscription'],
  ['디즈니+', 'subscription'],
  ['디즈니 플러스', 'subscription'],
  ['왓챠', 'subscription'],
  ['헬스장', 'membership'],
  ['PT 30회', 'membership'],
  ['OO 피트니스', 'membership'],
  ['SKT', 'telecom'],
  ['KT 인터넷', 'telecom'],
  ['LG U+', 'telecom'],
  ['알뜰폰 요금제', 'telecom'],
  ['자동차보험', 'insurance'],
  ['삼성화재 운전자', 'insurance'],
  ['코웨이 정수기', 'rental'],
  ['SK매직 정수기', 'rental'],
  ['안마의자 렌탈', 'rental'],
])('%s → %s', (title, expected) => expect(cat(title)).toBe(expected));

test.each([
  ['', '빈 이름'],
  ['월세', '키워드 없음'],
  ['KTX 정기권', "'ktx'의 kt는 통신이 아님"],
  ['Optimal 플랜', "'optimal'의 pt는 PT가 아님"],
  ['SKT 유튜브 프리미엄 결합', '두 분야가 섞임 → 애매'],
  ['헬스장 보험', '두 분야가 섞임 → 애매'],
])('%s → 추천 안 함 (%s)', (title) => expect(cat(title)).toBeNull());

test('규칙의 분야는 모두 실제 분야 코드 · 키워드는 공백 없는 소문자', () => {
  for (const r of CATEGORY_KEYWORD_RULES) {
    expect(CONTRACT_CATEGORIES).toContain(r.category);
    for (const k of r.keywords) expect(k).toBe(k.toLowerCase().replace(/\s+/g, ''));
  }
});

test('규칙을 넘기면 그 규칙으로 (키워드 추가가 쉬움)', () => {
  expect(suggestCategory('밀리의 서재', [...CATEGORY_KEYWORD_RULES, { category: 'subscription', keywords: ['밀리의서재'] }])?.category).toBe('subscription');
});

test('조사: 구독으로 · 렌탈로 · 회원권으로 · 통신으로', () => {
  expect(['구독', '렌탈', '회원권', '통신', '보험'].map(withRo)).toEqual(['구독으로', '렌탈로', '회원권으로', '통신으로', '보험으로']);
});
