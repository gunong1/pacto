import { directionStatusOf, fundCashEntries, natureOf, type DirectionStatus, type FlowNature } from './cashflow';
import { profileFor, profileKeyOf } from './contractKinds';
import { isConfirmedPayment, type PaymentKind } from './contractTypes';
import { adjustToBusinessDay } from './businessDays';
import { contractTermSource, getNotificationPriority, termNeedsReview, type ActionEventType, type NotificationPriority, type NotificationSource } from './notificationPriority';
import { addDays, dateInMonth, parseISODate } from './dates';
import { noticeActionType, noticeLabelOf } from './noticeKind';
import { amountOn, amountPeriods, periodBoundaries } from './paymentRules';
import { installmentText, isLoanContract, loanLegacyIssues, loanPlan } from './loanPlan';
import { prorationPlan, proratedFor, proratedText } from './payroll';
import { currentTerm, paymentCutoff, terminationNoticeDeadline } from './status';
import type {
  Contract,
  ContractCategory,
  ContractDateKind,
  ContractPayment,
  ContractRecord,
  Direction,
  ISODate,
  ScheduleItemType,
} from './types';

export interface DateRange {
  start: ISODate;
  end: ISODate;
}

const FREQUENCY_STEP_MONTHS: Record<Exclude<ContractPayment['frequency'], 'one_time'>, number> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
};

export interface PaymentOccurrence {
  /** 실제 예정일 (휴일 조정 반영) */
  date: ISODate;
  /** 계약서상 지급일 (조정 전) */
  nominalDate: ISODate;
  /** 그 회차 금액 (수습기간 등 기간별 금액 반영) */
  amount: number;
  /** 기간별 금액이 적용된 이유: '수습기간 90%' (PACTO 계산) */
  amountNote: string | null;
  paymentId: string;
  contractId: string;
  kind: PaymentKind;
  direction: Direction;
  label: string;
  /** 회차 (총 회차가 있는 결제만): 3/36 */
  installment: { no: number; total: number } | null;
  /** 금액이 변동될 수 있음 (통신비 등). */
  estimated: boolean;
  /** 첫·마지막 급여 일할 계산 문구 (payroll.proratedText) */
  prorated?: { title: string; detail: string } | null;
}

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

/** 정기 결제의 첫 회차 월 인덱스 (기준 월 주기에 맞추고, 시작일보다 앞선 날짜면 다음 주기). */
function firstOccurrenceIdx(payment: ContractPayment): number {
  const step = FREQUENCY_STEP_MONTHS[payment.frequency as keyof typeof FREQUENCY_STEP_MONTHS];
  const s = parseISODate(payment.startsOn);
  const day = payment.dayOfMonth ?? s.day;
  let idx = monthIndex(s.year, s.month);
  const anchorIdx = monthIndex(s.year, payment.monthOfYear ?? s.month);
  idx += (((anchorIdx - idx) % step) + step) % step;
  if (dateInMonth(Math.floor(idx / 12), (idx % 12) + 1, day) < payment.startsOn) idx += step;
  return idx;
}

export const FIRST_PAYMENT_CHECK = '첫 지급일 확인 필요';

/** 계약서상 첫 회차 날짜 (휴일 조정 전) */
export function firstNominalDate(payment: ContractPayment): ISODate {
  if (payment.frequency === 'one_time') return payment.startsOn;
  const idx = firstOccurrenceIdx(payment);
  return dateInMonth(Math.floor(idx / 12), (idx % 12) + 1, payment.dayOfMonth ?? parseISODate(payment.startsOn).day);
}

/**
 * 급여의 첫 지급일을 확인해야 하는지 — 첫 지급이 근로 시작 당월인지 익월인지는 계약마다 달라 계산으로 정하지 않는다.
 * 첫 지급일을 따로 정했으면(근로 시작일·입사일과 다른 날짜) 확인 필요 아님. 시작일이 없으면 확인 필요.
 */
