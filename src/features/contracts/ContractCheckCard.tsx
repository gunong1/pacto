import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { SeverityLabel } from '@/components/pacto';
import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/controls';
import { checkTopicLabel } from '@/domain/contractTypes';
import { formatDateKo } from '@/domain/dates';
import type { AiCheck } from '@/domain/types';
import { colors, hitSlop, radius, spacing } from '@/theme';

/**
 * PACTO 계약 체크 카드 — 확인이 필요한 조항 하나.
 * 등급(일반·확인 필요·주의 필요) + 무엇이 적혀 있는지 + 원문 근거(쪽·문장, 원문 보기) + 관리로 연결(날짜·캘린더).
 * AI 설명은 법적 판단이 아니며, 신뢰도가 낮으면 원문과 비교하도록 강조한다.
 */
export function ContractCheckCard({
  check,
  deadline,
  onOpenOriginal,
  action,
  testID,
}: {
  check: Pick<AiCheck, 'severity' | 'topic' | 'title' | 'description' | 'confidence' | 'evidenceQuote' | 'evidencePage' | 'behavior' | 'rule'>;
  /** 이 조항에서 계산된 챙길 날짜 (예: 해지 통보기한) */
  deadline?: { label: string; date: string } | null;
  onOpenOriginal?: () => void;
  action?: React.ReactNode;
  testID?: string;
}) {
  const low = check.confidence === 'low';
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.head}>
        <SeverityLabel severity={check.severity} />
        <AppText variant="caption" color="textTertiary">
          {checkTopicLabel(check.topic)}
        </AppText>
        {low ? <Badge label="AI 확신 낮음" tone="check" /> : null}
      </View>
      <AppText variant="body2Strong" style={{ marginTop: 6 }}>
        {check.title}
      </AppText>
      <AppText variant="body2" color="textSecondary" style={{ marginTop: 4 }}>
        {check.description}
      </AppText>
      {check.behavior === 'conditional_rule' && check.rule ? (
        <View style={styles.rule} testID={testID ? `${testID}-rule` : undefined}>
          <AppText variant="caption" color="textSecondary">
            <AppText variant="captionStrong">조건</AppText> {check.rule.condition}
          </AppText>
          <AppText variant="caption" color="textSecondary">
            <AppText variant="captionStrong">할 일</AppText> {check.rule.action}
          </AppText>
          <AppText variant="small" color="textTertiary">
            조건이 생길 때만 적용돼요. 계약서만으로는 날짜가 정해지지 않아 일정을 만들지 않았어요.
          </AppText>
        </View>
      ) : null}
      {low ? (
        <AppText variant="caption" color="check" style={{ marginTop: 4 }}>
          자동으로 찾은 내용이 정확하지 않을 수 있어요. 원문과 비교해주세요.
        </AppText>
      ) : null}
      {check.evidenceQuote ? (
        <View style={styles.quote}>
          <AppText variant="small" color="textTertiary">
            근거{check.evidencePage ? ` · 계약서 ${check.evidencePage}쪽` : ''}
          </AppText>
          <AppText variant="caption" color="textSecondary" style={{ marginTop: 2 }}>
            “{check.evidenceQuote}”
          </AppText>
          {onOpenOriginal ? (
            <Pressable onPress={onOpenOriginal} hitSlop={hitSlop} accessibilityRole="button" style={styles.open} testID={testID ? `${testID}-original` : undefined}>
              <Ionicons name="document-text-outline" size={14} color={colors.primary} />
              <AppText variant="captionStrong" color="primary">
                원문 보기
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <AppText variant="caption" color="textTertiary" style={{ marginTop: spacing.sm }}>
          원문 근거를 찾지 못했어요. 계약서를 직접 확인해주세요.
        </AppText>
      )}
      {deadline ? (
        <View style={styles.deadline} testID={testID ? `${testID}-deadline` : undefined}>
          <Ionicons name="calendar-outline" size={16} color={colors.caution} />
          <AppText variant="body2Strong">
            {deadline.label} {formatDateKo(deadline.date)}
          </AppText>
        </View>
      ) : null}
      {action ? <View style={styles.actions}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  rule: { marginTop: spacing.sm, padding: spacing.sm, gap: 2, borderRadius: radius.md, backgroundColor: colors.bgSubtle },
  quote: { marginTop: spacing.sm, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.border },
  open: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, alignSelf: 'flex-start' },
  deadline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.cautionSoft },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
});
