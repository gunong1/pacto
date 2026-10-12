/**
 * AI 전송 게이트 — 보호가 확인된 문서만 AI에 보낸다 (fail-closed). 일반 문서·암호 PDF 모두 같은 원칙.
 *   protected + 보호본 있음 → 보호본만
 *   no_sensitive_data(민감정보 없음으로 검증) → 원본 (암호 PDF는 메모리 복호화 사본)
 *   그 밖(failed · unreadable · unsupported_scan · unsupported_encryption · 처리 전 · 알 수 없음 · 보호본 없음) → 분석하지 않음
 * 보호 실패 시 원본으로 대신 보내는 경로는 없다.
 *
 * 사용자가 페이지를 뺀 문서 (selection.pages = 분석할 원본 페이지):
 *   남은 페이지가 모두 보호 검증(protected · no_sensitive_data)을 통과해야 한다 — 하나라도 아니면 분석하지 않음
 *   protected → 남은 페이지로만 만든 보호본, 그 보호본의 페이지가 지금 선택과 같을 때만 (선택이 바뀌면 예전 보호본을 쓰지 않음)
 *   no_sensitive_data → 원본(암호 PDF는 메모리 복호화 사본)에서 남은 페이지만 메모리에서 잘라 보낸다 (제외한 페이지는 보내지 않음)
 * 테스트: security/pipeline-security.test.ts
 */
export type AiInputPlan =
  | { kind: 'protected_view' }
  | { kind: 'original' }
  | { kind: 'decrypted_original' }
  /** 남은 페이지만 메모리에서 잘라 보냄 (민감정보 없음으로 검증된 페이지만) */
  | { kind: 'original_subset'; pages: number[] }
  | { kind: 'decrypted_subset'; pages: number[] }
  | { kind: 'blocked'; code: 'protection_required' };

export interface PageSelectionInput {
  /** 분석할 원본 페이지 (null = 선택 없음, 모든 페이지) */
  pages: number[] | null;
  /** 보호본에 담긴 원본 페이지 (null = 전체 또는 보호본 없음) */
  viewPages: number[] | null;
  /** 페이지별 보호 결과 */
  pageStatuses: readonly { page: number; status: string }[] | null;
}

const VERIFIED = new Set(['protected', 'no_sensitive_data']);
const same = (a: readonly number[] | null, b: readonly number[] | null) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

export function aiInputPlan(doc: { protectionStatus: string | null | undefined; encrypted: boolean; hasProtectedView: boolean; selection?: PageSelectionInput }): AiInputPlan {
  const sel = doc.selection;
  if (sel?.pages) {
    const pages = sel.pages;
    const verified = pages.length > 0 && pages.every((p) => VERIFIED.has(sel.pageStatuses?.find((x) => x.page === p)?.status ?? ''));
    if (!verified) return { kind: 'blocked', code: 'protection_required' };
    if (doc.protectionStatus === 'protected') return doc.hasProtectedView && same(sel.viewPages, pages) ? { kind: 'protected_view' } : { kind: 'blocked', code: 'protection_required' };
    if (doc.protectionStatus === 'no_sensitive_data') return doc.encrypted ? { kind: 'decrypted_subset', pages } : { kind: 'original_subset', pages };
    return { kind: 'blocked', code: 'protection_required' };
  }
  // 선택이 없는데 보호본이 일부 페이지만 담고 있으면(선택이 바뀐 뒤 다시 보호하지 않음) 쓰지 않는다
  if (sel?.viewPages) return { kind: 'blocked', code: 'protection_required' };
  if (doc.protectionStatus === 'protected') return doc.hasProtectedView ? { kind: 'protected_view' } : { kind: 'blocked', code: 'protection_required' };
  if (doc.protectionStatus === 'no_sensitive_data') return doc.encrypted ? { kind: 'decrypted_original' } : { kind: 'original' };
  return { kind: 'blocked', code: 'protection_required' };
}
