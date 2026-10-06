import { isConfirmedPayment } from './contractTypes';
import { addDays, monthRange, type YearMonth } from './dates';
import { expandPayment, type PaymentOccurrence } from './schedule';
import type { ContractCategory, ContractPayment, ContractRecord, Direction, ISODate } from './types';

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
  /** 이번 달 오가는 보증금 등 중립 금액 (지출·수입 합계 제외) */
  depositTotal: number;
  /** 이번 달 들어오는 돈 (급여·용역 대금 등) — 지출과 섞지 않는다 */
  incomeTotal: number;
}

/** 기간 내 결제 (기본: 지출만 — 수입·보증금(중립)은 제외) */
function occurrencesIn(records: ContractRecord[], start: ISODate, end: ISODate, direction: Direction = 'expense'): SpendingItem[] {
  return records.flatMap(({ contract, payments, dates }) =>
    payments.filter((p) => p.direction === direction).flatMap((p) =>
      expandPayment(p, contract, { start, end }, dates).map((o) => ({
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
    depositTotal: occurrencesIn(records, start, end, 'neutral').reduce((sum, o) => sum + o.amount, 0),
    incomeTotal: occurrencesIn(records, start, end, 'income').reduce((sum, o) => sum + o.amount, 0),
  };
}

/**
 * 매달 나가는 정기 계약비 = 지금 이어지고 있는 정기 결제(월납·분기납·연납 …)의 월 환산 합계.
 * 일시불(헬스장 1년권 일시 결제·설치비 등)은 한 번 내는 돈이라 넣지 않는다 — 결제한 달의 지출에만 나타난다.
 * 앞으로 12개월 안에 결제가 남아 있는 확정 지출만 (종료·해지·회차 완료된 결제와 선택형·조건부 비용 제외).
 */
export function recurringMonthlyCost(records: ContractRecord[], today: ISODate): number {
  const range = { start: today, end: addDays(today, 365) };
  return records.reduce(
    (sum, { contract, payments, dates }) =>
      sum +
      payments
        .filter((p) => p.frequency !== 'one_time' && expandPayment(p, contract, range, dates).length > 0)
        .reduce((s, p) => s + paymentMonthlyEquivalent(p), 0),
    0,
  );
}

const MONTHS_PER_PAYMENT: Record<ContractPayment['frequency'], number | null> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
  one_time: null,
};

/** 결제 규칙의 월 환산액 (연납 1,368,000 → 114,000). 일시불·보증금은 0. 실제 월 지출과 섞지 않는 보조 지표. */
export function paymentMonthlyEquivalent(payment: ContractPayment): number {
  if (payment.direction !== 'expense' || !isConfirmedPayment(payment)) return 0;
  const months = MONTHS_PER_PAYMENT[payment.frequency];
  return months ? Math.round(payment.amount / months) : 0;
}

/** 계약 한 건의 월 환산액 (정기결제 규칙 기준). */
export function contractMonthlyEquivalent(record: ContractRecord): number {
  return record.payments.reduce((sum, p) => sum + paymentMonthlyEquivalent(p), 0);
}
