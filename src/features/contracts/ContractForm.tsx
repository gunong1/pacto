import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { Controller, useFieldArray, useForm, useWatch, type Control, type FieldPath } from 'react-hook-form';
import { Pressable, StyleSheet, View } from 'react-native';

import { EVENT_COLOR } from '@/components/pacto';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Badge, ChipGroup, RadioGroup, SwitchRow, TextField, type TextFieldProps } from '@/components/ui/controls';
import { DateField } from '@/components/ui/DateField';
import { Screen, Section, SectionGap } from '@/components/ui/layout';
import { draftToRecord } from '@/data/draft';
import type { ContractDraft } from '@/data/repository';
import {
  dateKindLabel,
  contractTypeExamples,
  contractTypeLabel,
  profileOf,
  CONTRACT_TYPES,
  detailFields,
  paymentKindLabel,
  cleanDetails,
  DIRECTION_LABEL,
  DIRECTIONS,
  defaultDirection,
  type ContractType,
  type DetailFieldSpec,
  type DetailValue,
  type PaymentKind,
  type SourceType,
  OBLIGATION_LABEL,
} from '@/domain/contractTypes';
import { BUSINESS_DAY_RULE_LABEL } from '@/domain/businessDays';
import { addMonths, formatDateKo } from '@/domain/dates';
import { categoryLabel, FREQUENCY_LABEL } from '@/domain/labels';
import { formatAmountInput, formatWon, parseAmount } from '@/domain/money';
import { NOTICE_KIND_OPTIONS } from '@/domain/noticeKind';
import { contractSchedule, expandPayment } from '@/domain/schedule';
import { CONTRACT_CATEGORIES, PAYMENT_FREQUENCIES, type Confidence } from '@/domain/types';
import { colors, hitSlop, radius, spacing } from '@/theme';

import {
  contractFormSchema,
  detailFromInput,
  detailsToForm,
  formToDraft,
  type ContractFormValues,
  type ParsedContractForm,
  type PaymentFormValues,
} from './form';

type FieldName = FieldPath<ContractFormValues>;

export interface TypeSuggestionView {
  value: ContractType;
  confidence: Confidence;
  alternatives: ContractType[];
  reason: string | null;
}

export interface ContractFormProps {
  defaultValues: ContractFormValues;
  /** "확인 필요" 표시 경로 ('startDate', 'payments.1.startsOn', 'contractType' …) */
  flagged?: ReadonlySet<string>;
  /** 경로별 원문 근거 */
  evidence?: Partial<Record<string, string>>;
  /** 경로별 안내 (왜 확인이 필요한지) */
  notes?: Partial<Record<string, string>>;
  /** AI의 분야·유형 판단 (확인 화면) — 확정하지 않고 사용자가 바꿀 수 있다 */
  typeSuggestion?: TypeSuggestionView;
  categorySuggestion?: { value: string; confidence: Confidence; alternatives: string[]; reason: string | null };
  /** 모든 유형의 상세 속성 추출값 — 유형을 바꾸면 새 유형에 맞는 값만 다시 고른다 */
  allDetails?: Record<string, DetailValue>;
  header?: React.ReactNode;
  /** 폼과 일정 미리보기 아래에 붙는 보조 영역 (예: AI 체크 요약) */
  trailing?: React.ReactNode;
  footerNote?: string;
  submitLabel: string;
  submitting?: boolean;
  today: string;
  onSubmit: (draft: ContractDraft) => void;
}

const CONFIDENCE_LABEL: Record<Confidence, string> = { high: '높음', medium: '보통', low: '낮음' };
const CATEGORY_OPTIONS = CONTRACT_CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c) }));
const TYPE_OPTIONS = CONTRACT_TYPES.map((t) => ({ value: t, label: contractTypeLabel(t) }));
const DIRECTION_OPTIONS = DIRECTIONS.map((d) => ({ value: d, label: DIRECTION_LABEL[d] }));
const FREQUENCY_OPTIONS = PAYMENT_FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }));
const ONE_TIME_KINDS: ReadonlySet<PaymentKind> = new Set(['setup_fee', 'deposit', 'advance_payment', 'down_payment', 'interim_payment', 'balance_payment']);

const defaultFrequency = (kind: PaymentKind): PaymentFormValues['frequency'] => (ONE_TIME_KINDS.has(kind) ? 'one_time' : kind === 'premium' ? 'yearly' : 'monthly');

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

