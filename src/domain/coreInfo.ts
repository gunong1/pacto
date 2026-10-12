import { isPayoutLike } from './cashflow';
import { partyRows, partyRowText } from './parties';
import { detailFieldsFor, profileKeyOf } from './contractKinds';
import { BUSINESS_DAY_RULE_LABEL } from './businessDays';
import { detailFields, isConfirmedPayment, OBLIGATION_LABEL, profileOf, type PaymentKind, type PaymentObligation, type SourceType } from './contractTypes';
import { addDays, formatDateKo } from './dates';
import { FREQUENCY_LABEL } from './labels';
import { formatWon, formatWonCompact } from './money';
import { withAmountAt } from './paymentAmount';
import { paymentPlan, planSummary } from './paymentPlan';
import { amountPeriods, probationPeriod } from './paymentRules';
import { expandPayment, isPaymentDayUnknown } from './schedule';
import { noticeLabelOf } from './noticeKind';
import { terminationNoticeDeadline } from './status';
import type { ContractPayment, ContractRecord, ISODate, ReferenceAmountRole } from './types';

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
  /** 확인 필요 (예: 계약서에서 찾지 못한 당사자) */
  needsReview?: boolean;
}

export function paymentRule(p: ContractPayment): string {
  if (p.frequency === 'one_time') return `일시불 · ${formatDateKo(p.startsOn)}`;
  // 계약서에 지급일이 없는 정기 수입 — 시작일로 추론하지 않는다
  if (isPaymentDayUnknown(p)) return `${FREQUENCY_LABEL[p.frequency]} · ${isPayoutLike(p) ? '지급일' : '결제일'} 확인 필요`;
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
  const spec = detailFieldsFor(record.contract).find((f) => f.key === key);
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
  const { contract: c, dates } = record;
  // 핵심 정보의 결제는 지급 의무·시점이 확정된 것만 — 선택형·조건부 비용은 extraCosts()로 따로
  const payments = record.payments.filter(isConfirmedPayment);
  // 관리 프로필(화면 이름·유형별 속성) — 계약 종류 기준 (기존 계약은 저장된 유형)
  const t = profileKeyOf(c);
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
  // 정기 결제는 오늘 적용 중인 금액 (금액 변경 이력 반영 — 지난 회차 금액은 일정에서 그대로)
  const payRow = (p: ContractPayment, emphasis = p.direction !== 'neutral') => {
    add(`pay:${p.id}`, p.label, p.frequency === 'one_time' ? `${money(p)} · ${formatDateKo(p.startsOn)}${oneTimeStatus(p, today)}` : `${money(withAmountAt(p, today))} · ${paymentRule(p)}`, emphasis);
    // 구성항목 (기본급·수당 등) — 모든 유형 공통, 따로 더하지 않는 표시용
    if (p.components.length > 0) add(`comp:${p.id}`, `${p.label} 구성`, p.components.map((x) => `${x.label} ${formatWon(x.amount)}`).join(' + '));
    planRows(p);
  };
  // 결제 일정: 첫 결제 · 총/진행/남은 회차 · 마지막 결제 — 입력값이 아니라 계약 기간·회차에서 계산 (PACTO 계산)
  const planRows = (p: ContractPayment) => {
    const plan = paymentPlan(p, record, today);
    if (!plan) return;
    const income = p.direction === 'income';
    const conflict = plan.conflict ? ` · 계약서 ${plan.conflict.installments}회와 달라요 (확인 필요)` : '';
    const w = income ? '지급' : '결제';
    // 첫 회차: 시작일과 결제일로 계산 — 급여처럼 당월/익월이 정해지지 않았으면 "확인 필요"
    if (plan.first) add(`first:${p.id}`, `첫 ${w}`, plan.firstNeedsCheck ? `${formatDateKo(plan.first)} (예상) · 확인 필요` : formatDateKo(plan.first), false, 'calculated');
    add(`plan:${p.id}`, `${w} 회차`, planSummary(plan) + conflict, plan.total != null, 'calculated');
    if (plan.last) add(`last:${p.id}`, income ? '마지막 지급' : '마지막 결제', formatDateKo(plan.last), false, 'calculated');
  };
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
    // 의미가 불확실하면 이름 대신 "확인 필요"를 함께 보여준다 (계약 수정에서 고를 수 있음)
    add('notice', noticeLabelOf(c.noticeKind, t), `종료 ${c.terminationNoticeDays}일 전까지${n ? ` (${formatDateKo(n.date)})` : ''}${c.noticeKind === 'unknown' ? ' · 확인 필요' : ''}`, !!n && !n.passed);
  };

  // 계약 당사자 — 모든 종류 공통, 역할 이름은 레지스트리 (src/domain/parties.ts)
  for (const p of partyRows(c)) {
    add(p.key, p.isUser ? `${p.label} (나)` : p.label, partyRowText(p));
    if (p.missing) rows[rows.length - 1].needsReview = true;
  }
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
      for (const p of ofKind('installment')) payRow(p);
      for (const p of payments) payRow(p, false);
      add('maturity', '만기일', c.endDate ? formatDateKo(c.endDate) : null);
      break;
    case 'loan':
      detailRow('principal', true);
      detailRow('interestRate');
      detailRow('rateType');
      detailRow('repaymentMethod');
      for (const p of payments) payRow(p);
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
  // 결제가 아닌 금액 (참고·면제·할인 전 …) — 정보로만 보여준다. 홈·캘린더·알림에는 들어가지 않는다
  c.referenceAmounts.forEach((r, i) => add(`ref:${i}`, r.label, `${formatWon(r.amount)} · ${REFERENCE_ROLE_LABEL[r.role]}`));
  // 이전 버전에서 결제로 저장된 참고 금액 (읽기 호환) — 이미 보증금·계약 총액으로 보인 같은 금액은 생략
  for (const p of record.payments) {
    if (p.obligation !== 'informational') continue;
    if ((p.kind === 'deposit' && c.depositAmount === p.amount) || c.totalAmount === p.amount) continue;
    add(`info:${p.id}`, p.label, `${formatWon(p.amount)} · ${p.conditionNote ?? '참고 금액'}`);
  }
  // 유형 템플릿에 없는 이름의 날짜도 버리지 않고 보여준다
  for (const x of dates) if (!shown.has(`dk:${x.kind}`)) add(`date:${x.id}`, x.label, formatDateKo(x.date));
  return rows;
}

