/**
 * 근로 — 급여 방식 (월급제·시급제·일급제·연봉제) 선택과 방식별 입력 칸 (규칙: src/domain/payBasis.ts)
 * - 고용 형태(정규직·계약직·단시간)와 별개의 칸 (details.payBasis)
 * - 월급제: 월급 · 시급제: 시급 + 하루 근무시간 + 월 예상 근무일수 · 일급제: 일급 + 월 예상 근무일수 · 연봉제: 연봉
 * - 시급·일급·연봉은 예상 월 수입(세전 기본급 추정)을 계산해 급여 금액에 채운다 — 사용자가 고치면 고친 값 유지
 * - 예상 월 수입 ≠ 실제 수령액 (주휴·연장·야간·휴일수당, 세금·4대보험 공제 미포함)
 * mode quick: 직접 입력·수정 화면 — 급여 금액은 quick.amount
 * mode full: 등록 확인(AI 결과)·상세 수정 화면 — 급여 금액은 결제 목록의 급여. 자동으로 바꾸지 않고 "급여 금액에 넣기"
 */
import { Fragment, useEffect, useRef } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Badge, ChipGroup } from '@/components/ui/controls';
import { cleanDetails, detailFields } from '@/domain/contractTypes';
import { formatAmountInput, formatWon, parseAmount } from '@/domain/money';
import {
  monthlyPayEstimate,
  PAY_BASES,
  PAY_BASIS_FIELDS,
  PAY_BASIS_KEYS,
  PAY_BASIS_LABEL,
  PAY_ESTIMATE_EXCLUDES,
  PAY_ESTIMATE_EXCLUDES_WITH_HOLIDAY,
  payAmountLabel,
  payBasisOf,
  usesLegacyMonthlyDays,
  WEEKLY_HOLIDAY_LABEL,
  WEEKLY_HOLIDAY_PAY,
  weeklyPay,
  type PayBasis,
} from '@/domain/payBasis';
import { colors, radius, spacing } from '@/theme';

import { detailFromInput } from '../form';
import { WeeklyPayRows } from '../WeeklyPayRows';
import { FormLabel, type FieldName, type FormKit } from './kit';

const OPTIONS = PAY_BASES.map((b) => ({ value: b, label: PAY_BASIS_LABEL[b] }));
const HOLIDAY_OPTIONS = WEEKLY_HOLIDAY_PAY.map((v) => ({ value: v, label: WEEKLY_HOLIDAY_LABEL[v] }));

/** 폼 입력값(문자열) → 상세 값 (계산용 — 형식이 틀린 칸은 빈 값) */
function formDetails(raw: Record<string, string | boolean> | undefined) {
  const out: Record<string, unknown> = {};
  for (const spec of detailFields('employment')) {
    if (!PAY_BASIS_KEYS.has(spec.key)) continue;
    const v = detailFromInput(spec, raw?.[spec.key] ?? '');
    if (v != null) out[spec.key] = v;
  }
  return cleanDetails('employment', out);
}

