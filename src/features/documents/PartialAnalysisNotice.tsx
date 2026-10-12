/**
 * 부분 분석 안내 — 분석에 쓰지 않은 페이지가 있을 때 (자동 제외: 글자를 읽지 못함 / 사용자가 직접 뺌)
 * 등록 확인(결과 화면 맨 위) · 계약 상세가 같은 카드를 쓴다. 놓치지 않도록 경고 상태로 크게 보여준다.
 * "전체 2쪽 중 1쪽만 분석했어요." · 페이지별 사유 · [제외된 페이지 보기] · (등록 중) [문서 다시 등록]
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { colors, radius, spacing } from '@/theme';

import type { PartialAnalysis, PartialAnalysisItem } from './protectionCopy';

export function PartialAnalysisNotice({
  partial,
  onViewPage,
  onReregister,
  testID = 'partial-analysis',
}: {
  partial: PartialAnalysis;
  onViewPage: (item: PartialAnalysisItem) => void;
  onReregister?: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.card} testID={testID} accessibilityRole="alert">
      <View style={styles.head}>
        <Ionicons name="alert-circle" size={22} color={colors.check} />
        <AppText variant="bodyStrong" style={{ flex: 1 }} testID={`${testID}-title`}>
          {partial.title}
        </AppText>
      </View>
      {partial.items.map((x) => (
        <AppText key={`${x.docIndex}-${x.page}`} variant="body2" color="textSecondary" style={{ marginTop: spacing.sm }} testID={`${testID}-item-${x.docIndex}-${x.page}`}>
          {x.message}
        </AppText>
      ))}
      <View style={styles.actions}>
        {partial.items.map((x) => (
          <Button
            key={`view-${x.docIndex}-${x.page}`}
            label={partial.items.length > 1 ? `${x.label} 보기` : '제외된 페이지 보기'}
            size="sm"
            variant="secondary"
            onPress={() => onViewPage(x)}
            testID={`${testID}-view-${x.docIndex}-${x.page}`}
          />
        ))}
        {onReregister ? <Button label="문서 다시 등록" size="sm" variant="secondary" onPress={onReregister} testID={`${testID}-reregister`} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.check,
    backgroundColor: colors.bgSubtle,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
});
