/** 사진 보호 화면 문구 · 여러 장 전체 상태(J) · 동시 처리 제한 */
import { canProtect, overallProtectionCopy, protectionCopy } from '@/features/documents/protectionCopy';
import type { DocumentProtection, ProtectionStatus, SensitiveRegion } from '@/domain/types';
import { mapWithConcurrency } from '@/lib/pool';

const region = (type: string, state: SensitiveRegion['state'] = 'masked'): SensitiveRegion =>
  ({ id: `${type}-${Math.random()}`, type, state, page: 1, confidence: 'high', maskedPreview: '***', contextLabel: null, userConfirmed: false, bbox: [] }) as unknown as SensitiveRegion;
const p = (status: ProtectionStatus, regions: SensitiveRegion[] = [], detail: string | null = null): DocumentProtection => ({ status, detail, imagesUnchecked: false, protectedViewPath: status === 'protected' ? 'x' : null, regions });

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
    expect(canProtect(p('unsupported_scan', [], 'scanned_pages'))).toBe(false);
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
