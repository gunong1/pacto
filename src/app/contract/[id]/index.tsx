import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Amount, CategoryIcon, DDay, EVENT_COLOR, SeverityLabel, StatusBadge } from '@/components/pacto';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { SwitchRow } from '@/components/ui/controls';
import { Divider, EmptyState, KeyValueRow, Screen, Section, SectionGap } from '@/components/ui/layout';
import { AI_DISCLAIMER } from '@/domain/aiCopy';
import { addMonths, formatDateKo } from '@/domain/dates';
import { daysUntil } from '@/domain/dday';
import { CATEGORY_LABEL, EVENT_TYPE_LABEL, FREQUENCY_LABEL } from '@/domain/labels';
import { formatWon, formatWonCompact } from '@/domain/money';
import { contractSchedule, nextPayment } from '@/domain/schedule';
import { contractMonthlyEquivalent } from '@/domain/spending';
import { currentTerm, deriveStatus, terminationNoticeDeadline } from '@/domain/status';
import type { AiCheck, ContractPayment, ContractRecord } from '@/domain/types';
import { useContract, useContractActions, useToday } from '@/features/contracts/queries';
import { confirm, notify } from '@/lib/dialog';
import { colors, hitSlop, radius, spacing } from '@/theme';

function paymentRule(p: ContractPayment) {
  if (p.frequency === 'one_time') return '일시불';
  const day = p.dayOfMonth ? `${p.dayOfMonth}일` : '';
  if (p.frequency === 'yearly' && p.monthOfYear) return `매년 ${p.monthOfYear}월 ${day}`;
  return `${FREQUENCY_LABEL[p.frequency]} ${day}`.trim();
}

