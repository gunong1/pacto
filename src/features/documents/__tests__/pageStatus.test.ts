/**
 * 페이지별 보호 결과 표시 — 실패 · 처리하지 않음 · 이미 가려진 정보 구분 (2026-10 보험계약서 사례)
 */
import { toProtection } from '@/data/supabase/rowMapping';
import { isProblemPage, pageStatusLabel } from '@/features/documents/protectionCopy';

describe('pageStatusLabel', () => {
  test('실패한 페이지와 앞 단계 실패로 처리하지 않은 페이지를 다르게 표시', () => {
    expect(pageStatusLabel({ status: 'failed', detail: 'verification_failed' })).toBe('보호 처리 실패 · 확인 필요');
    expect(pageStatusLabel({ status: 'skipped', detail: null })).toBe('다른 페이지 문제로 처리하지 않음');
    expect(isProblemPage('failed')).toBe(true);
    expect(isProblemPage('skipped')).toBe(false);
  });

  test('이미 가려진 정보가 있는 페이지 — 검증을 통과한 페이지에만 표시', () => {
    expect(pageStatusLabel({ status: 'no_sensitive_data', detail: null, preMasked: 3 })).toBe('이미 가려진 정보 확인 · 추가 보호 대상 없음');
    expect(pageStatusLabel({ status: 'protected', detail: null, preMasked: 1 })).toBe('민감정보 보호 완료 · 이미 가려진 정보 확인');
    expect(pageStatusLabel({ status: 'failed', detail: 'verification_failed', preMasked: 3 })).toBe('보호 처리 실패 · 확인 필요');
    expect(pageStatusLabel({ status: 'no_sensitive_data', detail: null })).toBe('민감정보 감지되지 않음');
  });
});

describe('protection_pages → 앱 페이지 결과', () => {
  test('preMasked(개수)는 그대로, 실패 단계(stage)는 앱에 넘기지 않음', () => {
    const row = {
      protection_status: 'failed',
      protection_detail: 'verification_failed',
      access_status: null,
      protection_images_unchecked: false,
      protection_pages: [
        { page: 1, kind: 'text', status: 'failed', detail: 'verification_failed', stage: 'verify', preMasked: 3 },
        { page: 2, kind: 'text', status: 'protected', detail: null },
        { page: 3, kind: 'text', status: 'no_sensitive_data', detail: null, preMasked: 0 },
      ],
      analysis_excluded_pages: [],
      analysis_auto_excluded_pages: [],
      protection_view_pages: null,
      document_derivatives: [],
      document_sensitive_regions: [],
    };
    const p = toProtection(row as never);
    expect(p.pages).toEqual([
      { page: 1, kind: 'text', status: 'failed', detail: 'verification_failed', preMasked: 3 },
      { page: 2, kind: 'text', status: 'protected', detail: null },
      { page: 3, kind: 'text', status: 'no_sensitive_data', detail: null },
    ]);
  });
});
