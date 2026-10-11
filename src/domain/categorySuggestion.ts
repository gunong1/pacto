import { CONTRACT_KIND_DEFS, type ContractKindDef } from '../../supabase/functions/_shared/contractRegistry';

/**
 * 계약명으로 계약 종류를 "추천"한다 (직접 입력 화면). AI 분류가 아니고 확정도 아니다 — 사용자가 언제든 바꿀 수 있다.
 * - 단서 단어는 별도 규칙표가 아니라 공용 레지스트리의 계약 종류 정의(CONTRACT_KIND_DEFS.nameHints)에 있다
 *   (자동 분석·직접 입력·수정 화면이 같은 종류 정의를 쓴다).
 * - 애매하면 추천하지 않는다 (null): 단서가 없거나, 서로 다른 종류의 단서가 함께 있으면.
 *
 * 키워드 규칙
 * - 키워드는 공백 없이 소문자로 적는다 ("LG U+" → 'lgu+'). 대소문자는 구분하지 않는다.
 * - 한글·기호가 섞인 키워드는 계약명에서 공백을 뺀 뒤 포함 여부로 찾는다 ('디즈니플러스' ⊂ '디즈니 플러스').
 * - 영문·숫자만으로 된 키워드(youtube·kt·pt …)는 낱말 단위로 찾는다 — 앞뒤가 다른 영문자면 아님 ('skt'·'ktx'에서 'kt', 'optimal'에서 'pt'를 찾지 않음).
 */
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

export interface KindSuggestion {
  kind: string;
  /** 찾은 키워드 (화면에는 쓰지 않음, 테스트·디버그용) */
  keyword: string;
}

/** 계약명 → 추천 계약 종류. 단서가 없거나 여러 종류에 걸치면 null (추천 없음) */
export function suggestKind(title: string, kinds: readonly Pick<ContractKindDef, 'code' | 'nameHints'>[] = CONTRACT_KIND_DEFS): KindSuggestion | null {
  const lower = title.toLowerCase();
  const text: Normalized = { lower, compact: lower.replace(/\s+/g, '') };
  if (!text.compact) return null;
  const hits = new Map<string, string>();
  for (const k of kinds) {
    const kw = (k.nameHints ?? []).find((h) => contains(text, h));
    if (kw) hits.set(k.code, kw);
  }
  if (hits.size !== 1) return null;
  const [[kind, keyword]] = [...hits];
  return { kind, keyword };
}

/** '구독으로' · '렌탈로' — 받침에 따라 (으)로 */
export function withRo(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${word}(으)로`;
  const jong = (last - 0xac00) % 28;
  return `${word}${jong === 0 || jong === 8 ? '로' : '으로'}`;
}
