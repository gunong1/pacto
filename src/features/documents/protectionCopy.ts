import type { DocumentProtection, SensitiveRegion } from '@/domain/types';

/** 민감정보 종류 이름 (사용자 화면) */
export const SENSITIVE_TYPE_LABEL: Record<string, string> = {
  resident_registration_number: '주민등록번호',
  foreigner_registration_number: '외국인등록번호',
  passport_number: '여권번호',
  driver_license_number: '운전면허번호',
  credit_card: '카드번호',
  bank_account: '계좌번호',
  phone: '연락처',
  email: '이메일',
  address: '주소',
  signature: '서명',
  stamp: '도장',
  name: '이름',
  other: '개인정보',
};

export const sensitiveLabel = (t: string) => SENSITIVE_TYPE_LABEL[t] ?? '개인정보';

/** "주민등록번호 1건 · 연락처 1건" — 가린 항목 기준 */
export function maskedSummary(regions: SensitiveRegion[]): { total: number; text: string } {
  const masked = regions.filter((r) => r.state === 'masked');
  const counts = new Map<string, number>();
  for (const r of masked) counts.set(sensitiveLabel(r.type), (counts.get(sensitiveLabel(r.type)) ?? 0) + 1);
  return { total: masked.length, text: [...counts].map(([k, n]) => `${k} ${n}건`).join(' · ') };
}

/** 확인이 필요한 항목: 확신이 보통인데 아직 확인하지 않음 / 확신이 낮아 가리지 않은 후보 */
export const needsReview = (r: SensitiveRegion) => (r.confidence === 'medium' && !r.userConfirmed) || r.state === 'candidate';

export type ProtectionTone = 'protected' | 'neutral' | 'warning';

/**
 * 상태별 문구 — 단정하지 않는다 ("100% 안전", "민감정보가 없습니다" 같은 표현 금지).
 * unsupported_scan을 보호됨처럼 보이게 하지 않는다.
 */
export function protectionCopy(p: DocumentProtection | undefined): { title: string; body: string; tone: ProtectionTone } | null {
  if (!p) return null;
  switch (p.status) {
    case 'protected': {
      const { total, text } = maskedSummary(p.regions);
      return total > 0
        ? { title: '민감정보를 보호했어요', body: `${text}\n자동으로 찾아 가려서 표시합니다.`, tone: 'protected' }
        : { title: '민감정보 보호', body: '찾은 개인정보를 모두 표시하도록 설정했어요.', tone: 'neutral' };
    }
    case 'no_sensitive_data':
      return { title: '민감정보가 감지되지 않았어요', body: '자동 탐지가 모든 정보를 찾는 것을 보장하지는 않습니다. 중요한 문서는 원본도 확인해주세요.', tone: 'neutral' };
    case 'unreadable':
      // 사진·스캔 페이지를 충분히 읽지 못함 — "민감정보 없음"으로 보이지 않게
      return { title: '민감정보 보호를 완료하지 못했어요', body: `문서 일부를 정확하게 읽지 못했습니다.${pagesNote(p, 'unreadable')} 원본을 직접 확인해주세요.`, tone: 'warning' };
    case 'unsupported_scan':
      // 자동 보호 이전에 등록한 사진·스캔 PDF — 지금은 보호할 수 있다 (보호하기 버튼)
      if (p.detail === 'image_file') {
        return { title: '민감정보 보호 전이에요', body: '사진 속 주민등록번호·계좌번호 등을 찾아 가려서 표시할 수 있어요.', tone: 'neutral' };
      }
      if (p.detail === LEGACY_SCAN_DETAIL) {
        return { title: '민감정보 보호 전이에요', body: '스캔 페이지 속 주민등록번호·계좌번호 등을 찾아 가려서 표시할 수 있어요.', tone: 'neutral' };
      }
      if (p.detail === 'too_many_scan_pages') {
        return {
          title: `스캔 페이지가 ${MAX_SCAN_PAGES}쪽을 넘어 자동 가리기를 하지 않았어요`,
          body: `스캔 페이지가 ${MAX_SCAN_PAGES}쪽 이하인 문서만 자동으로 가릴 수 있어요. 문서를 나눠서 올려주세요. 원본은 비공개로 보관돼요.`,
          tone: 'warning',
        };
      }
      // 정말 특수한 PDF만 (CCITT·JBIG2·JPEG2000·CMYK·특수 색공간·여러 이미지로 나뉜 페이지 등)
      return {
        title: '자동 가리기를 지원하지 않는 형식의 페이지가 있어요',
        body: `특수한 형식으로 저장된 페이지는 아직 자동으로 가리지 못해요.${pagesNote(p, 'unsupported_scan')} 원본은 비공개로 보관돼요.`,
        tone: 'warning',
      };
    case 'failed':
      return { title: '민감정보 보호 처리 중 문제가 발생했어요.', body: `${failedReason(p.detail)}${pageList(p, 'failed') ? `문제가 생긴 페이지: ${pageList(p, 'failed')}. ` : ''}원본은 비공개로 보관돼요.`, tone: 'warning' };
    case 'pending':
      return p.detail === 'preview_mode' ? null : { title: '민감정보 보호 전이에요', body: '계약서 속 주민등록번호·계좌번호 등을 찾아 가려서 표시할 수 있어요.', tone: 'neutral' };
  }
}

