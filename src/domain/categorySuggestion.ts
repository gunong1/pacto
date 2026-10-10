import type { ContractCategory } from './types';

/**
 * 계약명으로 분야를 "추천"한다 (직접 입력 화면). 확정이 아니라 추천이며, 사용자가 언제든 바꿀 수 있다.
 * - 규칙은 아래 CATEGORY_KEYWORD_RULES 한 곳에서 관리한다 — 키워드를 추가할 때는 여기만 고치면 된다.
 * - 애매하면 추천하지 않는다 (null → 기타 유지): 키워드가 없거나, 서로 다른 분야의 키워드가 함께 있으면.
 *
 * 키워드 규칙
 * - 키워드는 공백 없이 소문자로 적는다 ("LG U+" → 'lgu+'). 대소문자는 구분하지 않는다.
 * - 한글·기호가 섞인 키워드는 계약명에서 공백을 뺀 뒤 포함 여부로 찾는다 ('디즈니플러스' ⊂ '디즈니 플러스').
 * - 영문·숫자만으로 된 키워드(youtube·kt·pt …)는 낱말 단위로 찾는다 — 앞뒤가 다른 영문자면 아님 ('skt'·'ktx'에서 'kt', 'optimal'에서 'pt'를 찾지 않음).
 */
export interface CategoryKeywordRule {
  category: ContractCategory;
  keywords: readonly string[];
}

export const CATEGORY_KEYWORD_RULES: readonly CategoryKeywordRule[] = [
  {
    category: 'subscription',
    keywords: ['구독', '유튜브', 'youtube', '넷플릭스', 'netflix', '티빙', 'tving', '디즈니+', '디즈니플러스', 'disney+', 'disneyplus', '왓챠', 'watcha', '웨이브', 'wavve', '쿠팡플레이', '스포티파이', 'spotify', '멜론', '지니뮤직', '애플뮤직', 'applemusic', '애플tv', 'appletv'],
  },
  {
    category: 'membership',
    keywords: ['헬스', '피트니스', 'fitness', 'pt', '퍼스널트레이닝', '필라테스', '요가', '크로스핏', '회원권'],
  },
  {
    category: 'telecom',
    keywords: ['skt', 'sk텔레콤', 'kt', 'lgu+', 'lg유플러스', '유플러스', '알뜰폰', '통신', '휴대폰요금', '핸드폰요금'],
  },
  {
    category: 'insurance',
    keywords: ['보험', '실손', '실비', '삼성화재', '메리츠화재', '현대해상', 'db손해', 'kb손해', '삼성생명', '한화생명', '교보생명'],
  },
  {
    category: 'rental',
    keywords: ['렌탈', '정수기', '비데', '안마의자', '코웨이', '청호나이스', 'sk매직'],
  },
];

interface Normalized {
  /** 소문자 (공백 유지) — 영문 낱말 비교용 */
  lower: string;
  /** 소문자 + 공백 제거 — 한글·기호 키워드 비교용 */
  compact: string;
}

function contains(t: Normalized, keyword: string): boolean {
  if (!/^[a-z0-9]+$/.test(keyword)) return t.compact.includes(keyword);
  // 영문 키워드: 앞뒤에 다른 영문자가 붙어 있으면 다른 낱말 (숫자·한글·공백은 괜찮음: 'pt30회', 'kt인터넷', 'youtube premium')
  return new RegExp(`(^|[^a-z])${keyword}($|[^a-z])`).test(t.lower);
}

export interface CategorySuggestion {
  category: ContractCategory;
  /** 찾은 키워드 (화면에는 쓰지 않음, 테스트·디버그용) */
  keyword: string;
}

/** 계약명 → 추천 분야. 키워드가 없거나 여러 분야에 걸치면 null (기타 유지) */
export function suggestCategory(title: string, rules: readonly CategoryKeywordRule[] = CATEGORY_KEYWORD_RULES): CategorySuggestion | null {
  const lower = title.toLowerCase();
  const text: Normalized = { lower, compact: lower.replace(/\s+/g, '') };
  if (!text.compact) return null;
  const hits = new Map<ContractCategory, string>();
  for (const rule of rules) {
    const kw = rule.keywords.find((k) => contains(text, k));
    if (kw) hits.set(rule.category, kw);
  }
  if (hits.size !== 1) return null;
  const [[category, keyword]] = [...hits];
  return { category, keyword };
}

/** '구독으로' · '렌탈로' — 받침에 따라 (으)로 */
export function withRo(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${word}(으)로`;
  const jong = (last - 0xac00) % 28;
  return `${word}${jong === 0 || jong === 8 ? '로' : '으로'}`;
}