/** 일시불의 결제일이 지났으면 완료로 표시 (결제일 기준 — 실제 결제 여부는 사용자가 확인) */
function oneTimeStatus(p: ContractPayment, today: ISODate): string {
  if (p.startsOn > today) return '';
  if (p.startsOn === today) return p.direction === 'income' ? ' · 오늘 지급' : ' · 오늘 결제';
  return p.direction === 'income' ? ' · 지급 완료' : ' · 결제 완료';
}

/** 참고 금액의 종류 표시 */
export const REFERENCE_ROLE_LABEL: Record<ReferenceAmountRole, string> = {
  total: '총액',
  reference: '참고 금액',
  waived: '면제',
  discount: '할인',
  before_discount: '할인 전 금액',
};

export interface ExtraCostRow {
  key: string;
  /** 결제로 전환할 원본 — 선택형 결제(또는 이전 버전의 조건부 결제) / 금액이 있는 계약 체크 */
  source: { kind: 'payment'; paymentId: string } | { kind: 'check'; checkId: string };
  label: string;
  /** 금액과 주기 (예: "월 5,000원", "30,000원") */
  value: string;
  /** 언제 내는 돈인지 (예: "회원권을 양도하는 경우", "이용 선택 시") */
  condition: string;
  obligation: PaymentObligation;
}

/**
 * "추가로 발생할 수 있는 비용" — 계약서에 금액은 있지만 지금 낼 의무가 확정되지 않은 돈. 캘린더·지출에는 넣지 않는다.
 * - 선택형 결제 (락커 이용 시 월 5,000원) → "이용 시작"
 * - 금액이 있는 계약 체크 (위약금·연체료·양도 수수료 …) → "발생했어요" (그날 1회 결제)
 * - 이전 버전에서 조건부·잠재 결제로 저장된 금액 (읽기 호환)
 * 참고 금액(합계 등)은 발생할 수 있는 비용이 아니다 — 핵심 정보에 참고로만
 */
export function extraCosts(record: ContractRecord): ExtraCostRow[] {
  const fromPayments = record.payments
    .filter((p) => !isConfirmedPayment(p) && p.obligation !== 'informational')
    .map((p): ExtraCostRow => ({
      key: `extra:${p.id}`,
      source: { kind: 'payment', paymentId: p.id },
      label: p.label,
      value: p.frequency === 'one_time' ? formatWon(p.amount) : `${FREQUENCY_LABEL[p.frequency] === '매월' ? '월' : FREQUENCY_LABEL[p.frequency]} ${formatWon(p.amount)}`,
      condition: p.conditionNote ?? (p.obligation === 'optional' ? '이용 선택 시' : p.obligation === 'conditional' ? '해당 상황이 생기는 경우' : OBLIGATION_LABEL[p.obligation]),
      obligation: p.obligation === 'potential' ? 'conditional' : p.obligation,
    }));
  // 이미 "발생했어요"로 결제가 된 체크는 빼고 (같은 이름의 확정 결제가 있음)
  const fromChecks = record.aiChecks
    .filter((c) => c.amount != null && c.amount > 0 && c.status !== 'dismissed')
    .filter((c) => !record.payments.some((p) => isConfirmedPayment(p) && p.label === c.title))
    .map((c): ExtraCostRow => ({
      key: `extra-check:${c.id}`,
      source: { kind: 'check', checkId: c.id },
      label: c.title,
      value: formatWon(c.amount!),
      condition: c.rule?.condition ?? '해당 상황이 생기는 경우',
      obligation: 'conditional',
    }));
  return [...fromPayments, ...fromChecks];
}

/** 상세 "계약 조건 · 기록" — 핵심 정보에 넣지 않은 유형별 속성 (근무시간·휴가·해지환급·저작권 …) */
export function otherDetails(record: ContractRecord): CoreInfoRow[] {
  const core = coreInfo(record, '1900-01-01');
  const inCore = new Set([...core.map((r) => r.key), ...core.flatMap((r) => (r.covers ?? []).map((k) => `d:${k}`))]);
  return detailFieldsFor(record.contract)
    .filter((f) => !inCore.has(`d:${f.key}`) && !f.party)
    .map((f) => ({ key: `d:${f.key}`, label: f.label, value: detailText(record, f.key) ?? '' }))
    .filter((r) => r.value !== '');
}
