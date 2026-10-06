import {
  CONTRACT_TYPE_PROFILES,
  DETAIL_FIELDS,
  REPAYMENT_METHODS,
  countsAsSpending,
  type ContractType,
  type PaymentKind,
} from './contractTypes';
import { formatDateKo } from './dates';
import { FREQUENCY_LABEL } from './labels';
import { formatWon, formatWonCompact } from './money';
import { expandPayment } from './schedule';
import { terminationNoticeDeadline } from './status';
import type { ContractPayment, ContractRecord, ISODate } from './types';

/**
 * 계약 상세의 "핵심 정보" — 공통 틀은 같고, 계약 유형별로 보여줄 항목이 다르다.
 * 전세: 보증금·잔금일·입주일·만기 / 대출: 원금·금리·월 상환액·남은 회차·만기 / 렌탈: 월 렌탈료·결제일·자동갱신·해지 통보기한 …
 * 값은 모두 저장된 계약 정보(결제 목록·주요 날짜·유형별 속성)에서 만든다. 계산하지 못하는 값은 표시하지 않는다.
 */
export interface CoreInfoRow {
  key: string;
  label: string;
  value: string;
  emphasis?: boolean;
}

const PERIOD_LABEL: Record<ContractType, string> = {
  recurring: '이용 기간',
  lease: '임대차 기간',
  auto_installment: '할부 기간',
  loan: '대출 기간',
  insurance: '보험 기간',
  one_time: '계약 기간',
  other: '계약 기간',
};

export function paymentRule(p: ContractPayment): string {
  if (p.frequency === 'one_time') return `일시불 · ${formatDateKo(p.startsOn)}`;
  const day = p.dayOfMonth ? `${p.dayOfMonth}일` : '';
  if (p.frequency === 'yearly' && p.monthOfYear) return `매년 ${p.monthOfYear}월 ${day}`.trim();
  return `${FREQUENCY_LABEL[p.frequency]} ${day}`.trim();
}

/** 회차 진행: 오늘까지 납부(예정일 기준) 회차와 남은 회차 */
export function installmentProgress(p: ContractPayment, record: ContractRecord, today: ISODate): { paid: number; remaining: number; total: number } | null {
  if (p.installmentCount == null || p.frequency === 'one_time') return null;
  const paid = expandPayment(p, record.contract, { start: p.startsOn, end: today }).length;
  return { paid, remaining: Math.max(0, p.installmentCount - paid), total: p.installmentCount };
}

