/**
 * AI 전송 게이트 — 보호가 확인된 문서만 AI에 보낸다 (fail-closed). 일반 문서·암호 PDF 모두 같은 원칙.
 *   protected + 보호본 있음 → 보호본만
 *   no_sensitive_data(민감정보 없음으로 검증) → 원본 (암호 PDF는 메모리 복호화 사본)
 *   그 밖(failed · unreadable · unsupported_scan · unsupported_encryption · 처리 전 · 알 수 없음 · 보호본 없음) → 분석하지 않음
 * 보호 실패 시 원본으로 대신 보내는 경로는 없다.
 * 테스트: security/pipeline-security.test.ts
 */
export type AiInputPlan = { kind: 'protected_view' } | { kind: 'original' } | { kind: 'decrypted_original' } | { kind: 'blocked'; code: 'protection_required' };

export function aiInputPlan(doc: { protectionStatus: string | null | undefined; encrypted: boolean; hasProtectedView: boolean }): AiInputPlan {
  if (doc.protectionStatus === 'protected') return doc.hasProtectedView ? { kind: 'protected_view' } : { kind: 'blocked', code: 'protection_required' };
  if (doc.protectionStatus === 'no_sensitive_data') return doc.encrypted ? { kind: 'decrypted_original' } : { kind: 'original' };
  return { kind: 'blocked', code: 'protection_required' };
}
