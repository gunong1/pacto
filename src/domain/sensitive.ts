/**
 * 민감정보 보호 (공용 모듈 재노출) — 탐지·가림 기준은 서버 파일 하나 (supabase/functions/_shared/protection/sensitive.ts).
 * 앱은 서버가 저장 전에 가린 값을 보여주고, 화면 표시 직전에만 maskSensitiveTextForDisplay로 한 번 더 가린다 (예전 데이터 방어선).
 * 앱에서 별도의 정규식으로 다시 판단하지 않는다.
 */
export {
  detectSensitive,
  maskSensitiveDeep,
  maskSensitiveText,
  maskSensitiveTextForDisplay,
  SENSITIVE_DISPLAY_FALLBACK,
  SENSITIVE_TYPES,
  shouldMaskSensitive,
  type SensitiveType,
} from '../../supabase/functions/_shared/protection/sensitive';

/** 민감정보 보호를 마치지 못한 문서 — 자동 분석을 하지 않을 때의 안내 (분석 화면·서버 거절 응답 공통) */
export const PROTECTION_REQUIRED_MESSAGE = '민감정보 보호를 완료하지 못해 자동 분석을 진행할 수 없어요.';
