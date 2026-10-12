import { contractKindDef, isSubtypeOf, profileKeyOf, type ClassificationMeta } from '@/domain/contractKinds';
import { z } from 'zod';

import { NOTICE_KINDS } from '@/domain/noticeKind';
import { legacyDetailParties, partiesFromInputs, partiesToInputs, type ContractParty } from '@/domain/parties';
import type { ContractDraft, DateDraft, FundDraft, PaymentDraft } from '@/data/repository';
import { DIRECTION_BASES, MONEY_NATURES, PARTY_RELATIONS } from '../../../supabase/functions/_shared/contractRegistry';
import {
  BUSINESS_DAY_RULES,
  PAYMENT_OBLIGATIONS,
  CONTRACT_DATE_KINDS,
  DIRECTIONS,
  SOURCE_TYPES,
  CONTRACT_TYPES,
  detailFields,
  detailSchema,
  PAYMENT_KINDS,
  paymentKindLabel,
  type PaymentKind,
  type ContractDetails,
  type ContractType,
  type DetailFieldSpec,
  type Direction,
} from '@/domain/contractTypes';
import { daysInMonth, isValidISODate, normalizeDateInput, toISODate, todayInSeoul } from '@/domain/dates';
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
  /** 저장된 결제 id (화면에 보이지 않음 — 수정 시 유지) */
  id: z.string().optional(),
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
  /** 화면에 직접 보이지 않는 값 (돈의 성격·방향 근거·계약서의 지급자/수령자·묶음) — 수정 시 유지. '' = 없음 */
  moneyNature: z.union([z.enum(MONEY_NATURES), z.literal('')]).optional(),
  directionBasis: z.union([z.enum(DIRECTION_BASES), z.literal('')]).optional(),
  payerRole: z.string().optional(),
  payeeRole: z.string().optional(),
  fundKey: z.string().optional(),
});

/**
 * 빠른 입력 (직접 입력 화면) — 금액·결제 주기·다음 결제일 한 줄. 저장할 때 첫 번째 결제로 바뀐다.
 * 금액을 비우면 결제 없이 저장 (계약명만 있어도 저장 가능).
 */
const quickFormSchema = z.object({
  amount: optionalAmount,
  /** 금액 구분(지출·수입·중립) — 유형으로 고정하지 않고 사용자가 고른다 (기본은 유형별 추천) */
  direction: z.enum(DIRECTIONS),
  frequency: z.enum(PAYMENT_FREQUENCIES),
  /** 매월: 결제일(1~31)만 받는다 — 첫 결제일은 저장할 때 오늘 기준 다음 그날로 계산 */
  day: optionalInt(1, 31, '1~31 사이로 입력해주세요').optional(),
  /** 2개월마다·분기·6개월·매년: 첫 결제일 / 일회성: 결제 예정일 */
  nextDate: optionalDate,
  /**
   * 수정 화면: 이 금액이 원래 어떤 결제였는지 (이름·종류·종료일·회차 등은 그대로 두고 화면에서 바꾼 값만 덮어쓴다).
   * 등록 화면에서는 없음
   */
  base: paymentFormSchema.optional(),
  /** 구성항목 (기본급·수당 등) — 위 금액을 이루는 하위 항목, 따로 더하지 않는다 */
  components: z.array(z.object({ label: z.string(), amount: z.number() })).optional(),
});

const dateFormSchema = z.object({
  kind: z.enum(CONTRACT_DATE_KINDS),
  label: z.string().trim().min(1, '이름을 입력해주세요').max(40),
  date: requiredDate,
});

