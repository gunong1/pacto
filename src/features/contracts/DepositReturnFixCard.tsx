/**
 * 결제로 잘못 저장된 보증금 반환 정리 (이전 분석 결과 — 규칙: domain/cashflow.ts misfiledDepositReturns).
 * 저장된 값을 자동으로 바꾸지 않는다: 알리고, 사용자가 반환일이 계약서에 적혀 있는지 고른 뒤에만 정리한다.
 * 정리하면 그 결제는 지워지고 보증금 묶음의 반환(반환일이 적혀 있으면 그날 반환 예정, 아니면 계약 종료일에 반환 확인)으로 본다.
 */
import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { formatDateKo } from '@/domain/dates';
import { formatWon } from '@/domain/money';
import type { ContractPayment } from '@/domain/types';
import { colors, radius, spacing } from '@/theme';

export function DepositReturnFixCard({ payment, onFix, busy }: { payment: ContractPayment; onFix: (dateIsStated: boolean) => void; busy?: boolean }) {
  const t = `deposit-return-fix-${payment.id}`;
  return (
    <View style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSubtle, gap: spacing.xs }} testID={t}>
      <AppText variant="body2Strong">{`"${payment.label}"은 보증금 반환으로 보여요`}</AppText>
      <AppText variant="caption" color="textSecondary">
        지금은 {formatWon(payment.amount)}이 {formatDateKo(payment.startsOn)} 일반 {payment.direction === 'income' ? '수입' : payment.direction === 'expense' ? '지출' : '결제'}로 저장돼 있어요. 보증금 반환은 처음 낸 보증금이 돌아오는(돌려주는) 돈이라 일반 수입·지출과 따로 관리해요. 방향은 이 계약에서의 내 역할(임차인·임대인)로 정해져요.
      </AppText>
      <AppText variant="caption" color="textTertiary">
        {formatDateKo(payment.startsOn)}이 계약서에 반환일로 적혀 있나요? 적혀 있지 않으면 계약 종료일에 ‘반환 확인’으로만 보여 드려요.
      </AppText>
      <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
        <Button label={`반환일이 적혀 있어요 (${formatDateKo(payment.startsOn)})`} size="sm" variant="secondary" loading={busy} onPress={() => onFix(true)} testID={`${t}-dated`} />
        <Button label="반환일은 따로 없어요 (계약 종료 시 반환)" size="sm" variant="secondary" loading={busy} onPress={() => onFix(false)} testID={`${t}-at-end`} />
      </View>
    </View>
  );
}
