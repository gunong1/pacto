/**
 * 날짜 정리
 *
 * 규칙 D1 cleanDates — 목적: 형식이 맞는 날짜만 남기고 의미 코드를 정리 (모르는 의미는 other)
 *   입력: 모델 출력 dates / 출력: ExtractedDate[] (최대 40개)
 *   예) "2026-02-30" → 버림 / meaning "start" → other
 * 테스트: src/domain/__tests__/scenario-lease-dates.test.ts
 */
import type { ExtractedDate } from './types.ts';
import { confidenceOf, isObj, oneOf, quoteOf, sourceOf, text, validDate } from './values.ts';
import { DATE_MEANINGS, type DateMeaning, type DateSource } from './vocabulary.ts';

/** 기준 날짜(anchor)가 가리키는 dates의 의미 — 앞에 있는 것부터 찾는다 */
export const DATE_ANCHORS: Partial<Record<DateSource, readonly DateMeaning[]>> = {
  contract_date: ['contract_signed'],
  balance_date: ['balance_due', 'move_in'],
  move_in_date: ['move_in', 'balance_due'],
  start_date: ['contract_start', 'service_start', 'coverage_start', 'hire'],
  end_date: ['contract_end', 'maturity'],
};

export function cleanDates(raw: unknown): ExtractedDate[] {
  return (Array.isArray(raw) ? raw : [])
    .filter(isObj)
    .filter((d) => validDate(d.date))
    .slice(0, 40)
    .map((d) => ({
      date: (d.date as string).trim(),
      meaning: oneOf(DATE_MEANINGS, d.meaning) ?? 'other',
      label: text(d.label, 40) ?? '날짜',
      confidence: confidenceOf(d.confidence),
      sourceType: sourceOf(d.source_type),
      ...quoteOf(d),
    }));
}