export function PayBasisFields({ kit, mode }: { kit: FormKit; mode: 'quick' | 'full' }) {
  const { values, setValue, getValues } = kit;
  const details = formDetails(values.details as Record<string, string | boolean>);
  const stored = payBasisOf(details);
  // 급여 방식이 없는 예전 계약은 월급제로 보여 주되 값은 바꾸지 않는다 (사용자가 고를 때만 저장)
  const basis: PayBasis = stored ?? 'monthly';
  const estimate = monthlyPayEstimate(details);
  // 방식에 맞는 칸. 등록 확인(AI 결과)·예전 계약은 값이 있는 칸도 함께 (기존 값이 숨지 않게) —
  // 직접 입력에서 방식을 바꾸면 다른 방식의 값은 지우지 않고 칸만 숨긴다
  const showFilled = mode === 'full' || !stored;
  // 예전 시급제 계약(주 근무일수 없이 월 예상 근무일수)은 그 칸도 보여 준다 · 주휴수당은 아래 선택 칩으로
  const legacyDays = basis === 'hourly' && usesLegacyMonthlyDays(details) ? ['monthlyWorkDays'] : [];
  const keys = [...new Set([...PAY_BASIS_FIELDS[basis], ...legacyDays, ...(showFilled ? [...PAY_BASIS_KEYS].filter((k) => k !== 'payBasis' && k !== 'weeklyHolidayPay' && details[k] != null) : [])])];
  const weekly = weeklyPay(details);
  const specs = detailFields('employment').filter((f) => keys.includes(f.key));

  // quick: 계산값이 바뀌면 급여 금액을 따라 바꾼다 — 비어 있거나 직전 계산값 그대로일 때만 (사용자가 고친 금액은 유지)
  const lastAuto = useRef<number | null>(estimate?.amount != null && parseAmount(values.quick?.amount ?? '') === estimate.amount ? estimate.amount : null);
  const est = estimate?.amount ?? null;
  // 직접 입력으로 새로 등록할 때만 급여 방식을 기본 월급제로 저장 — 수정 화면의 예전 계약·AI 분석 결과는 사용자가 고를 때만
  useEffect(() => {
    if (mode === 'quick' && !kit.editing && !getValues('details.payBasis')) setValue('details.payBasis', 'monthly');
  }, [mode, kit.editing, getValues, setValue]);
  useEffect(() => {
    if (mode !== 'quick' || est == null) return;
    const cur = parseAmount(getValues('quick.amount') ?? '');
    if (cur == null || cur === lastAuto.current) setValue('quick.amount', formatAmountInput(est), { shouldValidate: true });
    lastAuto.current = est;
  }, [est, mode, getValues, setValue]);

  // full: 결제 목록의 급여 (매월)
  const salaryIndex = mode === 'full' ? values.payments.findIndex((p) => p.kind === 'salary' && p.frequency === 'monthly') : -1;
  const current = mode === 'quick' ? parseAmount(values.quick?.amount ?? '') : salaryIndex >= 0 ? parseAmount(values.payments[salaryIndex].amount) : null;
  const edited = est != null && current != null && current !== est;
  const useEstimate = () => {
    if (est == null) return;
    if (mode === 'quick') {
      setValue('quick.amount', formatAmountInput(est), { shouldValidate: true });
      lastAuto.current = est;
    } else if (salaryIndex >= 0) setValue(`payments.${salaryIndex}.amount`, formatAmountInput(est), { shouldValidate: true });
  };

  return (
    <View testID="pay-basis">
      <FormLabel label="급여 방식" />
      <ChipGroup options={OPTIONS} value={basis} onChange={(b) => setValue('details.payBasis', b, { shouldDirty: true })} testIDPrefix="pay-basis" />
      <AppText variant="caption" color="textTertiary" style={{ marginTop: 6, marginBottom: spacing.lg }}>
        고용 형태(정규직·계약직·아르바이트)와 따로 골라요.
      </AppText>

      {specs.map((spec) => (
        <Fragment key={spec.key}>
          {kit.field(`details.${spec.key}` as FieldName, spec.label, {
            amount: spec.input === 'amount',
            keyboardType: spec.input === 'decimal' ? 'decimal-pad' : 'number-pad',
            suffix: spec.suffix,
            placeholder: spec.key === 'dailyWorkHours' ? '예: 8' : spec.key === 'weeklyWorkDays' ? '예: 5' : spec.key === 'monthlyWorkDays' ? '예: 22' : '0',
            testID: `pay-${spec.key}`,
            ...(spec.key === 'monthlyWorkDays' && basis === 'hourly' ? { hint: '주 근무일수를 넣으면 주 단위(주휴수당 포함 여부 반영)로 계산해요.' } : {}),
          })}
        </Fragment>
      ))}

      {/* 시급제: 주휴수당 포함 여부 — "포함"은 사용자가 지급 대상이라고 확인한 것 (법적 요건 판정 아님) */}
      {basis === 'hourly' ? (
        <View style={{ marginBottom: spacing.lg }} testID="pay-weeklyHolidayPay">
          <FormLabel label="주휴수당" />
          <ChipGroup
            options={HOLIDAY_OPTIONS}
            value={(values.details as Record<string, string>)?.weeklyHolidayPay || null}
            onChange={(v) => setValue('details.weeklyHolidayPay', (values.details as Record<string, string>)?.weeklyHolidayPay === v ? '' : v, { shouldDirty: true })}
            testIDPrefix="pay-holiday"
          />
          <AppText variant="caption" color="textTertiary" style={{ marginTop: 6 }}>
            지급 대상이라고 확인했을 때 "포함"을 골라요. 주 15시간 이상일 때만 계산하고, 법적 지급 요건 충족 여부는 판정하지 않아요.
          </AppText>
        </View>
      ) : null}

      {mode === 'quick'
        ? kit.field('quick.amount', payAmountLabel(stored), {
            keyboardType: 'number-pad',
            suffix: '원',
            placeholder: '0',
            amount: true,
            testID: 'quick-amount',
            hint: basis === 'monthly' ? '세전 월급 (계약서에 적힌 금액)' : basis === 'annual' ? '매달 받는 세전 금액 — 계약서에 적힌 월 지급액과 다르면 고쳐주세요' : '계산값을 채워 둘게요. 실제와 다르면 고칠 수 있어요.',
          })
        : null}

      {basis !== 'monthly' ? (
        <View style={{ marginBottom: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSubtle, gap: 4 }} testID="pay-estimate">
          {est != null ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
                <AppText variant="body2Strong" style={{ flex: 1 }}>
                  {basis === 'annual' ? '월 지급액 (연봉 ÷ 12)' : '예상 월 수입'}
                </AppText>
                <AppText variant="body2Strong" tabular testID="pay-estimate-amount">
                  {formatWon(est)}
                </AppText>
              </View>
              <AppText variant="caption" color="textSecondary" testID="pay-estimate-formula">
                {estimate!.formula}
              </AppText>
              {weekly ? <WeeklyPayRows w={weekly} testID="pay-weekly" /> : null}
              <Badge label={weekly?.holiday.status === 'added' ? '세전 추정 · 기본급 + 주휴수당' : '세전 기본급 추정'} tone="check" />
              <AppText variant="small" color="textTertiary">
                {weekly ? '월평균 추정치예요 — 달마다 주 수가 달라 실제 지급액과 달라요. ' : '실제 수령액이 아니에요. '}
                {weekly ? PAY_ESTIMATE_EXCLUDES : PAY_ESTIMATE_EXCLUDES_WITH_HOLIDAY}.
              </AppText>
              {edited ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 }} testID="pay-estimate-edited">
                  <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
                    {mode === 'quick' ? `직접 고친 금액 ${formatWon(current!)}으로 저장돼요.` : `지금 급여 금액은 ${formatWon(current!)}이에요.`}
                  </AppText>
                  <Button label={mode === 'quick' ? '계산값으로' : '급여 금액에 넣기'} size="sm" variant="secondary" onPress={useEstimate} testID="pay-estimate-apply" />
                </View>
              ) : null}
              {mode === 'full' && salaryIndex < 0 ? (
                <AppText variant="caption" color="check">
                  급여 항목이 없어요. 아래 금액에서 급여를 추가해주세요.
                </AppText>
              ) : null}
            </>
          ) : (
            <AppText variant="caption" color="textSecondary" testID="pay-estimate-missing">
              {estimate?.missing.join(' · ')}을(를) 입력하면 {basis === 'annual' ? '월 지급액' : '예상 월 수입'}을 계산해요.
            </AppText>
          )}
        </View>
      ) : null}
    </View>
  );
}
