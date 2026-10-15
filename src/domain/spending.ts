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
  /** 대출 원금 상환 (일반 지출과 구분) */
  principal?: boolean;
  /** 과거 분석이 자동으로 정한 방향 (역할 확인 전) — 합계에는 넣고 "자동 판단"으로 따로 알린다 */
  auto?: boolean;
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
  /** 대출 원금 상환 (총 출금에 포함 · 일반 지출과 구분) */
  principalOut: number;
  /** 총 입금 예정 */
  incomeTotal: number;
  /** 입금 중 예상 금액 (시급·일급제 예상 월 수입 등 변동 금액 — 세전 추정, 실제 수령액 아님) */
  incomeEstimated: number;
  ordinaryIncome: number;
  /** 보증금 받음 · 보증금 반환 받음 */
  depositIn: number;
  /** 방향 확인 필요 금액 (합계 제외) */
  undeterminedTotal: number;
  undetermined: SpendingItem[];
  /** 출금·입금 중 과거 자동 판단 금액 (역할 확인 전) */
  autoExpense: number;
  autoIncome: number;
  /** 일반 지출 분야별 / 계약 종류별 (보증금은 섞지 않는다) */
  byCategory: CategorySpending[];
  byKind: { label: string; amount: number }[];
  /** 화면 요약 (계층) — 총 출금 > 일반 지출·보증금 지급 > 계약 종류별. 아래 항목들에서만 계산 (화면이 다시 더하지 않음) */
  outflow: FlowSummary;
  /** 총 입금 > 일반 수입·보증금 받음 > 계약 종류별 */
  inflow: FlowSummary;
  /** 출금 항목 (일반 + 보증금) */
  items: SpendingItem[];
  /** 입금 항목 */
  incomeItems: SpendingItem[];
  hasEstimated: boolean;
}

/** 계층 요약의 하위 항목 (계약 종류별) — 상위 항목 금액에 포함된다 */
export interface FlowLine {
  label: string;
  amount: number;
  /** 이 줄에 들어간 계약 수 */
  contracts: number;
}
/** 상위 항목: 돈의 성격별 (일반 / 보증금·예치금) — 서로 섞지 않는다 */
export interface FlowGroup {
  nature: FlowNature | 'principal';
  label: string;
  amount: number;
  lines: FlowLine[];
}
/**
 * 방향 하나(출금 또는 입금)의 계층 요약 — 모든 금액은 items 한 목록에서 한 번씩만 센다.
 * total = Σ groups.amount, group.amount = Σ lines.amount (하위 금액은 상위 금액에 포함 — 따로 더하지 않음)
 * 반환·환급 등 다른 방향도 같은 구조 (FLOW_LABELS로 이름만 다름)
 */
export interface FlowSummary {
  direction: 'expense' | 'income';
  total: number;
  groups: FlowGroup[];
}
export const FLOW_LABELS: Record<FlowSummary['direction'], { total: string; ordinary: string; deposit: string; principal: string }> = {
  expense: { total: '총 출금 예정', ordinary: '일반 지출', deposit: '보증금 지급', principal: '대출 원금 상환' },
  income: { total: '총 입금 예정', ordinary: '일반 수입', deposit: '보증금 받음·반환', principal: '대출 원금' },
};
/** 같은 성격끼리만 (일반 / 보증금 / 대출 원금 상환) — 하나의 금액은 한 묶음에만 */
const natureOfItem = (i: SpendingItem): FlowGroup['nature'] => (i.principal ? 'principal' : i.nature === 'deposit' ? 'deposit' : 'ordinary');

export function flowSummary(items: readonly SpendingItem[], direction: FlowSummary['direction']): FlowSummary {
  const mine = items.filter((i) => i.direction === direction);
  const groups = (['ordinary', 'deposit', 'principal'] as const)
    .map((nature): FlowGroup => {
      // 성격을 모르는 금액(예전 데이터)은 지금처럼 일반으로 (monthSpending의 ordinaryExpense와 같은 기준)
      const list = mine.filter((i) => natureOfItem(i) === nature);
      const byKind = new Map<string, { amount: number; contracts: Set<string> }>();
      for (const i of list) {
        const g = byKind.get(i.kindLabel) ?? { amount: 0, contracts: new Set<string>() };
        g.amount += i.amount;
        g.contracts.add(i.contractId);
        byKind.set(i.kindLabel, g);
      }
      const lines = [...byKind.entries()].map(([label, g]) => ({ label, amount: g.amount, contracts: g.contracts.size })).sort((a, b) => b.amount - a.amount);
      return { nature, label: FLOW_LABELS[direction][nature], amount: sum(list), lines };
    })
    .filter((g) => g.amount > 0);
  return { direction, total: sum(mine), groups };
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
        principal: i.principal === true,
        auto: i.directionStatus === 'auto',
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
  const ordinary = items.filter((i) => natureOfItem(i) === 'ordinary');
  const byCat = new Map<ContractCategory, number>();
  for (const i of ordinary) byCat.set(i.category, (byCat.get(i.category) ?? 0) + i.amount);
  const byKind = new Map<string, number>();
  for (const i of ordinary) byKind.set(i.kindLabel, (byKind.get(i.kindLabel) ?? 0) + i.amount);
  return {
    yearMonth: ym,
    total: sum(items),
    ordinaryExpense: sum(ordinary),
    depositOut: sum(items.filter((i) => natureOfItem(i) === 'deposit')),
    principalOut: sum(items.filter((i) => i.principal)),
    incomeTotal: sum(incomeItems),
    incomeEstimated: sum(incomeItems.filter((i) => i.estimated)),
    ordinaryIncome: sum(incomeItems.filter((i) => i.nature !== 'deposit')),
    depositIn: sum(incomeItems.filter((i) => i.nature === 'deposit')),
    undeterminedTotal: sum(undetermined),
    undetermined,
    autoExpense: sum(items.filter((i) => i.auto)),
    autoIncome: sum(incomeItems.filter((i) => i.auto)),
    byCategory: [...byCat.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    byKind: [...byKind.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount),
    outflow: flowSummary(items, 'expense'),
    inflow: flowSummary(incomeItems, 'income'),
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
