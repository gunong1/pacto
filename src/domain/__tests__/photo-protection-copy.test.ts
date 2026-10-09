/** 사진 보호 화면 문구 · 여러 장 전체 상태(J) · 동시 처리 제한 */
import { canProtect, overallProtectionCopy, protectionCopy } from '@/features/documents/protectionCopy';
import type { DocumentProtection, ProtectionStatus, SensitiveRegion } from '@/domain/types';
import { mapWithConcurrency } from '@/lib/pool';

const region = (type: string, state: SensitiveRegion['state'] = 'masked'): SensitiveRegion =>
  ({ id: `${type}-${Math.random()}`, type, state, page: 1, confidence: 'high', maskedPreview: '***', contextLabel: null, userConfirmed: false, bbox: [] }) as unknown as SensitiveRegion;
const p = (status: ProtectionStatus, regions: SensitiveRegion[] = [], detail: string | null = null): DocumentProtection => ({ status, detail, imagesUnchecked: false, protectedViewPath: status === 'protected' ? 'x' : null, regions, pages: [] });

describe('문구', () => {
  test('보호됨: "민감정보를 보호했어요." + 종류별 건수 + "자동으로 찾아 가려서 표시합니다."', () => {
    const c = protectionCopy(p('protected', [region('resident_registration_number'), region('resident_registration_number'), region('bank_account'), region('credit_card'), region('phone'), region('phone')]))!;
    expect(c.title).toBe('민감정보를 보호했어요');
    expect(c.body).toBe('주민등록번호 2건 · 계좌번호 1건 · 카드번호 1건 · 연락처 2건\n자동으로 찾아 가려서 표시합니다.');
  });
  test('감지되지 않음: 단정하지 않는 문구', () => {
    const c = protectionCopy(p('no_sensitive_data'))!;
    expect(c).toMatchObject({ title: '민감정보가 감지되지 않았어요', body: '자동 탐지가 모든 정보를 찾는 것을 보장하지는 않습니다. 중요한 문서는 원본도 확인해주세요.' });
    expect(c.body).not.toContain('없습니다');
  });
  test('읽지 못함: "민감정보 보호를 완료하지 못했어요." (감지되지 않음과 다르게)', () => {
    expect(protectionCopy(p('unreadable', [], 'low_ocr_quality'))).toMatchObject({ title: '민감정보 보호를 완료하지 못했어요', body: '문서 일부를 정확하게 읽지 못했습니다. 원본을 직접 확인해주세요.', tone: 'warning' });
  });
  test('OCR 오류: 내부 코드를 보여주지 않음', () => {
    for (const d of ['ocr_timeout', 'ocr_server', 'ocr_auth', 'verification_failed']) {
      const c = protectionCopy(p('failed', [], d))!;
      expect(c.title).toBe('민감정보 보호 처리 중 문제가 발생했어요.');
      expect(c.body).toContain('잠시 후 다시 시도해주세요.');
      expect(c.body).not.toContain(d);
    }
  });
  test('"사진은 자동 가리기를 지원하지 않아요" 문구는 없음 — 이전에 등록한 사진은 보호하기 가능', () => {
    const c = protectionCopy(p('unsupported_scan', [], 'image_file'))!;
    expect(c.body).not.toContain('지원하지 않아요');
    expect(canProtect(p('unsupported_scan', [], 'image_file'))).toBe(true);
    expect(canProtect(p('unreadable'))).toBe(false);
  });
});

describe('J. 여러 장 — 모든 장이 보호됨·감지되지 않음일 때만 전체 완료', () => {
  test('보호됨 2 + 감지되지 않음 1 + 읽지 못함 1 → "일부 페이지의 민감정보 보호를 완료하지 못했어요"', () => {
    expect(overallProtectionCopy([p('protected', [region('phone')]), p('protected', [region('bank_account')]), p('no_sensitive_data'), p('unreadable')])).toEqual({ title: '일부 페이지의 민감정보 보호를 완료하지 못했어요', tone: 'warning' });
  });
  test('실패·처리 전이 하나라도 있으면 완료 아님', () => {
    expect(overallProtectionCopy([p('protected', [region('phone')]), p('failed', [], 'ocr_timeout')])!.tone).toBe('warning');
    expect(overallProtectionCopy([p('protected', [region('phone')]), p('pending')])!.tone).toBe('warning');
  });
  test('모두 보호됨·감지되지 않음 → "민감정보를 보호했어요"', () => {
    expect(overallProtectionCopy([p('protected', [region('phone')]), p('no_sensitive_data')])).toEqual({ title: '민감정보를 보호했어요', tone: 'protected' });
    expect(overallProtectionCopy([p('no_sensitive_data'), p('no_sensitive_data')])).toEqual({ title: '민감정보가 감지되지 않았어요', tone: 'neutral' });
  });
});

