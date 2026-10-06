import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewProps, type ViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, hitSlop, spacing } from '@/theme';

import { AppText } from './AppText';

/** 기본 스크롤 화면. 탭 화면은 상단 SafeArea만, 스택 화면은 헤더가 처리. */
export function Screen({
  children,
  edges = ['top'],
  scroll = true,
  footer,
  ...rest
}: ScrollViewProps & { edges?: Edge[]; scroll?: boolean; footer?: React.ReactNode }) {
  return (
    <SafeAreaView edges={edges} style={styles.safe}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" {...rest}>
          {children}
        </ScrollView>
      ) : (
        <View style={styles.flex}>{children}</View>
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

/** 제목 + 내용 묶음. 카드 대신 여백과 구분 배경으로 구획을 나눈다. */
export function Section({
  title,
  caption,
  action,
  children,
  style,
  testID,
}: ViewProps & { title?: string; caption?: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={[styles.section, style]} testID={testID}>
      {title ? (
        <View style={styles.sectionHeader}>
          <View style={styles.flex}>
            <AppText variant="title3">{title}</AppText>
            {caption ? (
              <AppText variant="caption" color="textTertiary" style={{ marginTop: 2 }}>
                {caption}
              </AppText>
            ) : null}
          </View>
          {action ? (
            <Pressable onPress={action.onPress} hitSlop={hitSlop} accessibilityRole="button">
              <AppText variant="caption" color="textTertiary">
                {action.label}
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** 섹션 사이 굵은 구분 (금융앱식 그룹 구분) */
export function SectionGap() {
  return <View style={styles.gap} />;
}

export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

export interface ListRowProps {
  title: string;
  subtitle?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  testID?: string;
}

export function ListRow({ title, subtitle, left, right, onPress, chevron, testID }: ListRowProps) {
  const body = (
    <View style={styles.row}>
      {left}
      <View style={styles.flex}>
        <AppText variant="body2Strong" numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color="textTertiary" numberOfLines={1} style={{ marginTop: 2 }}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} /> : null}
    </View>
  );
  if (!onPress) return <View testID={testID}>{body}</View>;
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
      {body}
    </Pressable>
  );
}

export function KeyValueRow({ label, value, emphasis, badge, testID }: { label: string; value: React.ReactNode; emphasis?: boolean; badge?: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.kv} testID={testID}>
      <View style={styles.kvLabel}>
        <AppText variant="body2" color="textTertiary">
          {label}
        </AppText>
        {badge ? <View style={{ marginTop: 4, alignSelf: 'flex-start' }}>{badge}</View> : null}
      </View>
      {typeof value === 'string' ? (
        <AppText variant={emphasis ? 'body2Strong' : 'body2'} tabular align="right" style={styles.kvValue}>
          {value}
        </AppText>
      ) : (
        value
      )}
    </View>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <AppText variant="body2Strong" color="textSecondary" align="center">
        {title}
      </AppText>
      {description ? (
        <AppText variant="caption" color="textTertiary" align="center" style={{ marginTop: spacing.xs }}>
          {description}
        </AppText>
      ) : null}
      {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingBottom: spacing.xxxl * 2 },
  footer: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md, paddingBottom: spacing.md, backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  section: { paddingHorizontal: spacing.gutter, paddingVertical: spacing.xl },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: spacing.md, gap: spacing.md },
  gap: { height: 10, backgroundColor: colors.bgSubtle },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, minHeight: 56 },
  pressed: { opacity: 0.6 },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, gap: spacing.lg },
  kvLabel: { flexShrink: 0, maxWidth: '45%' },
  kvValue: { flexShrink: 1 },
  empty: { paddingVertical: spacing.xxxl, alignItems: 'center', paddingHorizontal: spacing.gutter },
});
