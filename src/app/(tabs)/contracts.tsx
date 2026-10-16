import { Ionicons } from '@expo/vector-icons';
import { partySearchText, partySummary } from '@/domain/parties';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ContractLine, DDay, StatusBadge } from '@/components/pacto';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { ChipGroup } from '@/components/ui/controls';
import { EmptyState, Screen } from '@/components/ui/layout';
import { formatDateKo } from '@/domain/dates';
import { daysUntil } from '@/domain/dday';
import { CONTRACT_KINDS, kindDisplay } from '@/domain/contractKinds';
import { formatWon } from '@/domain/money';
import { nextPayment } from '@/domain/schedule';
import { contractMonthlyPayments } from '@/domain/spending';
import { currentTerm, deriveStatus } from '@/domain/status';
import type { ContractStatus } from '@/domain/types';
import { useContracts, useToday } from '@/features/contracts/queries';
import { colors, radius, spacing, typography } from '@/theme';

/** 계약 목록에서 D-day로 보여주는 만료까지 남은 날 (그보다 멀면 날짜로) */
const EXPIRY_DDAY_DAYS = 30;

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
  // MY 바로가기: docs=1 → 보관 문서(원본 계약서·사진·PDF 등)가 있는 계약만, docs=0 → 해제
  const params = useLocalSearchParams<{ status?: StatusFilter; docs?: string; t?: string }>();
  const { data: records, isLoading } = useContracts();
  // 기본은 진행중(종료 임박·갱신 예정 포함, 종료·해지 제외) — 홈 상태 칸에서 들어오면 그 필터 우선. 고른 필터는 탭을 떠나도 유지
  const [status, setStatus] = useState<StatusFilter>(params.status ?? 'live');
  /** 계약 종류 필터 (종류 이름 — 분류 개편 전 계약은 예전 이름) */
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [onlyDocs, setOnlyDocs] = useState(params.docs === '1');

  const [appliedNonce, setAppliedNonce] = useState(params.t);
  if (params.t !== appliedNonce) {
    setAppliedNonce(params.t);
    if (params.status) setStatus(params.status);
    if (params.docs != null) {
      setOnlyDocs(params.docs === '1');
      setCategory('all');
      setQuery('');
    }
  }

  const rows = useMemo(() => {
    if (!records) return [];
    const q = query.trim().toLowerCase();
    return records
      .map((r) => {
        const s = deriveStatus(r.contract, today);
        const term = currentTerm(r.contract, today);
        return { r, status: s, days: term ? daysUntil(term.termEnd, today) : null, end: term?.termEnd ?? null, next: nextPayment(r, today), monthly: contractMonthlyPayments(r, today) };
      })
      .filter((x) => matches(status, x.status))
      .filter((x) => category === 'all' || kindDisplay(x.r.contract).label === category)
      .filter((x) => !onlyDocs || x.r.documents.length > 0)
      .filter((x) => !q || `${x.r.contract.title} ${partySearchText(x.r.contract)}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const closedA = a.status === 'ended' || a.status === 'cancelled';
        const closedB = b.status === 'ended' || b.status === 'cancelled';
        if (closedA !== closedB) return closedA ? 1 : -1;
        return (a.days ?? 99999) - (b.days ?? 99999);
      });
  }, [records, today, status, category, query, onlyDocs]);

  const usedCategories = useMemo(() => {
    const set = new Set(records?.map((r) => kindDisplay(r.contract).label));
    // 계약 종류 순서대로, 그 뒤에 예전 분류 이름(예: 자동차)
    const order = CONTRACT_KINDS.map((k) => k.label);
    return [...set].sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)));
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
          options={[{ value: 'all', label: '모든 종류' }, ...usedCategories.map((c) => ({ value: c, label: c }))]}
          value={category}
          onChange={setCategory}
          scroll
        />
        {onlyDocs ? (
          <Pressable
            onPress={() => setOnlyDocs(false)}
            accessibilityRole="button"
            accessibilityLabel="보관 문서가 있는 계약만 보기 해제"
            testID="filter-docs-clear"
            style={({ pressed }) => [styles.docsFilter, pressed && { opacity: 0.7 }]}>
            <Ionicons name="document-text-outline" size={14} color={colors.primary} />
            <AppText variant="captionStrong" color="primary">
              보관 문서가 있는 계약만
            </AppText>
            <Ionicons name="close" size={14} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.list} testID="contracts-list">
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={records?.length ? (onlyDocs ? '보관 문서가 있는 계약이 없어요' : '조건에 맞는 계약이 없어요') : '아직 등록한 계약이 없어요'}
            action={records?.length ? undefined : <Button label="계약 등록하기" size="md" onPress={() => router.push('/register')} />}
          />
        ) : (
          rows.map(({ r, status: s, days, end, next, monthly }) => {
            const closed = s === 'ended' || s === 'cancelled';
            const sub = [
              partySummary(r.contract),
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
                    {/* 만료까지 30일 이내 = D-day, 31일 이상 = 만료 예정 날짜, 만료일 없음 = 표시 안 함 */}
                    {days != null && end && !closed ? (
                      days <= EXPIRY_DDAY_DAYS ? (
                        <DDay days={days} variant="body2Strong" />
                      ) : (
                        <AppText variant="caption" color="textSecondary" tabular testID={`contract-end-${r.contract.id}`}>
                          {formatDateKo(end)} 만료
                        </AppText>
                      )
                    ) : null}
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
  docsFilter: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 999, borderWidth: 1, borderColor: colors.primary },
  searchInput: { flex: 1, ...typography.body2, color: colors.text },
  list: { paddingHorizontal: spacing.gutter, paddingTop: spacing.md },
});
