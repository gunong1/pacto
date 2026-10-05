import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { LogoHorizontal } from '@/components/brand/Logo';
import { Amount, ContractLine, DDay } from '@/components/pacto';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { EmptyState, Screen, Section, SectionGap } from '@/components/ui/layout';
import { actionItems, statusSummary, upcomingEnds } from '@/domain/actions';
import { formatMonthDayKo, yearMonthOf } from '@/domain/dates';
import { CATEGORY_LABEL } from '@/domain/labels';
import { formatKRW } from '@/domain/money';
import { annualForecast, monthlyAverage, monthSpending } from '@/domain/spending';
import { useContracts, useToday } from '@/features/contracts/queries';
import { colors, hitSlop, radius, spacing } from '@/theme';

/**
 * 홈 — "지금 알아야 할 계약 정보" 우선.
 * 순서: 이번 달 실제 지출 → 지금 처리할 계약 → 곧 종료/갱신 → 상태 요약 → 최근 등록 → (보조) 확인이 필요한 조항
 */
export default function HomeScreen() {
  const today = useToday();
  const { data: records, isLoading } = useContracts();

  const view = useMemo(() => {
    if (!records) return null;
    const ym = yearMonthOf(today);
    const spending = monthSpending(records, ym);
    const actions = actionItems(records, today);
    const endingIds = new Set(actions.filter((a) => a.kind === 'contract_end' || a.kind === 'renewal').map((a) => a.contractId));
    const ends = upcomingEnds(records, today, endingIds).slice(0, 4);
    const recent = [...records].sort((a, b) => b.contract.createdAt.localeCompare(a.contract.createdAt)).slice(0, 3);
    const openChecks = records.flatMap((r) => r.aiChecks.filter((c) => c.status === 'new' && c.severity !== 'info').map((c) => ({ c, r })));
    return {
      ym,
      spending,
      annual: annualForecast(records, today),
      average: monthlyAverage(records, today),
      actions: actions.slice(0, 5),
      actionContracts: new Set(actions.map((a) => a.contractId)).size,
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

      {/* 1. 이번 달 실제 계약 지출 */}
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

      {/* 2. 지금 처리해야 할 계약 */}
      <Section
        title={view.actionContracts > 0 ? `확인할 계약 ${view.actionContracts}건` : '지금 처리할 계약'}
        caption="30일 이내 해지 통보기한 · 만료 · 갱신 · 내 일정"
        testID="home-actions">
        {view.actions.length === 0 ? (
          <AppText variant="body2" color="textTertiary">
            30일 안에 처리할 계약이 없어요.
          </AppText>
        ) : (
          view.actions.map((a) => (
            <ContractLine
              key={a.key}
              category={a.category}
              title={a.contractTitle}
              subtitle={`${a.label} · ${formatMonthDayKo(a.date)}`}
              right={<DDay days={a.days} />}
              onPress={() => router.push(`/contract/${a.contractId}`)}
            />
          ))
        )}
      </Section>

      <SectionGap />

      {/* 3. 곧 종료/갱신되는 계약 */}
      <Section title="곧 종료·갱신되는 계약" caption="180일 이내" testID="home-ends">
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
              subtitle={`${e.autoRenewal ? '자동갱신' : '만료'} · ${formatMonthDayKo(e.date)}`}
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
  hero: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  breakdown: { marginTop: spacing.xl, gap: 6 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between' },
  subMetrics: { flexDirection: 'row', marginTop: spacing.xl, backgroundColor: colors.bgSubtle, borderRadius: radius.lg, paddingVertical: spacing.md },
  metric: { flex: 1, alignItems: 'center', gap: 2 },
  metricDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  summary: { flexDirection: 'row' },
  summaryItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, gap: 2 },
  checkLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.gutter, marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSubtle },
});
