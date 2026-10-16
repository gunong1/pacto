import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { LogoHorizontal } from "@/components/brand/Logo";
import { AppText } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import {
  EmptyState,
  Screen,
  Section,
  SectionGap,
} from "@/components/ui/layout";
import { statusSummary } from "@/domain/actions";
import { formatDateKo, formatMonthDayKo, yearMonthOf } from "@/domain/dates";
import { formatKRW, formatWonCompact } from "@/domain/money";
import { flowCard, upcomingSchedule, upcomingTone, type FlowCard, type UpcomingTone } from "@/domain/homeView";
import { formatDDay } from "@/domain/dday";
import { likelyDuplicateGroups } from "@/domain/duplicates";
import { monthSpending, type ContractFlowLine } from "@/domain/spending";
import { useContracts, useToday } from "@/features/contracts/queries";
import { DuplicateNotice } from "@/features/contracts/DuplicateNotice";
import { RoleConfirmCard } from "@/features/contracts/RoleConfirmCard";
import { colors, hitSlop, radius, spacing } from "@/theme";

/**
 * 홈 — 계약 관리 중심 대시보드.
 * 순서: 내 계약 현황(상태 3칸) → 다가오는 일정(최대 3개) → 이번 달 계약 금액(출금·입금 카드, 계약별 금액) → (보조) 확인이 필요한 조항
 * 계산은 모두 기존 함수 그대로 — statusSummary · scheduleForRange(캘린더와 같은 일정) · monthSpending (domain/homeView.ts는 고르고 묶기만)
 */
