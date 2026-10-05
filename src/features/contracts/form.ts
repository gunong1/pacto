import { z } from 'zod';

import type { ContractDraft } from '@/data/repository';
import { isValidISODate } from '@/domain/dates';
import { formatAmountInput, parseAmount } from '@/domain/money';
import { CONTRACT_CATEGORIES, PAYMENT_FREQUENCIES } from '@/domain/types';

/**
 * 계약 확인/수정 폼 스키마. AI 등록·직접 입력·수정 화면이 같은 폼을 쓴다.
 * 입력값은 문자열로 받고, 저장 시 formToDraft로 변환한다.
 */

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === '' || isValidISODate(v), '날짜를 2026-01-31 형식으로 입력해주세요');

const optionalAmount = z
  .string()
  .refine((v) => v.trim() === '' || parseAmount(v) != null, '금액을 숫자로 입력해주세요');

const optionalInt = (min: number, max: number, message: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= min && Number(v) <= max), message);

export const contractFormSchema = z
  .object({
    title: z.string().trim().min(1, '계약명을 입력해주세요').max(100, '100자 이내로 입력해주세요'),
    category: z.enum(CONTRACT_CATEGORIES),
    counterparty: z.string().max(100),
    contractDate: optionalDate,
    startDate: optionalDate,
    endDate: optionalDate,
    totalAmount: optionalAmount,
    paymentLabel: z.string().max(40),
    paymentAmount: optionalAmount,
    paymentFrequency: z.enum([...PAYMENT_FREQUENCIES, 'none']),
    paymentDay: optionalInt(1, 31, '1~31 사이로 입력해주세요'),
    paymentVariable: z.boolean(),
    autoRenewal: z.boolean(),
    renewalPeriodMonths: optionalInt(1, 120, '1~120개월 사이로 입력해주세요'),
    terminationNoticeDays: optionalInt(0, 365, '0~365일 사이로 입력해주세요'),
    depositAmount: optionalAmount,
    earlyTerminationTerms: z.string().max(500),
    penaltyTerms: z.string().max(500),
    memo: z.string().max(2000),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && isValidISODate(v.startDate) && isValidISODate(v.endDate) && v.endDate < v.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: '종료일이 시작일보다 빠릅니다' });
    }
    const hasAmount = v.paymentAmount.trim() !== '';
    if (hasAmount && v.paymentFrequency === 'none') {
      ctx.addIssue({ code: 'custom', path: ['paymentFrequency'], message: '결제 주기를 선택해주세요' });
    }
    if (!hasAmount && v.paymentFrequency !== 'none') {
      ctx.addIssue({ code: 'custom', path: ['paymentAmount'], message: '결제 금액을 입력해주세요' });
    }
    if (v.autoRenewal && v.renewalPeriodMonths.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['renewalPeriodMonths'], message: '갱신 주기를 입력해주세요' });
    }
  });

export type ContractFormValues = z.infer<typeof contractFormSchema>;

const str = (v: string | null | undefined) => v ?? '';
const num = (v: number | null | undefined) => (v == null ? '' : String(v));
const nullable = (v: string) => (v.trim() === '' ? null : v.trim());
const intOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

export function draftToForm(d: ContractDraft): ContractFormValues {
  return {
    title: d.title,
    category: d.category,
    counterparty: str(d.counterparty),
    contractDate: str(d.contractDate),
    startDate: str(d.startDate),
    endDate: str(d.endDate),
    totalAmount: formatAmountInput(d.totalAmount),
    paymentLabel: str(d.paymentLabel),
    paymentAmount: formatAmountInput(d.paymentAmount),
    paymentFrequency: d.paymentFrequency ?? 'none',
    paymentDay: num(d.paymentDay),
    paymentVariable: d.paymentVariable,
    autoRenewal: d.autoRenewal,
    renewalPeriodMonths: num(d.renewalPeriodMonths),
    terminationNoticeDays: num(d.terminationNoticeDays),
    depositAmount: formatAmountInput(d.depositAmount),
    earlyTerminationTerms: str(d.earlyTerminationTerms),
    penaltyTerms: str(d.penaltyTerms),
    memo: str(d.memo),
  };
}

export function formToDraft(v: ContractFormValues): ContractDraft {
  const frequency = v.paymentFrequency === 'none' ? null : v.paymentFrequency;
  return {
    title: v.title.trim(),
    category: v.category,
    counterparty: nullable(v.counterparty),
    contractDate: nullable(v.contractDate),
    startDate: nullable(v.startDate),
    endDate: nullable(v.endDate),
    totalAmount: parseAmount(v.totalAmount),
    paymentLabel: nullable(v.paymentLabel),
    paymentAmount: frequency ? parseAmount(v.paymentAmount) : null,
    paymentFrequency: frequency,
    paymentDay: frequency ? intOrNull(v.paymentDay) : null,
    paymentVariable: frequency ? v.paymentVariable : false,
    autoRenewal: v.autoRenewal,
    renewalPeriodMonths: v.autoRenewal ? intOrNull(v.renewalPeriodMonths) : null,
    terminationNoticeDays: intOrNull(v.terminationNoticeDays),
    depositAmount: parseAmount(v.depositAmount),
    earlyTerminationTerms: nullable(v.earlyTerminationTerms),
    penaltyTerms: nullable(v.penaltyTerms),
    memo: nullable(v.memo),
  };
}
