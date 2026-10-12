/**
 * 홈 — 방향을 모르는 금액이 있는 계약마다 "이 계약에서 누구세요?" 한 줄 (규칙: src/domain/cashflow.ts recommendedSide)
 * - 추천이 있으면 "추천: 고객(임차인) · 김도윤 [맞아요]" — 누르는 것이 확인 (추천만으로는 합계에 넣지 않음)
 * - 추천이 없거나 다른 역할이면 계약 수정 화면의 역할 카드로
 */
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { recommendedSide } from '@/domain/cashflow';
import { formatWon } from '@/domain/money';
import { partyKindOf, partyRoleLabel } from '@/domain/parties';
import type { ContractRecord } from '@/domain/types';
import { useProfile } from '@/features/profile/queries';
import { spacing } from '@/theme';

import { useContractActions } from './queries';

export function RoleConfirmCard({ record, amount }: { record: ContractRecord; amount: number }) {
  const { contract } = record;
  const names = useProfile().data?.contractNames ?? [];
  const actions = useContractActions(contract.id);
  const rec = recommendedSide(contract, names);
  const kind = partyKindOf(contract);
  const party = rec ? contract.parties.find((p) => p.role === rec.role) : undefined;
  const recText = rec ? `${partyRoleLabel(kind, rec.role, party?.term)}${party ? ` · ${party.name}` : ''}` : null;
  return (
    <View style={{ marginTop: spacing.sm }} testID={`role-confirm-${contract.id}`}>
      <AppText variant="captionStrong" numberOfLines={1}>
        {contract.title} · {formatWon(amount)}
      </AppText>
      {recText ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 }}>
          <AppText variant="caption" color="textSecondary" style={{ flex: 1 }} testID="role-confirm-recommendation">
            추천: {recText}
            {rec!.reason === 'name' ? ' (등록한 이름과 같아요)' : ' (이 종류의 계약에서는 보통 이쪽이에요)'}
          </AppText>
          <Button label="맞아요" size="sm" loading={actions.confirmRole.isPending} onPress={() => actions.confirmRole.mutate([rec!.role])} testID="role-confirm-yes" />
        </View>
      ) : null}
      <Pressable onPress={() => router.push(`/contract/${contract.id}/edit`)} accessibilityRole="button" testID="role-confirm-other" style={{ marginTop: 2, alignSelf: 'flex-start' }}>
        <AppText variant="captionStrong" color="primary">
          {recText ? '다른 역할이에요 ›' : '이 계약에서 내 역할 확인 ›'}
        </AppText>
      </Pressable>
    </View>
  );
}
