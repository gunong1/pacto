/**
 * 민감정보 보호 Security Golden Test (문자열 층) — 모든 값은 가짜다.
 *
 * 기준 하나: 탐지 detectSensitive → 가림 여부 shouldMaskSensitive → 텍스트 가림 maskSensitiveText/Deep
 * 일반 UI·DB 파생 텍스트·AI 근거·보호본은 Level 1(주민·외국인·카드·계좌) + Level 2(전화·이메일)를 모두 가린다.
 * 표시 형식 (더 많이 가리는 쪽): 800101-1****** · 010-****-5678 · 02-****-5678 · e******@domain.com · ****-****-****-3456 · ***-***-**9012
 */
import { detectSensitive, maskSensitiveDeep, maskSensitiveText, maskSensitiveTextForDisplay, shouldMaskSensitive, SENSITIVE_DISPLAY_FALLBACK } from '@/domain/sensitive';

const m = maskSensitiveText;

describe('1. 유형별 단독', () => {
  test.each([
    ['주민등록번호', '주민등록번호 800101-1234567', '주민등록번호 800101-1******'],
    ['외국인등록번호', '외국인등록번호 850315-5123456', '외국인등록번호 850315-5******'],
    ['휴대전화', '연락처 010-1234-5678', '연락처 010-****-5678'],
    ['일반 전화', '전화 02-1234-5678', '전화 02-****-5678'],
    // 이메일은 앞 1글자만 남기고 나머지를 같은 길이의 *로 (example 7글자 → e + * 6개)
    ['이메일', '이메일 example@domain.com', '이메일 e******@domain.com'],
    ['카드번호', '카드번호 4111-1111-1111-1111', '카드번호 ****-****-****-1111'],
    ['계좌번호', '입금계좌 국민은행 123-456-789012', '입금계좌 국민은행 ***-***-**9012'],
  ])('%s', (_, input, expected) => expect(m(input)).toBe(expected));
});

describe('2. 여러 민감정보가 한 문장에', () => {
  test('주민번호 + 전화번호 (이번에 발견된 사례: 주민번호만 가려지고 전화번호가 보임)', () => {
    expect(m('임대인 김민수 / 주민등록번호 800101-1234567 / 010-1234-5678')).toBe('임대인 김민수 / 주민등록번호 800101-1****** / 010-****-5678');
  });
  test('전화번호 + 이메일', () => {
    expect(m('연락처 010-9876-5432, 이메일 hong.gildong@example.co.kr')).toBe('연락처 010-****-5432, 이메일 h***********@example.co.kr');
  });
  test('모든 유형이 한 문단에', () => {
    const out = m('임차인 이가상 주민등록번호 950729-2345678 휴대폰 010-7924-5510 이메일 lee@test.kr 계좌 우리은행 1002-458-771032 카드번호 4111 1111 1111 1111');
    for (const raw of ['950729-2345678', '7924', 'lee@', '1002-458', '4111 1111 1111']) expect(out).not.toContain(raw);
    expect(out).toContain('950729-2******');
    expect(out).toContain('010-****-5510');
  });
});

describe('3. 형식 — 하이픈 없음 · 공백 · OCR 띄어쓰기 · 이미 가린 값', () => {
  test('하이픈 없는 주민번호(필드명 있음)·휴대전화', () => {
    expect(m('주민번호 8001011234567')).toBe('주민번호 8001011******');
    expect(m('휴대전화 01012345678')).toBe('휴대전화 010****5678');
  });
  test('공백 구분 휴대전화 · 하이픈 앞뒤 공백 주민번호', () => {
    expect(m('연락처 010 1234 5678')).toBe('연락처 010 **** 5678');
    expect(m('주민등록번호 800101 - 1234567')).toBe('주민등록번호 800101 - 1******');
  });
  test('OCR이 필드명을 띄어 읽은 경우', () => {
    expect(m('주 민 등 록 번 호 800101-1234567')).toContain('800101-1******');
  });
  test('이미 가린 값은 다시 처리해도 그대로 (idempotent)', () => {
    for (const s of ['800101-1******', '010-****-5678', 'e******@domain.com', '****-****-****-3456', '***-***-**9012', '임대인 김민수 / 주민등록번호 800101-1****** / 010-****-5678']) {
      expect(m(s)).toBe(s);
      expect(m(m(s))).toBe(s);
    }
    const once = m('주민등록번호 800101-1234567 010-1234-5678 a@b.co');
    expect(m(once)).toBe(once);
  });
});

describe('4. 오탐 — 모든 숫자를 가리지 않는다', () => {
  test.each([
    ['계약번호', '계약번호 800101-1234567'],
    ['고객번호', '고객번호 010-1234-5678'],
    ['증권번호', '보험증권번호 1234-5678-9012-3456'],
    ['사업자등록번호', '사업자등록번호 123-45-67890'],
    ['접수번호', '접수번호 2026-1011-000123'],
    ['중개사 등록번호', '중개사무소 등록번호 11650-2020-00123'],
    ['제품 일련번호', '일련번호 SN-8001011234567'],
    ['금액', '보증금 50,000,000원 월세 700,000원'],
    ['날짜', '계약기간 2026-10-20 ~ 2028-10-19'],
  ])('%s는 가리지 않음', (_, s) => expect(m(s)).toBe(s));
});

describe('5. 단일 정책 — 보호본과 텍스트가 같은 기준', () => {
  test('Level 1·2 모두 가림 대상, 신뢰도 낮은 Level 2 후보만 예외 (보호본도 같은 함수로 기본 상태를 정한다)', () => {
    const ds = detectSensitive('주민등록번호 800101-1234567 연락처 010-1234-5678 이메일 a@b.co 카드번호 4111-1111-1111-1111 입금계좌 123-456-789012');
    expect(ds.map((d) => d.type).sort()).toEqual(['bank_account', 'credit_card', 'email', 'phone', 'resident_registration_number'].sort());
    expect(ds.every((d) => shouldMaskSensitive(d))).toBe(true);
  });
  test('깊은 값(객체·배열)도 모두', () => {
    const out = maskSensitiveDeep({ a: ['010-1234-5678'], b: { c: '주민등록번호 800101-1234567' }, n: 3 });
    expect(out).toEqual({ a: ['010-****-5678'], b: { c: '주민등록번호 800101-1******' }, n: 3 });
  });
});

describe('6. 화면 방어선 — 실패하면 원문 대신 안전한 문구 (fail-closed)', () => {
  test('정상: 가린 문장', () => expect(maskSensitiveTextForDisplay('연락처 010-1234-5678')).toBe('연락처 010-****-5678'));
  test('비어 있거나 문자열이 아니면 빈 문자열', () => {
    expect(maskSensitiveTextForDisplay(null)).toBe('');
    expect(maskSensitiveTextForDisplay(undefined)).toBe('');
  });
  test('가리는 중 오류가 나면 원문을 보여주지 않는다', () => {
    const boom = { toString: () => { throw new Error('x'); } } as unknown as string;
    expect(maskSensitiveTextForDisplay(boom)).toBe(SENSITIVE_DISPLAY_FALLBACK);
    expect(SENSITIVE_DISPLAY_FALLBACK).toBe('민감정보 보호 확인 필요');
  });
});
