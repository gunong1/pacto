/**
 * 유형별 정보 섹션 (예: 임대차 → 보증금·관리비 포함 항목, 근로 → 근무시간 …)
 * 입력: 계약 유형 · 경로별 확인 필요/근거 · 값 출처(AI 추정) / 출력: details.* 입력값
 */
import { Controller, type Control } from 'react-hook-form';
import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { ChipGroup } from '@/components/ui/controls';
import { Section, SectionGap } from '@/components/ui/layout';
import { contractTypeLabel, detailFields, type ContractType, type DetailFieldSpec, type SourceType } from '@/domain/contractTypes';
import { spacing } from '@/theme';

import type { ContractFormValues } from '../form';
import { FormLabel, FormText, type FieldName, type FormKit } from './kit';

export function DetailsSection({ kit, type }: { kit: FormKit; type: ContractType }) {
  if (detailFields(type).length === 0 && type !== 'lease') return null;
  return (
    <>
      <SectionGap />
      <Section title={`${contractTypeLabel(type)} 정보`} testID="section-details">
        {type === 'lease' ? kit.amount('depositAmount', '보증금') : null}
        {detailFields(type).map((spec) => (
          <DetailInput
            key={`${type}-${spec.key}`}
            control={kit.control}
            spec={spec}
            flagged={kit.flagged?.has(`details.${spec.key}`)}
            hint={kit.hint(`details.${spec.key}`)}
            source={kit.values.valueSources?.[`details.${spec.key}`]}
          />
        ))}
      </Section>
    </>
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
