import { profileOf, type PaymentKind } from './contractTypes';
import { addDays, dateInMonth, parseISODate } from './dates';
import { currentTerm, paymentCutoff, terminationNoticeDeadline } from './status';
import type {
  Contract,
  ContractCategory,
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
  date: ISODate;
  amount: number;
  paymentId: string;
  contractId: string;
  kind: PaymentKind;
  direction: Direction;
  label: string;
  /** 회차 (총 회차가 있는 결제만): 3/36 */
  installment: { no: number; total: number } | null;
  /** 금액이 변동될 수 있음 (통신비 등). */
  estimated: boolean;
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

/** 총 회차가 있는 결제의 마지막 회차 날짜 (일시불은 결제일). */
export function lastInstallmentDate(payment: ContractPayment): ISODate | null {
  if (payment.installmentCount == null) return null;
  if (payment.frequency === 'one_time') return payment.startsOn;
  const step = FREQUENCY_STEP_MONTHS[payment.frequency];
  const idx = firstOccurrenceIdx(payment) + (payment.installmentCount - 1) * step;
  const day = payment.dayOfMonth ?? parseISODate(payment.startsOn).day;
  return dateInMonth(Math.floor(idx / 12), (idx % 12) + 1, day);
}

/** 결제 규칙을 조회 범위 안의 실제 결제일 목록으로 전개한다. 일시불은 startsOn이 결제일. */
export function expandPayment(
  payment: ContractPayment,
  contract: Contract,
  range: DateRange,
): PaymentOccurrence[] {
  const start = payment.startsOn;
  const cutoff = paymentCutoff(contract);
  let end: ISODate | null = payment.endsOn;
  if (cutoff != null) end = end == null ? cutoff : end < cutoff ? end : cutoff;
  const last = lastInstallmentDate(payment);
  if (last != null) end = end == null || last < end ? last : end;

  const s = parseISODate(start);
  const day = payment.dayOfMonth ?? s.day;
  const total = payment.installmentCount;
  const step = payment.frequency === 'one_time' ? 0 : FREQUENCY_STEP_MONTHS[payment.frequency];
  const firstIdx = step ? firstOccurrenceIdx(payment) : 0;
  const make = (date: ISODate): PaymentOccurrence => {
    const d = parseISODate(date);
    const no = step ? Math.round((monthIndex(d.year, d.month) - firstIdx) / step) + 1 : 1;
    return {
      date,
      amount: payment.amount,
      paymentId: payment.id,
      contractId: contract.id,
      kind: payment.kind,
      direction: payment.direction,
      label: payment.label,
      installment: total != null ? { no, total } : null,
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
  /** 결제 항목의 의미 (결제가 아니면 null) */
  paymentKind: PaymentKind | null;
  /** 결제 항목의 돈 방향 (결제가 아니면 null) */
  direction: Direction | null;
  amount: number | null;
  estimated: boolean;
  contractId: string;
  contractTitle: string;
  category: ContractCategory;
  /** 사용자 일정 id (계산된 일정은 null) */
  eventId: string | null;
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
  const items: ScheduleItem[] = [];
  const inRange = (d: ISODate | null | undefined): d is ISODate => !!d && d >= range.start && d <= range.end;

  for (const p of record.payments) {
    for (const o of expandPayment(p, contract, range)) {
      items.push({
        ...base,
        key: `pay:${p.id}:${o.date}`,
        date: o.date,
        type: 'payment',
        title: o.installment ? `${p.label} ${o.installment.no}/${o.installment.total}회` : p.label,
        paymentKind: p.kind,
        direction: p.direction,
        amount: o.amount,
        estimated: o.estimated,
        eventId: null,
      });
    }
  }

  const profile = profileOf(contract.contractType);
  const plain = { paymentKind: null, direction: null, amount: null, estimated: false, eventId: null };

  if (profile.startEvent && inRange(contract.startDate)) {
    items.push({ ...base, ...plain, key: `start:${contract.id}`, date: contract.startDate, type: 'contract_start', title: profile.startEvent });
  }

  for (const d of record.dates) {
    if (!inRange(d.date)) continue;
    items.push({ ...base, ...plain, key: `date:${d.id}`, date: d.date, type: 'key_date', title: d.label });
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
      items.push({ ...base, ...plain, key: `notice:${contract.id}:${notice.date}`, date: notice.date, type: 'termination_notice', title: profile.noticeLabel });
    }
    const prep = prepareDate(contract);
    if (prep && inRange(prep.date)) {
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

  return items;
}

/** 종료 전 미리 확인할 시점 (임대차: 만기 60일 전 갱신 확인). 자동갱신 계약은 해지 통보기한으로 대신한다. */
export function prepareDate(contract: Contract): { date: ISODate; label: string; guidance: string } | null {
  const prep = profileOf(contract.contractType).prepare;
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
  const all = record.payments.flatMap((p) => expandPayment(p, record.contract, range));
  all.sort((a, b) => a.date.localeCompare(b.date));
  return all[0] ?? null;
}