export function firstPaymentNeedsCheck(payment: ContractPayment, contract: Contract, dates: ContractRecord['dates'] = []): boolean {
  // 급여(kind)면 방향과 무관 — 역할 확정 전(방향 확인 필요)에도 같은 안내
  if (payment.kind !== 'salary' || payment.frequency === 'one_time') return false;
  // 급여 산정기간·지급 시기·일할 기준이 확인되면 첫 지급일은 계산으로 정해진다 (payroll.ts)
  if (prorationPlan({ contract, dates }, payment).status === 'ready') return false;
  const start = contract.startDate;
  if (!start) return true;
  const hire = dates.find((d) => d.kind === 'hire')?.date;
  return payment.startsOn === start || payment.startsOn === hire;
}

/** 총 회차가 있는 결제의 마지막 회차 날짜 (일시불은 결제일). */
export function lastInstallmentDate(payment: ContractPayment): ISODate | null {
  if (payment.installmentCount == null) return null;
  if (payment.frequency === 'one_time') return payment.startsOn;
  const step = FREQUENCY_STEP_MONTHS[payment.frequency];
  const idx = firstOccurrenceIdx(payment) + (payment.installmentCount - 1) * step;
  const day = payment.dayOfMonth ?? parseISODate(payment.startsOn).day;
  return dateInMonth(Math.floor(idx / 12), (idx % 12) + 1, day);
}

/**
 * 결제 규칙을 조회 범위 안의 실제 결제 목록으로 전개한다. 일시불은 startsOn이 결제일.
 * - 계약서상 지급일(nominal)에서 휴일 규칙으로 실제 예정일(date)을 구하고, 범위는 실제 예정일로 판단한다
 * - 금액은 계약 조건(수습기간 등)의 기간별 금액을 반영한다 (paymentRules.ts)
 * @param dates 계약의 주요 날짜 (입사일 등 — 기간별 금액 계산에 사용)
 */
export function expandPayment(
  payment: ContractPayment,
  contract: Contract,
  range: DateRange,
  dates: ContractRecord['dates'] = [],
): PaymentOccurrence[] {
  // 선택형·조건부·잠재·참고 금액은 결제가 아니다 — 사용자가 이용/발생으로 바꾸기 전까지 캘린더·지출·알림에 넣지 않는다
  if (!isConfirmedPayment(payment)) return [];
  const rule = payment.businessDayRule ?? 'none';
  const margin = rule === 'none' ? 0 : 10;
  // 대출 이자 납부 규칙: 계획(loanPlan)이 회차별 이자 기간·금액·납부일을 정한다 (매월 이자가 달라도 결제는 1건)
  let loanUnsure = false;
  if (payment.kind === 'interest' && payment.frequency !== 'one_time' && isLoanContract(contract)) {
    const loan = loanPlan({ contract, payments: [payment] });
    // 계산 조건이 부족하면 저장된 금액을 "예상"으로만 (확정 금액을 만들지 않음)
    loanUnsure = loan.status !== 'ready';
    if (loan.status === 'ready') {
      const cutoff = paymentCutoff(contract);
      return loan.interest
        .filter((x) => cutoff == null || x.payDate <= cutoff)
        .map((x): PaymentOccurrence => {
          const text = installmentText(x, loan.terms);
          return {
            date: adjustToBusinessDay(x.payDate, rule),
            nominalDate: x.payDate,
            amount: x.amount,
            amountNote: text.title,
            paymentId: payment.id,
            contractId: contract.id,
            kind: payment.kind,
            direction: payment.direction,
            label: payment.label,
            installment: null,
            estimated: loan.estimated,
            prorated: { title: text.title, detail: `${text.detail}${loan.estimated ? ' · 예상' : ''}` },
          };
        })
        .filter((o) => o.date >= range.start && o.date <= range.end);
    }
  }
  // 급여 규정이 확인된 급여: 첫 지급일 전 회차 없음 · 마지막 지급일 뒤 회차 없음 · 첫·마지막 급여는 일할 계산 금액 (payroll.ts)
  const plan = prorationPlan({ contract, dates }, payment);
  const nominal = expandNominal(payment, contract, { start: addDays(range.start, -margin), end: addDays(range.end, margin) }, plan.status === 'ready' ? plan.lastPayDate : null);
  const periods = amountPeriods({ contract, dates }, payment);
  // 첫 지급일이 계약서·사용자로 정해지지 않은 급여 → 첫 회차는 "확인 필요" (당월/익월 지급을 임의로 추론하지 않음)
  const firstUnsure = firstPaymentNeedsCheck(payment, contract, dates) ? firstNominalDate(payment) : null;
  return nominal
    .filter((o) => plan.status !== 'ready' || (o.nominalDate >= plan.firstPayDate && (plan.lastPayDate == null || o.nominalDate <= plan.lastPayDate)))
    .map((o) => {
      const prorated = proratedFor(plan, o.nominalDate);
      const { amount, note } = amountOn(periods, payment, o.nominalDate, prorated?.total);
      const text = prorated ? proratedText(prorated) : null;
      const amountNote = [text?.title, note, o.nominalDate === firstUnsure ? FIRST_PAYMENT_CHECK : null, loanUnsure ? LOAN_INTEREST_CHECK : null].filter(Boolean).join(' · ') || null;
      return { ...o, date: adjustToBusinessDay(o.nominalDate, rule), amount, amountNote, prorated: text, estimated: o.estimated || loanUnsure };
    })
    .filter((o) => o.date >= range.start && o.date <= range.end);
}

