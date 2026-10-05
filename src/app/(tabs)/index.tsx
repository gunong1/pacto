import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { LogoHorizontal } from '@/components/brand/Logo';
import { Amount, ContractLine, DDay } from '@/components/pacto';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { EmptyState, Screen, Section, SectionGap } from '@/components/ui/layout';
import { statusSummary, upcomingEnds } from '@/domain/actions';
import { formatMonthDayKo, yearMonthOf } from '@/domain/dates';
import { CATEGORY_LABEL } from '@/domain/labels';
import { formatKRW } from '@/domain/money';
import { attentionItems } from '@/domain/nextAction';
import { annualForecast, monthlyAverage, monthSpending } from '@/domain/spending';
import { useContracts, useToday } from '@/features/contracts/queries';
import { colors, hitSlop, radius, spacing } from '@/theme';

/**
 * 홈 — "내가 지금 확인하거나 처리해야 할 계약이 무엇인지 바로 알 수 있다."
 * 순서: 관리 중인 계약 수 → 지금 확인이 필요한 계약(강조) → 이번 달 실제 지출 → 곧 종료/갱신
 *       → 상태 요약 → 최근 등록 → (보조) 확인이 필요한 조항
 */
export default function HomeScreen() {
  const today = useToday();
  const { data: records, isLoading } = useContracts();

  const view = useMemo(() => {
    if (!records) return null;
    const ym = yearMonthOf(today);
    const spending = monthSpending(records, ym);
    const attention = attentionItems(records, today);
    const ends = upcomingEnds(records, today, new Set(attention.map((a) => a.contractId))).slice(0, 4);
    const recent = [...records].sort((a, b) => b.contract.createdAt.localeCompare(a.contract.createdAt)).slice(0, 3);
    const openChecks = records.flatMap((r) => r.aiChecks.filter((c) => c.status === 'new' && c.severity !== 'info').map((c) => ({ c, r })));
    return {
      ym,
      spending,
      annual: annualForecast(records, today),
      average: monthlyAverage(records, today),
      attention,
      ends,
      summary: statusSummary(records, today),
      recent,
      openChecks,
    };
  }, [records, today]);

  if (isLoading || !view) {
    return (
      <Screen scroll={false}>
        <ActivityIndicator style={{ marginTop: 120 }} color={colors.primary} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.topBar}>
        <LogoHorizontal height={24} />
        <Pressable onPress={() => router.push('/notifications')} hitSlop={hitSlop} accessibilityLabel="알림" testID="open-notifications">
          <Ionicons name="notifications-outline" size={24} color={colors.text} />
        </Pressable>
      </View>

      {/* 0. 계약 지갑 정체성 */}
      <Pressable style={styles.wallet} onPress={() => router.push('/contracts')} accessibilityRole="button" testID="home-managed">
        <AppText variant="body2" color="textSecondary">
          내 계약 <AppText variant="body2Strong" color="primary" tabular>{view.summary.live}개</AppText>를 PACTO가 관리하고 있어요
        </AppText>
        <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
      </Pressable>

      {/* 1. 지금 확인이 필요한 계약 — 홈의 최우선 영역 */}
      <View style={styles.attention} testID="home-actions">
        <View style={styles.attentionHead}>
          <Ionicons name="alarm-outline" size={18} color={colors.primary} />
          <AppText variant="title3" color="primary" style={{ flex: 1 }}>
            {view.attention.length > 0 ? `지금 확인이 필요한 계약 ${view.attention.length}건` : '지금 확인이 필요한 계약'}
          </AppText>
        </View>
        {view.attention.length === 0 ? (
          <AppText variant="body2" color="textSecondary" style={{ marginTop: spacing.sm }}>
            30일 안에 챙길 계약 일정이 없어요. PACTO가 계속 지켜볼게요.
          </AppText>
        ) : (
          <View style={styles.attentionList}>
            {view.attention.slice(0, 4).map((a, i) => (
              <Pressable
                key={`${a.contractId}:${a.key}`}
                onPress={() => router.push(`/contract/${a.contractId}`)}
                accessibilityRole="button"
                testID={`attention-${a.contractId}`}
                style={({ pressed }) => [styles.attentionRow, i > 0 && styles.attentionDivider, pressed && { opacity: 0.6 }]}>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {a.contractTitle}
                  </AppText>
                  <AppText variant="caption" color="textSecondary" numberOfLines={1} style={{ marginTop: 2 }}>
                    {a.label} · {formatMonthDayKo(a.date)}
                  </AppText>
                </View>
                <DDay days={a.days} variant="title2" />
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* 2. 이번 달 실제 계약 지출 */}
      <View style={styles.hero} testID="home-spending">
        <AppText variant="body2" color="textSecondary">
          {view.ym.month}월 계약 지출
        </AppText>
        <AppText variant="display" tabular style={{ marginTop: 4 }} testID="home-spending-total">
          {formatKRW(view.spending.total)}
        </AppText>
        {view.spending.hasEstimated ? (
          <AppText variant="caption" color="textTertiary" style={{ marginTop: 2 }}>
            통신비 등 변동 금액은 예상치예요
          </AppText>
        ) : null}

        {view.spending.byCategory.length > 0 ? (
          <View style={styles.breakdown}>
            {view.spending.byCategory.map((c) => (
              <View key={c.category} style={styles.breakdownRow}>
                <AppText variant="body2" color="textSecondary">
                  {CATEGORY_LABEL[c.category]}
                </AppText>
                <Amount value={c.amount} variant="body2" />
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.subMetrics}>
          <View style={styles.metric}>
            <AppText variant="caption" color="textTertiary">
              월평균 계약비
            </AppText>
            <Amount value={view.average} variant="body2Strong" />
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metric}>
            <AppText variant="caption" color="textTertiary">
              연간 예상 (12개월)
            </AppText>
            <Amount value={view.annual} variant="body2Strong" />
          </View>
        </View>
      </View>

      <SectionGap />

      {/* 3. 곧 종료/갱신되는 계약 */}
      <Section title="곧 종료·갱신되는 계약" caption="180일 이내 · 해지 통보기한 포함" testID="home-ends">
        {view.ends.length === 0 ? (
          <AppText variant="body2" color="textTertiary">
            곧 끝나는 계약이 없어요.
          </AppText>
        ) : (
          view.ends.map((e) => (
            <ContractLine
              key={e.contractId}
              category={e.category}
              title={e.contractTitle}
              subtitle={`${e.autoRenewal ? '자동갱신' : '만료'} ${formatMonthDayKo(e.date)}${e.noticeDate ? ` · 해지 통보 ${formatMonthDayKo(e.noticeDate)}까지` : ''}`}
              right={<DDay days={e.days} variant="body2Strong" />}
              onPress={() => router.push(`/contract/${e.contractId}`)}
            />
          ))
        )}
      </Section>

      <SectionGap />

      {/* 4. 계약 상태 요약 */}
      <Section title="내 계약" testID="home-summary">
        <View style={styles.summary}>
          {[
            { label: '진행중', value: view.summary.live, status: 'live' },
            { label: '종료 예정', value: view.summary.endingSoon, status: 'ending_soon' },
            { label: '갱신 예정', value: view.summary.renewalDue, status: 'renewal_due' },
          ].map((s) => (
            <Pressable
              key={s.status}
              style={styles.summaryItem}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/contracts', params: { status: s.status, t: String(Date.now()) } })}>
              <AppText variant="title2" tabular>
                {s.value}
              </AppText>
              <AppText variant="caption" color="textTertiary">
                {s.label}
              </AppText>
            </Pressable>
          ))}
        </View>
      </Section>

      <SectionGap />

      {/* 5. 최근 등록 계약 */}
      <Section title="최근 등록" action={{ label: '전체 보기', onPress: () => router.push('/contracts') }} testID="home-recent">
        {view.recent.length === 0 ? (
          <EmptyState
            title="아직 등록한 계약이 없어요"
            description="계약서를 넣어두면 결제일과 만료일을 대신 기억해드려요."
            action={<Button label="계약 등록하기" size="md" onPress={() => router.push('/register')} />}
          />
        ) : (
          view.recent.map(({ contract }) => (
            <ContractLine
              key={contract.id}
              category={contract.category}
              title={contract.title}
              subtitle={[contract.counterparty, CATEGORY_LABEL[contract.category]].filter(Boolean).join(' · ')}
              onPress={() => router.push(`/contract/${contract.id}`)}
              testID={`recent-${contract.id}`}
            />
          ))
        )}
      </Section>

      {/* 6. (보조) 확인이 필요한 조항 */}
      {view.openChecks.length > 0 ? (
        <Pressable
          style={({ pressed }) => [styles.checkLink, pressed && { opacity: 0.6 }]}
          onPress={() => router.push(`/contract/${view.openChecks[0].r.contract.id}`)}
          testID="home-checks">
          <Ionicons name="document-text-outline" size={18} color={colors.textSecondary} />
          <AppText variant="body2" color="textSecondary" style={{ flex: 1 }}>
            확인이 필요한 조항 {view.openChecks.length}건 · {view.openChecks[0].r.contract.title}
          </AppText>
          <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} />
        </Pressable>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.gutter, paddingTop: spacing.sm, paddingBottom: spacing.xs, height: 48 },
  wallet: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.gutter, paddingTop: spacing.sm },
  attention: { marginHorizontal: spacing.gutter, marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.primarySoft },
  attentionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  attentionList: { marginTop: spacing.sm },
  attentionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  attentionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D5DDEA' },
  hero: { paddingHorizontal: spacing.gutter, paddingTop: spacing.xxl, paddingBottom: spacing.xxl },
  breakdown: { marginTop: spacing.xl, gap: 6 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between' },
  subMetrics: { flexDirection: 'row', marginTop: spacing.xl, backgroundColor: colors.bgSubtle, borderRadius: radius.lg, paddingVertical: spacing.md },
  metric: { flex: 1, alignItems: 'center', gap: 2 },
  metricDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  summary: { flexDirection: 'row' },
  summaryItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, gap: 2 },
  checkLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.gutter, marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSubtle },
});