export default function HomeScreen() {
  const today = useToday();
  const { data: records, isLoading, isError, refetch } = useContracts();

  const view = useMemo(() => {
    if (!records) return null;
    const ym = yearMonthOf(today);
    const spending = monthSpending(records, ym, today);
    const openChecks = records.flatMap((r) =>
      r.aiChecks
        .filter((c) => c.status === "new" && c.severity !== "info")
        .map((c) => ({ c, r })),
    );
    // 입금 중 예상 금액이 모두 근로계약에서 나온 경우만 "근로소득" 안내 (그 외 변동 입금은 일반 예상 안내)
    const estimatedIncome = spending.incomeItems.filter((i) => i.estimated);
    return {
      ym,
      spending,
      outCard: flowCard(spending.items),
      inCard: flowCard(spending.incomeItems),
      estimatedFromWork: estimatedIncome.length > 0 && estimatedIncome.every((i) => i.category === "employment"),
      upcoming: upcomingSchedule(records, today, 3),
      duplicates: likelyDuplicateGroups(records),
      summary: statusSummary(records, today),
      openChecks,
    };
  }, [records, today]);

  if (isLoading) {
    return (
      <Screen scroll={false}>
        <ActivityIndicator style={{ marginTop: 120 }} color={colors.primary} />
      </Screen>
    );
  }

  // 불러오지 못함 — 계약·일정이 없는 것처럼 보이지 않게
  if (isError || !view) {
    return (
      <Screen>
        <View style={styles.topBar}>
          <LogoHorizontal height={24} />
        </View>
        <View style={{ padding: spacing.gutter }} testID="home-error">
          <EmptyState
            title="계약 정보를 불러오지 못했어요"
            description="네트워크 연결을 확인한 뒤 다시 시도해주세요."
            action={<Button label="다시 시도" size="md" onPress={() => refetch()} />}
          />
        </View>
      </Screen>
    );
  }

  if (records && records.length === 0) return <FirstRunHome />;

  const { summary, spending } = view;
  return (
    <Screen>
      <View style={styles.topBar}>
        <LogoHorizontal height={24} />
        <Pressable
          onPress={() => router.push("/notifications")}
          hitSlop={hitSlop}
          accessibilityLabel="알림"
          testID="open-notifications"
        >
          <Ionicons
            name="notifications-outline"
            size={24}
            color={colors.text}
          />
        </Pressable>
      </View>

      {/* 1. 내 계약 현황 — 상태 계산은 기존 statusSummary 그대로 */}
      <View style={styles.block} testID="home-summary">
        <AppText variant="caption" color="textSecondary">
          내 계약 현황
        </AppText>
        <AppText variant="title2" style={{ marginTop: 2 }} testID="home-managed">
          {summary.live > 0 ? `${summary.live}개의 계약을 관리 중이에요` : "진행 중인 계약이 없어요"}
        </AppText>
        {summary.live === 0 && summary.closed > 0 ? (
          <AppText variant="caption" color="textTertiary" style={{ marginTop: 2 }}>
            종료된 계약 {summary.closed}개는 계약 목록에서 볼 수 있어요
          </AppText>
        ) : null}
        <View style={styles.statusRow}>
          {[
            { label: "진행 중", value: summary.live, status: "live" },
            { label: "종료 예정", value: summary.endingSoon, status: "ending_soon" },
            { label: "갱신 예정", value: summary.renewalDue, status: "renewal_due" },
          ].map((s) => (
            <Pressable
              key={s.status}
              style={({ pressed }) => [styles.statusCard, pressed && { backgroundColor: colors.bgPressed }]}
              accessibilityRole="button"
              accessibilityLabel={`${s.label} ${s.value}개`}
              testID={`home-status-${s.status}`}
              onPress={() =>
                router.push({
                  pathname: "/contracts",
                  params: { status: s.status, t: String(Date.now()) },
                })
              }
            >
              <AppText variant="title2" tabular>
                {s.value}
              </AppText>
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                {s.label}
              </AppText>
            </Pressable>
          ))}
        </View>
      </View>

      <SectionGap />

      {/* 2. 다가오는 일정 — 캘린더와 같은 일정·묶음 (지급일 휴일 규칙 반영된 날짜 그대로) */}
      <Section
        title="다가오는 일정"
        action={{ label: "전체 보기 ›", onPress: () => router.push("/calendar") }}
        testID="home-upcoming"
      >
        {view.upcoming.length === 0 ? (
          <AppText variant="body2" color="textTertiary" style={{ paddingVertical: spacing.sm }} testID="home-upcoming-empty">
            다가오는 계약 일정이 없어요.
          </AppText>
        ) : (
          view.upcoming.map((u, i) => (
            <Pressable
              key={u.key}
              onPress={() => router.push(`/contract/${u.contractId}`)}
              accessibilityRole="button"
              testID={`home-upcoming-${i}`}
              style={({ pressed }) => [styles.upRow, i > 0 && styles.divider, pressed && { opacity: 0.6 }]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {u.contractTitle}
                </AppText>
                <AppText variant="caption" color="textSecondary" numberOfLines={1} style={{ marginTop: 2 }}>
                  {u.label} · {u.date.slice(0, 4) === today.slice(0, 4) ? formatMonthDayKo(u.date) : formatDateKo(u.date)}
                </AppText>
              </View>
              {/* 빨강 = 7일 안에 확인할 계약 관리 일정 · 남색 = 30일 안 · 결제·입금 등 금융 일정은 기본 글자색 */}
              <AppText
                variant="body2Strong"
                tabular
                color={UPCOMING_TONE_COLOR[upcomingTone(u)]}
                accessibilityLabel={`${formatDDay(u.days)}${upcomingTone(u) === 'soon' ? ', 확인할 시점이 가까워요' : ''}`}
                testID={`home-upcoming-${i}-dday`}
              >
                {formatDDay(u.days)}
              </AppText>
            </Pressable>
          ))
        )}
      </Section>

      <SectionGap />

      {/* 3. 이번 달 계약 금액 — 총액·계약별 줄 모두 monthSpending 같은 항목에서 (줄의 합 = 총액) */}
      <Section
        title={`${view.ym.month}월 계약 금액`}
        action={{ label: "상세 보기 ›", onPress: () => router.push("/calendar") }}
        testID="home-money"
      >
        <FlowCardView
          kind="out"
          card={view.outCard}
          note={spending.hasEstimated ? "변동 금액은 예상치예요" : null}
          testID="home-spending"
        />
        <View style={{ height: spacing.md }} />
        <FlowCardView
          kind="in"
          card={view.inCard}
          note={
            spending.incomeEstimated > 0
              ? view.estimatedFromWork
                ? "세전 추정 근로소득이 포함되어 있어요. 실제 수령액과 다를 수 있습니다."
                : "예상 금액이 포함되어 있어요. 실제 금액과 다를 수 있습니다."
              : null
          }
          testID="home-income"
        />

        {/* 확인이 필요한 금액 — 합계에 넣지 않았거나 자동 판단인 금액은 짧게 알리고 바로 확인 */}
        <DuplicateNotice groups={view.duplicates} records={records!} />
        {spending.autoExpense + spending.autoIncome > 0 ? (
          <View style={{ marginTop: spacing.md }} testID="home-auto">
            <AppText variant="caption" color="textSecondary">
              {spending.autoExpense > 0 ? `출금 중 ${formatWonCompact(spending.autoExpense)}` : ''}
              {spending.autoExpense > 0 && spending.autoIncome > 0 ? ' · ' : ''}
              {spending.autoIncome > 0 ? `입금 중 ${formatWonCompact(spending.autoIncome)}` : ''}은 이전 분석이 자동으로 정한 금액이에요. 내 역할을 확인하면 확정돼요.
            </AppText>
            {[...new Set([...spending.items, ...spending.incomeItems].filter((i) => i.auto).map((i) => i.contractId))].slice(0, 3).map((cid) => {
              const record = records!.find((r) => r.contract.id === cid);
              const amount = [...spending.items, ...spending.incomeItems].filter((i) => i.auto && i.contractId === cid).reduce((s, i) => s + i.amount, 0);
              return record ? <RoleConfirmCard key={cid} record={record} amount={amount} mode="auto" /> : null;
            })}
          </View>
        ) : null}
        {spending.undeterminedTotal > 0 ? (
          <View style={{ marginTop: spacing.md }} testID="home-undetermined">
            <AppText variant="caption" color="caution">
              계약 금액 {formatWonCompact(spending.undeterminedTotal)}의 입출금 방향을 확인해주세요. 확인 전에는 합계에 넣지 않았어요.
            </AppText>
            {[...new Set(spending.undetermined.map((i) => i.contractId))].slice(0, 3).map((cid) => {
              const record = records!.find((r) => r.contract.id === cid);
              const amount = spending.undetermined.filter((i) => i.contractId === cid).reduce((s, i) => s + i.amount, 0);
              return record ? <RoleConfirmCard key={cid} record={record} amount={amount} /> : null;
            })}
          </View>
        ) : null}
      </Section>

      {/* (보조) 확인이 필요한 조항 */}
      {view.openChecks.length > 0 ? (
        <Pressable
          style={({ pressed }) => [
            styles.checkLink,
            pressed && { opacity: 0.6 },
          ]}
          onPress={() =>
            router.push(`/contract/${view.openChecks[0].r.contract.id}`)
          }
          testID="home-checks"
        >
          <Ionicons
            name="document-text-outline"
            size={18}
            color={colors.textSecondary}
          />
          <AppText variant="body2" color="textSecondary" style={{ flex: 1 }} numberOfLines={1}>
            확인이 필요한 조항 {view.openChecks.length}건 ·{" "}
            {view.openChecks[0].r.contract.title}
          </AppText>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.textDisabled}
          />
        </Pressable>
      ) : null}
    </Screen>
  );
}