/**
 * 결제일(지급일)을 모르는 정기 결제·수입 — 계약서에 결제일이 없고 사용자도 입력하지 않음.
 * 다른 날짜에서 추측하지 않는다: 시작일의 날짜(근로 시작일 ≠ 급여 지급일)도, 다른 결제의 결제일도 쓰지 않는다.
 * 반복 일정을 만들지 않고 "결제일(지급일) 확인 필요"로 보여준다.
 */
/** 대출 이자 — 계산 조건(금리 방식·계산 방식·상환 방식 등)이 부족해 저장된 금액을 예상으로만 보여줄 때 */
export const LOAN_INTEREST_CHECK = '이자 계산 조건 확인 필요';

export function isPaymentDayUnknown(payment: Pick<ContractPayment, 'frequency' | 'dayOfMonth'>): boolean {
  return payment.frequency !== 'one_time' && payment.dayOfMonth == null;
}

/** 계약서상 지급일 기준 전개 (휴일 조정·기간별 금액 전) */
/** 회차로 관리하는 결제 — 계약서에 회차가 없어도 종료일 기준 총 회차를 제목에 표시 */
const COUNTED_KINDS = new Set<string>(['installment', 'loan_repayment']);

function expandNominal(
  payment: ContractPayment,
  contract: Contract,
  range: DateRange,
  /** 끝난 기간의 급여를 그 뒤에 받는 경우 (퇴사 후 마지막 급여) — 이 날짜까지는 회차를 만든다 (payroll.ts) */
  extendTo: ISODate | null = null,
): PaymentOccurrence[] {
  if (isPaymentDayUnknown(payment)) return [];
  const start = payment.startsOn;
  const cutoff = paymentCutoff(contract);
  let end: ISODate | null = payment.endsOn;
  if (cutoff != null) end = end == null ? cutoff : end < cutoff ? end : cutoff;
  const last = lastInstallmentDate(payment);
  if (last != null) end = end == null || last < end ? last : end;
  if (extendTo != null && end != null && extendTo > end && contract.lifecycle === 'active') end = extendTo;

  const s = parseISODate(start);
  const day = payment.dayOfMonth ?? s.day;
  const step = payment.frequency === 'one_time' ? 0 : FREQUENCY_STEP_MONTHS[payment.frequency];
  const firstIdx = step ? firstOccurrenceIdx(payment) : 0;
  // 총 회차: 사용자가 입력하지 않고 끝나는 날(결제 마지막일·계약 종료일·계약서 회차·해지일 중 가장 이른 날)까지의 회차 수로 계산
  let total = payment.installmentCount;
  if (step && end != null) {
    const e = parseISODate(end);
    let endIdx = monthIndex(e.year, e.month);
    if (dateInMonth(e.year, e.month, day) > end) endIdx -= 1;
    total = endIdx < firstIdx ? 0 : Math.floor((endIdx - firstIdx) / step) + 1;
  }
  const make = (date: ISODate): PaymentOccurrence => {
    const d = parseISODate(date);
    const no = step ? Math.round((monthIndex(d.year, d.month) - firstIdx) / step) + 1 : 1;
    return {
      date,
      nominalDate: date,
      // 실제 금액은 expandPayment에서 amountOn(= amountAt + 기간 규칙)으로 정한다
      amount: payment.amount,
      amountNote: null,
      paymentId: payment.id,
      contractId: contract.id,
      kind: payment.kind,
      direction: payment.direction,
      label: payment.label,
      // 캘린더·알림 제목의 "n/총회차": 계약서 회차가 있거나 할부·대출 상환처럼 회차로 관리하는 결제만 (월세·급여 등은 제목에 회차를 붙이지 않음)
      installment: total != null && (payment.installmentCount != null || COUNTED_KINDS.has(payment.kind)) ? { no, total } : null,
      estimated: payment.isVariable,
    };
  };
  const inBounds = (date: ISODate) =>
    date >= start && date >= range.start && date <= range.end && (end == null || date <= end);

  if (payment.frequency === 'one_time') {
    // 일시불은 종료/해지와 무관하게 정해진 날에 한 번 (해지 처리 이후 날짜면 제외)
    return start >= range.start && start <= range.end && (cutoff == null || start <= cutoff || contract.lifecycle === 'active') ? [make(start)] : [];
  }

  const anchorMonth = payment.monthOfYear ?? s.month;
  const anchorIdx = monthIndex(s.year, anchorMonth);

  const rs = parseISODate(range.start);
  const re = parseISODate(range.end);
  let idx = Math.max(monthIndex(s.year, s.month), monthIndex(rs.year, rs.month));
  idx += (((anchorIdx - idx) % step) + step) % step; // 기준 월 주기에 정렬
  const lastIdx = monthIndex(re.year, re.month);

  const out: PaymentOccurrence[] = [];
  for (; idx <= lastIdx; idx += step) {
    const date = dateInMonth(Math.floor(idx / 12), (idx % 12) + 1, day);
    if (inBounds(date)) out.push(make(date));
  }
  return out;
}

