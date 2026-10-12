import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/controls';
import { Screen, Section } from '@/components/ui/layout';
import { cleanContractNames, MAX_CONTRACT_NAME_LENGTH, MAX_CONTRACT_NAMES } from '@/domain/partyMatch';
import { useProfile, useSaveProfile } from '@/features/profile/queries';
import { notify } from '@/lib/dialog';
import { colors, spacing } from '@/theme';

/**
 * 내 계약자 정보 — 계약서에 쓰는 내 이름·다른 표기(영문 등). 선택 입력, 최대 5개.
 * - 계약서 당사자와 이름이 정확히 같을 때 "추천"만 한다 (확정은 계약마다 사용자가) — 기기에서만 대조, AI에는 보내지 않음
 * - 이름을 바꿔도 이미 확정한 계약의 역할은 바뀌지 않는다
 * - 주민번호·전화번호·계좌번호는 받지 않는다
 */
export default function ContractNamesScreen() {
  const { data: profile } = useProfile();
  if (!profile) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator style={{ marginTop: 80 }} color={colors.textTertiary} />
      </Screen>
    );
  }
  return <NamesForm initial={profile.contractNames} />;
}

function NamesForm({ initial }: { initial: string[] }) {
  const save = useSaveProfile();
  const [names, setNames] = useState<string[]>(() => [...initial, ...Array(Math.max(0, 2 - initial.length)).fill('')]);
  const set = (i: number, v: string) => setNames((l) => l.map((x, j) => (j === i ? v : x)));
  const submit = () =>
    save.mutate(
      { contractNames: cleanContractNames(names) },
      { onSuccess: () => router.back(), onError: () => notify('내 계약자 정보', '저장하지 못했어요. 잠시 후 다시 시도해주세요.') },
    );
  return (
    <Screen edges={['bottom']} footer={<Button label="저장" loading={save.isPending} onPress={submit} testID="contract-names-save" />} testID="contract-names-screen">
      <Section title="계약서에 사용되는 이름" caption="계약서에서 본인을 찾고 계약상 역할을 추천하는 데 써요. 이름이 같아도 자동으로 정하지 않고, 계약마다 직접 확인해요.">
        {names.map((n, i) => (
          <TextField
            key={i}
            label={i === 0 ? '내 이름' : '다른 이름 또는 영문 이름'}
            value={n}
            onChangeText={(v) => set(i, v)}
            maxLength={MAX_CONTRACT_NAME_LENGTH}
            placeholder={i === 0 ? '예: 홍길동' : '예: Hong Gildong'}
            testID={`contract-name-${i}`}
          />
        ))}
        {names.length < MAX_CONTRACT_NAMES ? (
          <Button label="이름 추가" size="sm" variant="secondary" onPress={() => setNames((l) => [...l, ''])} testID="contract-name-add" />
        ) : null}
        <View style={{ height: spacing.md }} />
        <AppText variant="caption" color="textTertiary">
          이름은 내 계정에만 저장되고 계약서 분석(AI)에는 보내지 않아요. 주민등록번호·전화번호·계좌번호는 받지 않아요. 이름을 바꿔도 이미 확정한 계약의 역할은 그대로예요.
        </AppText>
      </Section>
    </Screen>
  );
}
