import { BUSINESS_DAY_RULE_LABEL } from './businessDays';
import { detailFields, profileOf, type PaymentKind, type SourceType } from './contractTypes';
import { addDays, formatDateKo } from './dates';
import { FREQUENCY_LABEL } from './labels';
import { formatWon, formatWonCompact } from './money';
import { amountPeriods, probationPeriod } from './paymentRules';
import { expandPayment } from './schedule';
import { terminationNoticeDeadline } from './status';
import type { ContractPayment, ContractRecord, ISODate } from './types';

/**
 * 계약 상세의 "핵심 정보" — 공통 틀은 같고, 계약 유형별로 보여줄 항목이 다르다.
 * 근로: 회사·급여·급여일·근로기간·수습 / 전세: 보증금·잔금·입주일·만기 / 대출: 원금·금리·월 상환액·남은 회차·만기 …
 * 값은 모두 저장된 계약 정보(결제 목록·주요 날짜·유형별 속성)에서 만든다. 계약서에 없던 값은 표시하지 않는다.
 * 앱이 모르는 유형은 공통 항목(결제·기간)만 보여준다.
 */
export interface CoreInfoRow {
  key: string;
  label: string;
  value: string;
  emphasis?: boolean;
  /** 값의 출처 — inferred(AI 추정)·calculated(PACTO 계산)는 화면에서 배지로 구분 */
  source?: SourceType;
  /** 이 행이 대신 보여주는 유형별 속성 (계약 조건 · 기록에 중복 표시하지 않음) */
  covers?: string[];
}

export function paymentRule(p: ContractPayment): string {
  if (p.frequency === 'one_time') return `일시불 · ${formatDateKo(p.startsOn)}`;
  const day = p.dayOfMonth ? `${p.dayOfMonth}일` : '';
  const base = p.frequency === 'yearly' && p.monthOfYear ? `매년 ${p.monthOfYear}월 ${day}`.trim() : `${FREQUENCY_LABEL[p.frequency]} ${day}`.trim();
  return p.businessDayRule && p.businessDayRule !== 'none' ? `${base} (${BUSINESS_DAY_RULE_LABEL[p.businessDayRule]})` : base;
}

/** 금액 표기: 수입은 '+', 보증금·큰 금액은 억·만 단위 */
function money(p: ContractPayment): string {
  const v = p.direction === 'neutral' || p.amount >= 10_000_000 ? formatWonCompact(p.amount) : formatWon(p.amount);
  return `${p.direction === 'income' ? '+' : ''}${v}${p.isVariable ? ' 내외' : ''}`;
}

/** 회차 진행: 오늘까지 납부(예정일 기준) 회차와 남은 회차 */
export function installmentProgress(p: ContractPayment, record: ContractRecord, today: ISODate): { paid: number; remaining: number; total: number } | null {
  if (p.installmentCount == null || p.frequency === 'one_time') return null;
  const paid = expandPayment(p, record.contract, { start: p.startsOn, end: today }, record.dates).length;
  return { paid, remaining: Math.max(0, p.installmentCount - paid), total: p.installmentCount };
}

function detailText(record: ContractRecord, key: string): string | null {
  const spec = detailFields(record.contract.contractType).find((f) => f.key === key);
  const v = record.contract.details[key];
  if (!spec || v == null) return null;
  if (spec.input === 'amount') return formatWon(v as number);
  // 금리는 연 이율, 그 밖의 비율(예: 수습기간 임금 90%)은 그대로
  if (spec.input === 'percent') return /Rate$/.test(spec.key) && /금리|이율/.test(spec.label) ? `연 ${v}%` : `${v}%`;
  if (spec.input === 'boolean') return v ? '예' : '아니오';
  if (spec.input === 'enum') return spec.options?.find((o) => o.value === v)?.label ?? String(v);
  return spec.suffix ? `${v}${spec.suffix}` : String(v);
}

