import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { EMPTY_DRAFT } from '@/data/draft';
import { ContractForm } from '@/features/contracts/ContractForm';
import { draftToForm } from '@/features/contracts/form';
import { useCreateContract, useToday } from '@/features/contracts/queries';
import { finishRegistration } from '@/features/registration/finish';
import { spacing } from '@/theme';

/** 직접 입력 — 확인 화면과 같은 폼을 빈 값으로 사용. */
export default function ManualEntryScreen() {
  const today = useToday();
  const create = useCreateContract();

  return (
    <ContractForm
      defaultValues={draftToForm(EMPTY_DRAFT)}
      today={today}
      header={
        <View style={{ paddingHorizontal: spacing.gutter, paddingTop: spacing.lg }}>
          <AppText variant="title2">계약 정보를 입력해주세요</AppText>
          <AppText variant="body2" color="textSecondary" style={{ marginTop: spacing.sm }}>
            계약명만 있어도 저장할 수 있어요. 종료일과 결제 정보를 넣으면 일정과 지출을 관리해 드려요.
          </AppText>
        </View>
      }
      submitLabel="계약 저장"
      submitting={create.isPending}
      onSubmit={(draft) =>
        create.mutate(
          { draft, source: 'manual', documents: [], aiChecks: [] },
          {
            onSuccess: (record) => {
              finishRegistration(record.contract.id);
            },
          },
        )
      }
    />
  );
}
