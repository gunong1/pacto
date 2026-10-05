import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { ContractLine, DDay, StatusBadge } from '@/components/pacto';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { ChipGroup } from '@/components/ui/controls';
import { EmptyState, Screen } from '@/components/ui/layout';
import { daysUntil } from '@/domain/dday';
import { CATEGORY_LABEL } from '@/domain/labels';
import { formatWon } from '@/domain/money';
import { nextPayment } from '@/domain/schedule';
import { contractMonthlyEquivalent } from '@/domain/spending';
import { currentTerm, deriveStatus } from '@/domain/status';
import { CONTRACT_CATEGORIES, type ContractCategory, type ContractStatus } from '@/domain/types';
import { useContracts, useToday } from '@/features/contracts/queries';
import { colors, radius, spacing, typography } from '@/theme';

type StatusFilter = 'all' | 'live' | 'ending_soon' | 'renewal_due' | 'closed';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'live', label: '진행중' },
  { value: 'ending_soon', label: '종료 임박' },
  { value: 'renewal_due', label: '갱신 예정' },
  { value: 'closed', label: '종료·해지' },
];

function matches(filter: StatusFilter, s: ContractStatus) {
  switch (filter) {
    case 'all':
      return true;
    case 'live':
      return s === 'active' || s === 'ending_soon' || s === 'renewal_due';
    case 'closed':
      return s === 'ended' || s === 'cancelled';
    default:
      return s === filter;
  }
}

export default function ContractsScreen() {
  const today = useToday();
  // 홈 상태 요약에서 진입: ?status=...&t=<nonce> (같은 필터로 다시 들어와도 적용되도록 nonce 사용)
  const params = useLocalSearchParams<{ status?: StatusFilter; t?: string }>();
  const { data: records, isLoading } = useContracts();
  const [status, setStatus] = useState<StatusFilter>(params.status ?? 'all');
  const [category, setCategory] = useState<ContractCategory | 'all'>('all');
  const [query, setQuery] = useState('');

  const [appliedNonce, setAppliedNonce] = useState(params.t);
  if (params.t !== appliedNonce) {
    setAppliedNonce(params.t);
    if (params.status) setStatus(params.status);
  }

  const rows = useMemo(() => {
    if (!records) return [];
    const q = query.trim().toLowerCase();
    return records
      .map((r) => {
        const s = deriveStatus(r.contract, today);
        const term = currentTerm(r.contract, today);
        return { r, status: s, days: term ? daysUntil(term.termEnd, today) : null, next: nextPayment(r, today), monthly: contractMonthlyEquivalent(r) };
      })
      .filter((x) => matches(status, x.status))
      .filter((x) => category === 'all' || x.r.contract.category === category)
      .filter((x) => !q || `${x.r.contract.title} ${x.r.contract.counterparty ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const closedA = a.status === 'ended' || a.status === 'cancelled';
        const closedB = b.status === 'ended' || b.status === 'cancelled';
        if (closedA !== closedB) return closedA ? 1 : -1;
        return (a.days ?? 99999) - (b.days ?? 99999);
      });
  }, [records, today, status, category, query]);

  const usedCategories = useMemo(() => {
    const set = new Set(records?.map((r) => r.contract.category));
    return CONTRACT_CATEGORIES.filter((c) => set.has(c));
  }, [records]);

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="title1">계약</AppText>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="계약명, 상대방 검색"
            placeholderTextColor={colors.textDisabled}
            style={styles.searchInput}
            accessibilityLabel="계약 검색"
            testID="contracts-search"
          />
        </View>
        <ChipGroup options={STATUS_FILTERS} value={status} onChange={setStatus} scroll testIDPrefix="filter-status" />
        <View style={{ height: spacing.sm }} />
        <ChipGroup
          options={[{ value: 'all' as const, label: '모든 종류' }, ...usedCategories.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))]}
          value={category}
          onChange={setCategory}
          scroll
        />
      </View>

      <View style={styles.list} testID="contracts-list">
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={records?.length ? '조건에 맞는 계약이 없어요' : '아직 등록한 계약이 없어요'}
            action={records?.length ? undefined : <Button label="계약 등록하기" size="md" onPress={() => router.push('/register')} />}
          />
        ) : (
          rows.map(({ r, status: s, days, next, monthly }) => {
            const closed = s === 'ended' || s === 'cancelled';
            const sub = [
              r.contract.counterparty,
              next ? `다음 결제 ${Number(next.date.slice(5, 7))}/${Number(next.date.slice(8))}` : null,
              monthly > 0 ? `월 ${formatWon(monthly)}` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <ContractLine
                key={r.contract.id}
                testID={`contract-row-${r.contract.id}`}
                category={r.contract.category}
                title={r.contract.title}
                subtitle={sub}
                onPress={() => router.push(`/contract/${r.contract.id}`)}
                right={
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    {days != null && !closed ? <DDay days={days} variant="body2Strong" /> : null}
                    <StatusBadge status={s} />
                  </View>
                }
              />
            );
          })
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md, gap: spacing.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.bgSubtle, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44 },
  searchInput: { flex: 1, ...typography.body2, color: colors.text },
  list: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md },
});
