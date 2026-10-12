/**
 * 금액 섹션 — 금액 카드 목록(의미·의무 수준·이름·금액·구성항목·구분·주기·결제일·휴일 규칙) + 공용 부품
 * 입력: 결제 목록(useFieldArray) · 유형별 금액 의미 · 결제별 계산 결과(plans) / 출력: payments.* 입력값
 * 확정 결제만 캘린더·지출에 반영된다. 선택형·조건부 금액은 결제일 없이 저장하고, 실제로 생기면 상세에서 활성화한다.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Controller, type UseFieldArrayReturn } from 'react-hook-form';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Badge, ChipGroup, SwitchRow, TextField } from '@/components/ui/controls';
import { BUSINESS_DAY_RULE_LABEL } from '@/domain/businessDays';
import { defaultDirection, DIRECTION_LABEL, DIRECTIONS, OBLIGATION_LABEL, paymentKindLabel, type Direction, type PaymentKind } from '@/domain/contractTypes';
import { formatDateKo } from '@/domain/dates';
import { FREQUENCY_LABEL } from '@/domain/labels';
import { formatAmountInput, formatWon, parseAmount } from '@/domain/money';
import { planSummary, type PaymentPlan } from '@/domain/paymentPlan';
import { PAYMENT_FREQUENCIES } from '@/domain/types';
import { colors, hitSlop, spacing } from '@/theme';

import type { ContractFormValues, PaymentFormValues } from '../form';
import { FormLabel, type FormKit } from './kit';
import { styles } from './styles';

export const FREQUENCY_OPTIONS = PAYMENT_FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }));
const DIRECTION_OPTIONS = DIRECTIONS.map((d) => ({ value: d, label: DIRECTION_LABEL[d] }));
/** 금액 구분 설명 — 고른 항목이 무슨 뜻인지 */
const DIRECTION_HINT: Record<Direction, string> = {
  expense: '출금 = 내(관리하는 분)가 내는 돈',
  income: '입금 = 내(관리하는 분)가 받는 돈 (급여·대금·돌려받는 보증금 등)',
  neutral: '확인 필요 = 누가 내는 돈인지 아직 몰라요 (출금·입금 합계에 넣지 않아요). 위 "이 계약에서 누구세요?"에서 역할을 고르면 자동으로 정해져요',
};
const ONE_TIME_KINDS: ReadonlySet<PaymentKind> = new Set(['setup_fee', 'deposit', 'advance_payment', 'down_payment', 'interim_payment', 'balance_payment']);
const defaultFrequency = (kind: PaymentKind): PaymentFormValues['frequency'] => (ONE_TIME_KINDS.has(kind) ? 'one_time' : kind === 'premium' ? 'yearly' : 'monthly');

/**
 * 확정 결제만 캘린더·지출에 반영된다. 참고 금액은 결제가 아니라 참고 금액 목록에 따로 저장된다 (선택지 없음).
 * 이전 버전에서 저장된 "발생 가능·참고 금액" 결제는 그 값을 그대로 보여준다 (읽기 호환).
 */
const OBLIGATION_OPTIONS = [
  { value: 'confirmed' as const, label: '확정 결제' },
  { value: 'optional' as const, label: '선택형 (이용 시)' },
  { value: 'conditional' as const, label: '조건부 (상황 발생 시)' },
];
const LEGACY_OBLIGATION_OPTIONS = [
  { value: 'potential' as const, label: '발생 가능' },
  { value: 'informational' as const, label: '참고 금액' },
];
const obligationOptions = (current: string) => [...OBLIGATION_OPTIONS, ...LEGACY_OBLIGATION_OPTIONS.filter((o) => o.value === current)];

const BUSINESS_DAY_OPTIONS = (['none', 'previous', 'next'] as const).map((v) => ({ value: v, label: v === 'none' ? '그날 그대로' : BUSINESS_DAY_RULE_LABEL[v] }));

function newPayment(kind: PaymentKind): PaymentFormValues {
  return {
    kind,
    direction: defaultDirection(kind),
    label: paymentKindLabel(kind),
    amount: '',
    frequency: defaultFrequency(kind),
    dayOfMonth: '',
    monthOfYear: '',
    startsOn: '',
    endsOn: '',
    installmentCount: '',
    isVariable: false,
    components: [],
    businessDayRule: 'none',
    obligation: 'confirmed',
    conditionNote: '',
  };
}

