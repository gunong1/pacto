import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { EMPTY_DRAFT } from '@/data/draft';
import { ContractForm, quickDefaultFrequency } from '@/features/contracts/ContractForm';
import { draftToForm, quickDirectionAdvice } from '@/features/contracts/form';
import { useCreateContract, useToday } from '@/features/contracts/queries';
import { finishRegistration } from '@/features/registration/finish';
import { useRegistration } from '@/features/registration/store';
import { spacing } from '@/theme';

/**
 * 직접 입력 — 문서 없는 계약(구독·헬스장·통신 등)을 가계부처럼 빠르게 등록.
 * 계약명·유형·금액·주기·다음 결제일만 보이고, 나머지는 "상세 정보 추가"로 펼친다 (확인·수정 화면과 같은 폼·저장 로직).
 */
export default function ManualEntryScreen() {
  const today = useToday();
  const create = useCreateContract();
  const uploaded = useRegistration((s) => s.uploaded);

  return (
    <ContractForm
      defaultValues={{ ...draftToForm({ ...EMPTY_DRAFT, contractType: 'recurring' }), quick: { amount: '', direction: quickDirectionAdvice('recurring').direction, frequency: quickDefaultFrequency('recurring'), day: '', nextDate: '' } }}
      variant="quick"
      today={today}
      header={
        <View style={{ paddingHorizontal: spacing.gutter, paddingTop: spacing.lg }}>
          <AppText variant="title2">빠르게 등록하기</AppText>
          <AppText variant="body2" color="textSecondary" style={{ marginTop: spacing.sm }}>
            계약명만 있어도 저장할 수 있어요. 금액과 결제일을 넣으면 캘린더에 결제 일정이 만들어져요.
          </AppText>
        </View>
      }
      submitLabel="계약 저장"
      submitting={create.isPending}
      onSubmit={(draft) =>
        create.mutate(
          {
            draft,
            // 분석 실패 후 직접 입력으로 넘어온 경우, 이미 보관한 원본을 함께 연결
            source: uploaded.length > 0 ? 'upload' : 'manual',
            documents: uploaded.map((d) => ({ id: d.id, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, storagePath: d.storagePath, localUri: d.localUri, pageCount: null })),
            aiChecks: [],
          },
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