export interface ScheduleItem {
  key: string;
  date: ISODate;
  type: ScheduleItemType;
  title: string;
  /** 계산 내역 한 줄 (일할 계산 급여: "10월 총 31일 중 17일분 일할 계산 · 세전") */
  detail?: string | null;
  /** 대출 원금 상환 — 총 출금에는 들어가지만 일반 지출과 구분 */
  principal?: boolean;
  /** 결제 항목의 의미 (결제가 아니면 null) */
  paymentKind: PaymentKind | null;
  /** 결제 항목의 돈 방향 (결제가 아니면 null) — neutral = 방향 확인 필요 (합계에 넣지 않음) */
  direction: Direction | null;
  /** 결제 항목의 돈 성격 — 일반 / 보증금·예치금(지급·반환) · null = 알 수 없음 (cashflow.ts) */
  moneyNature?: FlowNature | null;
  /** 결제 방향의 상태 (확인한 역할 · 사용자 선택 · 자동 판단 · 예전 값 · 확인 필요) — 결제 일정만 */
  directionStatus?: DirectionStatus;
  amount: number | null;
  estimated: boolean;
  contractId: string;
  contractTitle: string;
  category: ContractCategory;
  /** 사용자 일정 id (계산된 일정은 null) */
  eventId: string | null;
  /** 주요 날짜의 종류 (설치일·개통일 … — 캘린더 요약에서 같은 의미의 시작 일정을 하나로 볼 때 사용) */
  dateKind?: ContractDateKind;
  /** 행동 중심 종류 · 중요도 · 출처 (notificationPriority.ts — 알림과 같은 규칙) */
  actionType: ActionEventType;
  priority: NotificationPriority;
  source: NotificationSource;
  /** AI 추정값에서 나온 날짜 — 확인 전까지 확정 기한으로 보지 않음 */
  needsReview: boolean;
}

