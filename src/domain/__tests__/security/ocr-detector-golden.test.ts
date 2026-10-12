/**
 * OCR 문서 민감정보 탐지 Golden (공통 탐지기 · 문자열 층) — 모든 값은 가짜다.
 *
 * 배경: 손글씨 계약서에서 주민등록번호는 가렸는데 휴대전화번호는 놓쳤다.
 *   원인 — 유형마다 구분자 규칙이 달랐다 (주민번호는 하이픈 앞뒤 공백 허용, 전화는 구분자 1글자 · 앞뒤 같은 기호만).
 *   손글씨는 글자 간격이 넓어 OCR 조각 사이에 공백이 들어가고("010- 1234- 5678"), 대시가 다른 모양으로 읽히기도 한다.
 * 원칙: 손글씨 전용 규칙을 만들지 않는다 — 모든 유형·모든 문서가 같은 구분자 규칙·같은 탐지기를 쓴다.
 *       필드명이 있는데 값을 탐지하지 못하면 "민감정보 없음"이 아니라 "확인 필요"(findUnresolvedFields).
 */
import { detectSensitive, findUnresolvedFields, maskSensitiveText } from '../../../../supabase/functions/_shared/protection/sensitive.ts';

const types = (s: string) => detectSensitive(s).map((d) => d.type);
const unresolved = (s: string) => findUnresolvedFields(s, detectSensitive(s)).map((u) => u.type);

describe('A. 공통 구분자 — 전화·주민·계좌·카드가 같은 규칙', () => {
  test.each([
    ['하이픈', '휴대전화 010-1234-5678'],
    ['하이픈 뒤 공백 (손글씨 넓은 간격)', '휴대전화 010- 1234- 5678'],
    ['하이픈 앞뒤 공백', '휴대전화 010 - 1234 - 5678'],
    ['구분자 섞임', '휴대전화 010-1234 5678'],
    ['공백만', '휴대전화 010 1234 5678'],
    ['긴 대시', '휴대전화 010—1234—5678'],
    ['한글 ㅡ로 읽힌 대시', '휴대전화 010ㅡ1234ㅡ5678'],
    ['전각 하이픈', '휴대전화 010－1234－5678'],
  ])('휴대전화: %s → 탐지', (_n, s) => {
    expect(types(s)).toEqual(['phone']);
    expect(maskSensitiveText(s)).not.toMatch(/1234/);
  });

  test.each([
    ['주민 하이픈 앞뒤 공백', '주민등록번호 800101 - 1234567', 'resident_registration_number'],
    ['주민 긴 대시', '주민등록번호 800101—1234567', 'resident_registration_number'],
    ['계좌 하이픈 뒤 공백', '입금계좌 국민은행 123456- 01- 234567', 'bank_account'],
    ['계좌 ㅡ 대시', '계좌번호 110ㅡ123ㅡ456789', 'bank_account'],
    ['카드 하이픈 앞뒤 공백', '카드번호 4111 - 1111 - 1111 - 1111', 'credit_card'],
  ])('%s → 탐지', (_n, s, t) => {
    expect(types(s)).toEqual([t]);
  });

  test('일반전화도 같은 규칙 (02 - 1234 - 5678)', () => {
    expect(types('연락처 02 - 1234 - 5678')).toEqual(['phone']);
  });
});

describe('A. OCR 혼동 글자 (0↔O, 1↔l) — 필드명이 있을 때만 숫자로 본다', () => {
  test('필드명 있음: 휴대전화 O10-1234-5678 → 탐지, 표시값은 원문 글자 위치 그대로 가림', () => {
    const d = detectSensitive('휴대전화 O10-1234-5678');
    expect(d.map((x) => x.type)).toEqual(['phone']);
    expect(d[0].maskedPreview).toBe('O10-****-5678');
  });
  test('필드명 있음: 연락처 0l0-l234-5678 → 탐지', () => {
    expect(types('연락처 0l0-l234-5678')).toEqual(['phone']);
  });
  test('필드명 없음: 모델 O10-1234-5678 → 탐지하지 않음 (오탐 방지)', () => {
    expect(types('제품 O10-1234-5678 사양')).toEqual([]);
  });
  test('영어 단어 일부는 바꾸지 않음: Tel010-1234-5678 → 전화 탐지 유지', () => {
    expect(types('Tel010-1234-5678')).toEqual(['phone']);
  });
});

describe('A. 제외 문맥 · 오탐 없음 (숫자를 모두 가리지 않는다)', () => {
  test.each([
    ['계약번호', '계약번호 2026-1234-5678'],
    ['금액', '보증금 20,000,000원 월세 850,000원'],
    ['날짜', '계약기간 2026 - 10 - 20 ~ 2028 - 10 - 19'],
    ['사업자번호', '사업자등록번호 123 - 45 - 67890'],
    ['팩스', '팩스 02 - 1234 - 5678'],
  ])('%s → 탐지 없음', (_n, s) => {
    expect(types(s)).toEqual([]);
  });
});

describe('B. 필드명 기준 누락 검사 (findUnresolvedFields)', () => {
  test('값을 탐지하면 누락 없음', () => {
    expect(unresolved('임대인 휴대전화 010-1234-5678 주민등록번호 800101-1234567')).toEqual([]);
  });
  test('휴대전화 칸 값이 규칙 밖으로 읽힘 (예: 010 . 12 34 / 5678) → 확인 필요', () => {
    expect(unresolved('휴대전화 010 . 12 34 / 5678')).toEqual(['phone']);
  });
  test('주민등록번호 칸 값이 깨져 읽힘 → 확인 필요', () => {
    expect(unresolved('주민등록번호 8OO1O1 / l23456?')).toEqual(['resident_registration_number']);
  });
  test('빈칸이면 정상 (값이 없으면 가릴 것도 없다)', () => {
    expect(unresolved('휴대전화\n주소 서울시')).toEqual([]);
    expect(unresolved('휴대전화 (            )')).toEqual([]);
  });
  test('필드명 오타(OCR)도 같은 검사: 휴대젼화 010 . 12 34 / 5678', () => {
    expect(unresolved('휴대젼화 010 . 12 34 / 5678')).toEqual(['phone']);
  });
  test('금액·날짜·짧은 숫자는 값으로 보지 않음', () => {
    expect(unresolved('월세는 매월 25일 임대인 계좌로 입금한다. 월세 850,000원')).toEqual([]);
    expect(unresolved('계약 해지 시 30일 전 전화로 통지한다')).toEqual([]);
    expect(unresolved('연락처 2026년 10월 20일')).toEqual([]);
  });
  test('제외 필드명이 더 가까우면 건너뜀: 연락처 계약번호 2026 . 1234 . 5678', () => {
    expect(unresolved('연락처 계약번호 2026 . 1234 . 5678')).toEqual([]);
  });
});