export const contractFormSchema = z
  .object({
    /** 계약 종류 (기준값) — '' = 아직 고르지 않음(신뢰도 낮음) 또는 분류 개편 전 계약 */
    contractKind: z.string(),
    /** 상세 분류 — '' = 없음 */
    contractSubtype: z.string(),
    /** 분류 메타데이터 (폼에서 고치지 않고 그대로, 출처만 바뀜) */
    classification: z.custom<ClassificationMeta>(),
    /** 하위 호환값 — 계약 종류가 있으면 저장할 때 레지스트리 호환값으로 덮어쓴다 */
    contractType: z.enum(CONTRACT_TYPES),
    title: z.string().trim().min(1, '계약명을 입력해주세요').max(100, '100자 이내로 입력해주세요'),
    category: z.enum(CONTRACT_CATEGORIES),
    counterparty: z.string().max(100),
    /** 계약 당사자 — 역할 코드 → 이름 (여럿이면 쉼표로). 역할 이름은 레지스트리 (src/domain/parties.ts) */
    // 아직 입력하지 않은 역할 칸은 값이 없을 수 있다 (빈칸 = 확인 필요, 저장을 막지 않음)
    parties: z.record(z.string(), z.string().max(300, '300자 이내로 입력해주세요').optional()),
    /** 내 역할 — '' = 모름 (AI가 추측하지 않음, 이름 일치는 추천만) */
    userPartyRole: z.string(),
    /** 나와 계약의 관계 — '' = 묻지 않음 */
    userPartyRelation: z.union([z.enum(PARTY_RELATIONS), z.literal('')]).optional(),
    /** 돌려받을 돈 묶음 (보증금·예치금) — 화면에서 직접 고치지 않고 그대로 (undefined면 저장된 묶음 유지) */
    funds: z.custom<FundDraft[]>().optional(),
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
    /** 결제가 아닌 금액 (분석이 찾은 참고·면제·할인 전 금액) — 폼에서 고치지 않고 그대로 저장 */
    referenceAmounts: z.array(z.object({ label: z.string(), amount: z.number(), role: z.enum(['total', 'reference', 'waived', 'discount', 'before_discount']) })),
    /** 직접 입력 화면에서만 있음 (확인·수정 화면은 결제 목록을 그대로 쓴다) */
    quick: quickFormSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && isValidISODate(v.startDate) && isValidISODate(v.endDate) && v.endDate < v.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: '종료일이 시작일보다 빠릅니다' });
    }
    if (v.quick) {
      const q = v.quick;
      const hasAmount = q.amount.trim() !== '';
      const income = q.direction === 'income';
      // 정기 결제는 결제일(일)만 받는다 — 첫 결제 시점은 시작일과 결제일로 계산 (첫 결제일 직접 지정은 상세에서 선택)
      // 일회성은 결제 예정일
      const oneTime = q.frequency === 'one_time';
      // 수정 화면: 원래 날짜 없이(계약 시작일 기준) 같은 주기였던 일회성 결제는 날짜를 비워 둬도 된다
      const inheritsStart = !!q.base && q.base.frequency === q.frequency && !q.base.startsOn.trim();
      const hasWhen = oneTime ? !!q.nextDate || inheritsStart : !!q.day?.trim();
      if (hasAmount && !hasWhen) {
        const label = oneTime ? (income ? '지급 예정일' : '결제 예정일') : income ? '지급일' : '결제일';
        ctx.addIssue({ code: 'custom', path: ['quick', oneTime ? 'nextDate' : 'day'], message: `${label}을 입력해주세요` });
      }
      if (!hasAmount && hasWhen) ctx.addIssue({ code: 'custom', path: ['quick', 'amount'], message: '금액을 입력해주세요' });
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
    if (v.contractKind && !contractKindDef(v.contractKind)) ctx.addIssue({ code: 'custom', path: ['contractKind'], message: '계약 종류를 다시 골라주세요' });
    for (const spec of detailFields(formProfile(v))) {
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

/**
 * 예전 버전의 당사자 칸(임대인·임차인·근로자)을 당사자 목록과 맞춘다 — 사용자가 저장할 때만 (예전 앱도 같은 이름을 보도록).
 * 당사자 목록에서 그 역할을 지웠으면 예전 칸도 비운다 (지운 이름이 예전 칸에서 다시 나타나지 않게)
 */
function syncLegacyPartyDetails(type: ContractType, details: ContractDetails, parties: readonly ContractParty[]): ContractDetails {
  const out = { ...details };
  for (const spec of detailFields(type)) {
    if (!spec.party) continue;
    const names = parties.filter((p) => p.role === spec.party).map((p) => p.name).join(', ');
    if (names) out[spec.key] = names.slice(0, 500);
    else delete out[spec.key];
  }
  return out;
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
    ...(p.id ? { id: p.id } : {}),
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
    moneyNature: p.moneyNature ?? '',
    directionBasis: p.directionBasis ?? '',
    payerRole: p.payerRole ?? '',
    payeeRole: p.payeeRole ?? '',
    fundKey: p.fundKey ?? '',
  };
}

/** 폼 값의 관리 프로필 (화면 이름·유형별 속성 묶음) — 계약 종류가 있으면 종류로, 없으면 기존 유형으로 */
export const formProfile = (v: { contractKind: string; contractType: ContractType }): ContractType => profileKeyOf({ contractKind: v.contractKind || null, contractType: v.contractType });

export function draftToForm(d: ContractDraft): ContractFormValues {
  return {
    contractKind: d.contractKind ?? '',
    contractSubtype: d.contractSubtype ?? '',
    classification: d.classification,
    contractType: d.contractType,
    title: d.title,
    category: d.category,
    counterparty: str(d.counterparty),
    // 당사자 목록이 없는 예전 계약은 역할이 이름에 붙은 예전 칸(임대인·임차인·근로자)만 그 역할로 채운다 (상대방 이름은 역할을 추측하지 않음)
    parties: partiesToInputs(d.parties.length > 0 ? d.parties : legacyDetailParties(profileKeyOf(d), d.details)),
    userPartyRole: d.userPartyRole ?? '',
    userPartyRelation: d.userPartyRelation ?? '',
    ...(d.funds ? { funds: d.funds.map((f) => ({ ...f })) } : {}),
    contractDate: str(d.contractDate),
    startDate: str(d.startDate),
    endDate: str(d.endDate),
    details: detailsToForm(profileKeyOf(d), d.details),
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
    referenceAmounts: d.referenceAmounts.map((r) => ({ ...r })),
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

/**
 * 빠른 입력의 돈 방향 추천 — 같은 유형이라도 내 역할에 따라 달라질 수 있어 추천일 뿐, 사용자가 언제든 바꾼다.
 * clear: 대부분 한쪽인 유형(근로 → 수입, 월 납입형·할부·대출·보험 → 지출)만 "추천" 표시
 */
export function quickDirectionAdvice(type: ContractType): { direction: Direction; clear: boolean; roles: string } {
  switch (type) {
    case 'employment':
      return { direction: 'income', clear: true, roles: '수입 = 내가 근로자인 경우 · 지출 = 내가 고용주인 경우' };
    case 'recurring':
    case 'installment':
    case 'loan':
    case 'insurance':
      return { direction: 'expense', clear: true, roles: '지출 = 내가 내는 돈 · 수입 = 내가 받는 돈' };
    case 'sale':
      return { direction: 'expense', clear: false, roles: '지출 = 내가 사는(매수) 경우 · 수입 = 내가 파는(매도) 경우' };
    case 'service':
      return { direction: 'expense', clear: false, roles: '지출 = 내가 일을 맡기는(발주) 경우 · 수입 = 내가 일하고 돈을 받는 경우' };
    case 'lease':
      return { direction: 'expense', clear: false, roles: '지출 = 내가 임차인인 경우 · 수입 = 내가 임대인인 경우' };
    default:
      return { direction: 'expense', clear: false, roles: '지출 = 내가 내는 돈 · 수입 = 내가 받는 돈' };
  }
}

/** 빠른 입력 → 결제 1건. 다음 결제일이 첫 결제일, 그 날짜의 '일'이 매번 결제일 (예: 10월 12일 → 매월 12일) */
/** 매월 결제일(일) → 오늘 이후 첫 그날 (이번 달에 지났으면 다음 달, 없는 날짜는 그 달 말일) */
export function nextMonthlyDate(today: string, day: number): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const d = Number(today.slice(8, 10));
  const [yy, mm] = day >= d || day >= daysInMonth(y, m) ? [y, m] : m === 12 ? [y + 1, 1] : [y, m + 1];
  return toISODate(yy, mm, Math.min(day, daysInMonth(yy, mm)));
}

/** 빠른 입력의 기본 주기 — 매매·일회성·용역은 일시불, 나머지는 매월 */
export const quickDefaultFrequency = (type: ContractType): PaymentFormValues['frequency'] => (type === 'sale' || type === 'one_time' || type === 'service' ? 'one_time' : 'monthly');

/**
 * 저장된 계약 → 직접 입력(빠른 입력)과 같은 화면의 값 — 수정 화면용.
 * 대표 결제(첫 정기 결제, 없으면 첫 결제) 하나가 위쪽 "금액"으로, 나머지는 "상세 정보 추가 → 추가 결제"로 간다.
 */
export function draftToQuickForm(d: ContractDraft): ContractFormValues {
  const v = draftToForm(d);
  const idx = d.payments.findIndex((p) => p.frequency !== 'one_time' && p.obligation === 'confirmed');
  const pick = idx >= 0 ? idx : d.payments.length > 0 ? 0 : -1;
  const profile = profileKeyOf(d);
  if (pick < 0) return { ...v, quick: { amount: '', direction: quickDirectionAdvice(profile).direction, frequency: quickDefaultFrequency(profile), day: '', nextDate: '' } };
  const p = d.payments[pick];
  const oneTime = p.frequency === 'one_time';
  return {
    ...v,
    payments: v.payments.filter((_, i) => i !== pick),
    quick: {
      amount: formatAmountInput(p.amount),
      direction: p.direction,
      frequency: p.frequency,
      // 결제일을 모르면 비워 둔다 (시작일의 날짜를 결제일로 채우지 않음 — 사용자가 입력)
      day: oneTime || p.dayOfMonth == null ? '' : String(p.dayOfMonth),
      // 정기 결제: 계약 시작일과 다른 첫 결제일을 따로 정해 둔 경우만 (상세 정보의 "첫 결제일 직접 지정")
      // 시작일이 없는 계약은 저장 당시 날짜가 기준일로 들어가 있어 직접 지정한 값으로 보지 않는다
      nextDate: oneTime ? str(p.startsOn) : p.startsOn && d.startDate ? p.startsOn : '',
      base: v.payments[pick],
      components: p.components.map((c) => ({ ...c })),
    },
  };
}

/** 수정 화면: 상세 정보에 저장된 값이 있으면 처음부터 펼친다 (기존 데이터가 숨지 않게) */
export function quickHasDetails(v: ContractFormValues): boolean {
  const filled = (x: string | undefined) => !!x && x.trim() !== '';
  return (
    filled(v.counterparty) ||
    Object.values(v.parties ?? {}).some(filled) ||
    !!v.userPartyRole ||
    filled(v.contractDate) ||
    v.payments.length > 0 ||
    v.dates.length > 0 ||
    filled(v.terminationNoticeDays) ||
    filled(v.earlyTerminationTerms) ||
    filled(v.penaltyTerms) ||
    filled(v.totalAmount) ||
    filled(v.depositAmount) ||
    (!!v.quick && v.quick.frequency !== 'one_time' && filled(v.quick.nextDate)) ||
    Object.values(v.details).some((x) => (typeof x === 'string' ? x.trim() !== '' : x === true))
  );
}

export function quickToPayment(type: ContractType, q: NonNullable<ParsedContractForm['quick']>, today: string = todayInSeoul(), contractStart: string | null = null): PaymentDraft | null {
  void today;
  const amount = parseAmount(q.amount);
  const oneTime = q.frequency === 'one_time';
  const day = !oneTime && q.day?.trim() ? Number(q.day) : null;
  /** 정기 결제의 첫 결제일 직접 지정 (없으면 시작일 이후 결제일로 자동 계산) */
  const customFirst = !oneTime && q.nextDate ? q.nextDate : null;
  const base = q.base ? paymentFromForm(q.base) : null;
  if (base) {
    if (amount == null) return null;
    // 정기: 직접 지정한 첫 결제일, 없으면 계약 시작일을 따라감(null). 시작일이 없는 계약은 기존 기준일 유지
    // 일회성: 결제 예정일 (같은 주기였다면 비워 두면 기존 값)
    const first = oneTime ? q.nextDate || (base.frequency === q.frequency ? base.startsOn : null) : (customFirst ?? (contractStart ? null : base.frequency !== 'one_time' ? base.startsOn : null));
    if (oneTime && !first && !(base.frequency === q.frequency && !base.startsOn)) return null;
    return {
      ...base,
      direction: q.direction,
      // 방향을 바꿨을 때만 "사용자가 고른 방향"으로 (그대로면 원래 근거 유지)
      directionBasis: q.direction !== base.direction ? 'user' : base.directionBasis,
      amount,
      frequency: q.frequency,
      dayOfMonth: oneTime ? null : (day ?? base.dayOfMonth),
      monthOfYear: oneTime || q.frequency === 'monthly' || q.frequency !== base.frequency ? null : base.monthOfYear,
      startsOn: first,
      endsOn: oneTime ? null : base.endsOn,
      installmentCount: oneTime ? null : base.installmentCount,
      isVariable: oneTime ? false : base.isVariable,
      businessDayRule: oneTime ? 'none' : base.businessDayRule,
      components: q.components ?? base.components,
    };
  }
  if (amount == null) return null;
  if (oneTime ? !q.nextDate : day == null) return null;
  const kind = quickPaymentKind(type);
  return {
    kind,
    // 빠른 입력은 사용자가 방향을 직접 고른다 (역할을 바꿔도 다시 계산하지 않음)
    direction: q.direction,
    directionBasis: 'user',
    moneyNature: 'ordinary',
    label: paymentKindLabel(kind),
    amount,
    frequency: q.frequency,
    // 31일처럼 없는 달은 일정 계산에서 말일로 보정한다
    dayOfMonth: oneTime ? null : day,
    monthOfYear: null,
    // 정기: 첫 결제일을 직접 정하지 않으면 계약 시작일(없으면 오늘) 이후 결제일부터 자동 계산
    startsOn: oneTime ? q.nextDate! : customFirst,
    endsOn: null,
    installmentCount: null,
    isVariable: false,
    components: q.components ?? [],
    businessDayRule: 'none',
    obligation: 'confirmed',
    conditionNote: null,
  };
}


/** 결제 입력값 → 저장 형식 */
export function paymentFromForm(p: PaymentFormValues): PaymentDraft {
  const oneTime = p.frequency === 'one_time';
  return {
    ...(p.id ? { id: p.id } : {}),
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
    // 값이 있을 때만 (없으면 예전 데이터와 같은 모양)
    ...(p.moneyNature ? { moneyNature: p.moneyNature } : {}),
    ...(p.directionBasis ? { directionBasis: p.directionBasis } : {}),
    ...(p.payerRole ? { payerRole: p.payerRole } : {}),
    ...(p.payeeRole ? { payeeRole: p.payeeRole } : {}),
    ...(p.fundKey ? { fundKey: p.fundKey } : {}),
  };
}

export function formToDraft(v: ParsedContractForm, today: string = todayInSeoul()): ContractDraft {
  const profile = formProfile(v);
  const quick = v.quick ? quickToPayment(profile, v.quick, today, nullable(v.startDate)) : null;
  const kind = v.contractKind || null;
  const parties = partiesFromInputs(v.parties);
  return {
    contractKind: kind,
    contractSubtype: kind && v.contractSubtype && isSubtypeOf(kind, v.contractSubtype) ? v.contractSubtype : null,
    classification: v.classification,
    contractType: v.contractType,
    title: v.title.trim(),
    category: v.category,
    counterparty: nullable(v.counterparty),
    parties,
    userPartyRole: v.userPartyRole || null,
    ...(v.userPartyRelation !== undefined ? { userPartyRelation: v.userPartyRelation || null } : {}),
    ...(v.funds ? { funds: v.funds } : {}),
    contractDate: nullable(v.contractDate),
    startDate: nullable(v.startDate),
    endDate: nullable(v.endDate),
    details: syncLegacyPartyDetails(profile, detailsFromForm(profile, v.details), parties),
    payments: [
      ...(quick ? [quick] : []),
      ...v.payments.map(paymentFromForm),
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
    referenceAmounts: v.referenceAmounts,
  };
}