type ScheduleItemDraft = Omit<ScheduleItem, 'actionType' | 'priority' | 'source' | 'needsReview'> & { action?: ActionEventType };

/** 일정 한 건의 종류·출처·중요도 — 날짜를 만든 근거에 따라 */
function withMeta(record: ContractRecord, { action, ...item }: ScheduleItemDraft): ScheduleItem {
  const { contract } = record;
  const term = contractTermSource(contract);
  let actionType: ActionEventType;
  let source: NotificationSource = term;
  let needsReview = false;
  switch (item.type) {
    case 'payment':
      actionType = item.direction === 'income' ? 'income' : 'payment';
      break;
    case 'termination_notice':
      // 통보기한의 의미(해지 통보·갱신 통지·갱신 여부 확인·불확실)에 따라 종류·중요도가 달라진다
      actionType = noticeActionType(contract.noticeKind);
      needsReview = contract.noticeKind === 'unknown' || termNeedsReview(contract, ['endDate', 'terminationNoticeDays']);
      break;
    case 'renewal':
      actionType = 'renewal';
      needsReview = termNeedsReview(contract, ['endDate', 'renewalPeriodMonths']);
      break;
    case 'contract_end':
      actionType = /만기/.test(profileFor(contract).endEvent) ? 'maturity' : 'contract_end';
      needsReview = termNeedsReview(contract, ['endDate']);
      // 해지·종료 처리 기록은 사용자가 입력한 상태
      if (item.key.startsWith('closed:')) source = 'manual_entry';
      break;
    case 'prepare':
      // 계약서·법령이 아닌 PACTO 기본 사전 안내 (예: 임대차 만기 60일 전 갱신 여부 확인)
      actionType = 'prepare';
      source = 'pacto';
      break;
    case 'contract_start':
      actionType = 'contract_start';
      break;
    case 'key_date':
      actionType = 'key_date';
      break;
    default:
      actionType = 'custom';
  }
  // 보증금 반환 (반환 예정·반환 기록·반환 확인)
  if (action) actionType = action;
  // 사용자가 직접 만든 일정
  if (item.eventId) {
    const e = record.events.find((x) => x.id === item.eventId);
    source = e?.source === 'user' ? 'user_custom' : term;
    actionType = item.type === 'termination_notice' ? 'termination_notice' : item.type === 'contract_end' ? 'contract_end' : item.type === 'renewal' ? 'renewal' : item.type === 'payment' ? 'payment' : 'custom';
    needsReview = false;
  }
  return { ...item, actionType, source, needsReview, priority: getNotificationPriority(actionType, { source, needsReview }) };
}

const TYPE_ORDER: Record<ScheduleItemType, number> = {
  termination_notice: 0,
  prepare: 1,
  contract_end: 2,
  renewal: 3,
  contract_start: 4,
  key_date: 5,
  payment: 6,
  custom: 7,
};

/**
 * 한 계약의 일정. 계약 유형 프로필은 이름(이용 시작·대출 실행·보험 만기 …)만 정하고,
 * 실제 항목은 그 계약에 저장된 결제 목록·주요 날짜·기간에서 만든다.
 * - 결제: 결제 규칙 전개 (회차·종료일 반영)
 * - 시작일 / 종료일(만기) / 자동갱신 / 해지 통보기한 / 종료 전 확인 시점(임대차)
 * - 주요 날짜(설치·입주·잔금·갱신 …), 사용자 일정
 * - 계약 체결일은 기록용이라 일정에 넣지 않는다
 * 모두 저장하지 않고 계산 → 계약을 수정하면 자동으로 다시 만들어진다.
 */