/**
 * 계약 확인/수정 폼 — AI 등록 확인, 직접 입력, 수정에서 공용.
 * 공통 틀(유형 → 기본 정보 → 기간 → 유형별 정보 → 결제 목록 → 주요 날짜 → 갱신·해지 → 기타)은 같고,
 * 유형에 따라 날짜 이름·유형별 정보·결제 의미 선택지가 바뀐다. 결제·날짜는 여러 건 추가/수정/삭제할 수 있다.
 */
export function ContractForm({ defaultValues, flagged, evidence, notes, typeSuggestion, categorySuggestion, allDetails, header, trailing, footerNote, submitLabel, submitting, today, onSubmit }: ContractFormProps) {
  const { control, handleSubmit, setValue, getValues } = useForm<ContractFormValues, unknown, ParsedContractForm>({
    resolver: zodResolver(contractFormSchema),
    defaultValues,
    mode: 'onTouched',
  });
  const payments = useFieldArray({ control, name: 'payments' });
  const dates = useFieldArray({ control, name: 'dates' });

  const values = useWatch({ control }) as ContractFormValues;
  const type = values.contractType;
  const profile = profileOf(type);

  const hint = (path: string) => notes?.[path] ?? (evidence?.[path] ? `원문: “${evidence[path]}”` : undefined);
  const field = (name: FieldName, label: string, extra?: Partial<TextFieldProps> & { amount?: boolean }) => (
    <FormText control={control} name={name} label={label} flagged={flagged?.has(name)} hint={hint(name)} testID={`field-${name}`} {...extra} />
  );
  const amount = (name: FieldName, label: string) => field(name, label, { keyboardType: 'number-pad', suffix: '원', placeholder: '0', amount: true });
  const date = (name: FieldName, label: string, extra?: { hint?: string; testID?: string; flagPath?: string }) => {
    const path = extra?.flagPath ?? name;
    return <FormDate control={control} name={name} label={label} flagged={flagged?.has(path)} hint={hint(path) ?? extra?.hint} testID={extra?.testID ?? `field-${name}`} />;
  };

  /** 유형 변경: 결제·날짜는 그대로 두고, 유형별 정보만 새 유형 기준으로 다시 고른다 */
  const changeType = (next: ContractType) => {
    const prev = getValues('contractType');
    if (next === prev) return;
    const current = getValues('details');
    const merged: Record<string, DetailValue> = { ...(allDetails ?? {}) };
    for (const spec of detailFields(prev)) {
      const v = detailFromInput(spec, current[spec.key] ?? '');
      if (v !== undefined && v !== null) merged[spec.key] = v;
    }
    setValue('contractType', next);
    setValue('details', detailsToForm(next, cleanDetails(next, merged)));
  };

  const paymentKindOptions = (current: PaymentKind) => {
    const kinds = [...profile.paymentKinds];
    if (!kinds.includes(current)) kinds.push(current);
    return kinds.map((k) => ({ value: k, label: paymentKindLabel(k) }));
  };
  const dateKindOptions = profile.dateKinds.map((k) => ({ value: k, label: dateKindLabel(k) }));

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
          <Button label={submitLabel} loading={submitting} onPress={handleSubmit((v) => onSubmit(confirmEdited(formToDraft(v), defaultValues, getValues())))} testID="submit-contract" />
        </View>
      }>
      {header}

      <Section title="계약 유형" caption="돈·날짜·의무가 움직이는 구조예요. 이 유형에 맞게 일정과 지출을 관리해요." testID="section-type">
        {typeSuggestion ? (
          <View style={[styles.suggestion, flagged?.has('contractType') && styles.suggestionFlagged]} testID="type-suggestion">
            {categorySuggestion ? (
              <View style={styles.rowCenter}>
                <AppText variant="captionStrong" testID="category-suggestion">
                  AI 판단 분야: {categoryLabel(categorySuggestion.value)} · 신뢰도 {CONFIDENCE_LABEL[categorySuggestion.confidence]}
                </AppText>
                {flagged?.has('category') ? <Badge label="확인 필요" tone="check" /> : null}
              </View>
            ) : null}
            <View style={styles.rowCenter}>
              <AppText variant="captionStrong">
                AI 판단 유형: {contractTypeLabel(typeSuggestion.value)} · 신뢰도 {CONFIDENCE_LABEL[typeSuggestion.confidence]}
              </AppText>
              {flagged?.has('contractType') ? <Badge label="확인 필요" tone="check" /> : null}
            </View>
            {typeSuggestion.reason ? (
              <AppText variant="caption" color="textSecondary" style={{ marginTop: 2 }}>
                {typeSuggestion.reason}
              </AppText>
            ) : null}
            {typeSuggestion.alternatives.length > 0 ? (
              <AppText variant="caption" color="textTertiary" style={{ marginTop: 2 }}>
                다른 가능성: {typeSuggestion.alternatives.map((t) => contractTypeLabel(t)).join(', ')}
              </AppText>
            ) : null}
            <AppText variant="caption" color="textTertiary" style={{ marginTop: 2 }}>
              유형에 따라 일정·지출·확인할 조건이 다르게 만들어져요. 맞지 않으면 아래에서 바꿔주세요.
            </AppText>
          </View>
        ) : null}
        <ChipGroup options={TYPE_OPTIONS} value={type} onChange={changeType} testIDPrefix="type" />
        <AppText variant="caption" color="textTertiary" style={{ marginTop: spacing.sm }}>
          {contractTypeExamples(type)}
        </AppText>
      </Section>

      <SectionGap />
      <Section title="기본 정보">
        {field('title', '계약명', { placeholder: '예: 자동차보험' })}
        <FormLabel label="분야 (무슨 계약인가요?)" flagged={flagged?.has('category')} />
        <Controller control={control} name="category" render={({ field: f }) => <ChipGroup options={CATEGORY_OPTIONS} value={f.value} onChange={f.onChange} testIDPrefix="category" />} />
        <View style={{ height: spacing.lg }} />
        {field('counterparty', '계약 상대방', { placeholder: '예: 삼성화재' })}
      </Section>

      <SectionGap />
      <Section title="기간">
        <View style={styles.row2}>
          <View style={styles.col}>{date('startDate', profile.startLabel)}</View>
          <View style={styles.col}>{date('endDate', profile.endLabel)}</View>
        </View>
        {date('contractDate', '계약 체결일 (선택)', { hint: '기록용이에요. 캘린더와 알림에는 쓰지 않아요.' })}
      </Section>

      {detailFields(type).length > 0 || type === 'lease' ? (
        <>
          <SectionGap />
          <Section title={`${contractTypeLabel(type)} 정보`} testID="section-details">
            {type === 'lease' ? amount('depositAmount', '보증금') : null}
            {detailFields(type).map((spec) => (
              <DetailInput
                key={`${type}-${spec.key}`}
                control={control}
                spec={spec}
                flagged={flagged?.has(`details.${spec.key}`)}
                hint={hint(`details.${spec.key}`)}
                source={values.valueSources?.[`details.${spec.key}`]}
              />
            ))}
          </Section>
        </>
      ) : null}

      <SectionGap />
      <Section title="결제" caption="오가는 돈을 넣어주세요. 실제로 내야 하는 '확정 결제'만 캘린더·지출에 들어가요. 양도 수수료·락커비처럼 상황이나 선택에 따라 내는 돈은 조건부·선택형으로." testID="section-payments">
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
            <View key={p.id} style={styles.card} testID={`payment-${i}`}>
              <View style={styles.cardHeader}>
                <AppText variant="body2Strong">결제 {i + 1}</AppText>
                {pv.obligation !== 'confirmed' ? (
                  <Badge label={`${OBLIGATION_LABEL[pv.obligation]} · 캘린더·지출 제외`} tone="check" />
                ) : pv.direction === 'neutral' ? (
                  <Badge label="지출 합계 제외" />
                ) : pv.direction === 'income' ? (
                  <Badge label="수입" tone="primary" />
                ) : null}
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
                      if (getValues(`payments.${i}.direction`) === defaultDirection(f.value)) setValue(`payments.${i}.direction`, defaultDirection(k));
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
                render={({ field: f }) => <ChipGroup options={OBLIGATION_OPTIONS} value={f.value} onChange={f.onChange} testIDPrefix={`payment-${i}-obligation`} />}
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
              <Controller control={control} name={`payments.${i}.frequency`} render={({ field: f }) => <ChipGroup options={FREQUENCY_OPTIONS} value={f.value} onChange={f.onChange} scroll testIDPrefix={`payment-${i}-frequency`} />} />
              <View style={{ height: spacing.sm }} />
              <Controller control={control} name={`payments.${i}.direction`} render={({ field: f }) => <ChipGroup options={DIRECTION_OPTIONS} value={f.value} onChange={f.onChange} testIDPrefix={`payment-${i}-direction`} />} />
              <View style={{ height: spacing.md }} />
              {pv.obligation !== 'confirmed' ? (
                <AppText variant="caption" color="textTertiary">
                  결제일은 실제로 이용하거나 상황이 생겼을 때 계약 상세에서 정해요.
                </AppText>
              ) : oneTime ? (
                date(`payments.${i}.startsOn`, '결제일', { hint: values.startDate ? '비워두면 계약 시작일' : undefined, testID: `payment-${i}-startsOn` })
              ) : (
                <>
                  <View style={styles.row2}>
                    <View style={styles.colNarrow}>
                      {field(`payments.${i}.dayOfMonth`, pv.direction === 'income' ? '지급일' : '결제일', { keyboardType: 'number-pad', suffix: '일', maxLength: 2, testID: `payment-${i}-dayOfMonth`, flagged: flagged?.has(`${path}.dayOfMonth`), hint: hint(`${path}.dayOfMonth`) })}
                    </View>
                    <View style={styles.col}>{date(`payments.${i}.startsOn`, '첫 결제일', { hint: '비워두면 시작일부터', testID: `payment-${i}-startsOn` })}</View>
                  </View>
                  <View style={styles.row2}>
                    <View style={styles.col}>{date(`payments.${i}.endsOn`, '마지막 결제일 (선택)', { hint: '비워두면 종료일까지', testID: `payment-${i}-endsOn` })}</View>
                    <View style={styles.colNarrow}>{field(`payments.${i}.installmentCount`, '총 회차', { keyboardType: 'number-pad', suffix: '회', maxLength: 3, testID: `payment-${i}-installmentCount` })}</View>
                  </View>
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
              {pv.components && pv.components.length > 0 ? (
                <View style={styles.components} testID={`payment-${i}-components`}>
                  <AppText variant="captionStrong" color="textSecondary">
                    {pv.label || '금액'} 구성 (따로 더하지 않아요)
                  </AppText>
                  {pv.components.map((c, j) => (
                    <View key={`${c.label}-${j}`} style={styles.componentRow}>
                      <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
                        {c.label}
                      </AppText>
                      <AppText variant="caption" color="textSecondary" tabular>
                        {formatWon(Number(c.amount) || 0)}
                      </AppText>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
        <Button label="+ 결제 추가" variant="secondary" size="md" onPress={() => payments.append(newPayment(profile.paymentKinds[0]))} testID="add-payment" />
      </Section>

      <SectionGap />
      <Section title="주요 날짜" caption="설치일·입주일·잔금일처럼 챙겨야 할 날짜. 캘린더에 표시돼요." testID="section-dates">
        {dates.fields.map((d, i) => (
          <View key={d.id} style={styles.card} testID={`date-${i}`}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Controller
                  control={control}
                  name={`dates.${i}.kind`}
                  render={({ field: f }) => (
                    <ChipGroup
                      options={dateKindOptions.some((o) => o.value === f.value) ? dateKindOptions : [...dateKindOptions, { value: f.value, label: dateKindLabel(f.value) }]}
                      value={f.value}
                      onChange={(k) => {
                        const prevLabel = dateKindLabel(f.value);
                        const label = getValues(`dates.${i}.label`);
                        f.onChange(k);
                        if (!label || label === prevLabel) setValue(`dates.${i}.label`, dateKindLabel(k));
                      }}
                      testIDPrefix={`date-${i}-kind`}
                    />
                  )}
                />
              </View>
              <Pressable onPress={() => dates.remove(i)} hitSlop={hitSlop} accessibilityRole="button" accessibilityLabel={`날짜 ${i + 1} 삭제`} testID={`date-${i}-remove`}>
                <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
              </Pressable>
            </View>
            <View style={styles.row2}>
              <View style={styles.col}>{field(`dates.${i}.label`, '이름', { testID: `date-${i}-label`, flagged: flagged?.has(`dates.${i}`), hint: hint(`dates.${i}`) })}</View>
              <View style={styles.col}>{date(`dates.${i}.date`, '날짜', { testID: `date-${i}-date` })}</View>
            </View>
          </View>
        ))}
        <Button
          label="+ 날짜 추가"
          variant="secondary"
          size="md"
          onPress={() => {
            const kind = profile.dateKinds[0];
            dates.append({ kind, label: dateKindLabel(kind), date: '' });
          }}
          testID="add-date"
        />
      </Section>

      <SectionGap />
      {profile.hasRenewal ? (
        <Section title="갱신 · 해지">
          <Controller control={control} name="autoRenewal" render={({ field: f }) => <SwitchRow label="자동갱신" description="만료 시 자동으로 연장되는 계약 (묵시적 갱신 포함)" value={f.value} onValueChange={f.onChange} testID="field-autoRenewal" />} />
          {flagged?.has('autoRenewal') ? (
            <AppText variant="caption" color="check" style={{ marginBottom: spacing.sm }}>
              자동갱신 여부를 확인해주세요{evidence?.autoRenewal ? ` — 원문: “${evidence.autoRenewal}”` : ''}
            </AppText>
          ) : null}
          {values.autoRenewal ? field('renewalPeriodMonths', '갱신 주기', { keyboardType: 'number-pad', suffix: '개월', maxLength: 3 }) : null}
          {field('terminationNoticeDays', '통보·갱신 관련 기한 (종료 며칠 전까지)', { keyboardType: 'number-pad', suffix: '일 전', maxLength: 3 })}
          {values.terminationNoticeDays?.trim() ? (
            <View style={{ marginBottom: spacing.lg }} testID="notice-kind">
              <AppText variant="captionStrong" color="textSecondary">
                이 기한은 어떤 의미인가요?
              </AppText>
              {flagged?.has('noticeKind') ? (
                <AppText variant="caption" color="check" style={{ marginTop: 2 }}>
                  {hint('noticeKind') ?? '계약서에서 이 기한의 의미를 확인해주세요'}
                </AppText>
              ) : null}
              <Controller control={control} name="noticeKind" render={({ field: f }) => <RadioGroup options={NOTICE_KIND_OPTIONS} value={f.value} onChange={f.onChange} testIDPrefix="notice-kind" />} />
            </View>
          ) : null}
          {field('earlyTerminationTerms', '중도해지 관련 내용', { multiline: true })}
          {field('penaltyTerms', '위약금 관련 내용', { multiline: true })}
        </Section>
      ) : (
        <Section title="중도해지 · 위약금">
          {field('earlyTerminationTerms', type === 'loan' ? '중도상환 관련 내용' : '중도해지 관련 내용', { multiline: true })}
          {field('penaltyTerms', '위약금 관련 내용', { multiline: true })}
        </Section>
      )}

      <SectionGap />
      <Section title="기타">
        {amount('totalAmount', '계약 총액')}
        {type !== 'lease' ? amount('depositAmount', '보증금') : null}
        {field('memo', '메모', { multiline: true, placeholder: '자유롭게 적어두세요' })}
      </Section>

      <SectionGap />
      <SchedulePreview values={values} today={today} />
      {trailing}
    </Screen>
  );
}

/** 유형별 정보 한 칸 */
function DetailInput({ control, spec, flagged, hint, source }: { control: Control<ContractFormValues>; spec: DetailFieldSpec; flagged?: boolean; hint?: string; source?: SourceType }) {
  const name = `details.${spec.key}` as FieldName;
  if (spec.input === 'enum' || spec.input === 'boolean') {
    const options = spec.input === 'enum' ? [...(spec.options ?? [])] : [{ value: 'true', label: '예' }, { value: 'false', label: '아니오' }];
    return (
      <View style={{ marginBottom: spacing.lg }}>
        <FormLabel label={spec.label} flagged={flagged} source={source} />
        <Controller
          control={control}
          name={name}
          render={({ field: f }) => (
            <ChipGroup options={options} value={String(f.value ?? '') || null} onChange={(v) => f.onChange(String(f.value) === v ? '' : v)} testIDPrefix={`detail-${spec.key}`} />
          )}
        />
        {hint ? (
          <AppText variant="caption" color={flagged ? 'check' : 'textTertiary'} style={{ marginTop: 6 }}>
            {hint}
          </AppText>
        ) : null}
      </View>
    );
  }
  return (
    <FormText
      control={control}
      name={name}
      label={source === 'inferred' ? `${spec.label} · AI 추정` : spec.label}
      hint={hint}
      flagged={flagged}
      amount={spec.input === 'amount'}
      multiline={spec.input === 'text'}
      keyboardType={spec.input === 'percent' ? 'decimal-pad' : spec.input === 'text' ? 'default' : 'number-pad'}
      suffix={spec.suffix}
      testID={`detail-${spec.key}`}
    />
  );
}

/** 저장하면 관리될 결제·일정 미리보기 — 계약 조건이 실제 일정·지출 관리로 이어지는 것을 보여준다. */
function SchedulePreview({ values, today }: { values: ContractFormValues; today: string }) {
  const preview = useMemo(() => {
    const parsed = contractFormSchema.safeParse(values);
    if (!parsed.success) return null;
    const record = draftToRecord(formToDraft(parsed.data), 'preview', today);
    const pays = record.payments.map((p) => ({ p, first: expandPayment(p, record.contract, { start: '1900-01-01', end: '2999-12-31' }, record.dates)[0] ?? null }));
    const items = contractSchedule(record, { start: today, end: addMonths(today, 36) }, today).filter((i) => i.type !== 'payment');
    return { items: items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6), pays };
  }, [values, today]);

  return (
    <Section title="저장하면 관리되는 결제·일정" testID="schedule-preview">
      {!preview ? (
        <AppText variant="body2" color="textTertiary">
          필수 정보를 확인하면 일정이 표시돼요.
        </AppText>
      ) : preview.items.length === 0 && preview.pays.length === 0 ? (
        <AppText variant="body2" color="textTertiary">
          날짜·결제 정보를 입력하면 일정이 만들어져요.
        </AppText>
      ) : (
        <View style={styles.preview}>
          {preview.pays.map(({ p, first }) => (
            <PreviewRow
              key={p.id}
              color={EVENT_COLOR.payment}
              title={`${p.label} ${formatWon(p.amount)}`}
              sub={[
                p.frequency === 'one_time' ? '일시불' : `${FREQUENCY_LABEL[p.frequency]}${p.dayOfMonth ? ` ${p.dayOfMonth}일` : ''}`,
                first ? `${p.frequency === 'one_time' ? '' : '첫 결제 '}${formatDateKo(first.date)}` : null,
                p.installmentCount ? `총 ${p.installmentCount}회` : null,
                p.direction === 'neutral' ? '지출 합계 제외' : p.direction === 'income' ? '수입' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
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

/** AI가 추정한 값을 사용자가 고쳐 저장하면 그 값은 사용자가 확인한 값(user_confirmed) */
function confirmEdited(draft: ContractDraft, before: ContractFormValues, after: ContractFormValues): ContractDraft {
  const at = (o: unknown, path: string) => path.split('.').reduce<unknown>((v, k) => (v != null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o);
  const sources = { ...draft.valueSources };
  for (const [path, src] of Object.entries(sources)) {
    if (src === 'inferred' && JSON.stringify(at(before, path) ?? '') !== JSON.stringify(at(after, path) ?? '')) sources[path] = 'user_confirmed';
  }
  return { ...draft, valueSources: sources };
}

function FormLabel({ label, flagged, source }: { label: string; flagged?: boolean; source?: SourceType }) {
  return (
    <View style={styles.label}>
      <AppText variant="captionStrong" color="textSecondary">
        {label}
      </AppText>
      {source === 'inferred' ? <Badge label="AI 추정" tone="check" /> : null}
      {flagged ? <Badge label="확인 필요" tone="check" /> : null}
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

function FormDate({ control, name, label, flagged, hint, testID }: { control: Control<ContractFormValues>; name: FieldName; label: string; flagged?: boolean; hint?: string; testID?: string }) {
  return (
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
          flagged={flagged}
          hint={hint}
          testID={testID}
        />
      )}
    />
  );
}

/** 확정 결제만 캘린더·지출에 반영된다 (잠재·참고 금액은 AI가 고른 경우에만 보이도록 뒤에) */
const OBLIGATION_OPTIONS = [
  { value: 'confirmed' as const, label: '확정 결제' },
  { value: 'optional' as const, label: '선택형 (이용 시)' },
  { value: 'conditional' as const, label: '조건부 (상황 발생 시)' },
  { value: 'potential' as const, label: '발생 가능' },
  { value: 'informational' as const, label: '참고 금액' },
];

const BUSINESS_DAY_OPTIONS = (['none', 'previous', 'next'] as const).map((v) => ({ value: v, label: v === 'none' ? '그날 그대로' : BUSINESS_DAY_RULE_LABEL[v] }));

const styles = StyleSheet.create({
  components: { marginTop: spacing.md, padding: spacing.md, gap: 4, borderRadius: radius.md, backgroundColor: colors.bgSubtle },
  componentRow: { flexDirection: 'row', alignItems: 'center' },
  row2: { flexDirection: 'row', gap: spacing.md },
  col: { flex: 1 },
  colNarrow: { width: 110 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 8 },
  suggestion: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSubtle, marginBottom: spacing.md },
  suggestionFlagged: { backgroundColor: colors.checkSoft },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  preview: { gap: 2 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
