/**
 * 대출 상환 계획 — 이자 납부 규칙 1개(결제 kind=interest)와 대출 정보(원금·금리·방식·기준)로 월별 이자·만기 원금을 계산한다.
 * 매월 이자가 달라도 결제 항목을 여러 개 만들지 않는다: 이자 결제 1건 + 이 계획이 회차별 금액을 정한다.
 *
 * 계산 (계약서 기준이 확인된 경우만 — AI가 추정만 한 값(inferred)은 쓰지 않음):
 * - 이자 계산 기간: calendar_month 매월 1일~말일 (첫 기간은 실행일부터, 마지막은 만기일까지 — 양 끝 포함), 다음 달 납부일에 냄 · 마지막 기간은 만기일에
 *                   pay_cycle 직전 납부일(첫 기간은 실행일)~다음 납부일 전날, 마지막 기간은 만기일 전날까지 · 만기일에 냄
 * - 이자: 원금 × 연 이자율 × 일수 ÷ 365(또는 360) / monthly_12는 한 달 전체 기간만 원금 × 연 이자율 ÷ 12
 * - 원 단위: 계약서 규정 (없으면 원 미만 반올림한 예상액)
 * 확정 금액을 만들지 않는 경우 (needs_check): 원금·금리·실행일·만기일·납부일·계산 방식·계산 기간·금리 방식·상환 방식 중 빠진 값,
 *   원리금균등·원금균등 등 분할 상환 (회차별 원금이 필요)
 * 변동·혼합 금리는 지금 금리 기준 "예상" 금액 (estimated).
 */
import { addDays, dateInMonth, daysInMonth, diffDays, parseISODate, toISODate } from './dates';
import { formatWonShort } from './money';
import { isConfirmedPayment } from './contractTypes';
import type { Contract, ContractPayment, ContractRecord, ISODate } from './types';

export type InterestDayCount = 'actual_365' | 'actual_360' | 'monthly_12';
export type InterestPeriod = 'calendar_month' | 'pay_cycle';
export type InterestRounding = 'floor_1' | 'round_1' | 'floor_10';
export type RateType = 'fixed' | 'variable' | 'mixed';
export type RepaymentMethod = 'equal_payment' | 'equal_principal' | 'bullet' | 'other';

export interface LoanTerms {
  principal: number | null;
  /** 연 이자율 (%) */
  ratePct: number | null;
  rateType: RateType | null;
  method: RepaymentMethod | null;
  dayCount: InterestDayCount | null;
  period: InterestPeriod | null;
  rounding: InterestRounding | null;
  /** 대출 실행일 (계약 시작일) */
  start: ISODate | null;
  /** 만기일 (계약 종료일) */
  maturity: ISODate | null;
  /** 이자 납부일 (매월 N일 — 이자 결제의 지급일) */
  payDay: number | null;
}

export const LOAN_TERM_LABEL: Record<keyof LoanTerms, string> = {
  principal: '대출 원금',
  ratePct: '금리',
  rateType: '금리 방식 (고정·변동)',
  method: '상환 방식',
  dayCount: '이자 계산 방식',
  period: '이자 계산 기간',
  rounding: '이자 원 단위 처리',
  start: '대출 실행일',
  maturity: '만기일',
  payDay: '이자 납부일',
};

const DETAIL_KEY = { principal: 'principal', ratePct: 'interestRate', rateType: 'rateType', method: 'repaymentMethod', dayCount: 'interestDayCount', period: 'interestPeriod', rounding: 'interestRounding' } as const;

/** 이자 납부 규칙 결제 (정기 · 확정) — 하나만 쓴다 */
export function interestPayment(record: Pick<ContractRecord, 'payments'>): ContractPayment | null {
  return record.payments.find((p) => p.kind === 'interest' && p.frequency !== 'one_time' && isConfirmedPayment(p)) ?? null;
}

/** 만기 원금 상환 결제 (일회성 원리금 상환) */
export function principalRepayment(record: Pick<ContractRecord, 'payments'>): ContractPayment | null {
  return record.payments.find((p) => p.kind === 'loan_repayment' && p.frequency === 'one_time') ?? null;
}

/** 대출 계약인지 (관리 프로필 = loan) */
export function isLoanContract(contract: Pick<Contract, 'contractType'>): boolean {
  return contract.contractType === 'loan';
}

