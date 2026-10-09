import { z } from 'zod';

import { NOTICE_KINDS } from '@/domain/noticeKind';
import type { ContractDraft, DateDraft, PaymentDraft } from '@/data/repository';
import {
  BUSINESS_DAY_RULES,
  PAYMENT_OBLIGATIONS,
  CONTRACT_DATE_KINDS,
  DIRECTIONS,
  SOURCE_TYPES,
  CONTRACT_TYPES,
  detailFields,
  detailSchema,
  defaultDirection,
  PAYMENT_KINDS,
  paymentKindLabel,
  type PaymentKind,
  type ContractDetails,
  type ContractType,
  type DetailFieldSpec,
} from '@/domain/contractTypes';
import { isValidISODate, normalizeDateInput } from '@/domain/dates';
import { formatAmountInput, parseAmount } from '@/domain/money';
import { CONTRACT_CATEGORIES, PAYMENT_FREQUENCIES } from '@/domain/types';

/**
 * 계약 확인/수정 폼 스키마. AI 등록·직접 입력·수정 화면이 같은 폼을 쓴다.
 * 입력값은 문자열로 받고, 저장 시 formToDraft로 변환한다.
 * 구조: 계약 유형 → 공통 정보 → 유형별 정보(details) → 결제 목록(여러 건) → 주요 날짜 목록 → 갱신·해지 → 메모
 */

/** '261012' · '20261012' · '2026-10-12' 모두 허용 → 'YYYY-MM-DD'로 정규화 후 실제 날짜인지 검증 */
const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === '' ? '' : (normalizeDateInput(v) ?? v)))
  .refine((v) => v === '' || isValidISODate(v), '올바른 날짜가 아니에요 (예: 261012 또는 2026-10-12)');

const requiredDate = optionalDate.refine((v) => v !== '', '날짜를 입력해주세요');

const optionalAmount = z.string().refine((v) => v.trim() === '' || parseAmount(v) != null, '금액을 숫자로 입력해주세요');

const optionalInt = (min: number, max: number, message: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= min && Number(v) <= max), message);

const paymentFormSchema = z.object({
  kind: z.enum(PAYMENT_KINDS),
  direction: z.enum(DIRECTIONS),
  label: z.string().max(40),
  amount: z.string().refine((v) => parseAmount(v) != null, '금액을 입력해주세요'),
  frequency: z.enum(PAYMENT_FREQUENCIES),
  dayOfMonth: optionalInt(1, 31, '1~31 사이로 입력해주세요'),
  /** 폼에 보이지 않는 값 (연납 기준 월) — 수정 시 유지 */
  monthOfYear: z.string(),
  startsOn: optionalDate,
  endsOn: optionalDate,
  installmentCount: optionalInt(1, 600, '1~600 사이로 입력해주세요'),
  isVariable: z.boolean(),
  /** 금액 구성 (AI가 찾은 하위 항목, 표시용 — 합산하지 않음) */
  components: z.array(z.object({ label: z.string(), amount: z.number() })),
  businessDayRule: z.enum(BUSINESS_DAY_RULES),
  obligation: z.enum(PAYMENT_OBLIGATIONS),
  conditionNote: z.string(),
});

/**
 * 빠른 입력 (직접 입력 화면) — 금액·결제 주기·다음 결제일 한 줄. 저장할 때 첫 번째 결제로 바뀐다.
 * 금액을 비우면 결제 없이 저장 (계약명만 있어도 저장 가능).
 */
const quickFormSchema = z.object({
  amount: optionalAmount,
  frequency: z.enum(PAYMENT_FREQUENCIES),
  nextDate: optionalDate,
});

const dateFormSchema = z.object({
  kind: z.enum(CONTRACT_DATE_KINDS),
  label: z.string().trim().min(1, '이름을 입력해주세요').max(40),
  date: requiredDate,
});

