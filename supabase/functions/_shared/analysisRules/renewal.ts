/**
 * 자동갱신
 *
 * 규칙 RN1 autoRenewalOf — 자동갱신 여부는 AI의 명시적 autoRenewal 필드만 기준으로 한다.
 *   계약 체크의 주제(auto_renewal)만 보고 true로 추론하지 않는다 (서버·화면 모두).
 *   true → 계약 종료 후에도 반복 결제 계속 / false·없음 → 종료일에서 반복 결제 중단 (앱 계산 paymentCutoff)
 *   사용자가 수정 화면에서 바꾼 값이 항상 우선한다 (저장 값).
 *   예) autoRenewal=false + 체크 주제 auto_renewal "갱신 여부 협의" → false
 * 테스트: notices-rules.test.ts, golden
 */
import type { Extracted } from './types.ts';

export function autoRenewalOf(fields: Record<string, Extracted>): boolean | null {
  const v = fields.autoRenewal?.value;
  return typeof v === 'boolean' ? v : null;
}
