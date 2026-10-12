/**
 * 근거 문장 가림이 실패하면 원문을 보여주지 않는다 (공통 화면 방어선) — 값은 가짜다.
 * 가림 함수가 실패 표시값을 돌려주는 상황을 모듈 대체로 재현한다.
 */
import { evidenceView } from '../../evidence';

jest.mock('../../sensitive', () => ({
  SENSITIVE_DISPLAY_FALLBACK: '민감정보 보호 확인 필요',
  maskSensitiveTextForDisplay: () => '민감정보 보호 확인 필요',
}));

test('가림 자체가 실패하면 근거 문장·AI 값 대신 "민감정보 보호 확인 필요"', () => {
  const v = evidenceView({ quote: '연락처 010-1234-5678', page: 1, documentId: 'doc-1' }, { aiValue: '010-1234-5678' });
  expect(v.quote).toBe('민감정보 보호 확인 필요');
  expect(JSON.stringify(v)).not.toContain('5678');
});