export function contractSchedule(record: ContractRecord, range: DateRange, today: ISODate): ScheduleItem[] {
  const { contract } = record;
  const base = { contractId: contract.id, contractTitle: contract.title, category: contract.category };
  const items: ScheduleItemDraft[] = [];
  const inRange = (d: ISODate | null | undefined): d is ISODate => !!d && d >= range.start && d <= range.end;

  // 대출 실행금(예전 분석으로 결제로 저장된 것)은 입출금 일정·합계에 넣지 않는다 — 저장값은 그대로, 정리는 사용자가 (loanLegacyIssues)
  const disbursed = new Set(loanLegacyIssues(record).disbursements.map((p) => p.id));
  for (const p of record.payments) {
    if (disbursed.has(p.id)) continue;
    for (const o of expandPayment(p, contract, range, record.dates)) {
      items.push({
        ...base,
        key: `pay:${p.id}:${o.date}`,
        date: o.date,
        type: 'payment',
        // 일할 계산 회차는 "첫 급여 · 10월 15일~31일 근무분" (분수 표기 없이) — 계산 내역은 detail
        title: o.prorated
          ? [o.prorated.title, o.amountNote?.replace(o.prorated.title, '').replace(/^ · /, '')].filter(Boolean).join(' · ')
          : `${o.installment ? `${p.label} ${o.installment.no}/${o.installment.total}회` : p.label}${o.amountNote ? ` (${o.amountNote})` : ''}`,
        detail: o.prorated?.detail ?? null,
        // 대출 원금 상환 (일회성) — 실제 현금 유출이지만 일반 지출과 따로 집계 (spending.ts)
        principal: p.kind === 'loan_repayment' && p.frequency === 'one_time' ? true : undefined,
        paymentKind: p.kind,
        direction: p.direction,
        directionStatus: directionStatusOf(p, contract),
        moneyNature: natureOf(p),
        amount: o.amount,
        estimated: o.estimated,
        eventId: null,
      });
    }
  }

  // 돌려받을 돈: 실제 반환 기록 · 계약서에 적힌 반환 예정(금액 포함) · 종료일 기준 반환 확인(금액 없음 — 합계에 넣지 않음)
  for (const f of fundCashEntries(record, range, today)) {
    const cash = f.type !== 'check';
    items.push({
      ...base,
      key: f.key,
      date: f.date,
      type: cash ? 'payment' : 'key_date',
      title: f.title,
      paymentKind: cash ? 'deposit' : null,
      direction: cash ? f.direction : null,
      moneyNature: cash ? 'deposit' : null,
      amount: f.amount,
      estimated: false,
      eventId: null,
      action: 'deposit_return',
    });
  }

  const profile = profileFor(contract);
  const plain = { paymentKind: null, direction: null, amount: null, estimated: false, eventId: null };

  if (profile.startEvent && inRange(contract.startDate)) {
    items.push({ ...base, ...plain, key: `start:${contract.id}`, date: contract.startDate, type: 'contract_start', title: profile.startEvent });
  }

  for (const d of record.dates) {
    if (!inRange(d.date)) continue;
    items.push({ ...base, ...plain, key: `date:${d.id}`, date: d.date, type: 'key_date', title: d.label, dateKind: d.kind });
  }

  // 기간의 끝 (수습기간 종료 예정 등) — 계약 조건에서 계산
  if (contract.lifecycle === 'active') {
    for (const b of periodBoundaries(record)) {
      if (inRange(b.date)) items.push({ ...base, ...plain, key: `${b.key}:${contract.id}`, date: b.date, type: 'key_date', title: b.label });
    }
  }

  if (contract.lifecycle === 'active') {
    const term = currentTerm(contract, today);
    const ends = new Set<ISODate>();
    if (contract.endDate) ends.add(contract.endDate);
    if (term) ends.add(term.termEnd);
    for (const end of ends) {
      if (!inRange(end)) continue;
      items.push({
        ...base,
        key: `end:${contract.id}:${end}`,
        date: end,
        type: 'contract_end',
        title: contract.autoRenewal ? `${profile.endEvent} (자동갱신 조건)` : profile.endEvent,
        paymentKind: null,
        direction: null,
        amount: null,
        estimated: end !== contract.endDate,
        eventId: null,
      });
    }
    if (contract.autoRenewal && term) {
      const renewal = addDays(term.termEnd, 1);
      if (inRange(renewal)) {
        items.push({ ...base, ...plain, key: `renew:${contract.id}:${renewal}`, date: renewal, type: 'renewal', title: '자동갱신 예정' });
      }
    }
    const notice = terminationNoticeDeadline(contract, today);
    if (notice && inRange(notice.date)) {
      items.push({ ...base, ...plain, key: `notice:${contract.id}:${notice.date}`, date: notice.date, type: 'termination_notice', title: noticeLabelOf(contract.noticeKind, profileKeyOf(contract)) });
    }
    const prep = prepareDate(contract);
    // 계약서에 갱신 여부 확인 시점이 있으면 PACTO 기본 안내(갱신 여부 확인)를 따로 만들지 않는다
    if (prep && inRange(prep.date) && !(notice && contract.noticeKind === 'renewal_decision')) {
      items.push({ ...base, ...plain, key: `prepare:${contract.id}:${prep.date}`, date: prep.date, type: 'prepare', title: prep.label });
    }
  } else if (contract.lifecycleChangedOn && inRange(contract.lifecycleChangedOn)) {
    items.push({
      ...base,
      key: `closed:${contract.id}`,
      date: contract.lifecycleChangedOn,
      type: 'contract_end',
      title: contract.lifecycle === 'cancelled' ? '계약 해지' : '계약 종료',
      paymentKind: null,
      direction: null,
      amount: null,
      estimated: false,
      eventId: null,
    });
  }

  for (const e of record.events) {
    if (!inRange(e.eventDate)) continue;
    items.push({ ...base, key: `event:${e.id}`, date: e.eventDate, type: e.eventType, title: e.title, paymentKind: null, direction: null, amount: e.amount, estimated: false, eventId: e.id });
  }

  return items.map((i) => withMeta(record, i));
}

