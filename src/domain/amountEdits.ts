import { addDays, formatDateKo } from './dates';
import { amountAt, amountVersions, changeAt, sortedChanges } from './paymentAmount';
import { expandPayment } from './schedule';
import type { ContractPayment, ContractRecord, Direction, ISODate, PaymentAmountChange } from './types';

/**
 * 반복 결제·수입 금액 수정 — 바로 덮어쓰지 않고 "언제부터" 바뀌는지 받는다.
 * 과거 일정이 바뀌는 경우는 두 가지뿐: "처음부터 이 금액이었어요"(입력 실수 정정) / 사용자가 과거 적용일을 직접 고르고 확인.
 */

export type AmountDecision = { kind: 'next' } | { kind: 'date'; date: ISODate } | { kind: 'correct' };

export type AmountChangeOp =
  | { op: 'add'; paymentId: string; effectiveFrom: ISODate; amount: number }
  | { op: 'correct'; changeId: string; amount: number };

export interface AmountEdit {
  paymentId: string;
  label: string;
  direction: Direction;
  /** 오늘 적용 중인 금액 → 새 금액 */
  from: number;
  to: number;
  /** "다음 결제일부터"의 날짜 (계약서상 결제일). null이면 남은 결제가 없음 */
  nextDate: ISODate | null;
  /** 적용일은 이 날짜보다 뒤여야 한다 (결제 시작일 — 그 이전이면 "처음부터") */
  startsOn: ISODate;
  /** 오늘 적용 중인 변경 (있으면 "입력 실수 정정"은 이 변경의 금액을 고친다) */
  current: PaymentAmountChange | null;
  /** 아직 적용 전인 변경 (정정해도 그대로 유지) */
  upcoming: PaymentAmountChange[];
}

/** 이 결제의 일정 (계약서상 결제일 nominal 기준으로 금액을 정하므로 nominal도 함께) */
function occurrences(record: ContractRecord, p: ContractPayment, start: ISODate, end: ISODate) {
  return start > end ? [] : expandPayment(p, record.contract, { start, end }, record.dates);
}

/** 오늘 이전에 이미 지난 일정이 있는 정기 결제인지 — 없으면 바꿔도 과거가 없으므로 확인 없이 최초 금액을 고친다 */
function hasPast(record: ContractRecord, p: ContractPayment, today: ISODate): boolean {
  return occurrences(record, p, p.startsOn, addDays(today, -1)).length > 0;
}

/** "다음 결제일부터"의 적용일 = 오늘 이후 첫 회차의 계약서상 결제일 */
export function nextPaymentNominal(record: ContractRecord, p: ContractPayment, today: ISODate): ISODate | null {
  return occurrences(record, p, today, addDays(today, 800))[0]?.nominalDate ?? null;
}

/** 수정한 결제 중 "언제부터"를 물어야 하는 것 */
export function detectAmountEdits(record: ContractRecord, payments: readonly { id?: string | null; amount: number; frequency: ContractPayment['frequency'] }[], today: ISODate): AmountEdit[] {
  const edits: AmountEdit[] = [];
  for (const d of payments) {
    const orig = d.id ? record.payments.find((p) => p.id === d.id) : undefined;
    if (!orig || orig.frequency === 'one_time' || d.frequency === 'one_time') continue;
    const from = amountAt(orig, today);
    if (d.amount === from || !hasPast(record, orig, today)) continue;
    edits.push({
      paymentId: orig.id,
      label: orig.label,
      direction: orig.direction,
      from,
      to: d.amount,
      nextDate: nextPaymentNominal(record, orig, today),
      startsOn: orig.startsOn,
      current: changeAt(orig, today),
      upcoming: sortedChanges(orig).filter((c) => c.effectiveFrom > today),
    });
  }
  return edits;
}