const UPCOMING_TONE_COLOR: Record<UpcomingTone, "caution" | "primary" | "text"> = { soon: "caution", near: "primary", plain: "text" };

const NATURE_NOTE: Record<ContractFlowLine["nature"], string | null> = { ordinary: null, deposit: "보증금", principal: "원금 상환" };

/** 출금·입금 카드 — 총액 + 계약별 금액 (최대 3줄, 나머지는 "외 N건"으로 펼치기) */
function FlowCardView({ kind, card, note, testID }: { kind: "out" | "in"; card: FlowCard; note: string | null; testID: string }) {
  const [open, setOpen] = useState(false);
  const income = kind === "in";
  const lines = open ? card.lines : card.shown;
  return (
    <View style={styles.moneyCard} testID={testID}>
      <View style={styles.moneyHead}>
        <Ionicons name={income ? "arrow-down-circle" : "arrow-up-circle"} size={16} color={income ? colors.positive : colors.primary} />
        <AppText variant="captionStrong" color="textSecondary">
          {income ? "입금 예정" : "출금 예정"}
        </AppText>
      </View>
      <AppText
        variant="title1"
        tabular
        numberOfLines={1}
        adjustsFontSizeToFit
        color={income && card.total > 0 ? "positive" : "text"}
        style={{ marginTop: 4 }}
        testID={`${testID === "home-spending" ? "home-spending" : "home-income"}-total`}
      >
        {income && card.total > 0 ? "+" : ""}
        {formatKRW(card.total)}
      </AppText>
      {card.lines.length === 0 ? (
        <AppText variant="caption" color="textTertiary" style={{ marginTop: 4 }}>
          이번 달 {income ? "입금" : "출금"} 예정이 없어요
        </AppText>
      ) : (
        <View style={styles.moneyLines} testID={`${testID}-lines`}>
          {lines.map((l, i) => {
            const sub = [l.kindLabel, NATURE_NOTE[l.nature], l.estimated ? "예상" : null].filter(Boolean).join(" · ");
            return (
              <View key={l.key} style={styles.moneyLine} testID={`${testID}-line-${i}`}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText variant="body2Strong" numberOfLines={1}>
                    {l.contractTitle}
                  </AppText>
                  <AppText variant="small" color="textTertiary" numberOfLines={1}>
                    {sub}
                  </AppText>
                </View>
                <AppText variant="body2Strong" tabular numberOfLines={1} style={{ flexShrink: 0 }}>
                  {formatKRW(l.amount)}
                </AppText>
              </View>
            );
          })}
          {card.rest.count > 0 ? (
            <Pressable
              onPress={() => setOpen((o) => !o)}
              accessibilityRole="button"
              hitSlop={hitSlop}
              style={styles.more}
              testID={`${testID}-more`}
            >
              <AppText variant="caption" color="textSecondary">
                {open ? "접기" : `외 ${card.rest.count}건 · ${formatKRW(card.rest.amount)} 더 보기`}
              </AppText>
              <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>
      )}
      {note ? (
        <AppText variant="small" color="textTertiary" style={{ marginTop: spacing.sm }} testID={`${testID}-note`}>
          {note}
        </AppText>
      ) : null}
    </View>
  );
}

/** 계약이 하나도 없을 때: 숫자 0 대신 PACTO가 무엇을 기억해주는지 보여주고 첫 등록으로 안내 */
function FirstRunHome() {
  return (
    <Screen>
      <View style={styles.topBar}>
        <LogoHorizontal height={24} />
      </View>
      <View style={styles.firstRun} testID="home-first-run">
        <AppText variant="title1">첫 계약서를{"\n"}넣어보세요</AppText>
        <AppText
          variant="body"
          color="textSecondary"
          style={{ marginTop: spacing.sm }}
        >
          계약서를 올리면 PACTO가 중요한 날짜와 금액, 조건을 알아서
          정리해드려요.
        </AppText>
        <View style={styles.remembers}>
          {[
            ["calendar-outline", "중요한 날짜와 금액을 한눈에"],
            ["alarm-outline", "만료·갱신·해지기한을 놓치지 않게"],
            ["document-text-outline", "계약서 원본도 안전하게 보관"],
          ].map(([icon, text]) => (
            <View key={text} style={styles.remember}>
              <Ionicons
                name={icon as keyof typeof Ionicons.glyphMap}
                size={20}
                color={colors.primary}
              />
              <AppText variant="body2" color="textSecondary">
                {text}
              </AppText>
            </View>
          ))}
        </View>
        <Button
          label="계약 등록하기"
          onPress={() => router.push("/register")}
          testID="first-run-register"
        />
        <AppText
          variant="caption"
          color="textTertiary"
          align="center"
          style={{ marginTop: spacing.md }}
        >
          PDF·사진으로 올리거나 직접 입력할 수 있어요
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  firstRun: {
    margin: spacing.gutter,
    marginTop: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.primarySoft,
  },
  remembers: { gap: spacing.md, marginVertical: spacing.xl },
  remember: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    height: 48,
  },
  block: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  statusRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  statusCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSubtle,
    gap: 2,
  },
  upRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  moneyCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  moneyHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  moneyLines: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  moneyLine: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  more: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingVertical: 2 },
  checkLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.gutter,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSubtle,
  },
});