test('동시 처리 제한: 10장 → 동시에 최대 2장, 결과는 입력 순서대로', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapWithConcurrency([...Array(10).keys()], 2, async (i) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5 + (i % 3) * 3));
    running--;
    return i * 10;
  });
  expect(peak).toBe(2);
  expect(out).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
});

describe('스캔 PDF 문구 — unsupported_scan은 정말 특수한 PDF에만', () => {
  const pages = (list: [number, 'text' | 'scan' | 'unsupported', string][]) => list.map(([page, kind, status]) => ({ page, kind, status })) as DocumentProtection['pages'];
  test('예전 문구 "스캔된 페이지가 포함되어 있어 자동 가리기를 지원하지 않아요."는 어떤 사유에도 없음', () => {
    for (const d of ['scan_format', 'scan_layout', 'scan_too_large', 'no_text', 'too_many_scan_pages', 'scanned_pages', null]) {
      const c = protectionCopy(p('unsupported_scan', [], d))!;
      expect(`${c.title} ${c.body}`).not.toContain('스캔된 페이지가 포함되어 있어');
    }
  });
  test('특수 형식 → "자동 가리기를 지원하지 않는 형식의 페이지가 있어요" + 해당 쪽 번호', () => {
    const c = protectionCopy({ ...p('unsupported_scan', [], 'scan_format'), pages: pages([[1, 'text', 'skipped'], [3, 'unsupported', 'unsupported_scan']]) })!;
    expect(c).toMatchObject({ title: '자동 가리기를 지원하지 않는 형식의 페이지가 있어요', tone: 'warning' });
    expect(c.body).toContain('(3쪽)');
  });
  test('스캔 페이지 20쪽 초과 → 나눠서 올리라는 안내', () => {
    const c = protectionCopy(p('unsupported_scan', [], 'too_many_scan_pages'))!;
    expect(c.title).toBe('스캔 페이지가 20쪽을 넘어 자동 가리기를 하지 않았어요');
    expect(c.body).toContain('나눠서 올려주세요');
  });
  test('예전 버전에서 미지원 처리된 스캔 PDF(scanned_pages) → 지금은 보호하기 가능', () => {
    expect(canProtect(p('unsupported_scan', [], 'scanned_pages'))).toBe(true);
    expect(protectionCopy(p('unsupported_scan', [], 'scanned_pages'))!.title).toBe('민감정보 보호 전이에요');
    expect(canProtect(p('unsupported_scan', [], 'scan_format'))).toBe(false);
  });
  test('읽지 못한 스캔 페이지 쪽 번호 · 스캔 페이지 실패 사유는 내부 코드 없이', () => {
    const u = protectionCopy({ ...p('unreadable'), pages: pages([[1, 'text', 'no_sensitive_data'], [2, 'scan', 'unreadable'], [3, 'scan', 'skipped']]) })!;
    expect(u.body).toContain('(2쪽)');
    const f = protectionCopy({ ...p('failed', [], 'ocr_layer_mismatch'), pages: pages([[2, 'scan', 'failed']]) })!;
    expect(f.body).toContain('글자 위치를 정확히 확인하지 못해');
    expect(f.body).toContain('문제가 생긴 페이지: 2쪽.');
    expect(f.body).not.toContain('ocr_layer');
    for (const d of ['scan_worker_error', 'scan_incomplete']) expect(protectionCopy(p('failed', [], d))!.body).toContain('잠시 후 다시 시도해주세요.');
  });
});
