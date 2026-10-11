/**
 * 계약 폼 공용 입력 도구 — 라벨·글 입력·날짜 입력과, 경로별 "확인 필요"·원문 근거 안내를 붙이는 도우미.
 * 모든 섹션이 같은 도구를 쓰므로 섹션을 나눠도 입력칸의 모양·testID는 그대로다.
 */
import { Controller, type Control, type FieldPath, type UseFormGetValues, type UseFormSetValue } from 'react-hook-form';
import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge, TextField, type TextFieldProps } from '@/components/ui/controls';
import { DateField } from '@/components/ui/DateField';
import type { SourceType } from '@/domain/contractTypes';
import { formatAmountInput, parseAmount } from '@/domain/money';

import type { ContractFormValues } from '../form';
import { styles } from './styles';

export type FieldName = FieldPath<ContractFormValues>;

/** 섹션이 함께 쓰는 폼 상태 */
export interface FormKit {
  control: Control<ContractFormValues>;
  setValue: UseFormSetValue<ContractFormValues>;
  getValues: UseFormGetValues<ContractFormValues>;
  values: ContractFormValues;
  flagged?: ReadonlySet<string>;
  evidence?: Partial<Record<string, string>>;
  hint: (path: string) => string | undefined;
  field: (name: FieldName, label: string, extra?: Partial<TextFieldProps> & { amount?: boolean }) => React.ReactElement;
  amount: (name: FieldName, label: string) => React.ReactElement;
  date: (name: FieldName, label: string, extra?: { hint?: string; testID?: string; flagPath?: string }) => React.ReactElement;
}

export function formKit(base: Pick<FormKit, 'control' | 'setValue' | 'getValues' | 'values' | 'flagged' | 'evidence'> & { notes?: Partial<Record<string, string>> }): FormKit {
  const { control, flagged, evidence, notes } = base;
  const hint = (path: string) => notes?.[path] ?? (evidence?.[path] ? `원문: “${evidence[path]}”` : undefined);
  const field: FormKit['field'] = (name, label, extra) => (
    <FormText control={control} name={name} label={label} flagged={flagged?.has(name)} hint={hint(name)} testID={`field-${name}`} {...extra} />
  );
  const amount: FormKit['amount'] = (name, label) => field(name, label, { keyboardType: 'number-pad', suffix: '원', placeholder: '0', amount: true });
  const date: FormKit['date'] = (name, label, extra) => {
    const path = extra?.flagPath ?? name;
    return <FormDate control={control} name={name} label={label} flagged={flagged?.has(path)} hint={hint(path) ?? extra?.hint} testID={extra?.testID ?? `field-${name}`} />;
  };
  return { control: base.control, setValue: base.setValue, getValues: base.getValues, values: base.values, flagged, evidence, hint, field, amount, date };
}

export function FormLabel({ label, flagged, source }: { label: string; flagged?: boolean; source?: SourceType }) {
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

export function FormText({
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

export function FormDate({ control, name, label, flagged, hint, testID }: { control: Control<ContractFormValues>; name: FieldName; label: string; flagged?: boolean; hint?: string; testID?: string }) {
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
