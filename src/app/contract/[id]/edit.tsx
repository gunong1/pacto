import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { EmptyState } from '@/components/ui/layout';
import { recordToDraft } from '@/data/draft';
import { ContractForm } from '@/features/contracts/ContractForm';
import { draftToForm } from '@/features/contracts/form';
import { useContract, useToday, useUpdateContract } from '@/features/contracts/queries';
import { colors } from '@/theme';

export default function EditContractScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = useToday();
  const { data: record, isLoading } = useContract(id);
  const update = useUpdateContract(id);

  if (isLoading) return <ActivityIndicator style={{ marginTop: 80 }} color={colors.primary} />;
  if (!record) return <EmptyState title="계약을 찾을 수 없어요" />;

  return (
    <ContractForm
      defaultValues={draftToForm(recordToDraft(record))}
      today={today}
      submitLabel="수정 완료"
      submitting={update.isPending}
      onSubmit={(draft) => update.mutate(draft, { onSuccess: () => router.back() })}
    />
  );
}