export function PaymentsList({
  kit,
  payments,
  paymentKinds,
  plans,
  notes,
}: {
  kit: FormKit;
  payments: UseFieldArrayReturn<ContractFormValues, 'payments', 'key'>;
  paymentKinds: readonly PaymentKind[];
  /** 결제별 계산 결과 (빠른 입력 결제가 있으면 맨 앞, 그 뒤로 추가 결제) */
  plans: { plan: PaymentPlan | null }[] | undefined;
  notes?: Partial<Record<string, string>>;
}) {
  const { control, getValues, setValue, values, flagged, hint, field, date } = kit;
  const paymentKindOptions = (current: PaymentKind) => {
    const kinds = [...paymentKinds];
    if (!kinds.includes(current)) kinds.push(current);
    return kinds.map((k) => ({ value: k, label: paymentKindLabel(k) }));
  };
  return (
    <>
      {flagged?.has('payments') && notes?.payments ? (
        <AppText variant="caption" color="check" style={{ marginBottom: spacing.md }}>
          {notes.payments}
        </AppText>
      ) : null}
      {payments.fields.map((p, i) => {
        const pv = values.payments?.[i];
        if (!pv) return null;
        const oneTime = pv.frequency === 'one_time';
        const path = `payments.${i}`;
        return (
          <View key={p.key} style={styles.card} testID={`payment-${i}`}>
            <View style={styles.cardHeader}>
              <AppText variant="body2Strong">금액 {i + 1}</AppText>
              {pv.obligation !== 'confirmed' ? (
                <Badge label={`${OBLIGATION_LABEL[pv.obligation]} · 캘린더·지출 제외`} tone="check" />
              ) : pv.direction === 'neutral' ? (
                <Badge label="방향 확인 필요 · 합계 제외" tone="check" />
              ) : pv.direction === 'income' ? (
                <Badge label="입금" tone="primary" />
              ) : null}
              {pv.moneyNature === 'refundable_deposit' ? <Badge label="보증금 · 돌려받을(줄) 돈" /> : null}
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => payments.remove(i)} hitSlop={hitSlop} accessibilityRole="button" accessibilityLabel={`결제 ${i + 1} 삭제`} testID={`payment-${i}-remove`}>
                <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
              </Pressable>
            </View>
            <Controller
              control={control}
              name={`payments.${i}.kind`}
              render={({ field: f }) => (
                <ChipGroup
                  options={paymentKindOptions(f.value)}
                  value={f.value}
                  onChange={(k) => {
                    // 이름·주기를 직접 바꾸지 않았다면 새 의미의 기본값으로 (예: 설치비 → 일시불)
                    const label = getValues(`payments.${i}.label`);
                    const frequency = getValues(`payments.${i}.frequency`);
                    if (!label || label === paymentKindLabel(f.value)) setValue(`payments.${i}.label`, paymentKindLabel(k));
                    if (frequency === defaultFrequency(f.value)) setValue(`payments.${i}.frequency`, defaultFrequency(k));
                    // 방향을 사용자가 정하지 않았고 역할로 계산되지도 않았을 때만 새 의미의 기본값으로
                    const basis = getValues(`payments.${i}.directionBasis`);
                    if (!basis && getValues(`payments.${i}.direction`) === defaultDirection(f.value)) setValue(`payments.${i}.direction`, defaultDirection(k));
                    // 보증금(돌려받을 돈)으로 바꾸면 성격도 보증금, 보증금에서 다른 의미로 바꾸면 일반 (묶음 연결은 저장된 값 유지)
                    if (k === 'deposit') setValue(`payments.${i}.moneyNature`, 'refundable_deposit');
                    else if (f.value === 'deposit' && getValues(`payments.${i}.moneyNature`) === 'refundable_deposit') setValue(`payments.${i}.moneyNature`, 'ordinary');
                    f.onChange(k);
                  }}
                  testIDPrefix={`payment-${i}-kind`}
                />
              )}
            />
            <View style={{ height: spacing.md }} />
            <FormLabel label="이 돈을 내야 하나요?" flagged={flagged?.has(`${path}.obligation`)} />
            <Controller
              control={control}
              name={`payments.${i}.obligation`}
              render={({ field: f }) => <ChipGroup options={obligationOptions(f.value)} value={f.value} onChange={f.onChange} testIDPrefix={`payment-${i}-obligation`} />}
            />
            {hint(`${path}.obligation`) ? (
              <AppText variant="caption" color={flagged?.has(`${path}.obligation`) ? 'check' : 'textTertiary'} style={{ marginTop: 6 }}>
                {hint(`${path}.obligation`)}
              </AppText>
            ) : null}
            {pv.obligation !== 'confirmed' ? (
              <View style={{ marginTop: spacing.md }}>
                {field(`payments.${i}.conditionNote`, '언제 내는 돈인가요?', { placeholder: '예: 회원권을 양도하는 경우', testID: `payment-${i}-conditionNote` })}
              </View>
            ) : null}
            <View style={{ height: spacing.md }} />
            <View style={styles.row2}>
              <View style={styles.col}>{field(`payments.${i}.label`, '항목 이름', { placeholder: '예: 월 렌탈료', testID: `payment-${i}-label` })}</View>
              <View style={styles.col}>
                {field(`payments.${i}.amount`, '금액', { keyboardType: 'number-pad', suffix: '원', placeholder: '0', amount: true, testID: `payment-${i}-amount`, flagged: flagged?.has(`${path}.amount`), hint: hint(`${path}.amount`) })}
              </View>
            </View>
            {/* 구성항목: 이 금액을 이루는 하위 항목 (기본급·수당 등) — 따로 일정·합계에 넣지 않는다 */}
            {pv.obligation === 'confirmed' ? (
              <ComponentsEditor components={pv.components ?? []} total={parseAmount(pv.amount)} onChange={(next) => setValue(`payments.${i}.components`, next)} testID={`payment-${i}-components`} />
            ) : null}
            <FormLabel label="금액 구분" />
            <Controller
              control={control}
              name={`payments.${i}.direction`}
              render={({ field: f }) => (
                <ChipGroup
                  options={DIRECTION_OPTIONS}
                  value={f.value}
                  onChange={(d) => {
                    // 사용자가 직접 고른 방향 — 역할을 바꿔도 다시 계산하지 않는다 (확인 필요로 되돌리면 근거 없음)
                    setValue(`payments.${i}.directionBasis`, d === 'neutral' ? '' : 'user');
                    f.onChange(d);
                  }}
                  testIDPrefix={`payment-${i}-direction`}
                />
              )}
            />
            <AppText variant="caption" color="textTertiary" style={{ marginTop: spacing.xs }} testID={`payment-${i}-direction-hint`}>
              {DIRECTION_HINT[pv.direction]}
            </AppText>
            <View style={{ height: spacing.md }} />
            <FormLabel label="결제 주기" />
            <Controller control={control} name={`payments.${i}.frequency`} render={({ field: f }) => <ChipGroup options={FREQUENCY_OPTIONS} value={f.value} onChange={f.onChange} scroll testIDPrefix={`payment-${i}-frequency`} />} />
            <View style={{ height: spacing.md }} />
            {pv.obligation !== 'confirmed' ? (
              <AppText variant="caption" color="textTertiary">
                결제일은 실제로 이용하거나 상황이 생겼을 때 계약 상세에서 정해요.
              </AppText>
            ) : oneTime ? (
              date(`payments.${i}.startsOn`, '결제일', { hint: values.startDate ? '비워두면 계약 시작일' : undefined, testID: `payment-${i}-startsOn` })
            ) : (
              <>
                <View style={styles.colNarrow}>
                  {field(`payments.${i}.dayOfMonth`, pv.direction === 'income' ? '지급일' : '결제일', { keyboardType: 'number-pad', suffix: '일', maxLength: 2, testID: `payment-${i}-dayOfMonth`, flagged: flagged?.has(`${path}.dayOfMonth`), hint: hint(`${path}.dayOfMonth`) })}
                </View>
                <AppText variant="caption" color="textTertiary" style={{ marginBottom: spacing.sm }}>
                  첫 {pv.direction === 'income' ? '지급' : '결제'} 시점은 시작일과 {pv.direction === 'income' ? '지급일' : '결제일'}을 기준으로 자동 계산해요.
                </AppText>
                {/* 예외만: 계약서에 첫 지급일이 따로 있거나 첫 달만 다른 경우 */}
                <CustomFirstDate income={pv.direction === 'income'} initialOpen={!!pv.startsOn} onClear={() => setValue(`payments.${i}.startsOn`, '')} testID={`payment-${i}-firstToggle`}>
                  {date(`payments.${i}.startsOn`, pv.direction === 'income' ? '첫 지급일' : '첫 결제일', { testID: `payment-${i}-startsOn` })}
                </CustomFirstDate>
                {/* 총 회차·마지막 결제일은 입력하지 않고 계약 기간(또는 계약서 회차)으로 계산해 보여준다 */}
                <PlanLine plan={plans ? (plans[plans.length - (values.payments?.length ?? 0) + i]?.plan ?? null) : null} income={pv.direction === 'income'} testID={`payment-${i}-plan`} />
                <FormLabel label={pv.direction === 'income' ? '지급일이 휴일이면' : '결제일이 휴일이면'} />
                <Controller
                  control={control}
                  name={`payments.${i}.businessDayRule`}
                  render={({ field: f }) => <ChipGroup options={BUSINESS_DAY_OPTIONS} value={f.value} onChange={f.onChange} testIDPrefix={`payment-${i}-businessDay`} />}
                />
                <View style={{ height: spacing.sm }} />
                <Controller control={control} name={`payments.${i}.isVariable`} render={({ field: f }) => <SwitchRow label="금액이 매번 달라져요" description="통신비처럼 변동되는 금액은 예상치로 표시" value={f.value} onValueChange={f.onChange} />} />
              </>
            )}
          </View>
        );
      })}
      <Button label="+ 금액 추가" variant="secondary" size="md" onPress={() => payments.append(newPayment(paymentKinds[0]))} testID="add-payment" />
    </>
  );
}

