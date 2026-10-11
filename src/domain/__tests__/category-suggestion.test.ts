/**
 * 계약명으로 계약 종류 추천 (직접 입력) — 확신할 때만 추천, 애매하면 null
 * 분류 개편: 별도 규칙표(CATEGORY_KEYWORD_RULES · 분야 코드) 대신 레지스트리 계약 종류 정의의 nameHints를 쓴다
 *   (자동 분석·직접 입력·수정 화면이 같은 종류 정의). 이전 기대: 분야 subscription/membership → 바뀐 기대: 종류 subscription_membership
 */
import { CONTRACT_KIND_DEFS } from '../../../supabase/functions/_shared/contractRegistry';
import { suggestKind, withRo } from '@/domain/categorySuggestion';

const kind = (t: string) => suggestKind(t)?.kind ?? null;

test.each([
  ['유튜브 프리미엄', 'subscription_membership'],
  ['YouTube Premium', 'subscription_membership'],
  ['넷플릭스', 'subscription_membership'],
  ['티빙', 'subscription_membership'],
  ['디즈니+', 'subscription_membership'],
  ['디즈니 플러스', 'subscription_membership'],
  ['왓챠', 'subscription_membership'],
  ['헬스장', 'subscription_membership'],
  ['PT 30회', 'subscription_membership'],
  ['OO 피트니스', 'subscription_membership'],
  ['SKT', 'telecom'],
  ['KT 인터넷', 'telecom'],
  ['LG U+', 'telecom'],
  ['알뜰폰 요금제', 'telecom'],
  ['자동차보험', 'insurance'],
  ['삼성화재 운전자', 'insurance'],
  ['코웨이 정수기', 'rental'],
  ['SK매직 정수기', 'rental'],
  ['안마의자 렌탈', 'rental'],
])('%s → %s', (title, expected) => expect(kind(title)).toBe(expected));

test.each([
  ['', '빈 이름'],
  ['월세', '단서 없음'],
  ['KTX 정기권', "'ktx'의 kt는 통신이 아님"],
  ['Optimal 플랜', "'optimal'의 pt는 PT가 아님"],
  ['SKT 유튜브 프리미엄 결합', '두 종류가 섞임 → 애매'],
  ['헬스장 보험', '두 종류가 섞임 → 애매'],
])('%s → 추천 안 함 (%s)', (title) => expect(kind(title)).toBeNull());

test('단서는 계약 종류 정의 안에 · 공백 없는 소문자', () => {
  for (const k of CONTRACT_KIND_DEFS) for (const h of k.nameHints ?? []) expect(h).toBe(h.toLowerCase().replace(/\s+/g, ''));
});

test('종류 정의를 넘기면 그 정의로 (단서 추가가 쉬움)', () => {
  expect(suggestKind('밀리의 서재', [...CONTRACT_KIND_DEFS, { code: 'subscription_membership', nameHints: ['밀리의서재'] }])?.kind).toBe('subscription_membership');
});

test('조사: 구독으로 · 렌탈로 · 회원권으로 · 통신으로', () => {
  expect(['구독', '렌탈', '회원권', '통신', '보험'].map(withRo)).toEqual(['구독으로', '렌탈로', '회원권으로', '통신으로', '보험으로']);
});
