import { addDays, dateInMonth, parseISODate } from './dates';
import { currentTerm, paymentCutoff, terminationNoticeDeadline } from './status';
import type {
  Contract,
  ContractCategory,
  ContractEventType,
  ContractPayment,
  ContractRecord,
  ISODate,
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
  date: ISODate;
  amount: number;
  paymentId: string;
  contractId: string;
  label: string;
  /** 금액이 변동될 수 있음 (통신비 등). */
  estimated: boolean;
}

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

/** 결제 규칙을 조회 범위 안의 실제 결제일 목록으로 전개한다. */
export function expandPayment(
  payment: ContractPayment,
  contract: Contract,
  range: DateRange,
): PaymentOccurrence[] {
  const start = payment.startsOn;
  const cutoff = paymentCutoff(contract);
  let end: ISODate | null = payment.endsOn;
  if (cutoff != null) end = end == null ? cutoff : end < cutoff ? end : cutoff;

  const s = parseISODate(start);
  const day = payment.dayOfMonth ?? s.day;
  const make = (date: ISODate): PaymentOccurrence => ({
    date,
    amount: payment.amount,
    paymentId: payment.id,
    contractId: contract.id,
    label: payment.label,
    estimated: payment.isVariable,
  });
  const inBounds = (date: ISODate) =>
    date >= start && date >= range.start && date <= range.end && (end == null || date <= end);

  if (payment.frequency === 'one_time') {
    const date = dateInMonth(s.year, s.month, day);
    return inBounds(date) ? [make(date)] : [];
  }

  const step = FREQUENCY_STEP_MONTHS[payment.frequency];
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
  type: ContractEventType;
  title: string;
  amount: number | null;
  estimated: boolean;
  contractId: string;
  contractTitle: string;
  category: ContractCategory;
  /** 사용자 일정 id (계산된 일정은 null) */
  eventId: string | null;
}

const TYPE_ORDER: Record<ContractEventType, number> = {
  termination_notice: 0,
  contract_end: 1,
  renewal: 2,
  payment: 3,
  contract_start: 4,
  custom: 5,
};

/**
 * 한 계약의 일정 (결제 + 시작/종료/자동갱신/해지 통보기한 + 사용자 일정).
 * 시작/종료/갱신/해지통보는 저장하지 않고 계약 정보에서 계산 → 수정 시 재생성 불필요.
 */
export function contractSchedule(record: ContractRecord, range: DateRange, today: ISODate): ScheduleItem[] {
  const { contract } = record;
  const base = { contractId: contract.id, contractTitle: contract.title, category: contract.category };
  const items: ScheduleItem[] = [];
  const inRange = (d: ISODate | null | undefined): d is ISODate => !!d && d >= range.start && d <= range.end;

  for (const p of record.payments) {
    for (const o of expandPayment(p, contract, range)) {
      items.push({
        ...base,
        key: `pay:${p.id}:${o.date}`,
        date: o.date,
        type: 'payment',
        title: p.label,
        amount: o.amount,
        estimated: o.estimated,
        eventId: null,
      });
    }
  }

  if (inRange(contract.startDate)) {
    items.push({ ...base, key: `start:${contract.id}`, date: contract.startDate, type: 'contract_start', title: '계약 시작', amount: null, estimated: false, eventId: null });
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
        title: contract.autoRenewal ? '계약 만료 (자동갱신 조건)' : '계약 종료',
        amount: null,
        estimated: end !== contract.endDate,
        eventId: null,
      });
    }
    if (contract.autoRenewal && term) {
      const renewal = addDays(term.termEnd, 1);
      if (inRange(renewal)) {
        items.push({ ...base, key: `renew:${contract.id}:${renewal}`, date: renewal, type: 'renewal', title: '자동갱신 예정', amount: null, estimated: false, eventId: null });
      }
    }
    const notice = terminationNoticeDeadline(contract, today);
    if (notice && inRange(notice.date)) {
      items.push({ ...base, key: `notice:${contract.id}:${notice.date}`, date: notice.date, type: 'termination_notice', title: '해지 통보기한', amount: null, estimated: false, eventId: null });
    }
  } else if (contract.lifecycleChangedOn && inRange(contract.lifecycleChangedOn)) {
    items.push({
      ...base,
      key: `closed:${contract.id}`,
      date: contract.lifecycleChangedOn,
      type: 'contract_end',
      title: contract.lifecycle === 'cancelled' ? '계약 해지' : '계약 종료',
      amount: null,
      estimated: false,
      eventId: null,
    });
  }

  for (const e of record.events) {
    if (!inRange(e.eventDate)) continue;
    items.push({ ...base, key: `event:${e.id}`, date: e.eventDate, type: e.eventType, title: e.title, amount: e.amount, estimated: false, eventId: e.id });
  }

  return items;
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
  const all = record.payments.flatMap((p) => expandPayment(p, record.contract, range));
  all.sort((a, b) => a.date.localeCompare(b.date));
  return all[0] ?? null;
}