export function loanTerms(record: Pick<ContractRecord, 'contract' | 'payments'>): { terms: LoanTerms; unconfirmed: (keyof LoanTerms)[] } {
  const { contract } = record;
  const d = (contract.details ?? {}) as Record<string, unknown>;
  const unconfirmed: (keyof LoanTerms)[] = [];
  const pick = <T>(k: keyof typeof DETAIL_KEY, ok: (v: unknown) => v is T): T | null => {
    const v = d[DETAIL_KEY[k]];
    if (v == null || !ok(v)) return null;
    if (contract.valueSources?.[`details.${DETAIL_KEY[k]}`] === 'inferred') {
      unconfirmed.push(k);
      return null;
    }
    return v;
  };
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const oneOf = <T extends string>(list: readonly T[]) => (v: unknown): v is T => list.includes(v as T);
  return {
    terms: {
      principal: pick('principal', num),
      ratePct: pick('ratePct', (v): v is number => typeof v === 'number' && v > 0 && v < 100),
      rateType: pick('rateType', oneOf(['fixed', 'variable', 'mixed'] as const)),
      method: pick('method', oneOf(['equal_payment', 'equal_principal', 'bullet', 'other'] as const)),
      dayCount: pick('dayCount', oneOf(['actual_365', 'actual_360', 'monthly_12'] as const)),
      period: pick('period', oneOf(['calendar_month', 'pay_cycle'] as const)),
      rounding: pick('rounding', oneOf(['floor_1', 'round_1', 'floor_10'] as const)),
      start: contract.startDate ?? null,
      maturity: contract.endDate ?? null,
      payDay: interestPayment(record)?.dayOfMonth ?? null,
    },
    unconfirmed,
  };
}

export interface InterestInstallment {
  /** 회차 (1부터) */
  no: number;
  kind: 'first' | 'regular' | 'final';
  /** 이자 계산 기간 (양 끝 포함) */
  from: ISODate;
  to: ISODate;
  days: number;
  /** 계약상 납부일 (휴일 조정 전) */
  payDate: ISODate;
  amount: number;
  /** 한 달 전체가 아닌 기간을 monthly_12로 계산할 수 없어 일수로 어림한 회차 */
  approximated: boolean;
}

export type LoanPlan =
  | { status: 'not_loan' }
  | { status: 'needs_check'; missing: (keyof LoanTerms)[]; reason: string | null }
  | {
      status: 'ready';
      terms: LoanTerms & { principal: number; ratePct: number; start: ISODate; maturity: ISODate; payDay: number };
      interest: InterestInstallment[];
      totalInterest: number;
      /** 만기 원금 상환 (만기일시만) */
      principal: { date: ISODate; amount: number } | null;
      /** 변동금리·원 단위 규정 없음 등 — 금액은 예상 */
      estimated: boolean;
      notes: string[];
    };

const REQUIRED: (keyof LoanTerms)[] = ['principal', 'ratePct', 'start', 'maturity', 'payDay', 'dayCount', 'period', 'rateType', 'method'];

/** 원금 × 이율(%) × 일수 ÷ (100 × 기준일수) — 정수 연산 (BigInt) 후 원 단위 처리 */
function interestFor(principal: number, ratePct: number, days: number, basis: number, rounding: InterestRounding | null): number {
  const rateMicro = BigInt(Math.round(ratePct * 1_000_000)); // 0.000001% 단위
  const num = BigInt(Math.round(principal)) * rateMicro * BigInt(days);
  const den = 100n * 1_000_000n * BigInt(basis);
  if (rounding === 'floor_10') return Number((num / (den * 10n)) * 10n);
  if (rounding === 'floor_1') return Number(num / den);
  return Number((2n * num + den) / (2n * den)); // 반올림 (규정 없음 → 예상액)
}

const monthEnd = (d: ISODate) => {
  const { year, month } = parseISODate(d);
  return toISODate(year, month, daysInMonth(year, month));
};
const nextMonthDay = (d: ISODate, day: number) => {
  const { year, month } = parseISODate(d);
  return month === 12 ? dateInMonth(year + 1, 1, day) : dateInMonth(year, month + 1, day);
};

