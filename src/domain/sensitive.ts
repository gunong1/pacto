/**
 * 민감정보 탐지·가림 (공용 모듈 재노출) — 앱에서는 표시 직전 재마스킹에 쓴다.
 * 서버가 저장 전에 이미 가리지만, 이전에 저장된 값도 화면에 원문이 나오지 않도록 한 번 더 가린다.
 */
export { detectSensitive, maskLevel1Text, SENSITIVE_TYPES, type SensitiveType } from '../../supabase/functions/_shared/protection/sensitive';
