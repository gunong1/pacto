import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/controls';
import { formatDateKo } from '@/domain/dates';
import type { ImportantScheduleItem } from '@/domain/importantSchedule';
import { maskSensitiveTextForDisplay } from '@/domain/sensitive';
import { useContracts } from '@/features/contracts/queries';
import { notify } from '@/lib/dialog';
import { colors, hitSlop, radius, spacing } from '@/theme';

/**
 * 중요한 계약 일정 카드 — 색만으로 구분하지 않는다: 아이콘 + 제목 + 라벨(중요·기한 임박·확인 필요) + 테두리/배경 + 문구.
 * 날짜의 출처("계약서 기준 · 2029. 9. 11.")와 PACTO 알림 정책("30·7·1일 전과 당일에 미리 알려드려요")을 다른 줄로 보여준다.
 * 카드 전체를 누르면 계약 상세로 (예전 "계약 확인"과 같은 경로) — "관련 조항 보기"는 따로 동작하고 카드 이동을 일으키지 않는다.
 * 오른쪽 위 라벨(확인·중요·기한 임박·확인 필요)은 상태 표시일 뿐 버튼이 아니다.
 * 계약이 삭제됐거나 볼 수 없으면(내 계약 목록에 없음) 이동하지 않고 안내한다.
 */
export function ImportantScheduleCard({ entry }: { entry: ImportantScheduleItem }) {
  const [showEvidence, setShowEvidence] = useState(false);
  const critical = entry.priority === 'critical';
  const { item, evidence } = entry;
  const { refetch } = useContracts();
  const [opening, setOpening] = useState(false);
  // 누르는 순간 목록을 다시 확인 — 다른 기기·탭에서 삭제됐거나 권한이 없어진 계약은 이동하지 않음 (확인 실패 시 상세 화면이 "찾을 수 없어요"로 막는다)
  const open = async () => {
    if (opening) return;
    setOpening(true);
    const { data: records } = await refetch().finally(() => setOpening(false));
    if (records && !records.some((r) => r.contract.id === item.contractId)) {
      notify('계약을 찾을 수 없어요', '삭제되었거나 볼 수 없는 계약이에요. 알림 목록을 새로 불러와 주세요.');
      return;
    }
    router.push(`/contract/${item.contractId}`);
  };
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityHint="계약 상세로 이동해요"
      style={({ pressed }) => [styles.card, critical ? styles.critical : styles.important, pressed && { opacity: 0.85 }]}
      testID={`important-${item.key}`}
      accessibilityLabel={`${entry.badge}. ${entry.title}. ${item.contractTitle}`}>
      <View style={styles.head}>
        <Ionicons name={critical ? 'alert-circle' : 'calendar-outline'} size={20} color={critical ? colors.caution : colors.amber} />
        <AppText variant="body2Strong" style={{ flex: 1 }}>
          {entry.title}
        </AppText>
        <Badge label={entry.badge} tone={entry.badge === '확인 필요' ? 'check' : critical ? 'caution' : 'neutral'} />
      </View>
      <AppText variant="caption" color="textSecondary" style={{ marginTop: 2 }}>
        {item.contractTitle}
      </AppText>
      <AppText variant="body2" style={{ marginTop: spacing.sm }}>
        {entry.body}
      </AppText>
      <View style={styles.dateRow}>
        <View style={styles.sourceChip} testID={`important-source-${item.key}`}>
          <AppText variant="small" color="textSecondary">
            {entry.sourceLabel}
          </AppText>
        </View>
        <AppText variant="captionStrong" tabular>
          {formatDateKo(item.date, true)}
        </AppText>
        <AppText variant="caption" color="textTertiary" tabular>
          {entry.daysLeft === 0 ? '오늘' : `D-${entry.daysLeft}`}
        </AppText>
      </View>
      {entry.policyNote ? (
        <AppText variant="small" color="textTertiary" style={{ marginTop: spacing.xs }}>
          {entry.policyNote}
        </AppText>
      ) : null}
      {item.needsReview ? (
        <AppText variant="small" color="check" style={{ marginTop: spacing.xs }}>
          AI가 추정한 값으로 계산한 날짜예요. 계약서와 맞는지 확인해주세요.
        </AppText>
      ) : null}
      {evidence && showEvidence ? (
        <View style={styles.quote}>
          <AppText variant="caption" color="textSecondary">
            “{maskSensitiveTextForDisplay(evidence.quote)}”
          </AppText>
          {evidence.page ? (
            <AppText variant="small" color="textTertiary" style={{ marginTop: 2 }}>
              계약서 {evidence.page}쪽
            </AppText>
          ) : null}
        </View>
      ) : null}
      <View style={styles.actions}>
        <Pressable onPress={open} hitSlop={hitSlop} accessibilityRole="button" testID={`important-open-${item.key}`}>
          <AppText variant="captionStrong" color="primary">
            계약 확인
          </AppText>
        </Pressable>
        {evidence ? (
          <Pressable onPress={() => setShowEvidence((v) => !v)} hitSlop={hitSlop} accessibilityRole="button" testID={`important-evidence-${item.key}`}>
            <AppText variant="captionStrong" color="primary">
              {showEvidence ? '근거 접기' : '관련 조항 보기'}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.sm },
  critical: { backgroundColor: colors.cautionSoft, borderColor: colors.caution },
  important: { backgroundColor: colors.checkSoft, borderColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  sourceChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  quote: { marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.bg },
  actions: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
});
