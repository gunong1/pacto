/** 서버 단어 규칙(analysisRules/keywords.ts) — 각 규칙의 대표 예 (맞는 예 / 아닌 예) */
import {
  CONDITIONAL_COST,
  DISCOUNT_APPLIED,
  DISCOUNT_ITEM,
  LUMP_SUM,
  OPTIONAL_STRONG,
  OPTIONAL_WEAK,
  PRE_DISCOUNT,
  WAIVED,
  quoteHasDate,
  quoteHasPayDay,
} from '../../../supabase/functions/_shared/analysisRules/keywords.ts';

const cases: [string, RegExp, string[], string[]][] = [
  ['CONDITIONAL_COST', CONDITIONAL_COST, ['중도해지 위약금', '연체료', '분실 시 배상', '초과주행료', '회원권 양도 수수료'], ['월 렌탈료', '월세', '월 급여']],
  ['OPTIONAL_STRONG', OPTIONAL_STRONG, ['(선택) 필터 교체', '신청 시 월 3,000원', '옵션 요금'], ['월 이용료']],
  ['OPTIONAL_WEAK', OPTIONAL_WEAK, ['락커 이용 시 월 5,000원'], ['월 이용료 59,000원']],
  ['PRE_DISCOUNT', PRE_DISCOUNT, ['45,900원(할인전)', '정상가 50,000원', '프로모션 적용 전'], ['고정가 30,000원', '할인 적용 월 렌탈료']],
  ['DISCOUNT_ITEM', DISCOUNT_ITEM, ['E규정 할인', '프로모션 할인액'], ['월 렌탈료']],
  ['DISCOUNT_APPLIED', DISCOUNT_APPLIED, ['할인 적용 월 렌탈료', '할인 후 요금'], ['E규정 할인']],
  ['WAIVED', WAIVED, ['등록비 면제', '설치비 무료', '무상 설치'], ['등록비 100,000원']],
  ['LUMP_SUM', LUMP_SUM, ['660,000원(일시불)', '보험료 일시납'], ['매월 59,000원']],
];

describe.each(cases)('%s', (_name, re, yes, no) => {
  test.each(yes)('맞음: %s', (s) => expect(re.test(s)).toBe(true));
  test.each(no)('아님: %s', (s) => expect(re.test(s)).toBe(false));
});

test('quoteHasPayDay: 문구에 그 지급일이 적혀 있는지', () => {
  expect(quoteHasPayDay('매월 25일 지급', 25)).toBe(true);
  expect(quoteHasPayDay('매월 말일 지급', 31)).toBe(true);
  expect(quoteHasPayDay('근로개시일 2026년 7월 20일', 25)).toBe(false);
});

test('quoteHasDate: 문구에 그 날짜가 직접 적혀 있는지', () => {
  expect(quoteHasDate('잔금 2026년 10월 20일 지급', '2026-10-20')).toBe(true);
  expect(quoteHasDate('잔금 2026.10.20 지급', '2026-10-20')).toBe(true);
  expect(quoteHasDate('계약금 계약 당일 지급', '2026-10-20')).toBe(false);
});
