/**
 * 계약 폼 공용 입력 도구 — 라벨·글 입력·날짜 입력과, 경로별 "확인 필요"·안내·계약서 근거 아이콘을 붙이는 도우미.
 * 모든 섹션이 같은 도구를 쓰므로 섹션을 나눠도 입력칸의 모양·testID는 그대로다.
 * 근거 문장은 입력칸 아래에 늘 펼치지 않는다 — 근거가 있는 칸만 라벨 옆 아이콘(계약서 근거 보기), 규칙은 src/domain/evidence.ts.
 */
import { Controller, type Control, type FieldPath, type UseFormGetValues, type UseFormSetValue } from 'react-hook-form';
import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge, TextField, type TextFieldProps } from '@/components/ui/controls';
import { DateField } from '@/components/ui/DateField';
import type { SourceType } from '@/domain/contractTypes';
import { evidenceView, type EvidenceMap } from '@/domain/evidence';
import { formatAmountInput, parseAmount } from '@/domain/money';
import { maskSensitiveTextForDisplay } from '@/domain/sensitive';
import { EvidenceButton } from '@/features/evidence/EvidenceUI';

import type { ContractFormValues } from '../form';
import { styles } from './styles';

export type FieldName = FieldPath<ContractFormValues>;

/** 섹션이 함께 쓰는 폼 상태 */
export interface FormKit {
  control: Control<ContractFormValues>;
  setValue: UseFormSetValue<ContractFormValues>;
  getValues: UseFormGetValues<ContractFormValues>;
  values: ContractFormValues;
  /** 저장된 계약 수정 화면 */
  editing?: boolean;
  flagged?: ReadonlySet<string>;
  evidence?: EvidenceMap;
  /** 안내 문구 (AI 추정·계산 설명 등). 계약서 원문은 여기에 넣지 않고 근거 아이콘으로 */
  hint: (path: string) => string | undefined;
  /** 라벨 옆 계약서 근거 아이콘 (근거가 없으면 null) */
  evidenceIcon: (path: string, label: string) => React.ReactNode;
  field: (name: FieldName, label: string, extra?: Partial<TextFieldProps> & { amount?: boolean; evidencePath?: string }) => React.ReactElement;
  amount: (name: FieldName, label: string) => React.ReactElement;
  date: (name: FieldName, label: string, extra?: { hint?: string; testID?: string; flagPath?: string }) => React.ReactElement;
}

export function formKit(
  base: Pick<FormKit, 'control' | 'setValue' | 'getValues' | 'values' | 'flagged' | 'evidence' | 'editing'> & { notes?: Partial<Record<string, string>>; initial?: ContractFormValues },
): FormKit {
  const { control, flagged, evidence, notes, initial, values } = base;
  // 화면 방어선: 안내는 공통 정책으로 가려서 보여준다 (가림 실패 시 원문 대신 "민감정보 보호 확인 필요")
  const hint = (path: string) => {
    const text = notes?.[path];
    return text == null ? undefined : maskSensitiveTextForDisplay(text);
  };
  const at = (obj: unknown, path: string) => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
  const evidenceIcon = (path: string, label: string) => {
    const view = evidenceView(evidence?.[path], { flagged: flagged?.has(path), aiValue: at(initial, path), currentValue: at(values, path) });
    return view.hasEvidence ? <EvidenceButton label={label} view={view} testID={`evidence-${path}`} /> : null;
  };
  const field: FormKit['field'] = (name, label, extra) => {
    const { evidencePath, ...rest } = extra ?? {};
    return <FormText control={control} name={name} label={label} flagged={flagged?.has(name)} hint={hint(name)} labelAccessory={evidenceIcon(evidencePath ?? name, label)} testID={`field-${name}`} {...rest} />;
  };
  const amount: FormKit['amount'] = (name, label) => field(name, label, { keyboardType: 'number-pad', suffix: '원', placeholder: '0', amount: true });
  const date: FormKit['date'] = (name, label, extra) => {
    const path = extra?.flagPath ?? name;
    return <FormDate control={control} name={name} label={label} flagged={flagged?.has(path)} hint={hint(path) ?? extra?.hint} accessory={evidenceIcon(path, label)} testID={extra?.testID ?? `field-${name}`} />;
  };
  return { control: base.control, setValue: base.setValue, getValues: base.getValues, values, editing: base.editing, flagged, evidence, hint, evidenceIcon, field, amount, date };
}

export function FormLabel({ label, flagged, source, accessory }: { label: string; flagged?: boolean; source?: SourceType; accessory?: React.ReactNode }) {
  return (
    <View style={styles.label}>
      <AppText variant="captionStrong" color="textSecondary">
        {label}
      </AppText>
      {source === 'inferred' ? <Badge label="AI 추정" tone="check" /> : null}
      {flagged ? <Badge label="확인 필요" tone="check" /> : null}
      {accessory}
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

export function FormDate({ control, name, label, flagged, hint, accessory, testID }: { control: Control<ContractFormValues>; name: FieldName; label: string; flagged?: boolean; hint?: string; accessory?: React.ReactNode; testID?: string }) {
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
          labelAccessory={accessory}
          testID={testID}
        />
      )}
    />
  );
}
