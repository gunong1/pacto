import { monthRange, shiftYearMonth, yearMonthOf, type YearMonth } from './dates';
import { expandPayment, type PaymentOccurrence } from './schedule';
import type { ContractCategory, ContractPayment, ContractRecord, ISODate } from './types';

export interface SpendingItem extends PaymentOccurrence {
  contractTitle: string;
  category: ContractCategory;
}

export interface CategorySpending {
  category: ContractCategory;
  amount: number;
}

export interface MonthSpending {
  yearMonth: YearMonth;
  /** 이번 달 실제 결제 예정액 (연납은 결제되는 달에만 포함). */
  total: number;
  byCategory: CategorySpending[];
  items: SpendingItem[];
  hasEstimated: boolean;
}

function occurrencesIn(records: ContractRecord[], start: ISODate, end: ISODate): SpendingItem[] {
  return records.flatMap(({ contract, payments }) =>
    payments.flatMap((p) =>
      expandPayment(p, contract, { start, end }).map((o) => ({
        ...o,
        contractTitle: contract.title,
        category: contract.category,
      })),
    ),
  );
}

/** 특정 월의 실제 결제 예정 지출. 종료/해지 계약은 처리일 이후 결제가 자동 제외된다. */
export function monthSpending(records: ContractRecord[], ym: YearMonth): MonthSpending {
  const { start, end } = monthRange(ym);
  const items = occurrencesIn(records, start, end).sort((a, b) => a.date.localeCompare(b.date));
  const byCat = new Map<ContractCategory, number>();
  for (const i of items) byCat.set(i.category, (byCat.get(i.category) ?? 0) + i.amount);
  return {
    yearMonth: ym,
    total: items.reduce((sum, i) => sum + i.amount, 0),
    byCategory: [...byCat.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    items,
    hasEstimated: items.some((i) => i.estimated),
  };
}

/** 연간 예상 계약지출 = 이번 달부터 12개월간 결제 예정액 합계. */
export function annualForecast(records: ContractRecord[], today: ISODate): number {
  const from = yearMonthOf(today);
  const start = monthRange(from).start;
  const end = monthRange(shiftYearMonth(from, 11)).end;
  return occurrencesIn(records, start, end).reduce((sum, i) => sum + i.amount, 0);
}

/** 월평균 계약비 = 연간 예상 ÷ 12 (연납 보험료 등이 고르게 분산된 값). */
export function monthlyAverage(records: ContractRecord[], today: ISODate): number {
  return Math.round(annualForecast(records, today) / 12);
}

const MONTHS_PER_PAYMENT: Record<ContractPayment['frequency'], number | null> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
  one_time: null,
};

/** 결제 규칙의 월 환산액 (연납 1,368,000 → 114,000). 일시불은 0. */
export function paymentMonthlyEquivalent(payment: ContractPayment): number {
  const months = MONTHS_PER_PAYMENT[payment.frequency];
  return months ? Math.round(payment.amount / months) : 0;
}

/** 계약 한 건의 월 환산액 (정기결제 규칙 기준). */
export function contractMonthlyEquivalent(record: ContractRecord): number {
  return record.payments.reduce((sum, p) => sum + paymentMonthlyEquivalent(p), 0);
}
