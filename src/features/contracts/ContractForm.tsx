import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { Controller, useForm, useWatch, type Control, type FieldPath } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { EVENT_COLOR } from '@/components/pacto';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { ChipGroup, SwitchRow, TextField, type TextFieldProps } from '@/components/ui/controls';
import { DateField } from '@/components/ui/DateField';
import { Screen, Section, SectionGap } from '@/components/ui/layout';
import { applyDraftToContract, blankContract, draftToPayment } from '@/data/draft';
import type { ContractDraft } from '@/data/repository';
import { addMonths, formatDateKo } from '@/domain/dates';
import { CATEGORY_LABEL, FREQUENCY_LABEL } from '@/domain/labels';
import { formatAmountInput, formatWon, parseAmount } from '@/domain/money';
import { contractSchedule, nextPayment } from '@/domain/schedule';
import { CONTRACT_CATEGORIES, PAYMENT_FREQUENCIES, type ContractRecord } from '@/domain/types';
import { colors, radius, spacing } from '@/theme';

import { contractFormSchema, formToDraft, type ContractFormValues } from './form';

type FieldName = FieldPath<ContractFormValues>;

export interface ContractFormProps {
  defaultValues: ContractFormValues;
  /** 신뢰도 낮음/값 없음 → "확인 필요" 표시할 필드 */
  flagged?: ReadonlySet<string>;
  /** 필드별 원문 근거 */
  evidence?: Partial<Record<string, string>>;
  header?: React.ReactNode;
  /** 폼과 일정 미리보기 아래에 붙는 보조 영역 (예: AI 체크 요약) */
  trailing?: React.ReactNode;
  footerNote?: string;
  submitLabel: string;
  submitting?: boolean;
  today: string;
  onSubmit: (draft: ContractDraft) => void;
}

const CATEGORY_OPTIONS = CONTRACT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }));
const FREQUENCY_OPTIONS = [
  { value: 'none' as const, label: '결제 없음' },
  ...PAYMENT_FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABEL[f] })),
];

/** 계약 확인/수정 폼 — AI 등록 확인, 직접 입력, 수정에서 공용. 모든 주요 필드를 수정할 수 있다. */
export function ContractForm({ defaultValues, flagged, evidence, header, trailing, footerNote, submitLabel, submitting, today, onSubmit }: ContractFormProps) {
  const { control, handleSubmit } = useForm<ContractFormValues>({
    resolver: zodResolver(contractFormSchema),
    defaultValues,
    mode: 'onTouched',
  });

  const field = (name: FieldName, label: string, extra?: Partial<TextFieldProps> & { amount?: boolean }) => (
    <FormText control={control} name={name} label={label} flagged={flagged?.has(name)} hint={evidence?.[name] ? `원문: “${evidence[name]}”` : undefined} {...extra} />
  );
  const amount = (name: FieldName, label: string) => field(name, label, { keyboardType: 'number-pad', suffix: '원', placeholder: '0', amount: true, testID: `field-${name}` });
  const date = (name: FieldName, label: string) => (
    <Controller
      control={control}
      name={name}
      render={({ field: f, fieldState }) => (
        <DateField
          label={label}
          value={String(f.value ?? '')}
          onChangeText={f.onChange}
          onBlur={f.onBlur}
          error={fieldState.error?.message}
          flagged={flagged?.has(name)}
          hint={evidence?.[name] ? `원문: “${evidence[name]}”` : undefined}
          testID={`field-${name}`}
        />
      )}
    />
  );

  const values = useWatch({ control }) as ContractFormValues;
  const frequency = values.paymentFrequency;
  const autoRenewal = values.autoRenewal;

  return (
    <Screen
      edges={['bottom']}
      footer={
        <View>
          {footerNote ? (
            <AppText variant="caption" color="textTertiary" align="center" style={{ marginBottom: spacing.sm }}>
              {footerNote}
            </AppText>
          ) : null}
          <Button label={submitLabel} loading={submitting} onPress={handleSubmit((v) => onSubmit(formToDraft(v)))} testID="submit-contract" />
        </View>
      }>
      {header}

      <Section title="기본 정보">
        {field('title', '계약명', { placeholder: '예: 자동차보험', testID: 'field-title' })}
        <FormLabel label="계약 종류" flagged={flagged?.has('category')} />
        <Controller control={control} name="category" render={({ field: f }) => <ChipGroup options={CATEGORY_OPTIONS} value={f.value} onChange={f.onChange} testIDPrefix="category" />} />
        <View style={{ height: spacing.lg }} />
        {field('counterparty', '계약 상대방', { placeholder: '예: 삼성화재' })}
      </Section>

      <SectionGap />
      <Section title="기간">
        {date('contractDate', '계약 체결일')}
        <View style={styles.row2}>
          <View style={styles.col}>{date('startDate', '계약 시작일')}</View>
          <View style={styles.col}>{date('endDate', '계약 종료일')}</View>
        </View>
      </Section>

      <SectionGap />
      <Section title="결제">
        <FormLabel label="결제 주기" flagged={flagged?.has('paymentFrequency')} />
        <Controller control={control} name="paymentFrequency" render={({ field: f, fieldState }) => (
          <View>
            <ChipGroup options={FREQUENCY_OPTIONS} value={f.value} onChange={f.onChange} testIDPrefix="frequency" />
            {fieldState.error ? <AppText variant="caption" color="caution" style={{ marginTop: 4 }}>{fieldState.error.message}</AppText> : null}
          </View>
        )} />
        <View style={{ height: spacing.lg }} />
        {frequency !== 'none' ? (
          <>
            <View style={styles.row2}>
              <View style={styles.col}>{amount('paymentAmount', '결제 금액')}</View>
              <View style={styles.colNarrow}>{field('paymentDay', '결제일', { keyboardType: 'number-pad', suffix: '일', maxLength: 2, testID: 'field-paymentDay' })}</View>
            </View>
            {field('paymentLabel', '결제 항목 이름', { placeholder: '예: 월 렌탈료' })}
            <Controller control={control} name="paymentVariable" render={({ field: f }) => <SwitchRow label="금액이 매달 달라져요" description="통신비처럼 변동되는 금액은 예상치로 표시" value={f.value} onValueChange={f.onChange} />} />
          </>
        ) : null}
        {amount('totalAmount', '계약 총액')}
        {amount('depositAmount', '보증금')}
      </Section>

      <SectionGap />
      <Section title="갱신 · 해지">
        <Controller control={control} name="autoRenewal" render={({ field: f }) => <SwitchRow label="자동갱신" description="만료 시 자동으로 연장되는 계약" value={f.value} onValueChange={f.onChange} testID="field-autoRenewal" />} />
        {flagged?.has('autoRenewal') ? <AppText variant="caption" color="check" style={{ marginBottom: spacing.sm }}>자동갱신 여부를 확인해주세요{evidence?.autoRenewal ? ` — 원문: “${evidence.autoRenewal}”` : ''}</AppText> : null}
        {autoRenewal ? field('renewalPeriodMonths', '갱신 주기', { keyboardType: 'number-pad', suffix: '개월', maxLength: 3 }) : null}
        {field('terminationNoticeDays', '해지 통보기한 (종료 며칠 전까지)', { keyboardType: 'number-pad', suffix: '일 전', maxLength: 3, testID: 'field-terminationNoticeDays' })}
        {field('earlyTerminationTerms', '중도해지 관련 내용', { multiline: true })}
        {field('penaltyTerms', '위약금 관련 내용', { multiline: true })}
      </Section>

      <SectionGap />
      <Section title="메모">{field('memo', '메모', { multiline: true, placeholder: '자유롭게 적어두세요' })}</Section>

      <SectionGap />
      <SchedulePreview values={values} today={today} />
      {trailing}
    </Screen>
  );
}

