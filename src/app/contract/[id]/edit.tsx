import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { EmptyState } from '@/components/ui/layout';
import { recordToDraft } from '@/data/draft';
import { ContractForm } from '@/features/contracts/ContractForm';
import { draftToForm, draftToQuickForm } from '@/features/contracts/form';
import { useContract, useToday, useUpdateContract } from '@/features/contracts/queries';
import { colors } from '@/theme';

export default function EditContractScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = useToday();
  const { data: record, isLoading } = useContract(id);
  const update = useUpdateContract(id);

  if (isLoading) return <ActivityIndicator style={{ marginTop: 80 }} color={colors.primary} />;
  if (!record) return <EmptyState title="계약을 찾을 수 없어요" />;

  // 직접 입력한 계약은 등록 때와 같은 화면(빠른 입력 + 상세 정보 추가)으로 수정한다. 계약서로 등록한 계약은 전체 입력 화면
  const manual = record.contract.source === 'manual';
  const draft = recordToDraft(record);
  return (
    <ContractForm
      defaultValues={manual ? draftToQuickForm(draft) : draftToForm(draft)}
      variant={manual ? 'quick' : 'full'}
      mode="edit"
      today={today}
      submitLabel="수정 완료"
      submitting={update.isPending}
      onSubmit={(draft) => update.mutate(draft, { onSuccess: () => router.back() })}
    />
  );
}