export function loanPlan(record: Pick<ContractRecord, 'contract' | 'payments'>): LoanPlan {
  if (!isLoanContract(record.contract)) return { status: 'not_loan' };
  const { terms, unconfirmed } = loanTerms(record);
  const missing = REQUIRED.filter((k) => terms[k] == null);
  if (missing.length > 0) return { status: 'needs_check', missing: [...new Set([...missing, ...unconfirmed.filter((k) => k !== 'rounding')])], reason: null };
  if (terms.method !== 'bullet') {
    return { status: 'needs_check', missing: [], reason: '원리금균등·원금균등처럼 나눠 갚는 대출은 회차별 원금 상환표가 필요해 자동으로 계산하지 않아요' };
  }
  const t = terms as LoanTerms & { principal: number; ratePct: number; start: ISODate; maturity: ISODate; payDay: number };
  if (t.maturity <= t.start) return { status: 'needs_check', missing: ['maturity'], reason: '만기일이 실행일보다 앞서요' };

  // 이자 계산 기간
  const periods: { from: ISODate; to: ISODate; payDate: ISODate }[] = [];
  if (t.period === 'calendar_month') {
    for (let from = t.start; from <= t.maturity && periods.length < 600; ) {
      const end = monthEnd(from);
      const to = end < t.maturity ? end : t.maturity;
      periods.push({ from, to, payDate: to === t.maturity ? t.maturity : nextMonthDay(to, t.payDay) });
      from = addDays(to, 1);
    }
  } else {
    const { year, month } = parseISODate(t.start);
    let pay = dateInMonth(year, month, t.payDay);
    if (pay <= t.start) pay = nextMonthDay(pay, t.payDay);
    for (let from = t.start; from < t.maturity && periods.length < 600; ) {
      const due = pay < t.maturity ? pay : t.maturity;
      periods.push({ from, to: addDays(due, -1), payDate: due });
      from = due;
      pay = nextMonthDay(pay, t.payDay);
    }
  }

  const basis = t.dayCount === 'actual_360' ? 360 : 365;
  const notes: string[] = [];
  let approx = false;
  const interest = periods.map((p, i): InterestInstallment => {
    const days = diffDays(p.from, p.to) + 1;
    const whole = p.from.slice(8) === '01' && p.to === monthEnd(p.from);
    let amount: number;
    let approximated = false;
    if (t.dayCount === 'monthly_12' && whole) amount = interestFor(t.principal, t.ratePct, 1, 12, t.rounding);
    else {
      approximated = t.dayCount === 'monthly_12';
      amount = interestFor(t.principal, t.ratePct, days, basis, t.rounding);
    }
    if (approximated) approx = true;
    return { no: i + 1, kind: i === 0 ? 'first' : i === periods.length - 1 ? 'final' : 'regular', from: p.from, to: p.to, days, payDate: p.payDate, amount, approximated };
  });
  if (t.rateType !== 'fixed') notes.push('변동금리라 지금 금리 기준 예상 이자예요. 금리가 바뀌면 이자도 바뀌어요');
  if (t.rounding == null) notes.push('원 단위 처리 규정이 없어 원 미만을 반올림한 예상액이에요');
  if (approx) notes.push('한 달이 다 차지 않는 기간은 실제 일수로 어림했어요');
  return {
    status: 'ready',
    terms: t,
    interest,
    totalInterest: interest.reduce((s, x) => s + x.amount, 0),
    principal: { date: t.maturity, amount: t.principal },
    estimated: t.rateType !== 'fixed' || t.rounding == null || approx,
    notes,
  };
}

/** 회차 표시 문구 — "첫 이자 · 10월 20일~31일 (12일)" / 계산 내역 "원금 3,000만원 · 연 6% · 12일 ÷ 365" */
export function installmentText(x: InterestInstallment, terms: Pick<LoanTerms, 'principal' | 'ratePct' | 'dayCount'>): { title: string; detail: string } {
  const md = (d: ISODate) => ({ m: Number(d.slice(5, 7)), d: Number(d.slice(8, 10)) });
  const a = md(x.from);
  const b = md(x.to);
  const range = a.m === b.m ? (a.d === b.d ? `${a.m}월 ${a.d}일` : `${a.m}월 ${a.d}일~${b.d}일`) : `${a.m}월 ${a.d}일~${b.m}월 ${b.d}일`;
  const name = x.kind === 'first' ? '첫 이자' : x.kind === 'final' ? '만기 최종 이자' : '이자';
  const how = terms.dayCount === 'monthly_12' && !x.approximated ? '연 이자율 ÷ 12' : `${x.days}일 ÷ ${terms.dayCount === 'actual_360' ? 360 : 365}`;
  return { title: `${name} · ${range} (${x.days}일)`, detail: `원금 ${formatWonShort(terms.principal ?? 0)} · 연 ${terms.ratePct}% · ${how}` };
}