export const contractFormSchema = z
  .object({
    contractType: z.enum(CONTRACT_TYPES),
    title: z.string().trim().min(1, '계약명을 입력해주세요').max(100, '100자 이내로 입력해주세요'),
    category: z.enum(CONTRACT_CATEGORIES),
    counterparty: z.string().max(100),
    contractDate: optionalDate,
    startDate: optionalDate,
    endDate: optionalDate,
    details: z.record(z.string(), z.union([z.string(), z.boolean()])),
    payments: z.array(paymentFormSchema).max(20),
    dates: z.array(dateFormSchema).max(30),
    totalAmount: optionalAmount,
    depositAmount: optionalAmount,
    autoRenewal: z.boolean(),
    renewalPeriodMonths: optionalInt(1, 120, '1~120개월 사이로 입력해주세요'),
    terminationNoticeDays: optionalInt(0, 365, '0~365일 사이로 입력해주세요'),
    noticeKind: z.enum(NOTICE_KINDS),
    earlyTerminationTerms: z.string().max(500),
    penaltyTerms: z.string().max(500),
    memo: z.string().max(2000),
    /** 값별 출처 (화면에는 배지로만 표시) */
    valueSources: z.record(z.string(), z.enum(SOURCE_TYPES)),
    /** 직접 입력 화면에서만 있음 (확인·수정 화면은 결제 목록을 그대로 쓴다) */
    quick: quickFormSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && isValidISODate(v.startDate) && isValidISODate(v.endDate) && v.endDate < v.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: '종료일이 시작일보다 빠릅니다' });
    }
    if (v.quick) {
      const hasAmount = v.quick.amount.trim() !== '';
      if (hasAmount && !v.quick.nextDate) {
        ctx.addIssue({ code: 'custom', path: ['quick', 'nextDate'], message: v.quick.frequency === 'one_time' ? '결제일을 입력해주세요' : '다음 결제일을 입력해주세요' });
      }
      if (!hasAmount && v.quick.nextDate) ctx.addIssue({ code: 'custom', path: ['quick', 'amount'], message: '금액을 입력해주세요' });
    }
    if (v.autoRenewal && v.renewalPeriodMonths.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['renewalPeriodMonths'], message: '갱신 주기를 입력해주세요' });
    }
    v.payments.forEach((p, i) => {
      // 확정된 일시불은 결제일이 있어야 한다 (없으면 계약 시작일). 선택형·조건부는 발생할 때 날짜를 정한다
      if (p.obligation === 'confirmed' && p.frequency === 'one_time' && !p.startsOn && !v.startDate) {
        ctx.addIssue({ code: 'custom', path: ['payments', i, 'startsOn'], message: '결제일을 입력해주세요' });
      }
      if (p.startsOn && p.endsOn && isValidISODate(p.startsOn) && isValidISODate(p.endsOn) && p.endsOn < p.startsOn) {
        ctx.addIssue({ code: 'custom', path: ['payments', i, 'endsOn'], message: '마지막 결제일이 첫 결제일보다 빠릅니다' });
      }
    });
    // 유형별 정보: 앱·AI·저장이 같은 스키마로 검증
    for (const spec of detailFields(v.contractType)) {
      const raw = v.details[spec.key];
      if (raw === undefined || raw === '') continue;
      if (detailFromInput(spec, raw) === undefined) {
        ctx.addIssue({ code: 'custom', path: ['details', spec.key], message: spec.input === 'percent' ? '0~100 사이 숫자로 입력해주세요 (예: 4.9)' : '숫자로 입력해주세요' });
      }
    }
  });

export type ContractFormValues = z.input<typeof contractFormSchema>;
export type ParsedContractForm = z.output<typeof contractFormSchema>;
export type PaymentFormValues = ContractFormValues['payments'][number];
export type DateFormValues = ContractFormValues['dates'][number];

const str = (v: string | null | undefined) => v ?? '';
const num = (v: number | null | undefined) => (v == null ? '' : String(v));
const nullable = (v: string) => (v.trim() === '' ? null : v.trim());
const intOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

/** 폼 문자열 → 상세 속성 값. 형식이 틀리면 undefined */
export function detailFromInput(spec: DetailFieldSpec, raw: string | boolean): string | number | boolean | null | undefined {
  if (raw === '') return null;
  switch (spec.input) {
    case 'boolean':
      return raw === true || raw === 'true' ? true : raw === false || raw === 'false' ? false : undefined;
    case 'amount': {
      const n = parseAmount(String(raw));
      return n == null ? undefined : n;
    }
    case 'integer':
      return /^\d+$/.test(String(raw).trim()) ? Number(String(raw).trim()) : undefined;
    case 'percent': {
      const t = String(raw).trim().replace('%', '');
      const n = Number(t);
      return /^\d+(\.\d+)?$/.test(t) && n <= 100 ? n : undefined;
    }
    case 'text':
      return String(raw).trim() || null;
    case 'enum':
      return (spec.options ?? []).some((o) => o.value === raw) ? String(raw) : undefined;
  }
}

/** 상세 속성 값 → 폼 문자열 */
export function detailToInput(spec: DetailFieldSpec, value: unknown): string | boolean {
  if (value == null) return '';
  if (spec.input === 'boolean') return value === true ? 'true' : value === false ? 'false' : '';
  if (spec.input === 'amount') return formatAmountInput(value as number);
  return String(value);
}

export function detailsToForm(type: ContractType, details: ContractDetails): Record<string, string | boolean> {
  return Object.fromEntries(detailFields(type).map((spec) => [spec.key, detailToInput(spec, details[spec.key])]));
}

export function detailsFromForm(type: ContractType, values: Record<string, string | boolean>): ContractDetails {
  const out: ContractDetails = {};
  for (const spec of detailFields(type)) {
    const v = detailFromInput(spec, values[spec.key] ?? '');
    if (v !== undefined && v !== null) out[spec.key] = v;
  }
  return detailSchema(type).parse(out);
}

export function paymentToForm(p: PaymentDraft): PaymentFormValues {
  return {
    kind: p.kind,
    direction: p.direction,
    label: p.label,
    amount: formatAmountInput(p.amount),
    frequency: p.frequency,
    dayOfMonth: num(p.dayOfMonth),
    monthOfYear: num(p.monthOfYear),
    startsOn: str(p.startsOn),
    endsOn: str(p.endsOn),
    installmentCount: num(p.installmentCount),
    isVariable: p.isVariable,
    components: p.components,
    businessDayRule: p.businessDayRule,
    obligation: p.obligation,
    conditionNote: p.conditionNote ?? '',
  };
}