/** 종료 전 미리 확인할 시점 (임대차: 만기 60일 전 갱신 확인). 자동갱신 계약은 해지 통보기한으로 대신한다. */
export function prepareDate(contract: Contract): { date: ISODate; label: string; guidance: string } | null {
  const prep = profileFor(contract).prepare;
  if (!prep || !contract.endDate || contract.autoRenewal || contract.lifecycle !== 'active') return null;
  return { date: addDays(contract.endDate, -prep.daysBefore), label: prep.label, guidance: prep.guidance };
}

export function sortSchedule(items: ScheduleItem[]): ScheduleItem[] {
  return [...items].sort(
    (a, b) => a.date.localeCompare(b.date) || TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.contractTitle.localeCompare(b.contractTitle),
  );
}

export function scheduleForRange(records: ContractRecord[], range: DateRange, today: ISODate): ScheduleItem[] {
  return sortSchedule(records.flatMap((r) => contractSchedule(r, range, today)));
}

/** 계약의 다음 결제 (오늘 포함, 최대 13개월 앞까지 탐색). */
export function nextPayment(record: ContractRecord, today: ISODate): PaymentOccurrence | null {
  const range = { start: today, end: addDays(today, 400) };
  const all = record.payments.flatMap((p) => expandPayment(p, record.contract, range, record.dates));
  all.sort((a, b) => a.date.localeCompare(b.date));
  return all[0] ?? null;
}
