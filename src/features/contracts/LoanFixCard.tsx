/**
 * 예전 분석으로 저장된 대출 금액 정리 (규칙: domain/loanPlan.ts loanLegacyIssues) — 자동으로 바꾸지 않는다.
 * - 결제로 저장된 대출 실행금(입금·출금) → 합계·캘린더에서는 빼고 보여주며, 사용자가 확인하면 그 결제만 지우고 대출 원금 정보로 (금액은 참고 금액으로 남김)
 * - 회차별로 저장된 이자 여러 개 → 사용자가 확인하면 이자 납부 규칙 1건으로 (원래 회차 금액은 참고 금액으로 남겨 계산과 대조)
 */
import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { formatDateKo } from '@/domain/dates';
import { loanLegacyIssues } from '@/domain/loanPlan';
import { formatWon } from '@/domain/money';
import type { ContractRecord } from '@/domain/types';
import { colors, radius, spacing } from '@/theme';

export function LoanFixCard({ record, busy, onFixDisbursement, onMergeInterest }: { record: ContractRecord; busy?: boolean; onFixDisbursement: (paymentId: string) => void; onMergeInterest: (paymentIds: string[]) => void }) {
  const { disbursements, interestRows } = loanLegacyIssues(record);
  if (disbursements.length === 0 && interestRows.length === 0) return null;
  const box = { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSubtle, gap: spacing.xs } as const;
  return (
    <>
      {disbursements.map((p) => (
        <View key={p.id} style={box} testID={`loan-fix-disbursement-${p.id}`}>
          <AppText variant="body2Strong">{`"${p.label}"은 대출 실행금으로 보여요`}</AppText>
          <AppText variant="caption" color="textSecondary">
            {formatDateKo(p.startsOn)} {formatWon(p.amount)}이 {p.direction === 'income' ? '입금' : p.direction === 'expense' ? '출금' : '결제'} 항목으로 저장돼 있어요. 대출 실행금은 입출금으로 관리하지 않아서 캘린더·월 합계에서는 빼고 보여 드리고 있어요 (저장된 항목은 그대로). 대출 원금 정보로 옮기면 이 항목이 정리돼요. 만기에 갚는 원금은 ‘원금 상환’으로 따로 관리해요.
          </AppText>
          <Button label="대출 원금 정보로 옮기기 (항목 정리)" size="sm" variant="secondary" loading={busy} onPress={() => onFixDisbursement(p.id)} testID={`loan-fix-disbursement-${p.id}-apply`} />
        </View>
      ))}
      {interestRows.length > 0 ? (
        <View style={box} testID="loan-fix-interest">
          <AppText variant="body2Strong">{`이자가 ${interestRows.length}개 항목으로 나뉘어 있어요`}</AppText>
          <AppText variant="caption" color="textSecondary">
            {interestRows.map((p) => `${p.label} ${formatWon(p.amount)}`).join(' · ')}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            이자 납부 규칙 1개로 합치면 회차별 이자를 금리·일수로 계산해요. 원래 금액은 ‘계약서 예시 금액’으로 남겨 계산과 맞는지 보여 드려요. 계산 기준(이자 계산 방식·기간)이 비어 있으면 정보 수정에서 먼저 입력해주세요.
          </AppText>
          <Button label="이자 납부 규칙 1개로 합치기" size="sm" variant="secondary" loading={busy} onPress={() => onMergeInterest(interestRows.map((p) => p.id))} testID="loan-fix-interest-apply" />
        </View>
      ) : null}
    </>
  );
}