/** 결제 카드 아래 계산 결과: "총 24회 · 10회 진행 · 14회 남음 · 마지막 결제 2027. 12. 15." */
export function PlanLine({ plan, income, testID }: { plan: PaymentPlan | null; income: boolean; testID?: string }) {
  if (!plan) return null;
  const w = income ? '지급' : '결제';
  const parts = [plan.first ? `첫 ${w} ${formatDateKo(plan.first)}${plan.firstNeedsCheck ? ' (예상)' : ''}` : null, planSummary(plan), plan.last ? `마지막 ${w} ${formatDateKo(plan.last)}` : null].filter(Boolean).join(' · ');
  return (
    <View style={styles.planLine} testID={testID}>
      <Badge label="자동 계산" tone="primary" />
      <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
        {parts}
        {plan.conflict ? ` · 계약서 ${plan.conflict.installments}회와 달라요 (확인 필요)` : ''}
        {plan.firstNeedsCheck ? ' · 첫 지급일 확인 필요 (당월·익월 지급은 계약서를 확인해 직접 지정해주세요)' : ''}
      </AppText>
    </View>
  );
}

/**
 * 구성항목 (기본급·수당 등) — 위 금액을 이루는 하위 항목. 따로 일정·지출·수입에 더하지 않는다.
 * 추가·삭제할 수 있고, 합계가 위 금액과 다르면 알려준다 (금액 자체는 바꾸지 않음).
 */
