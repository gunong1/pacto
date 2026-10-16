/**
 * 유형별 정보 섹션 (예: 임대차 → 보증금·임대인, 근로 → 근무시간 …)
 * 입력: 계약 유형 · 경로별 확인 필요/근거 · 값 출처(AI 추정) / 출력: details.* 입력값
 * 계약 정보 = 사실. 조건 문장(갱신·보증금 반환·중도상환수수료·면책 …, 레지스트리 role=condition)은 기본 화면이 아니라 "상세 조건"(접힘)에서.
 * 행동·기한·위험은 계약 체크가 맡는다. 등록 확인(AI 결과)에서는 값이 있는 조건만 보여 빈 장문 입력칸을 만들지 않는다.
 * 저장된 값은 지우지 않는다 (수정 화면에서는 모든 조건 칸을 상세 조건 안에 둔다).
 */
import { useState } from 'react';
import { Controller, type Control } from 'react-hook-form';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { ChipGroup } from '@/components/ui/controls';
import { Section, SectionGap } from '@/components/ui/layout';
import { PAY_BASIS_KEYS, PAYROLL_RULE_KEYS } from '@/domain/payBasis';
import { contractTypeLabel, detailFields, splitDetailFields, type ContractType, type DetailFieldSpec, type SourceType } from '@/domain/contractTypes';
import { hitSlop, spacing } from '@/theme';

import type { ContractFormValues } from '../form';
import { FormLabel, FormText, type FieldName, type FormKit } from './kit';
import { styles } from './styles';

export function DetailsSection({ kit, type, extra }: { kit: FormKit; type: ContractType; extra?: React.ReactNode }) {
  const split = splitDetailFields(type);
  const conditions = split.conditions;
  // 근로의 급여 방식 칸은 급여 방식 영역(PayBasisFields)에서 — 여기서 빼고 값은 지우지 않는다
  // 급여 산정·지급 규정도 급여 영역에서 (원 단위 처리는 보여주지 않음) — 직접 입력·수정·등록 확인이 같은 자리·같은 순서
  const facts = type === 'employment' ? split.facts.filter((f) => !PAY_BASIS_KEYS.has(f.key) && !PAYROLL_RULE_KEYS.has(f.key)) : split.facts;
  const filled = (key: string) => {
    const v = (kit.values.details as Record<string, unknown> | undefined)?.[key];
    return v != null && String(v).trim() !== '';
  };
  // AI 결과 확인 화면이면 값이 있는 조건만 (직접 입력·수정 화면은 모든 조건 칸)
  const fromAi = !kit.editing && !!kit.evidence && Object.keys(kit.evidence).length > 0;
  const shown = fromAi ? conditions.filter((f) => filled(f.key)) : conditions;
  const anyFlagged = shown.some((f) => kit.flagged?.has(`details.${f.key}`));
  const [open, setOpen] = useState(anyFlagged);
  if (detailFields(type).length === 0 && type !== 'lease') return null;
  const input = (spec: DetailFieldSpec) => (
    <DetailInput
      key={`${type}-${spec.key}`}
      control={kit.control}
      spec={spec}
      flagged={kit.flagged?.has(`details.${spec.key}`)}
      hint={kit.hint(`details.${spec.key}`)}
      source={kit.values.valueSources?.[`details.${spec.key}`]}
      accessory={kit.evidenceIcon(`details.${spec.key}`, spec.label)}
    />
  );
  return (
    <>
      <SectionGap />
      <Section title={`${contractTypeLabel(type)} 정보`} testID="section-details">
        {type === 'lease' ? kit.amount('depositAmount', '보증금') : null}
        {extra}
        {facts.map(input)}
        {shown.length > 0 ? (
          <>
            <Pressable onPress={() => setOpen((o) => !o || anyFlagged)} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={hitSlop} testID="toggle-conditions" style={styles.classToggle}>
              <AppText variant="captionStrong" color="primary">
                {open ? '− 상세 조건 닫기' : `+ 상세 조건${fromAi ? ` ${shown.length}개` : ''}`}
              </AppText>
              {!open ? (
                <AppText variant="caption" color="textTertiary" numberOfLines={1} style={{ flex: 1 }}>
                  {shown.map((f) => f.label).join(' · ')}
                </AppText>
              ) : null}
            </Pressable>
            {open ? (
              <View style={{ marginTop: spacing.md }} testID="details-conditions">
                {shown.map(input)}
              </View>
            ) : null}
          </>
        ) : null}
      </Section>
    </>
  );
}

/** 유형별 정보 한 칸 */
function DetailInput({ control, spec, flagged, hint, source, accessory }: { control: Control<ContractFormValues>; spec: DetailFieldSpec; flagged?: boolean; hint?: string; source?: SourceType; accessory?: React.ReactNode }) {
  const name = `details.${spec.key}` as FieldName;
  if (spec.input === 'enum' || spec.input === 'boolean') {
    const options = spec.input === 'enum' ? [...(spec.options ?? [])] : [{ value: 'true', label: '예' }, { value: 'false', label: '아니오' }];
    return (
      <View style={{ marginBottom: spacing.lg }}>
        <FormLabel label={spec.label} flagged={flagged} source={source} accessory={accessory} />
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
      labelAccessory={accessory}
      amount={spec.input === 'amount'}
      multiline={spec.input === 'text'}
      keyboardType={spec.input === 'percent' || spec.input === 'decimal' ? 'decimal-pad' : spec.input === 'text' ? 'default' : 'number-pad'}
      suffix={spec.suffix}
      testID={`detail-${spec.key}`}
    />
  );
}
