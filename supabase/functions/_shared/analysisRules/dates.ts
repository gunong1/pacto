/**
 * 날짜 정리 — 날짜의 의미 규칙표는 이 파일 하나에서 관리한다 (서버·앱 공용)
 *
 * 규칙 D1 cleanDates — 목적: 형식이 맞는 날짜만 남기고 의미 코드를 정리 (모르는 의미는 other)
 *   예) "2026-02-30" → 버림 / meaning "start" → other
 * 규칙 D2 assignDateUses — 목적: 각 날짜를 어디에 쓰는지 서버가 정한다 (앱은 그대로 옮기기만)
 *   입력: 날짜들 · 계약 유형 · 결제 목록 / 출력: 날짜마다 use(contract_date·start·end·notice·key·payment·drop) + 주요 날짜 종류
 *   - 체결일은 contract_signed가 있을 때만 (다른 날짜로 대신하지 않음)
 *   - 시작·종료일: 계약 유형별 의미 우선순위 (START_PRIORITY·END_PRIORITY)
 *   - 반복 결제일("월세 지급일 매월 5일")·첫 납입일·결제와 같은 날의 잔금일은 결제 정보 → 주요 날짜 아님
 *   - 시작일과 같은 날의 입주일·설치일은 의미가 다르므로 주요 날짜로 보존 (캘린더는 같은 계약·같은 날을 한 카드로 묶어 "임대차 시작 · 입주")
 *   - 같은 종류·같은 날짜는 한 번만 / "기타" 날짜가 시작·종료일과 같으면 생략
 * 테스트: dates-rules.test.ts, scenario-lease-dates.test.ts, key-dates-payment-day.test.ts, golden
 */
import type { CONTRACT_TYPE_CODES, DATE_KIND_CODES } from '../contractRegistry.ts';
import type { ExtractedDate, ExtractedPayment } from './types.ts';
import { confidenceOf, isObj, oneOf, quoteOf, sourceOf, text, validDate } from './values.ts';
import { DATE_MEANINGS, type DateMeaning, type DateSource } from './vocabulary.ts';

type ContractType = (typeof CONTRACT_TYPE_CODES)[number];
type DateKind = (typeof DATE_KIND_CODES)[number];

// ===== 의미 규칙표 =====

/** "시작"을 뜻하는 날짜 의미 (기준 날짜 start_date · 급여 지급일 추론 검사에 공통으로 쓴다). 앞쪽 우선 */
export const START_MEANINGS: readonly DateMeaning[] = ['contract_start', 'service_start', 'coverage_start', 'hire'];
/** 계약 유형별 시작일로 쓸 의미 (앞쪽 우선). 없는 유형은 DEFAULT_START */
export const START_PRIORITY: Partial<Record<ContractType, readonly DateMeaning[]>> = {
  recurring: ['service_start', 'contract_start', 'installation', 'activation'],
  lease: ['contract_start', 'move_in'],
  installment: ['loan_execution', 'contract_start'],
  loan: ['loan_execution', 'contract_start'],
  insurance: ['coverage_start', 'contract_start'],
  employment: ['contract_start', 'hire'],
  service: ['contract_start', 'service_start'],
  sale: ['contract_start'],
  one_time: ['contract_start', 'service_start'],
};
export const DEFAULT_START: readonly DateMeaning[] = ['contract_start', 'service_start', 'coverage_start', 'loan_execution'];
/** 계약 유형별 종료일로 쓸 의미 (앞쪽 우선) */
export const END_PRIORITY: Partial<Record<ContractType, readonly DateMeaning[]>> = {
  installment: ['maturity', 'contract_end'],
  loan: ['maturity', 'contract_end'],
  insurance: ['maturity', 'contract_end'],
  service: ['contract_end', 'completion', 'delivery'],
  sale: ['completion', 'contract_end'],
  one_time: ['completion', 'contract_end'],
};
export const DEFAULT_END: readonly DateMeaning[] = ['contract_end', 'maturity', 'completion'];

/** 기준 날짜(anchor)가 가리키는 dates의 의미 — 앞에 있는 것부터 찾는다 */
export const DATE_ANCHORS: Partial<Record<DateSource, readonly DateMeaning[]>> = {
  contract_date: ['contract_signed'],
  balance_date: ['balance_due', 'move_in'],
  move_in_date: ['move_in', 'balance_due'],
  start_date: START_MEANINGS,
  end_date: ['contract_end', 'maturity'],
};

