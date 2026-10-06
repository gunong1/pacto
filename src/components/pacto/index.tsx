import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, type AppTextProps } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/controls';
import { formatDDay } from '@/domain/dday';
import { categoryLabel, SEVERITY_LABEL, STATUS_LABEL } from '@/domain/labels';
import { formatKRW, formatWon } from '@/domain/money';
import type { SourceType } from '@/domain/contractTypes';
import type { ContractCategory, ContractStatus, ReviewSeverity, ScheduleItemType } from '@/domain/types';
import { colors, radius, spacing } from '@/theme';

/** D-Day: 7일 이내는 주의 색, 30일 이내는 강조 색. */
export function DDay({ days, variant = 'title3', muted }: { days: number; variant?: AppTextProps['variant']; muted?: boolean }) {
  const color = muted ? 'textTertiary' : days <= 7 ? 'caution' : days <= 30 ? 'primary' : 'text';
  return (
    <AppText variant={variant} color={color} tabular>
      {formatDDay(days)}
    </AppText>
  );
}

export function Amount({ value, variant = 'body2Strong', won, color }: { value: number; variant?: AppTextProps['variant']; won?: boolean; color?: AppTextProps['color'] }) {
  return (
    <AppText variant={variant} tabular color={color}>
      {won ? formatWon(value) : formatKRW(value)}
    </AppText>
  );
}

export function StatusBadge({ status }: { status: ContractStatus }) {
  const tone = status === 'ending_soon' ? 'caution' : status === 'renewal_due' ? 'check' : status === 'active' ? 'primary' : 'neutral';
  return <Badge label={STATUS_LABEL[status]} tone={tone} />;
}

/** 값의 출처 배지 — AI 추정(계약서에 그대로 적힌 값이 아님) / PACTO 계산(계약 조건으로 계산한 값). 명시·사용자 확인 값은 배지 없음 */
export function SourceBadge({ source }: { source?: SourceType }) {
  if (source === 'inferred') return <Badge label="AI 추정" tone="check" />;
  if (source === 'calculated') return <Badge label="PACTO 계산" />;
  return null;
}

export function SeverityLabel({ severity }: { severity: ReviewSeverity }) {
  const tone = severity === 'caution' ? 'caution' : severity === 'check' ? 'check' : 'neutral';
  return <Badge label={SEVERITY_LABEL[severity]} tone={tone} />;
}

const CATEGORY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  education: 'school-outline',
  service: 'construct-outline',
  sale: 'swap-horizontal-outline',
  real_estate: 'home-outline',
  vehicle: 'car-outline',
  insurance: 'shield-checkmark-outline',
  telecom: 'wifi-outline',
  rental: 'cube-outline',
  finance: 'card-outline',
  employment: 'briefcase-outline',
  business: 'business-outline',
  membership: 'id-card-outline',
  subscription: 'repeat-outline',
  other: 'document-text-outline',
};

export function CategoryIcon({ category, size = 40 }: { category: ContractCategory; size?: number }) {
  return (
    <View
      style={[styles.icon, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityLabel={categoryLabel(category)}>
      <Ionicons name={CATEGORY_ICON[category] ?? CATEGORY_ICON.other} size={size * 0.48} color={colors.textSecondary} />
    </View>
  );
}

/**
 * 캘린더 이벤트 색상 체계 (고정). 색만으로 구분하지 않고 항상 범례/라벨 텍스트를 함께 표시한다.
 * 결제 = 네이비 · 계약 시작 = 라이트 블루 · 해지 통보기한 = 레드 · 종료·갱신 = 앰버 · 내 일정 = 그레이
 */
/** 캘린더 색: 돈이 움직이는 날 = 네이비, 시작·주요 날짜(입주·설치·실행 …) = 라이트 블루, 통보기한 = 레드, 종료·만기·갱신·확인 시점 = 앰버, 내 일정 = 그레이 */
export const EVENT_COLOR: Record<ScheduleItemType, string> = {
  payment: colors.primary,
  termination_notice: colors.caution,
  contract_end: colors.amber,
  renewal: colors.amber,
  prepare: colors.amber,
  contract_start: colors.brandSky,
  key_date: colors.brandSky,
  custom: colors.textTertiary,
};

export const EVENT_LEGEND: { label: string; color: string }[] = [
  { label: '결제', color: EVENT_COLOR.payment },
  { label: '시작·주요 날짜', color: EVENT_COLOR.contract_start },
  { label: '통보기한', color: EVENT_COLOR.termination_notice },
  { label: '종료·만기·갱신', color: EVENT_COLOR.contract_end },
  { label: '내 일정', color: EVENT_COLOR.custom },
];

/** 계약/일정 목록 한 줄: 아이콘 · 이름/보조 · 오른쪽 값 */
export function ContractLine({
  category,
  title,
  subtitle,
  right,
  onPress,
  testID,
}: {
  category: ContractCategory;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} style={({ pressed }) => [styles.line, pressed && { opacity: 0.6 }]}>
      <CategoryIcon category={category} />
      <View style={{ flex: 1 }}>
        <AppText variant="body2Strong" numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color="textTertiary" numberOfLines={1} style={{ marginTop: 2 }}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  icon: { backgroundColor: colors.bgSubtle, alignItems: 'center', justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10, minHeight: 60 },
  right: { alignItems: 'flex-end' },
});

export const pactoStyles = StyleSheet.create({
  panel: { backgroundColor: colors.bgSubtle, borderRadius: radius.lg, padding: spacing.lg },
});