export default function ContractDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = useToday();
  const { data: record, isLoading } = useContract(id);
  const actions = useContractActions(id);

  const view = useMemo(() => {
    if (!record) return null;
    const c = record.contract;
    const term = currentTerm(c, today);
    return {
      status: deriveStatus(c, today),
      term,
      notice: terminationNoticeDeadline(c, today),
      next: nextPayment(record, today),
      monthly: contractMonthlyEquivalent(record),
      schedule: contractSchedule(record, { start: today, end: addMonths(today, 12) }, today)
        .filter((i) => i.type !== 'payment')
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }, [record, today]);

  if (isLoading) return <ActivityIndicator style={{ marginTop: 80 }} color={colors.primary} />;
  if (!record || !view) return <EmptyState title="계약을 찾을 수 없어요" />;

  const c = record.contract;
  const live = c.lifecycle === 'active';

  const changeLifecycle = async () => {
    if (live) {
      const ok = await confirm('해지 처리', `'${c.title}' 계약을 해지된 계약으로 표시할까요?\n오늘 이후 결제와 일정이 지출·캘린더에서 빠집니다.`, '해지 처리');
      if (ok) actions.setLifecycle.mutate(['cancelled', today]);
    } else {
      actions.setLifecycle.mutate(['active', null]);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <Pressable onPress={() => router.push(`/contract/${id}/edit`)} accessibilityRole="button" testID="edit-contract" hitSlop={hitSlop} style={{ paddingHorizontal: spacing.xs }}>
              <AppText variant="body2Strong" color="primary">
                수정
              </AppText>
            </Pressable>
          ),
        }}
      />
      <Screen edges={[]} testID="contract-detail">
        {/* 헤더: 이름 · 상대방 · 상태 · D-Day */}
        <View style={styles.head}>
          <View style={styles.headRow}>
            <CategoryIcon category={c.category} size={44} />
            <View style={{ flex: 1 }}>
              <AppText variant="caption" color="textTertiary">
                {[CATEGORY_LABEL[c.category], c.counterparty].filter(Boolean).join(' · ')}
              </AppText>
              <AppText variant="title2" testID="detail-title">
                {c.title}
              </AppText>
            </View>
            <StatusBadge status={view.status} />
          </View>

          {view.term && live ? (
            <View style={styles.ddayBlock}>
              <DDay days={daysUntil(view.term.termEnd, today)} variant="display" />
              <AppText variant="body2" color="textSecondary">
                {c.autoRenewal ? '자동갱신 예정 ' : '계약 만료 '}
                {formatDateKo(view.term.termEnd)}
              </AppText>
            </View>
          ) : !view.term && live ? (
            <AppText variant="body2" color="textTertiary" style={{ marginTop: spacing.lg }}>
              종료일이 없는 계약이에요
            </AppText>
          ) : null}

          {view.term?.isEstimatedRenewal ? (
            <View style={styles.notice}>
              <Ionicons name="information-circle-outline" size={18} color={colors.check} />
              <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
                원래 종료일({formatDateKo(c.endDate!)})이 지나 자동갱신된 것으로 계산했어요. 실제 갱신 여부를 확인하고 정보를 수정해주세요.
              </AppText>
            </View>
          ) : null}

          {/* 다음 할 일 */}
          {live && (view.notice || view.next) ? (
            <View style={styles.todo} testID="detail-next">
              {view.notice ? (
                <View style={styles.todoRow}>
                  <View style={[styles.bar, { backgroundColor: EVENT_COLOR.termination_notice }]} />
                  <View style={{ flex: 1 }}>
                    <AppText variant="caption" color="textTertiary">
                      해지 통보기한 {view.notice.passed ? '(이번 회차 지남)' : ''}
                    </AppText>
                    <AppText variant="body2Strong">{formatDateKo(view.notice.date, true)}</AppText>
                  </View>
                  {!view.notice.passed ? <DDay days={daysUntil(view.notice.date, today)} variant="title3" /> : null}
                </View>
              ) : null}
              {view.next ? (
                <View style={styles.todoRow}>
                  <View style={[styles.bar, { backgroundColor: EVENT_COLOR.payment }]} />
                  <View style={{ flex: 1 }}>
                    <AppText variant="caption" color="textTertiary">
                      다음 결제 · {view.next.label}
                    </AppText>
                    <AppText variant="body2Strong">{formatDateKo(view.next.date, true)}</AppText>
                  </View>
                  <Amount value={view.next.amount} won variant="title3" />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        <SectionGap />

        {/* 금액 · 결제 */}
        <Section title="금액 · 결제">
          {record.payments.map((p) => (
            <KeyValueRow key={p.id} label={`${p.label} (${paymentRule(p)})`} value={`${formatWon(p.amount)}${p.isVariable ? ' 내외' : ''}`} emphasis />
          ))}
          {view.monthly > 0 && record.payments.some((p) => p.frequency !== 'monthly') ? <KeyValueRow label="월 환산" value={formatWon(view.monthly)} /> : null}
          {c.totalAmount != null ? <KeyValueRow label="계약 총액" value={formatWon(c.totalAmount)} /> : null}
          {c.depositAmount != null ? <KeyValueRow label="보증금" value={formatWonCompact(c.depositAmount)} emphasis /> : null}
          {record.payments.length === 0 && c.totalAmount == null && c.depositAmount == null ? (
            <AppText variant="body2" color="textTertiary">
              등록된 금액 정보가 없어요.
            </AppText>
          ) : null}
        </Section>

        <SectionGap />

        {/* 기간 · 갱신 · 해지 */}
        <Section title="기간 · 갱신 · 해지">
          {c.contractDate ? <KeyValueRow label="계약일" value={formatDateKo(c.contractDate)} /> : null}
          <KeyValueRow label="계약 기간" value={`${c.startDate ? formatDateKo(c.startDate) : '-'} ~ ${c.endDate ? formatDateKo(c.endDate) : '종료일 없음'}`} />
          <KeyValueRow label="자동갱신" value={c.autoRenewal ? `있음${c.renewalPeriodMonths ? ` · ${c.renewalPeriodMonths}개월` : ''}` : '없음'} />
          <KeyValueRow label="해지 통보" value={c.terminationNoticeDays != null ? `종료 ${c.terminationNoticeDays}일 전까지` : '정보 없음'} />
          {c.earlyTerminationTerms ? <KeyValueRow label="중도해지" value={c.earlyTerminationTerms} /> : null}
          {c.penaltyTerms ? <KeyValueRow label="위약금" value={c.penaltyTerms} /> : null}
        </Section>

        <SectionGap />

        {/* 일정 */}
        <Section title="다가오는 일정" caption="12개월 · 결제일 제외" action={{ label: '일정 추가', onPress: () => router.push(`/contract/${id}/event`) }} testID="detail-schedule">
          {view.schedule.length === 0 ? (
            <AppText variant="body2" color="textTertiary">
              예정된 일정이 없어요.
            </AppText>
          ) : (
            view.schedule.map((i) => {
              const ev = i.eventId ? record.events.find((e) => e.id === i.eventId) : null;
              return (
                <View key={i.key} style={styles.eventRow}>
                  <View style={[styles.dot, { backgroundColor: EVENT_COLOR[i.type] }]} />
                  <View style={{ flex: 1 }}>
                    <AppText variant="body2Strong" style={ev?.completedAt ? styles.done : undefined}>
                      {i.title}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      {formatDateKo(i.date, true)} · {EVENT_TYPE_LABEL[i.type]}
                      {i.estimated ? ' (추정)' : ''}
                    </AppText>
                  </View>
                  {ev ? (
                    <Pressable onPress={() => actions.setEventCompleted.mutate([ev.id, !ev.completedAt])} accessibilityRole="checkbox" accessibilityState={{ checked: !!ev.completedAt }}>
                      <Ionicons name={ev.completedAt ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={ev.completedAt ? colors.primary : colors.textDisabled} />
                    </Pressable>
                  ) : (
                    <DDay days={daysUntil(i.date, today)} variant="body2Strong" />
                  )}
                </View>
              );
            })
          )}
        </Section>

        <SectionGap />

        {/* 원본 계약서 */}
        <Section title="원본 계약서">
          {record.documents.length === 0 ? (
            <AppText variant="body2" color="textTertiary">
              보관된 원본이 없어요. (직접 입력한 계약)
            </AppText>
          ) : (
            record.documents.map((d) => (
              <Pressable
                key={d.id}
                style={styles.doc}
                onPress={() => notify('원본 보기', '원본 열람은 보안 저장소 연결(Step 8) 이후 제공됩니다. 계약서는 본인만 접근 가능한 비공개 저장소에 보관됩니다.')}>
                <Ionicons name={d.mimeType === 'application/pdf' ? 'document-outline' : 'image-outline'} size={22} color={colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <AppText variant="body2Strong" numberOfLines={1}>
                    {d.fileName}
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    {d.pageCount ? `${d.pageCount}쪽 · ` : ''}
                    {d.sizeBytes ? `${Math.max(1, Math.round(d.sizeBytes / 1024))}KB` : ''}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} />
              </Pressable>
            ))
          )}
        </Section>

        {c.memo ? (
          <>
            <SectionGap />
            <Section title="메모">
              <AppText variant="body2" color="textSecondary">
                {c.memo}
              </AppText>
            </Section>
          </>
        ) : null}

        <SectionGap />
        <Section title="알림">
          <SwitchRow
            label="이 계약 알림 받기"
            description="만료·해지 통보기한·결제일 알림"
            value={c.notificationsEnabled}
            onValueChange={(v) => actions.setNotifications.mutate([v])}
            testID="detail-notifications"
          />
        </Section>

        {/* 자동 정리 정보 — 보조 영역 */}
        <SectionGap />
        <AiSection record={record} onApply={(checkId) => actions.applyAiSuggestion.mutate([checkId])} onAck={(checkId) => actions.setAiCheckStatus.mutate([checkId, 'acknowledged'])} />

        <View style={styles.footerActions}>
          <Button label={live ? '해지 처리' : '진행중으로 되돌리기'} variant={live ? 'danger' : 'secondary'} size="md" onPress={changeLifecycle} testID="lifecycle-button" />
        </View>
      </Screen>
    </>
  );
}

function AiSection({ record, onApply, onAck }: { record: ContractRecord; onApply: (id: string) => void; onAck: (id: string) => void }) {
  const c = record.contract;
  const checks = record.aiChecks.filter((x) => x.status !== 'dismissed');
  const isApplied = (x: AiCheck) =>
    x.suggestion?.kind === 'set_termination_notice' && c.terminationNoticeDays === x.suggestion.terminationNoticeDays && c.autoRenewal === x.suggestion.autoRenewal;

  return (
    <Section title="확인이 필요한 조항" caption={c.source === 'upload' ? '계약서에서 자동으로 정리한 내용이에요' : undefined} testID="detail-checks">
      {checks.length === 0 ? (
        <AppText variant="body2" color="textTertiary">
          {c.source === 'upload' ? '따로 확인이 필요한 조항이 없어요.' : '직접 입력한 계약은 조항 정리 정보가 없어요.'}
        </AppText>
      ) : (
        checks.map((x, i) => (
          <View key={x.id}>
            {i > 0 ? <Divider /> : null}
            <View style={styles.check}>
              <View style={styles.checkHead}>
                <SeverityLabel severity={x.severity} />
                <AppText variant="body2Strong">{x.title}</AppText>
              </View>
              <AppText variant="body2" color="textSecondary" style={{ marginTop: 6 }}>
                {x.description}
              </AppText>
              {x.evidenceQuote ? (
                <View style={styles.quote}>
                  <AppText variant="caption" color="textSecondary">
                    “{x.evidenceQuote}”
                  </AppText>
                  {x.evidencePage ? (
                    <AppText variant="small" color="textTertiary" style={{ marginTop: 4 }}>
                      원문 {x.evidencePage}쪽
                    </AppText>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.checkActions}>
                {x.suggestion?.kind === 'set_termination_notice' ? (
                  isApplied(x) ? (
                    <View style={styles.applied}>
                      <Ionicons name="checkmark-circle" size={16} color={colors.positive} />
                      <AppText variant="caption" color="textSecondary">
                        해지 통보기한이 캘린더에 등록되어 있어요
                      </AppText>
                    </View>
                  ) : (
                    <Button label="해지 통보기한 캘린더에 등록" size="sm" variant="secondary" onPress={() => onApply(x.id)} testID={`apply-${x.id}`} />
                  )
                ) : null}
                {x.status === 'new' && !(x.suggestion && !isApplied(x)) ? <Button label="확인했어요" size="sm" variant="ghost" onPress={() => onAck(x.id)} /> : null}
              </View>
            </View>
          </View>
        ))
      )}
      <AppText variant="small" color="textTertiary" style={{ marginTop: spacing.md }}>
        {AI_DISCLAIMER}
      </AppText>
      <Pressable style={styles.ask} onPress={() => router.push(`/contract/${c.id}/ask`)} accessibilityRole="button" testID="ask-contract">
        <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.textSecondary} />
        <AppText variant="body2" color="textSecondary" style={{ flex: 1 }}>
          이 계약에 질문하기
        </AppText>
        <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} />
      </Pressable>
    </Section>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ddayBlock: { marginTop: spacing.xl, gap: 2 },
  notice: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.checkSoft },
  todo: { marginTop: spacing.xl, backgroundColor: colors.bgSubtle, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  todoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  bar: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  done: { textDecorationLine: 'line-through', color: colors.textTertiary },
  doc: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  check: { paddingVertical: spacing.md },
  checkHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  quote: { marginTop: spacing.sm, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.border },
  checkActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  applied: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ask: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  footerActions: { paddingHorizontal: spacing.gutter, paddingTop: spacing.xxl, alignItems: 'flex-start' },
});