/** 저장하면 캘린더에 등록될 일정 미리보기 — 계약 조건이 실제 일정 관리로 이어지는 것을 보여준다. */
function SchedulePreview({ values, today }: { values: ContractFormValues; today: string }) {
  const preview = useMemo(() => {
    const parsed = contractFormSchema.safeParse(values);
    if (!parsed.success) return null;
    const draft = formToDraft(parsed.data);
    const base = applyDraftToContract(blankContract('preview', 'manual', ''), draft);
    const payment = draftToPayment(draft, 'preview', 'preview-p', today);
    const record: ContractRecord = { contract: base, payments: payment ? [payment] : [], events: [], documents: [], aiChecks: [] };
    const items = contractSchedule(record, { start: today, end: addMonths(today, 36) }, today).filter((i) => i.type !== 'payment');
    return { items: items.slice(0, 5), next: nextPayment(record, today), payment };
  }, [values, today]);

  return (
    <Section title="저장하면 캘린더에 등록되는 일정" testID="schedule-preview">
      {!preview ? (
        <AppText variant="body2" color="textTertiary">
          필수 정보를 확인하면 일정이 표시돼요.
        </AppText>
      ) : preview.items.length === 0 && !preview.next ? (
        <AppText variant="body2" color="textTertiary">
          날짜·결제 정보를 입력하면 일정이 만들어져요.
        </AppText>
      ) : (
        <View style={styles.preview}>
          {preview.next && preview.payment ? (
            <PreviewRow color={EVENT_COLOR.payment} title={`${preview.payment.label} ${formatWon(preview.payment.amount)}`} sub={`${FREQUENCY_LABEL[preview.payment.frequency]}${preview.payment.dayOfMonth ? ` ${preview.payment.dayOfMonth}일` : ''} · 첫 결제 ${formatDateKo(preview.next.date)}`} />
          ) : null}
          {preview.items.map((i) => (
            <PreviewRow key={i.key} color={EVENT_COLOR[i.type]} title={i.title} sub={formatDateKo(i.date, true)} />
          ))}
        </View>
      )}
    </Section>
  );
}

function PreviewRow({ color, title, sub }: { color: string; title: string; sub: string }) {
  return (
    <View style={styles.previewRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <AppText variant="body2Strong">{title}</AppText>
        <AppText variant="caption" color="textTertiary">
          {sub}
        </AppText>
      </View>
    </View>
  );
}

function FormLabel({ label, flagged }: { label: string; flagged?: boolean }) {
  return (
    <View style={styles.label}>
      <AppText variant="captionStrong" color="textSecondary">
        {label}
      </AppText>
      {flagged ? (
        <View style={styles.flag}>
          <AppText variant="small" color="check">
            확인 필요
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

function FormText({
  control,
  name,
  amount,
  ...props
}: Omit<TextFieldProps, 'value' | 'onChangeText'> & { control: Control<ContractFormValues>; name: FieldName; amount?: boolean }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: f, fieldState }) => (
        <TextField
          {...props}
          value={String(f.value ?? '')}
          onBlur={f.onBlur}
          onChangeText={(t) => f.onChange(amount ? formatAmountInput(parseAmount(t)) : t)}
          error={fieldState.error?.message}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  row2: { flexDirection: 'row', gap: spacing.md },
  col: { flex: 1 },
  colNarrow: { width: 110 },
  label: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 8 },
  flag: { backgroundColor: colors.checkSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  preview: { gap: 2 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