export function coreInfo(record: ContractRecord, today: ISODate): CoreInfoRow[] {
  const { contract: c, payments, dates } = record;
  const t = c.contractType;
  const profile = profileOf(t);
  const d = c.details;
  const rows: CoreInfoRow[] = [];
  const shown = new Set<string>();
  const add = (key: string, label: string, value: string | null | undefined, emphasis = false, source?: SourceType, covers?: string[]) => {
    if (value == null || value === '' || shown.has(key)) return;
    shown.add(key);
    rows.push({ key, label, value, emphasis, ...(source ? { source } : {}), ...(covers ? { covers } : {}) });
  };
  /** 결제 + 구성 항목(합산하지 않음) + 기간별 금액(PACTO 계산) + 실제 다음 지급 예정일 */
  const payDetail = (p: ContractPayment) => {
    if (p.components.length > 0) add(`comp:${p.id}`, `${p.label} 구성`, p.components.map((x) => `${x.label} ${formatWon(x.amount)}`).join(' + '));
    for (const ap of amountPeriods(record, p)) add(`period:${p.id}:${ap.from}`, `${ap.label.split(' ')[0]} ${p.label}`, `${money({ ...p, amount: ap.amount })} (${formatDateKo(ap.from)} ~ ${formatDateKo(ap.to)})`, true, 'calculated');
    const next = expandPayment(p, record.contract, { start: today, end: addDays(today, 400) }, record.dates)[0];
    if (next && p.frequency !== 'one_time' && (p.businessDayRule !== 'none' || next.amountNote)) {
      add(`next:${p.id}`, p.direction === 'income' ? '다음 지급 예정' : '다음 결제 예정', `${formatDateKo(next.date, true)} · ${money({ ...p, amount: next.amount })}`, false, 'calculated');
    }
  };
  const ofKind = (...kinds: PaymentKind[]) => payments.filter((p) => kinds.includes(p.kind));
  const payRow = (p: ContractPayment, emphasis = p.direction !== 'neutral') =>
    add(`pay:${p.id}`, p.label, p.frequency === 'one_time' ? `${money(p)} · ${formatDateKo(p.startsOn)}` : `${money(p)} · ${paymentRule(p)}`, emphasis);
  const dateRow = (kind: string, label: string) => {
    const v = dates.find((x) => x.kind === kind)?.date;
    add(`dk:${kind}`, label, v ? formatDateKo(v) : null);
  };
  const detailRow = (key: string, emphasis = false) => {
    const spec = detailFields(t).find((f) => f.key === key);
    if (spec) add(`d:${key}`, spec.label, detailText(record, key), emphasis, c.valueSources[`details.${key}`]);
  };
  const period = () =>
    add('period', profile.periodLabel, c.startDate || c.endDate ? `${c.startDate ? formatDateKo(c.startDate) : '-'} ~ ${c.endDate ? formatDateKo(c.endDate) : '종료일 없음'}` : null);
  const renewal = () => {
    if (profile.hasRenewal) add('renewal', '자동갱신', c.autoRenewal ? `있음${c.renewalPeriodMonths ? ` · ${c.renewalPeriodMonths}개월 단위` : ''}` : '없음');
  };
  const notice = () => {
    if (c.terminationNoticeDays == null) return;
    const n = terminationNoticeDeadline(c, today);
    add('notice', profile.noticeLabel, `종료 ${c.terminationNoticeDays}일 전까지${n ? ` (${formatDateKo(n.date)})` : ''}`, !!n && !n.passed);
  };
  const progress = (p: ContractPayment) => {
    const pr = installmentProgress(p, record, today);
    if (pr) add(`progress:${p.id}`, '남은 회차', `${pr.remaining}회 남음 (${pr.paid}/${pr.total}회 납부)`, true);
  };

  switch (t) {
    case 'recurring':
      for (const p of payments) payRow(p);
      period();
      renewal();
      notice();
      detailRow('commitmentMonths');
      break;
    case 'lease':
      detailRow('leaseKind');
      add('deposit', '보증금', c.depositAmount != null ? formatWonCompact(c.depositAmount) : null, true);
      for (const p of ofKind('rent', 'maintenance_fee')) payRow(p);
      for (const p of payments) payRow(p, false);
      dateRow('balance_due', '잔금일');
      dateRow('move_in', '입주일');
      period();
      renewal();
      notice();
      break;
    case 'installment':
      detailRow('vehicleName');
      detailRow('vehiclePrice');
      detailRow('principal', true);
      detailRow('interestRate');
      for (const p of ofKind('installment')) {
        payRow(p);
        progress(p);
      }
      for (const p of payments) payRow(p, false);
      add('maturity', '만기일', c.endDate ? formatDateKo(c.endDate) : null);
      break;
    case 'loan':
      detailRow('principal', true);
      detailRow('interestRate');
      detailRow('rateType');
      detailRow('repaymentMethod');
      for (const p of payments) {
        payRow(p);
        progress(p);
      }
      add('executed', '대출 실행일', c.startDate ? formatDateKo(c.startDate) : null);
      add('maturity', '만기일', c.endDate ? formatDateKo(c.endDate) : null);
      break;
    case 'insurance':
      detailRow('productName');
      for (const p of payments) payRow(p);
      period();
      detailRow('paymentPeriod');
      detailRow('coveragePeriod');
      add('renewable', '갱신형', d.renewable == null ? null : d.renewable ? `갱신형${d.renewalCycleYears ? ` · ${d.renewalCycleYears}년마다` : ''}` : '비갱신형');
      dateRow('renewal', '갱신일');
      renewal();
      notice();
      break;
    case 'employment': {
      add('company', '회사', c.counterparty);
      detailRow('employeeName');
      detailRow('employmentKind');
      detailRow('jobTitle');
      for (const p of ofKind('salary')) {
        payRow(p, true);
        payDetail(p);
      }
      // 연봉은 계약서에 적혀 있을 때만 (월 임금 × 12 같은 추정값을 만들지 않는다)
      detailRow('annualSalary', true);
      for (const p of payments) payRow(p, false);
      period();
      dateRow('hire', '입사일');
      const prob = probationPeriod(record);
      if (prob) add('probation', '수습기간', `${formatDateKo(prob.from)} ~ ${formatDateKo(prob.to)} (${prob.months}개월)`, false, 'calculated', ['probationMonths', ...(payments.some((p) => p.kind === 'salary') ? ['probationPayRate'] : [])]);
      else detailRow('probationMonths');
      add('renewal', '갱신', c.autoRenewal ? `자동갱신${c.renewalPeriodMonths ? ` · ${c.renewalPeriodMonths}개월` : ''}` : (detailText(record, 'renewalTerms') ?? '자동갱신 아님'), false, undefined, c.autoRenewal ? [] : ['renewalTerms']);
      break;
    }
    case 'service':
      detailRow('userRole');
      detailRow('workScope');
      for (const p of payments) payRow(p, true);
      period();
      dateRow('delivery', '납기일');
      dateRow('inspection', '검수일');
      break;
    case 'sale':
      detailRow('userRole');
      detailRow('subject');
      add('total', '총 매매금액', c.totalAmount != null ? formatWonCompact(c.totalAmount) : null, true);
      for (const p of payments) payRow(p, true);
      dateRow('handover', '인도일');
      dateRow('ownership_transfer', '소유권 이전일');
      add('completion', '계약 완료일', c.endDate ? formatDateKo(c.endDate) : null);
      break;
    case 'one_time':
      detailRow('subject');
      for (const p of payments) payRow(p, true);
      add('completion', '계약 완료일', c.endDate ? formatDateKo(c.endDate) : null);
      break;
    default:
      for (const p of payments) payRow(p);
      period();
      renewal();
      notice();
      break;
  }
  if (c.depositAmount != null) add('deposit', '보증금', formatWonCompact(c.depositAmount));
  if (c.totalAmount != null) add('total', '계약 총액', formatWon(c.totalAmount));
  // 유형 템플릿에 없는 이름의 날짜도 버리지 않고 보여준다
  for (const x of dates) if (!shown.has(`dk:${x.kind}`)) add(`date:${x.id}`, x.label, formatDateKo(x.date));
  return rows;
}

/** 상세 "계약 조건 · 기록" — 핵심 정보에 넣지 않은 유형별 속성 (근무시간·휴가·해지환급·저작권 …) */
export function otherDetails(record: ContractRecord): CoreInfoRow[] {
  const core = coreInfo(record, '1900-01-01');
  const inCore = new Set([...core.map((r) => r.key), ...core.flatMap((r) => (r.covers ?? []).map((k) => `d:${k}`))]);
  return detailFields(record.contract.contractType)
    .filter((f) => !inCore.has(`d:${f.key}`))
    .map((f) => ({ key: `d:${f.key}`, label: f.label, value: detailText(record, f.key) ?? '' }))
    .filter((r) => r.value !== '');
}
