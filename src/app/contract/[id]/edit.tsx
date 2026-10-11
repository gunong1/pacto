import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { EmptyState } from '@/components/ui/layout';
import { recordToDraft } from '@/data/draft';
import type { ContractDraft } from '@/data/repository';
import { detectAmountEdits, pastOccurrencesAffected, resolveAmountEdits, type AmountDecision, type AmountEdit } from '@/domain/amountEdits';
import { AmountChangeSheet } from '@/features/contracts/AmountChangeSheet';
import { ContractForm } from '@/features/contracts/ContractForm';
import { draftToForm, draftToQuickForm } from '@/features/contracts/form';
import { useContract, useToday, useUpdateContract } from '@/features/contracts/queries';
import { colors } from '@/theme';

export default function EditContractScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = useToday();
  const { data: record, isLoading } = useContract(id);
  const update = useUpdateContract(id);
  /** 반복 금액을 바꾼 결제마다 "언제부터"를 차례로 묻는다 */
  const [pending, setPending] = useState<{ draft: ContractDraft; queue: AmountEdit[]; decisions: Record<string, AmountDecision> } | null>(null);

  if (isLoading) return <ActivityIndicator style={{ marginTop: 80 }} color={colors.primary} />;
  if (!record) return <EmptyState title="계약을 찾을 수 없어요" />;

  const save = (draft: ContractDraft, decisions: Record<string, AmountDecision>) => {
    // 금액을 그대로 둔 결제는 최초 금액 유지, 바꾼 결제는 결정대로 (변경 이력 추가 / 정정)
    const { payments, ops } = resolveAmountEdits(record, draft.payments, today, decisions);
    update.mutate({ draft: { ...draft, payments }, amountChanges: ops }, { onSuccess: () => router.back() });
  };

  const submit = (draft: ContractDraft) => {
    const queue = detectAmountEdits(record, draft.payments, today);
    if (queue.length === 0) return save(draft, {});
    setPending({ draft, queue, decisions: {} });
  };

  const decide = (decision: AmountDecision) => {
    if (!pending) return;
    const [head, ...rest] = pending.queue;
    const decisions = { ...pending.decisions, [head.paymentId]: decision };
    if (rest.length > 0) return setPending({ ...pending, queue: rest, decisions });
    setPending(null);
    save(pending.draft, decisions);
  };

  // 직접 입력한 계약은 등록 때와 같은 화면(빠른 입력 + 상세 정보 추가)으로 수정한다. 계약서로 등록한 계약은 전체 입력 화면
  const manual = record.contract.source === 'manual';
  // 금액은 오늘 적용 중인 금액으로 보여준다 (저장할 때 최초 금액/변경 이력으로 정리)
  const draft = recordToDraft(record, today);
  return (
    <>
      <ContractForm
        defaultValues={manual ? draftToQuickForm(draft) : draftToForm(draft)}
        variant={manual ? 'quick' : 'full'}
        mode="edit"
        today={today}
        submitLabel="수정 완료"
        submitting={update.isPending}
        onSubmit={submit}
      />
      <AmountChangeSheet
        edit={pending?.queue[0] ?? null}
        pastCount={(date) => (pending ? pastOccurrencesAffected(record, pending.queue[0].paymentId, date, today) : 0)}
        onConfirm={decide}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
