/**
 * AI 체크 문구 규칙 (ARCHITECTURE.md §2.6).
 * AI는 법적 판단을 하지 않는다. 서버 후처리에서도 같은 목록을 사용한다.
 */
export const BANNED_AI_PHRASES = [
  '불법',
  '위법',
  '무효',
  '독소조항',
  '독소 조항',
  '불공정',
  '불리합니다',
  '불리한',
  '유리합니다',
  '유리한',
  '손해를 봅니다',
  '반드시 손해',
  '위험합니다',
  '위험한 계약',
] as const;

export const AI_DISCLAIMER = '계약서 내용을 정리한 것이며 법률 자문이 아닙니다. 중요한 조건은 원문을 함께 확인해주세요.';

/** 사용자에게 보이는 이름 — "독소조항"처럼 단정하지 않는다 */
export const CHECK_SECTION_TITLE = 'PACTO 계약 체크';

export function findBannedPhrases(text: string): string[] {
  return BANNED_AI_PHRASES.filter((p) => text.includes(p));
}
