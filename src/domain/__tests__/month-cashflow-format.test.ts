/** 캘린더 상단 출금·입금 카드 표기 (화면 표현만 — 금액·집계는 바꾸지 않음) */
import { cashflowSummaryLabel } from '@/features/calendar/MonthCashflowCards';

import { formatWon, formatWonShort, textFits, wonForWidth } from '../money';

describe('짧은 금액 표기 formatWonShort — 원 단위까지 그대로', () => {
  test.each([
    [0, '0원'],
    [9_900, '9,900원'],
    [1_700_000, '170만원'],
    [20_000_000, '2,000만원'],
    [43_500_000, '4,350만원'],
    [722_581, '72만 2,581원'],
    [200_000_000, '2억원'],
    [1_834_567_890, '18억 3,456만 7,890원'],
    [123_400_000_000, '1,234억원'],
  ])('%d → %s', (n, s) => expect(formatWonShort(n)).toBe(s));

  test('짧은 표기를 다시 숫자로 읽으면 원래 금액 (반올림·절사 없음)', () => {
    for (const n of [722_581, 1_834_567_890, 43_500_000, 10_001]) {
      const s = formatWonShort(n);
      const eok = Number(/(\d[\d,]*)억/.exec(s)?.[1]?.replace(/,/g, '') ?? 0);
      const man = Number(/(\d[\d,]*)만/.exec(s)?.[1]?.replace(/,/g, '') ?? 0);
      const rest = Number(/(?:^|\s)([\d,]+)원$/.exec(s)?.[1]?.replace(/,/g, '') ?? 0);
      expect(eok * 1e8 + man * 1e4 + rest).toBe(n);
    }
  });
});

describe('카드 너비에 맞는 표기 wonForWidth', () => {
  test('넓으면 전체, 좁으면 짧은 표기, 너비를 아직 모르면 전체', () => {
    expect(wonForWidth(43_500_000, 300, 17)).toBe('43,500,000원');
    expect(wonForWidth(43_500_000, 90, 17)).toBe('4,350만원');
    expect(wonForWidth(43_500_000, 0, 17)).toBe(formatWon(43_500_000));
  });
  test('글자 크기를 키우면(fontScale 2) 같은 너비에서도 짧은 표기', () => {
    expect(wonForWidth(43_500_000, 140, 17, 1)).toBe('43,500,000원');
    expect(wonForWidth(43_500_000, 140, 17, 2)).toBe('4,350만원');
  });
  test('한글은 숫자보다 넓게 어림', () => {
    expect(textFits('4,350만원', 100, 17)).toBe(true);
    expect(textFits('18억 3,456만 7,890원', 140, 17)).toBe(false);
  });
});

describe('화면 낭독기 문장 (기존 한 줄 요약과 같은 내용)', () => {
  test('보증금 포함 · 입금 · 확인 필요 금액 제외', () => {
    expect(cashflowSummaryLabel({ total: 43_500_000, depositOut: 20_000_000, incomeTotal: 1_700_000, undeterminedTotal: 0 })).toBe('총 출금 예정 ₩43,500,000 (보증금 ₩20,000,000 포함) · 입금 +₩1,700,000');
    expect(cashflowSummaryLabel({ total: 0, depositOut: 0, incomeTotal: 0, undeterminedTotal: 5_000_000 })).toBe('총 출금 예정 ₩0 · 입금 예정 없음 · 확인 필요 금액 제외');
  });
});