export function ComponentsEditor({ components, total, onChange, testID }: { components: { label: string; amount: number }[]; total: number | null; onChange: (next: { label: string; amount: number }[]) => void; testID: string }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [amountText, setAmountText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sum = components.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
  const add = () => {
    const amount = parseAmount(amountText);
    if (!label.trim()) return setError('항목 이름을 입력해주세요');
    if (amount == null || amount <= 0) return setError('금액을 입력해주세요');
    onChange([...components, { label: label.trim(), amount }]);
    setLabel('');
    setAmountText('');
    setError(null);
    setAdding(false);
  };
  return (
    <View style={[styles.components, { marginTop: 0, marginBottom: spacing.md }]} testID={testID}>
      {components.length > 0 ? (
        <>
          <AppText variant="captionStrong" color="textSecondary">
            구성항목 · 따로 더하지 않아요
          </AppText>
          {components.map((c, j) => (
            <View key={`${c.label}-${j}`} style={styles.componentRow}>
              <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
                {c.label}
              </AppText>
              <AppText variant="caption" color="textSecondary" tabular>
                {formatWon(Number(c.amount) || 0)}
              </AppText>
              <Pressable onPress={() => onChange(components.filter((_, k) => k !== j))} hitSlop={hitSlop} accessibilityRole="button" accessibilityLabel={`구성항목 ${c.label} 삭제`} testID={`${testID}-${j}-delete`}>
                <Ionicons name="close" size={14} color={colors.textTertiary} />
              </Pressable>
            </View>
          ))}
          <AppText variant="caption" color={total != null && sum !== total ? 'caution' : 'textTertiary'} testID={`${testID}-sum`}>
            {total == null ? `합계 ${formatWon(sum)}` : sum === total ? `합계 ${formatWon(sum)} · 위 금액과 같아요` : `합계 ${formatWon(sum)} · 위 금액(${formatWon(total)})과 달라요 — 확인해주세요`}
          </AppText>
        </>
      ) : null}
      {adding ? (
        <View style={{ gap: spacing.xs, marginTop: components.length > 0 ? spacing.sm : 0 }}>
          <View style={styles.row2}>
            <View style={styles.col}>
              <TextField label="항목 이름" value={label} onChangeText={setLabel} placeholder="예: 기본급" testID={`${testID}-new-label`} />
            </View>
            <View style={styles.col}>
              <TextField label="금액" value={amountText} onChangeText={(t) => setAmountText(formatAmountInput(parseAmount(t)))} keyboardType="number-pad" suffix="원" placeholder="0" testID={`${testID}-new-amount`} />
            </View>
          </View>
          {error ? (
            <AppText variant="caption" color="caution">
              {error}
            </AppText>
          ) : null}
          <View style={styles.row2}>
            <Button label="취소" variant="secondary" size="sm" onPress={() => { setAdding(false); setError(null); }} style={{ flex: 1 }} testID={`${testID}-cancel`} />
            <Button label="구성항목 추가" size="sm" onPress={add} style={{ flex: 1 }} testID={`${testID}-confirm`} />
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setAdding(true)} accessibilityRole="button" hitSlop={hitSlop} testID={`${testID}-add`} style={{ marginTop: components.length > 0 ? spacing.sm : 0 }}>
          <AppText variant="captionStrong" color="primary">
            + 구성항목 추가 (기본급·수당 등)
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

/**
 * "+ 첫 지급일 직접 지정" — 계약서에 첫 지급일이 따로 있거나(입사 첫 달 급여는 익월 지급, 첫 달 무료, 첫 결제만 다른 날짜) 할 때만.
 * 기본은 시작일 이후 결제일로 자동 계산. 닫으면 직접 지정한 날짜를 지우고 자동 계산으로 돌아간다.
 */
export function CustomFirstDate({ income, initialOpen, onClear, testID, children }: { income: boolean; initialOpen: boolean; onClear: () => void; testID: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(initialOpen);
  const w = income ? '지급' : '결제';
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Pressable
        onPress={() => {
          if (open) onClear();
          setOpen(!open);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={hitSlop}
        testID={testID}
        style={styles.classToggle}>
        <AppText variant="captionStrong" color="primary">
          {open ? `− 첫 ${w}일 직접 지정 취소 (자동 계산)` : `+ 첫 ${w}일 직접 지정`}
        </AppText>
      </Pressable>
      {open ? (
        <View style={{ marginTop: spacing.sm }}>
          <AppText variant="caption" color="textTertiary" style={{ marginBottom: spacing.xs }}>
            계약서에 첫 {w}일이 따로 있거나 첫 달만 다른 경우에만 입력하세요.
          </AppText>
          {children}
        </View>
      ) : null}
    </View>
  );
}