/** 주요 날짜(contract_dates)로 옮길 의미 → 종류 */
export const KEY_DATE_KIND: Partial<Record<DateMeaning, DateKind>> = {
  installation: 'installation',
  activation: 'activation',
  move_in: 'move_in',
  balance_due: 'balance_due',
  renewal: 'renewal',
  hire: 'hire',
  delivery: 'delivery',
  inspection: 'inspection',
  handover: 'handover',
  ownership_transfer: 'ownership_transfer',
};
/** 시작·종료로 쓰이지 않으면 '기타 날짜'로 남길 의미 (계약서의 날짜를 버리지 않는다) */
export const KEEP_AS_OTHER: ReadonlySet<DateMeaning> = new Set(['service_start', 'contract_start', 'loan_execution', 'coverage_start', 'maturity', 'contract_end', 'completion', 'other']);

/**
 * 반복 결제일(예: "월세 지급일 매월 5일")은 주요 날짜가 아니다 — 금액의 결제일·주기로 캘린더에 반복 표시된다.
 * 하루짜리 날짜(입주일·잔금일·설치일)와 섞이지 않도록 이름·원문으로 가린다.
 */
const RECURRING_WORD = /매\s?(월|달|년|주|일)|정기|자동\s?이체/;
const PAY_DAY_WORD = /(지급|결제|납부|납입|이체|입금|출금|청구)\s?일|월세|임대료|관리비|렌탈료|이용료|보험료|급여|월급|임금|상환|할부금|납입금|요금|구독료/;
const PAY_DAY_LABEL = /(월세|차임|임대료|관리비|렌탈료|이용료|보험료|급여|월급|임금|상환금?|할부금|납입금|요금|구독료|회비)\s?(지급|결제|납부|납입|이체|입금|출금)?\s?일$/;
export function isRecurringPaymentDay(d: Pick<ExtractedDate, 'label' | 'evidence'>): boolean {
  const label = d.label.trim();
  if (PAY_DAY_LABEL.test(label)) return true;
  const said = `${label} ${(d.evidence ?? []).map((e) => e.quote).join(' ')}`;
  return RECURRING_WORD.test(said) && PAY_DAY_WORD.test(said);
}

// ===== 규칙 =====

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

export function assignDateUses(dates: ExtractedDate[], type: ContractType, payments: readonly ExtractedPayment[]): void {
  const free = (d: ExtractedDate) => d.use == null;
  const pick = (meanings: readonly DateMeaning[]) => {
    for (const m of meanings) {
      const d = dates.find((x) => x.meaning === m && free(x));
      if (d) return d;
    }
    return null;
  };
  const contractDate = pick(['contract_signed']);
  if (contractDate) contractDate.use = 'contract_date';
  const start = pick(START_PRIORITY[type] ?? DEFAULT_START);
  if (start) start.use = 'start';
  const end = pick(END_PRIORITY[type] ?? DEFAULT_END);
  if (end) end.use = 'end';

  const keys: { kind: DateKind; date: string }[] = [];
  for (const d of dates) {
    if (!free(d)) continue;
    if (d.meaning === 'contract_signed') d.use = 'drop';
    else if (d.meaning === 'notice_deadline') d.use = 'notice';
    else if (d.meaning === 'first_payment' || isRecurringPaymentDay(d)) d.use = 'payment';
    else {
      const kind = KEY_DATE_KIND[d.meaning] ?? (KEEP_AS_OTHER.has(d.meaning) ? 'other' : null);
      if (!kind) d.use = 'drop';
      else if (kind === 'balance_due' && payments.some((p) => p.frequency === 'one_time' && p.date === d.date)) d.use = 'payment';
      else if (kind === 'other' && (d.date === start?.date || d.date === end?.date)) d.use = 'drop';
      else if (keys.some((k) => k.kind === kind && k.date === d.date)) d.use = 'drop';
      else {
        d.use = 'key';
        d.keyKind = kind;
        keys.push({ kind, date: d.date });
      }
    }
  }
}
