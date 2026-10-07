/* 민감정보 탐지 — 패턴 + 문맥(필드명) + 검증. 원문 값은 가린 표시값으로만 다룬다 */
import { detectSensitive, maskLevel1Deep, maskLevel1Text } from '../../../supabase/functions/_shared/protection/sensitive.ts';

const one = (text: string) => detectSensitive(text).map((d) => [d.type, d.confidence, d.maskedPreview]);

describe('탐지·부분 가림 (V1 5종)', () => {
  test('A. 주민등록번호 + 전화번호 (근로계약서)', () => {
    expect(one('주민등록번호: 901225-1234567')).toEqual([['resident_registration_number', 'high', '901225-1******']]);
    expect(one('연락처: 010-1234-5678')).toEqual([['phone', 'high', '010-****-5678']]);
    expect(one('외국인등록번호 920101-5123456')).toEqual([['foreigner_registration_number', 'high', '920101-5******']]);
    // 이름·회사명은 탐지 대상이 아님 (계약 분석에 필요)
    expect(detectSensitive('사용자: 주식회사 네오링크   근로자: 박민준')).toEqual([]);
  });

  test('B. 계좌번호 (렌탈계약) — 은행·계좌 필드명이 있을 때', () => {
    expect(one('자동이체 계좌: 국민은행 123456-01-234567')).toEqual([['bank_account', 'high', '******-**-**4567']]);
    expect(one('입금 계좌 110-123-456789 (신한)')).toEqual([['bank_account', 'high', '***-***-**6789']]);
    // 금액·결제일은 그대로
    expect(detectSensitive('월 렌탈료 29,900원, 매월 10일 출금')).toEqual([]);
  });

  test('카드번호: 필드명·Luhn 검증', () => {
    expect(one('결제 카드번호 4111-1111-1111-1111')).toEqual([['credit_card', 'high', '4111-****-****-1111']]);
    expect(one('4111 1111 1111 1111')).toEqual([['credit_card', 'medium', '4111 **** **** 1111']]);
  });

  test('이메일 부분 가림', () => {
    expect(one('이메일: pacto@example.com')).toEqual([['email', 'high', 'pa***@example.com']]);
  });
});

describe('C·G. 오탐 방지 — 비슷한 숫자 모양', () => {
  test('C. 카드번호처럼 보이는 계약번호', () => {
    expect(detectSensitive('계약번호: 1234-5678-9012-3456')).toEqual([]);
    expect(detectSensitive('계약번호: 4111-1111-1111-1111')).toEqual([]); // Luhn을 통과해도 계약번호
  });
  test.each([
    ['보험증권번호', '증권번호: 2026-1234-5678-9012'],
    ['보험증권번호(13자리)', '보험증권번호 9012251234567'],
    ['차량 VIN', '차대번호(VIN): KMHD341CBNU123456'],
    ['고객번호', '고객번호 901225-1234567'],
    ['사업자등록번호', '사업자등록번호: 123-45-67890'],
    ['법인등록번호', '법인등록번호 110111-1234567'],
    ['계약금액', '계약금액 3,600,000원 (2026-10-01 지급)'],
    ['날짜', '계약기간 2026-10-01 ~ 2027-09-30'],
    ['우편번호', '우편번호 06236'],
    ['대표번호', '고객센터 대표번호 1588-1234'],
  ])('%s', (_, text) => {
    expect(detectSensitive(text).filter((d) => d.level === 1)).toEqual([]);
  });
  test('필드명 없는 13자리 숫자는 후보(low)일 뿐 자동으로 가리지 않음', () => {
    expect(one('9012251234567')).toEqual([['resident_registration_number', 'low', '9012251******']]);
  });
  test('필드명 없는 숫자 묶음은 계좌번호로 보지 않음', () => {
    expect(detectSensitive('번호 123456-01-234567')).toEqual([]);
  });
  test('생년월일이 될 수 없는 숫자는 주민번호가 아님', () => {
    expect(detectSensitive('주민등록번호 991399-1234567')).toEqual([]);
  });
});

describe('H 준비. 문장 속 Level 1 재마스킹 (AI 인용문·설명)', () => {
  test('의미는 유지하고 값 일부만 가림', () => {
    expect(maskLevel1Text('근로자 박민준(주민등록번호: 901225-1234567)은 급여를 국민은행 계좌 123456-01-234567로 받는다.')).toBe(
      '근로자 박민준(주민등록번호: 901225-1******)은 급여를 국민은행 계좌 ******-**-**4567로 받는다.',
    );
    // Level 2(전화·이메일)는 AI 문장에서 그대로 (계약 이해에 필요할 수 있음)
    expect(maskLevel1Text('연락처 010-1234-5678')).toBe('연락처 010-1234-5678');
    expect(maskLevel1Text('월 임금 3,600,000원, 매월 25일 지급')).toBe('월 임금 3,600,000원, 매월 25일 지급');
  });
  test('객체 전체(중첩) 재마스킹, 원본 객체는 그대로', () => {
    const src = { checks: [{ evidenceQuote: '주민등록번호 901225-1234567', n: 1 }], label: '카드번호 4111-1111-1111-1111' };
    const out = maskLevel1Deep(src);
    expect(out).toEqual({ checks: [{ evidenceQuote: '주민등록번호 901225-1******', n: 1 }], label: '카드번호 4111-****-****-1111' });
    expect(src.checks[0].evidenceQuote).toContain('1234567');
  });
});
