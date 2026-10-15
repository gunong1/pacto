/**
 * 시급제 주 단위 예상 급여 — 주 기본급 · 주휴수당 · 주 예상 급여 (규칙: src/domain/payBasis.ts weeklyPay)
 * 입력 화면(PayBasisFields)과 계약 상세(SalaryCard)가 같은 계산 결과를 같은 모양으로 보여 준다 (화면에서 다시 계산하지 않음).
 */
import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import type { WeeklyPay } from '@/domain/payBasis';
import { formatWon } from '@/domain/money';
import { spacing } from '@/theme';

const n = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

const HOLIDAY_TEXT: Record<WeeklyPay['holiday']['status'], string> = {
  added: '',
  excluded: '제외',
  in_wage: '시급에 포함 (따로 더하지 않음)',
  not_selected: '포함 여부 선택 안 함',
  below_15: '계산 안 함 (주 15시간 미만)',
  needs_check: '확인 필요',
};

export function WeeklyPayRows({ w, testID }: { w: WeeklyPay; testID: string }) {
  const h = w.holiday;
  return (
    <View style={{ gap: 2 }} testID={testID}>
      <Row label={`주 기본급 (주 ${n(w.hours)}시간)`} value={formatWon(w.base)} testID={`${testID}-base`} />
      <Row label={h.status === 'added' ? `주휴수당 (${n(h.hours!)}시간분)` : '주휴수당'} value={h.status === 'added' ? `+${formatWon(h.amount)}` : HOLIDAY_TEXT[h.status]} testID={`${testID}-holiday`} />
      <Row label="주 예상 급여" value={formatWon(w.total)} strong testID={`${testID}-total`} />
      <AppText variant="small" color={h.status === 'below_15' || h.status === 'needs_check' ? 'check' : 'textTertiary'} testID={`${testID}-note`}>
        {h.note}
      </AppText>
    </View>
  );
}

function Row({ label, value, strong, testID }: { label: string; value: string; strong?: boolean; testID?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }} testID={testID}>
      <AppText variant={strong ? 'captionStrong' : 'caption'} color={strong ? 'text' : 'textSecondary'} style={{ flexShrink: 1 }}>
        {label}
      </AppText>
      <AppText variant={strong ? 'captionStrong' : 'caption'} color={strong ? 'text' : 'textSecondary'} tabular style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </AppText>
    </View>
  );
}
