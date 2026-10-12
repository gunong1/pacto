import type { FlowNature } from './cashflow';
import { kindDisplay } from './contractKinds';
import { isConfirmedPayment } from './contractTypes';
import { amountAt } from './paymentAmount';
import { monthRange, type YearMonth } from './dates';
import { contractSchedule } from './schedule';
import type { ContractCategory, ContractPayment, ContractRecord, Direction, ISODate } from './types';

export interface SpendingItem {
  key: string;
  date: ISODate;
  amount: number;
  label: string;
  /** 사용자 기준 방향 — neutral = 방향 확인 필요 */
  direction: Direction;
  /** 일반 / 보증금·예치금 · null = 알 수 없음 */
  nature: FlowNature | null;
  estimated: boolean;
  contractId: string;
  contractTitle: string;
  category: ContractCategory;
  /** 계약 종류 이름 (화면 표시용 — 분류 개편 전 계약은 예전 이름) */
  kindLabel: string;
}

export interface CategorySpending {
  category: ContractCategory;
  amount: number;
}

/**
 * 한 달 현금흐름 — 홈·캘린더·계약 상세가 같은 값을 쓴다 (캘린더 일정 scheduleForRange와 같은 목록에서 계산).
 * - 총 출금 예정 = 일반 지출 + 보증금 지급 / 총 입금 예정 = 일반 수입 + 보증금 받음·반환(실제 기록·계약서에 적힌 반환 예정)
 * - 종료일 기준 "반환 확인" 일정은 금액이 오가지 않아 넣지 않는다
 * - 방향 확인 필요(neutral) 금액은 합계에 넣지 않고 따로 (undetermined)
 * - 보증금 총액과 그 몫(계약금·잔금)을 함께 세지 않는다 — 일정은 몫(결제)만 있다
 */
export interface MonthSpending {
  yearMonth: YearMonth;
  /** 총 출금 예정 (연납은 결제되는 달에만) */
  total: number;
  /** 일반 지출 (보증금 제외) */
  ordinaryExpense: number;
  /** 보증금·예치금 지급 (또는 임대인의 반환) */
  depositOut: number;
  /** 총 입금 예정 */
  incomeTotal: number;
  ordinaryIncome: number;
  /** 보증금 받음 · 보증금 반환 받음 */
  depositIn: number;
  /** 방향 확인 필요 금액 (합계 제외) */
  undeterminedTotal: number;
  undetermined: SpendingItem[];
  /** 일반 지출 분야별 / 계약 종류별 (보증금은 섞지 않는다) */
  byCategory: CategorySpending[];
  byKind: { label: string; amount: number }[];
  /** 출금 항목 (일반 + 보증금) */
  items: SpendingItem[];
  /** 입금 항목 */
  incomeItems: SpendingItem[];
  hasEstimated: boolean;
}

/** 기간 안의 돈이 오가는 일정 (결제·보증금 지급·반환) — 캘린더와 같은 목록 */
export function cashItems(records: ContractRecord[], start: ISODate, end: ISODate, today: ISODate = start): SpendingItem[] {
  return records.flatMap((record) => {
    const { contract } = record;
    const kindLabel = kindDisplay(contract).label;
    return contractSchedule(record, { start, end }, today)
      .filter((i) => i.type === 'payment' && i.eventId === null && i.amount != null && i.direction != null)
      .map((i) => ({
        key: i.key,
        date: i.date,
        amount: i.amount!,
        label: i.title,
        direction: i.direction!,
        nature: i.moneyNature ?? null,
        estimated: i.estimated,
        contractId: contract.id,
        contractTitle: contract.title,
        category: contract.category,
        kindLabel,
      }));
  });
}

const sum = (list: readonly SpendingItem[]) => list.reduce((s, i) => s + i.amount, 0);

/** 특정 월의 현금흐름. 종료/해지 계약은 처리일 이후 결제가 자동 제외된다. */
export function monthSpending(records: ContractRecord[], ym: YearMonth, today?: ISODate): MonthSpending {
  const { start, end } = monthRange(ym);
  const all = cashItems(records, start, end, today ?? start).sort((a, b) => a.date.localeCompare(b.date));
  const items = all.filter((i) => i.direction === 'expense');
  const incomeItems = all.filter((i) => i.direction === 'income');
  const undetermined = all.filter((i) => i.direction === 'neutral');
  const ordinary = items.filter((i) => i.nature !== 'deposit');
  const byCat = new Map<ContractCategory, number>();
  for (const i of ordinary) byCat.set(i.category, (byCat.get(i.category) ?? 0) + i.amount);
  const byKind = new Map<string, number>();
  for (const i of ordinary) byKind.set(i.kindLabel, (byKind.get(i.kindLabel) ?? 0) + i.amount);
  return {
    yearMonth: ym,
    total: sum(items),
    ordinaryExpense: sum(ordinary),
    depositOut: sum(items.filter((i) => i.nature === 'deposit')),
    incomeTotal: sum(incomeItems),
    ordinaryIncome: sum(incomeItems.filter((i) => i.nature !== 'deposit')),
    depositIn: sum(incomeItems.filter((i) => i.nature === 'deposit')),
    undeterminedTotal: sum(undetermined),
    undetermined,
    byCategory: [...byCat.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    byKind: [...byKind.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount),
    items,
    incomeItems,
    hasEstimated: items.some((i) => i.estimated),
  };
}

/** 매월 결제되는 확정 지출 금액 (매월이 아니거나 수입·보증금·선택형·조건부면 0) */
export function monthlyPaymentAmount(payment: ContractPayment, today: ISODate): number {
  return payment.frequency === 'monthly' && payment.direction === 'expense' && isConfirmedPayment(payment) ? amountAt(payment, today) : 0;
}

/** 계약 한 건의 매월 결제 합계 (계약 목록 "월 ○○원" — 연납 등은 나누지 않음) */
export function contractMonthlyPayments(record: ContractRecord, today: ISODate): number {
  return record.payments.reduce((sum, p) => sum + monthlyPaymentAmount(p, today), 0);
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
export function paymentMonthlyEquivalent(payment: ContractPayment, today?: ISODate): number {
  if (payment.direction !== 'expense' || !isConfirmedPayment(payment)) return 0;
  const months = MONTHS_PER_PAYMENT[payment.frequency];
  const amount = today ? amountAt(payment, today) : payment.amount;
  return months ? Math.round(amount / months) : 0;
}

/** 계약 한 건의 월 환산액 (정기결제 규칙 기준, today가 있으면 그날 적용 중인 금액). */
export function contractMonthlyEquivalent(record: ContractRecord, today?: ISODate): number {
  return record.payments.reduce((sum, p) => sum + paymentMonthlyEquivalent(p, today), 0);
}