/** 한 문서에서 자동으로 가리는 스캔 페이지 최대 수 — 서버 MAX_SCAN_PAGES(protect.ts)와 같게 */
export const MAX_SCAN_PAGES = 20;
/** 스캔 PDF 자동 보호 이전 버전이 남긴 사유 — 지금은 다시 처리할 수 있다 */
const LEGACY_SCAN_DETAIL = 'scanned_pages';

/** "3쪽, 5쪽" — 해당 상태인 페이지 (PDF 페이지별 결과가 있을 때만, 없으면 '') */
function pageList(p: DocumentProtection, status: string): string {
  const pages = (p.pages ?? []).filter((x) => x.status === status).map((x) => `${x.page}쪽`);
  return pages.length === 0 ? '' : `${pages.slice(0, 5).join(', ')}${pages.length > 5 ? ` 외 ${pages.length - 5}개` : ''}`;
}
/** " (3쪽, 5쪽)" */
const pagesNote = (p: DocumentProtection, status: string) => (pageList(p, status) ? ` (${pageList(p, status)})` : '');

/** 실패 사유별 안내 (원문·기술 용어 없이 — 내부 오류 코드를 보여주지 않는다) */
function failedReason(detail: string | null | undefined): string {
  if (detail && /^ocr_(?!layer)|^verification_|^scan_worker|^scan_incomplete/.test(detail)) return '잠시 후 다시 시도해주세요. ';
  if (detail && /^scan_image|^ocr_layer_mismatch/.test(detail)) return '스캔 페이지의 글자 위치를 정확히 확인하지 못해 자동으로 가리지 않았어요. ';
  switch (detail) {
    case 'image_orientation':
    case 'image_format':
    case 'image_decode':
      return '이 사진 형식은 자동으로 가리지 못했어요. 다시 촬영하거나 다른 사진으로 등록해주세요. ';
    case 'encrypted':
      return '암호가 걸린 문서는 자동으로 가릴 수 없어요. ';
    case 'form_fields':
      return '입력 양식이 들어 있는 문서는 아직 자동 가리기를 지원하지 않아요. ';
    case 'unsupported_font':
    case 'undecodable_font':
    case 'text_mismatch':
      return '이 문서에 쓰인 글꼴 형식은 글자 위치를 정확히 확인할 수 없어 자동으로 가리지 않았어요. ';
    case 'too_many_pages':
      return '쪽수가 많은 문서는 아직 자동 가리기를 지원하지 않아요. ';
    default:
      return '자동 가리기를 적용하지 못했어요. 다시 시도해주세요. ';
  }
}

/** 이 문서를 지금 보호 처리할 수 있는지 (처리 전·실패·자동 보호 이전에 등록한 사진·스캔 PDF) */
export const canProtect = (p: DocumentProtection | undefined) =>
  !!p && (p.status === 'pending' || p.status === 'failed' || (p.status === 'unsupported_scan' && (p.detail === 'image_file' || p.detail === LEGACY_SCAN_DETAIL)));

/**
 * 여러 장(문서)의 전체 보호 상태 — 보수적으로: 모든 장이 보호됨 또는 감지되지 않음일 때만 완료.
 * 하나라도 읽지 못함·실패·미지원·처리 전이면 "일부 완료하지 못함"
 */
export function overallProtectionCopy(list: (DocumentProtection | undefined)[]): { title: string; tone: ProtectionTone } | null {
  const ps = list.filter((p): p is DocumentProtection => !!p && !(p.status === 'pending' && p.detail === 'preview_mode'));
  if (ps.length === 0) return null;
  if (ps.length === 1) {
    const c = protectionCopy(ps[0]);
    return c ? { title: c.title, tone: c.tone } : null;
  }
  const done = ps.every((p) => p.status === 'protected' || p.status === 'no_sensitive_data');
  if (!done) return { title: '일부 페이지의 민감정보 보호를 완료하지 못했어요', tone: 'warning' };
  const masked = ps.reduce((n, p) => n + p.regions.filter((r) => r.state === 'masked').length, 0);
  return masked > 0 ? { title: '민감정보를 보호했어요', tone: 'protected' } : { title: '민감정보가 감지되지 않았어요', tone: 'neutral' };
}

export const PROTECTION_DISCLAIMER = 'PACTO가 민감정보를 자동으로 찾아 보호합니다. 중요한 문서는 원본을 직접 확인해주세요.';
export const IMAGES_UNCHECKED_NOTE = '문서 안에 이미지(서명·신분증 사본 등)로 들어간 내용은 확인하지 못했어요.';
