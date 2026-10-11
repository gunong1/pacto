import { isConfirmedPayment } from './contractTypes';
import { addDays, minDate } from './dates';
import { expandPayment, firstPaymentNeedsCheck, isPaymentDayUnknown, lastInstallmentDate } from './schedule';
import { paymentCutoff } from './status';
import type { Contract, ContractPayment, ContractRecord, ISODate } from './types';

/**
 * 결제 일정 요약 — 총 회차·진행 회차·남은 회차·마지막 결제일을 사용자가 입력하지 않고 계산한다.
 * 회차는 캘린더·지출과 같은 일정 전개(expandPayment)에서 센다 → 금액 변경 이력·휴일 조정과 무관하게 일관된다.
 *
 * 끝나는 시점 (계산 우선순위)
 * 1. 날짜로 정해진 끝: 결제의 마지막 결제일(계약서의 납입기간 등) 또는 계약 종료일(자동갱신 아님)
 * 2. 날짜가 없으면 계약서의 총 회차 → 첫 결제일 + 회차로 마지막 결제일
 * 3. 둘 다 없으면 무기한 반복 (총 회차 없음)
 * 날짜와 총 회차가 둘 다 있고 서로 다르면 일정은 더 이른 쪽에서 끝내고(없는 결제를 만들지 않음) "확인 필요"로 알린다.
 */

export type PlanBasis = 'end_date' | 'installments' | 'open';

export interface PaymentPlan {
  first: ISODate | null;
  /** 마지막 결제일 (무기한이면 null) */
  last: ISODate | null;
  /** 총 회차 (무기한이면 null) */
  total: number | null;
  /** 오늘까지 지난 회차 (예정일 기준) */
  done: number;
  remaining: number | null;
  basis: PlanBasis;
  /** 계약서 총 회차와 종료일 기준 회차가 다름 */
  conflict: { installments: number; byDate: number } | null;
  /** 첫 지급일 확인 필요 (급여: 당월/익월 지급을 임의로 정하지 않음) */
  firstNeedsCheck: boolean;
}

/** 날짜로 정해진 끝 (결제 마지막 결제일 · 자동갱신 아닌 계약 종료일 · 해지/만료 처리일) */
function dateEnd(p: ContractPayment, contract: Contract): ISODate | null {
  const cutoff = paymentCutoff(contract);
  if (p.endsOn && cutoff) return minDate(p.endsOn, cutoff);
  return p.endsOn ?? cutoff;
}

const occurrences = (p: ContractPayment, contract: Contract, dates: ContractRecord['dates'], end: ISODate) =>
  expandPayment(p, contract, { start: addDays(p.startsOn, -10), end: addDays(end, 10) }, dates);

export function paymentPlan(p: ContractPayment, record: Pick<ContractRecord, 'contract' | 'dates'>, today: ISODate): PaymentPlan | null {
  if (p.frequency === 'one_time' || !isConfirmedPayment(p) || isPaymentDayUnknown(p)) return null;
  const { contract, dates } = record;
  const firstNeedsCheck = firstPaymentNeedsCheck(p, contract, dates);
  const byDateEnd = dateEnd(p, contract);
  const byCountEnd = lastInstallmentDate(p);
  const end = byDateEnd && byCountEnd ? minDate(byDateEnd, byCountEnd) : (byDateEnd ?? byCountEnd);

  if (!end) {
    // 무기한 반복 — 진행 회차만 (첫 결제는 앞으로 2년 안에서 찾는다)
    const past = expandPayment(p, contract, { start: addDays(p.startsOn, -10), end: today }, dates);
    const first = past[0]?.date ?? expandPayment(p, contract, { start: today, end: addDays(today, 800) }, dates)[0]?.date ?? null;
    return { first, last: null, total: null, done: past.length, remaining: null, basis: 'open', conflict: null, firstNeedsCheck };
  }

  const all = occurrences(p, contract, dates, end);
  const done = all.filter((o) => o.date <= today).length;
  let conflict: PaymentPlan['conflict'] = null;
  if (byDateEnd && p.installmentCount != null) {
    const byDate = occurrences({ ...p, installmentCount: null }, contract, dates, byDateEnd).length;
    if (byDate !== p.installmentCount) conflict = { installments: p.installmentCount, byDate };
  }
  return {
    first: all[0]?.date ?? null,
    last: all.at(-1)?.date ?? null,
    total: all.length,
    done,
    remaining: all.length - done,
    basis: byDateEnd ? 'end_date' : 'installments',
    conflict,
    firstNeedsCheck,
  };
}

/** 화면 표기: "총 24회 · 10회 진행 · 14회 남음" / 무기한 "10회 진행 · 종료일 없이 반복" */
export function planSummary(plan: PaymentPlan): string {
  if (plan.total == null) return plan.done > 0 ? `${plan.done}회 진행 · 종료일 없이 반복` : '종료일 없이 반복';
  return `총 ${plan.total}회 · ${plan.done}회 진행 · ${plan.remaining}회 남음`;
}