export function coreInfo(record: ContractRecord, today: ISODate): CoreInfoRow[] {
  const { contract: c, payments, dates } = record;
  const t = c.contractType;
  const profile = CONTRACT_TYPE_PROFILES[t];
  const d = c.details;
  const rows: CoreInfoRow[] = [];
  const add = (key: string, label: string, value: string | null | undefined, emphasis = false) => {
    if (value != null && value !== '') rows.push({ key, label, value, emphasis });
  };
  const ofKind = (...kinds: PaymentKind[]) => payments.filter((p) => kinds.includes(p.kind));
  const payRow = (p: ContractPayment, emphasis = true) => add(`pay:${p.id}`, p.label, `${formatWon(p.amount)}${p.isVariable ? ' 내외' : ''} · ${paymentRule(p)}`, emphasis);
  const dateOf = (kind: string) => dates.find((x) => x.kind === kind)?.date ?? null;
  const detailText = (key: string) => {
    const spec = DETAIL_FIELDS[t].find((f) => f.key === key);
    const v = d[key];
    if (!spec || v == null) return null;
    if (spec.input === 'amount') return formatWon(v as number);
    if (spec.input === 'percent') return `연 ${v}%`;
    if (spec.input === 'boolean') return v ? '예' : '아니오';
    if (spec.input === 'enum') return spec.options?.find((o) => o.value === v)?.label ?? String(v);
    return spec.suffix ? `${v}${spec.suffix}` : String(v);
  };
  const period = () => add('period', PERIOD_LABEL[t], c.startDate || c.endDate ? `${c.startDate ? formatDateKo(c.startDate) : '-'} ~ ${c.endDate ? formatDateKo(c.endDate) : '종료일 없음'}` : null);
  const renewal = () => {
    if (!profile.hasRenewal) return;
    add('renewal', '자동갱신', c.autoRenewal ? `있음${c.renewalPeriodMonths ? ` · ${c.renewalPeriodMonths}개월 단위` : ''}` : '없음');
    const notice = terminationNoticeDeadline(c, today);
    if (c.terminationNoticeDays != null) add('notice', profile.noticeLabel, `종료 ${c.terminationNoticeDays}일 전까지${notice ? ` (${formatDateKo(notice.date)})` : ''}`, !!notice && !notice.passed);
  };
  const progress = (p: ContractPayment) => {
    const pr = installmentProgress(p, record, today);
    if (pr) add(`progress:${p.id}`, '남은 회차', `${pr.remaining}회 남음 (${pr.paid}/${pr.total}회 납부)`, true);
  };

  switch (t) {
    case 'recurring': {
      for (const p of payments) payRow(p, countsAsSpending(p.kind));
      period();
      renewal();
      add('commitment', '의무 사용기간', detailText('commitmentMonths'));
      add('ownership', '소유권 이전', detailText('ownershipTransferTerms'));
      break;
    }
    case 'lease': {
      add('leaseKind', '임대 형태', detailText('leaseKind'));
      add('deposit', '보증금', c.depositAmount != null ? formatWonCompact(c.depositAmount) : null, true);
      for (const p of ofKind('rent', 'maintenance_fee')) payRow(p);
      for (const p of ofKind('deposit', 'down_payment', 'balance_payment')) add(`pay:${p.id}`, p.label, `${formatWonCompact(p.amount)} · ${formatDateKo(p.startsOn)}`);
      for (const p of payments.filter((p) => !['rent', 'maintenance_fee', 'deposit', 'down_payment', 'balance_payment'].includes(p.kind))) payRow(p, false);
      add('balanceDue', '잔금일', dateOf('balance_due') ? formatDateKo(dateOf('balance_due')!) : null);
      add('moveIn', '입주일', dateOf('move_in') ? formatDateKo(dateOf('move_in')!) : null);
      period();
      renewal();
      add('renewalTerms', '갱신 관련 조건', detailText('renewalTerms'));
      break;
    }
    case 'auto_installment': {
      add('vehicle', '차량', detailText('vehicleName'));
      add('vehiclePrice', '차량가', detailText('vehiclePrice'));
      add('advance', '선수금', detailText('advancePayment'));
      add('principal', '할부원금', detailText('principal'), true);
      add('rate', '금리', detailText('interestRate'));
      for (const p of ofKind('installment')) {
        payRow(p);
        progress(p);
      }
      for (const p of payments.filter((p) => p.kind !== 'installment')) payRow(p, false);
      add('maturity', '만기일', c.endDate ? formatDateKo(c.endDate) : null);
      break;
    }
    case 'loan': {
      add('principal', '대출원금', detailText('principal'), true);
      add('rate', '금리', detailText('interestRate'));
      add('method', '상환방식', d.repaymentMethod ? (REPAYMENT_METHODS.find((m) => m.value === d.repaymentMethod)?.label ?? null) : null);
      for (const p of payments) {
        payRow(p);
        progress(p);
      }
      add('executed', '대출 실행일', c.startDate ? formatDateKo(c.startDate) : null);
      add('maturity', '만기일', c.endDate ? formatDateKo(c.endDate) : null);
      add('prepayment', '중도상환수수료', detailText('prepaymentFeeTerms'));
      break;
    }
    case 'insurance': {
      for (const p of payments) payRow(p);
      period();
      add('renewable', '갱신형', d.renewable == null ? null : d.renewable ? `갱신형${d.renewalCycleYears ? ` · ${d.renewalCycleYears}년마다` : ''}` : '비갱신형');
      add('renewalDate', '갱신일', dateOf('renewal') ? formatDateKo(dateOf('renewal')!) : null);
      add('coverage', '주요 보장', detailText('coverageSummary'));
      renewal();
      break;
    }
    case 'one_time': {
      add('subject', '계약 대상', detailText('subject'));
      for (const p of payments) add(`pay:${p.id}`, p.label, `${formatWon(p.amount)} · ${formatDateKo(p.startsOn)}`, true);
      add('completion', '계약 완료일', c.endDate ? formatDateKo(c.endDate) : null);
      break;
    }
    case 'other': {
      for (const p of payments) payRow(p, countsAsSpending(p.kind));
      period();
      renewal();
      break;
    }
  }
  if (t !== 'lease' && c.depositAmount != null) add('deposit', '보증금', formatWonCompact(c.depositAmount));
  if (c.totalAmount != null) add('total', '계약 총액', formatWon(c.totalAmount));
  // 유형 템플릿에 없는 이름의 날짜도 버리지 않고 보여준다
  for (const x of dates) {
    if ((x.kind === 'balance_due' && t === 'lease') || (x.kind === 'move_in' && t === 'lease') || (x.kind === 'renewal' && t === 'insurance')) continue;
    add(`date:${x.id}`, x.label, formatDateKo(x.date));
  }
  return rows;
}
