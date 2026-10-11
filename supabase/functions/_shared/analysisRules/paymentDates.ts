/**
 * 결제 날짜·주기·결제일
 *
 * 규칙 PD1 resolvePaymentDate — 목적: 옆 줄 날짜가 옮겨 오지 않도록, 그 금액의 문구로 날짜를 정한다
 *   입력: 모델 date·date_source·근거 문장·계약서 날짜들 / 출력: { date, dateSource }
 *   예) 계약금 "계약 당일 지급"(아래 줄 잔금 10/20) → 계약 체결일 / 문구에 없는 날짜를 explicit로 → inferred
 * 규칙 PD2 guardIncomePayday — 목적: 급여 지급일을 근로 시작일의 날짜로 추론하지 않는다
 *   입력: 결제 목록 · 날짜들 / 출력: 문구에 "N일"이 없는데 시작일과 같은 날이면 지급일 null + low
 * 규칙 PD3 lumpSum — 목적: "일시불·일시납"으로 적힌 금액은 이용 기간과 상관없이 1회
 *   예) "1년 회원권 660,000원(일시불)"을 매월로 답함 → one_time
 * 테스트: scenario-lease-dates.test.ts, salary-payday.test.ts, extraction.test.ts
 */
import { DATE_ANCHORS } from './dates.ts';
import { LUMP_SUM, quoteHasDate, quoteHasPayDay } from './keywords.ts';
import type { ExtractedDate, ExtractedPayment } from './types.ts';
import { oneOf } from './values.ts';
import { DATE_SOURCES, type DateSource } from './vocabulary.ts';

/** 금액 문구에서 기준 날짜 표현 찾기 ("계약 당일 지급" → contract_date). "계약 시작일"은 계약 시가 아니다 */
const ANCHOR_PATTERNS: [DateSource, RegExp][] = [
  ['contract_date', /계약\s*(당일|체결\s*(일|시|당일|와\s*동시)|시(?!작|점)|과\s*동시)/],
  ['balance_date', /잔금\s*(지급\s*)?일(에|까지|\s*지급)/],
  ['move_in_date', /입주\s*(일|시)/],
  ['start_date', /(계약\s*)?(시작|개시)\s*일(에|까지|\s*지급)/],
  ['end_date', /(종료|만료|만기)\s*(일|시)(에|까지|\s*지급)?/],
];
export function anchorFromQuote(quote: string): DateSource | null {
  for (const [source, re] of ANCHOR_PATTERNS) if (re.test(quote)) return source;
  return null;
}

export function resolvePaymentDate(
  modelDate: string | null,
  rawSource: unknown,
  quote: string,
  dates: readonly { date: string; meaning: string }[],
): { date: string | null; dateSource: DateSource | null } {
  let source: DateSource | null = oneOf(DATE_SOURCES, rawSource) ?? (modelDate ? 'explicit' : null);
  const anchor = quote ? anchorFromQuote(quote) : null;
  if ((source === 'explicit' || source === null) && quote && !(modelDate && quoteHasDate(quote, modelDate))) {
    if (anchor) source = anchor;
    else if (source === 'explicit' && modelDate) source = 'inferred';
  }
  const meanings = source ? DATE_ANCHORS[source] : undefined;
  if (meanings) {
    for (const m of meanings) {
      const d = dates.find((x) => x.meaning === m);
      if (d) return { date: d.date, dateSource: source };
    }
    return { date: null, dateSource: source };
  }
  return { date: modelDate, dateSource: source };
}

/** 시작일 계열 날짜 의미 (지급일 추론 검사용) */
const START_MEANINGS = new Set(['hire', 'contract_start', 'service_start', 'coverage_start']);

export function guardIncomePayday(payments: ExtractedPayment[], dates: readonly ExtractedDate[]): void {
  const startDays = new Set(dates.filter((d) => START_MEANINGS.has(d.meaning)).map((d) => Number(d.date.slice(8, 10))));
  for (const p of payments) {
    if (p.direction !== 'income' || p.frequency === 'one_time' || p.dayOfMonth == null || !startDays.has(p.dayOfMonth)) continue;
    if ((p.evidence ?? []).some((e) => quoteHasPayDay(e.quote, p.dayOfMonth!))) continue;
    p.dayOfMonth = null;
    p.confidence = 'low';
  }
}

export function lumpSum(payments: ExtractedPayment[]): void {
  for (const p of payments) {
    const q = p.evidence?.[0]?.quote ?? '';
    if (p.frequency !== 'one_time' && LUMP_SUM.test(`${p.label} ${q}`)) {
      p.frequency = 'one_time';
      p.dayOfMonth = null;
      p.installmentCount = null;
      p.endDate = null;
      p.businessDayRule = 'none';
      p.confidence = 'medium';
    }
  }
}