/** 직접 고른 적용일 검사 — 결제 시작일 이후여야 한다 */
export function effectiveDateError(edit: Pick<AmountEdit, 'startsOn'>, date: ISODate): string | null {
  return date > edit.startsOn ? null : '결제 시작일 이후 날짜를 골라주세요. 처음부터 다른 금액이었다면 "처음부터 이 금액이었어요"를 선택하세요.';
}

/** 과거 적용일을 고르면 바뀌는 지난 일정 수 (오늘 이전 회차 중 계약서상 결제일이 적용일 이후인 것) */
export function pastOccurrencesAffected(record: ContractRecord, paymentId: string, from: ISODate, today: ISODate): number {
  const p = record.payments.find((x) => x.id === paymentId);
  if (!p || from >= today) return 0;
  return occurrences(record, p, addDays(from, -10), addDays(today, -1)).filter((o) => o.nominalDate >= from).length;
}

/**
 * 결정 반영 → 저장할 결제(최초 금액 유지/정정)와 변경 이력 작업.
 * 수정 화면은 "오늘 적용 중인 금액"을 보여주므로, 금액을 그대로 두었으면 최초 금액으로 되돌려 저장한다 (과거가 바뀌지 않게).
 */
export function resolveAmountEdits<T extends { id?: string | null; amount: number; frequency: ContractPayment['frequency'] }>(
  record: ContractRecord,
  payments: readonly T[],
  today: ISODate,
  decisions: Readonly<Record<string, AmountDecision>>,
): { payments: T[]; ops: AmountChangeOp[] } {
  const ops: AmountChangeOp[] = [];
  const out = payments.map((d) => {
    const orig = d.id ? record.payments.find((p) => p.id === d.id) : undefined;
    if (!orig) return d;
    const decision = decisions[orig.id];
    if (!decision) {
      // 금액을 그대로 두었으면 최초 금액 유지. 지난 일정이 없는 결제의 금액 수정은 최초 금액 자체를 고친다
      return d.amount === amountAt(orig, today) ? { ...d, amount: orig.amount } : d;
    }
    if (decision.kind === 'correct') {
      const current = changeAt(orig, today);
      if (!current) return d; // 최초 금액 정정
      ops.push({ op: 'correct', changeId: current.id, amount: d.amount }); // 적용 중인 변경의 금액 정정
      return { ...d, amount: orig.amount };
    }
    const effectiveFrom = decision.kind === 'next' ? nextPaymentNominal(record, orig, today) : decision.date;
    if (!effectiveFrom || effectiveFrom <= orig.startsOn) throw new Error('적용일을 확인해주세요.');
    ops.push({ op: 'add', paymentId: orig.id, effectiveFrom, amount: d.amount });
    return { ...d, amount: orig.amount };
  });
  return { payments: out, ops };
}

export interface AmountHistoryRow {
  key: string;
  /** "~ 2026. 10. 31." / "2026. 11. 1. ~ 2027. 2. 28." / "2026. 11. 1. ~" / 예정: "2026. 11. 1.부터" */
  period: string;
  amount: number;
  /** 아직 적용 전인 변경 — 취소할 수 있다 (이미 적용이 시작된 변경은 수정·삭제 불가) */
  upcoming: boolean;
  changeId: string | null;
}

/** 계약 상세 "금액 변경 이력" — 변경 이력이 없으면 빈 목록 */
export function amountHistory(payment: ContractPayment, today: ISODate): AmountHistoryRow[] {
  if (!payment.amountChanges?.length) return [];
  return amountVersions(payment).map((v, i) => {
    const upcoming = v.change != null && v.change.effectiveFrom > today;
    const period = upcoming ? `${formatDateKo(v.from)}부터` : i === 0 ? `~ ${formatDateKo(v.to!)}` : v.to ? `${formatDateKo(v.from)} ~ ${formatDateKo(v.to)}` : `${formatDateKo(v.from)} ~`;
    return { key: v.change?.id ?? 'base', period, amount: v.amount, upcoming, changeId: v.change?.id ?? null };
  });
}
