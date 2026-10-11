/**
 * 주요 날짜 목록 (설치일·입주일·잔금일 …) — 추가·수정·삭제. 캘린더에 표시된다.
 * 입력: 날짜 목록(useFieldArray) · 유형별 날짜 종류 / 출력: dates.* 입력값
 */
import { Ionicons } from '@expo/vector-icons';
import { Controller, type UseFieldArrayReturn } from 'react-hook-form';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { ChipGroup } from '@/components/ui/controls';
import { dateKindLabel, type ContractDateKind } from '@/domain/contractTypes';
import { colors, hitSlop } from '@/theme';

import type { ContractFormValues } from '../form';
import type { FormKit } from './kit';
import { styles } from './styles';

export function DatesList({ kit, dates, dateKinds }: { kit: FormKit; dates: UseFieldArrayReturn<ContractFormValues, 'dates'>; dateKinds: readonly ContractDateKind[] }) {
  const { control, getValues, setValue, flagged, hint, field, date } = kit;
  const dateKindOptions = dateKinds.map((k) => ({ value: k, label: dateKindLabel(k) }));
  return (
    <>
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
          const kind = dateKinds[0];
          dates.append({ kind, label: dateKindLabel(kind), date: '' });
        }}
        testID="add-date"
      />
    </>
  );
}