export function draftToForm(d: ContractDraft): ContractFormValues {
  return {
    contractType: d.contractType,
    title: d.title,
    category: d.category,
    counterparty: str(d.counterparty),
    contractDate: str(d.contractDate),
    startDate: str(d.startDate),
    endDate: str(d.endDate),
    details: detailsToForm(d.contractType, d.details),
    payments: d.payments.map(paymentToForm),
    dates: d.dates.map((x): DateFormValues => ({ kind: x.kind, label: x.label, date: x.date })),
    totalAmount: formatAmountInput(d.totalAmount),
    depositAmount: formatAmountInput(d.depositAmount),
    autoRenewal: d.autoRenewal,
    renewalPeriodMonths: num(d.renewalPeriodMonths),
    terminationNoticeDays: num(d.terminationNoticeDays),
    noticeKind: d.noticeKind,
    earlyTerminationTerms: str(d.earlyTerminationTerms),
    penaltyTerms: str(d.penaltyTerms),
    memo: str(d.memo),
    valueSources: d.valueSources,
  };
}

/** 빠른 입력의 결제 의미 — 유형의 대표 결제 (월 납입형 → 정기 이용료, 근로 → 급여(수입) …) */
export function quickPaymentKind(type: ContractType): PaymentKind {
  const map: Partial<Record<ContractType, PaymentKind>> = {
    recurring: 'recurring_fee',
    lease: 'rent',
    installment: 'installment',
    loan: 'loan_repayment',
    insurance: 'premium',
    employment: 'salary',
    service: 'service_fee',
  };
  return map[type] ?? 'other';
}

/** 빠른 입력 → 결제 1건. 다음 결제일이 첫 결제일, 그 날짜의 '일'이 매번 결제일 (예: 10월 12일 → 매월 12일) */
export function quickToPayment(type: ContractType, q: NonNullable<ParsedContractForm['quick']>): PaymentDraft | null {
  const amount = parseAmount(q.amount);
  if (amount == null || !q.nextDate) return null;
  const kind = quickPaymentKind(type);
  const oneTime = q.frequency === 'one_time';
  return {
    kind,
    direction: defaultDirection(kind),
    label: paymentKindLabel(kind),
    amount,
    frequency: q.frequency,
    dayOfMonth: oneTime ? null : Number(q.nextDate.slice(8, 10)),
    monthOfYear: null,
    startsOn: q.nextDate,
    endsOn: null,
    installmentCount: null,
    isVariable: false,
    components: [],
    businessDayRule: 'none',
    obligation: 'confirmed',
    conditionNote: null,
  };
}

export function formToDraft(v: ParsedContractForm): ContractDraft {
  const quick = v.quick ? quickToPayment(v.contractType, v.quick) : null;
  return {
    contractType: v.contractType,
    title: v.title.trim(),
    category: v.category,
    counterparty: nullable(v.counterparty),
    contractDate: nullable(v.contractDate),
    startDate: nullable(v.startDate),
    endDate: nullable(v.endDate),
    details: detailsFromForm(v.contractType, v.details),
    payments: [
      ...(quick ? [quick] : []),
      ...v.payments.map((p): PaymentDraft => {
      const oneTime = p.frequency === 'one_time';
      return {
        kind: p.kind,
        direction: p.direction,
        label: p.label.trim(),
        amount: parseAmount(p.amount) ?? 0,
        frequency: p.frequency,
        dayOfMonth: oneTime ? null : intOrNull(p.dayOfMonth),
        monthOfYear: oneTime ? null : intOrNull(p.monthOfYear),
        startsOn: nullable(p.startsOn),
        endsOn: oneTime ? null : nullable(p.endsOn),
        installmentCount: oneTime ? null : intOrNull(p.installmentCount),
        isVariable: oneTime ? false : p.isVariable,
        components: p.components,
        businessDayRule: oneTime ? 'none' : p.businessDayRule,
        obligation: p.obligation,
        conditionNote: p.obligation === 'confirmed' ? null : p.conditionNote.trim() || null,
      };
      }),
    ],
    dates: v.dates.map((x): DateDraft => ({ kind: x.kind, label: x.label.trim(), date: x.date })),
    totalAmount: parseAmount(v.totalAmount),
    depositAmount: parseAmount(v.depositAmount),
    autoRenewal: v.autoRenewal,
    renewalPeriodMonths: v.autoRenewal ? intOrNull(v.renewalPeriodMonths) : null,
    terminationNoticeDays: intOrNull(v.terminationNoticeDays),
    noticeKind: v.noticeKind,
    earlyTerminationTerms: nullable(v.earlyTerminationTerms),
    penaltyTerms: nullable(v.penaltyTerms),
    memo: nullable(v.memo),
    valueSources: v.valueSources,
  };
}