// ─────────────────────────────── 계약서 예시 금액 대조 · 예전 저장 데이터 점검 ───────────────────────────────

const INTEREST_WORD = /이자/;
const CONDITIONAL_INTEREST = /연체|지연|지체|가산|위약/;
const DISBURSE_WORD = /(대출\s*(금|금액|원금)|원금|실행\s*금|대출\s*실행|대여\s*금|차입\s*금)/;
const REPAY_WORD = /상환|변제|갚/;

/**
 * 계약서에 적힌 회차별 이자(참고 금액으로 보관된 예시)가 계산과 맞는지 — 같은 금액의 회차가 있으면 일치.
 * 계산 규칙 검증용 (예시 금액으로 일정을 따로 만들지 않음)
 */
export function interestExamples(record: Pick<ContractRecord, 'contract'>, plan: LoanPlan): { label: string; amount: number; matched: boolean }[] {
  const refs = (record.contract.referenceAmounts ?? []).filter((r) => INTEREST_WORD.test(r.label) && !CONDITIONAL_INTEREST.test(r.label) && r.amount > 0);
  const amounts = new Set(plan.status === 'ready' ? plan.interest.map((x) => x.amount) : []);
  return refs.map((r) => ({ label: r.label, amount: r.amount, matched: amounts.has(r.amount) }));
}

/** 예전 분석으로 저장된 대출 금액 중 사용자 확인이 필요한 것 (자동으로 바꾸지 않음) */
export function loanLegacyIssues(record: Pick<ContractRecord, 'contract' | 'payments'>): { disbursements: ContractPayment[]; interestRows: ContractPayment[] } {
  if (!isLoanContract(record.contract)) return { disbursements: [], interestRows: [] };
  const { startDate, endDate } = record.contract;
  const principal = Number((record.contract.details as Record<string, unknown>)?.principal ?? NaN);
  // 실행일에 저장된 원금(입금·출금 어느 방향이든) — 실행일·이름/원금 금액이 모두 맞을 때만 (상환·이자 이름은 제외)
  const disbursements = record.payments.filter(
    (p) =>
      p.frequency === 'one_time' &&
      p.kind !== 'loan_repayment' &&
      startDate != null &&
      p.startsOn === startDate &&
      p.startsOn !== endDate &&
      !REPAY_WORD.test(p.label) &&
      !INTEREST_WORD.test(p.label) &&
      (DISBURSE_WORD.test(p.label) || p.amount === principal),
  );
  const interest = record.payments.filter((p) => (p.kind === 'interest' || INTEREST_WORD.test(p.label)) && !CONDITIONAL_INTEREST.test(p.label) && isConfirmedPayment(p) && !REPAY_WORD.test(p.label));
  const interestRows = interest.length > 1 || interest.some((p) => p.frequency === 'one_time') ? interest : [];
  return { disbursements, interestRows };
}

/** 이자 행 여러 개 → 이자 납부 규칙 1건으로 바꿀 때의 값 (납부일 = 가장 많이 쓰인 날 · 첫 납부일 = 가장 이른 날 · 만기까지) */
export function interestRuleFrom(rows: readonly ContractPayment[], maturity: ISODate | null): { dayOfMonth: number | null; startsOn: ISODate; endsOn: ISODate | null; amount: number } {
  const sorted = [...rows].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const count = new Map<number, number>();
  for (const p of sorted) {
    const day = p.dayOfMonth ?? Number(p.startsOn.slice(8, 10));
    if (p.startsOn !== maturity) count.set(day, (count.get(day) ?? 0) + 1);
  }
  const dayOfMonth = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { dayOfMonth, startsOn: sorted[0].startsOn, endsOn: maturity ?? sorted[sorted.length - 1].startsOn, amount: sorted[0].amount };
}
