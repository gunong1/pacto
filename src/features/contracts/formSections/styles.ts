import { StyleSheet } from 'react-native';

import { colors, radius, spacing } from '@/theme';

/** 계약 폼 섹션 공용 스타일 */
export const styles = StyleSheet.create({
  directionLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  moreWrap: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  more: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  components: { marginTop: spacing.md, padding: spacing.md, gap: 4, borderRadius: radius.md, backgroundColor: colors.bgSubtle },
  componentRow: { flexDirection: 'row', alignItems: 'center' },
  row2: { flexDirection: 'row', gap: spacing.md },
  classToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, alignSelf: 'flex-start' },
  classBox: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSubtle, gap: spacing.xs },
  planLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  col: { flex: 1 },
  colNarrow: { width: 110 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 8 },
  suggestion: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSubtle, marginBottom: spacing.md },
  suggestionFlagged: { backgroundColor: colors.checkSoft },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  preview: { gap: 2 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
