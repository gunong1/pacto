import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Amount, CategoryIcon, DDay, EVENT_COLOR, SeverityLabel, StatusBadge } from '@/components/pacto';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { SwitchRow } from '@/components/ui/controls';
import { Divider, EmptyState, KeyValueRow, Screen, Section, SectionGap } from '@/components/ui/layout';
import { documentStore } from '@/data';
import { AI_DISCLAIMER } from '@/domain/aiCopy';
import { addMonths, formatDateKo } from '@/domain/dates';
import { daysUntil } from '@/domain/dday';
import { CATEGORY_LABEL, EVENT_TYPE_LABEL, FREQUENCY_LABEL } from '@/domain/labels';
import { formatWon, formatWonCompact } from '@/domain/money';
import { contractSchedule, nextPayment } from '@/domain/schedule';
import { contractMonthlyEquivalent } from '@/domain/spending';
import { currentTerm, deriveStatus } from '@/domain/status';
import { CATEGORY_PROFILES, isActionable, nextAction } from '@/domain/nextAction';
import type { AiCheck, ContractPayment, ContractRecord } from '@/domain/types';
import { useAttachOriginal, useContract, useContractActions, useRemoveContract, useToday } from '@/features/contracts/queries';
import { pickPdf, pickPhotos } from '@/features/registration/pickers';
import { confirm, notify } from '@/lib/dialog';
import { colors, hitSlop, radius, spacing } from '@/theme';

function paymentRule(p: ContractPayment) {
  if (p.frequency === 'one_time') return '일시불';
  const day = p.dayOfMonth ? `${p.dayOfMonth}일` : '';
  if (p.frequency === 'yearly' && p.monthOfYear) return `매년 ${p.monthOfYear}월 ${day}`;
  return `${FREQUENCY_LABEL[p.frequency]} ${day}`.trim();
}

/**
 * 원본 계약서 열기 — 비공개 저장소의 짧은 Signed URL(2분)로만 연다. 공개 URL은 사용하지 않는다.
 * 웹은 팝업 차단을 피하기 위해 탭을 먼저 연 뒤 주소를 넣는다.
 */
async function openOriginal(doc: ContractRecord['documents'][number]) {
  const tab = Platform.OS === 'web' ? window.open('', '_blank') : null;
  try {
    const url = await documentStore.openUrl(doc);
    if (Platform.OS === 'web') {
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.location.href = url;
    } else {
      await WebBrowser.openBrowserAsync(url);
    }
  } catch (e) {
    tab?.close();
    notify('계약서 원본', e instanceof Error ? e.message : '원본을 열지 못했어요.');
  }
}

export default function ContractDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = useToday();
  const { data: record, isLoading } = useContract(id);
  const actions = useContractActions(id);
  const remove = useRemoveContract();
  const attach = useAttachOriginal(id);
  const attachOriginal = async (kind: 'pdf' | 'photo') => {
    const files = kind === 'pdf' ? await pickPdf() : await pickPhotos();
    if (files) attach.mutate(files, { onError: (e) => notify('원본 추가', e instanceof Error ? e.message : '원본을 보관하지 못했어요.') });
  };

  const view = useMemo(() => {
    if (!record) return null;
    const c = record.contract;
    const term = currentTerm(c, today);
    return {
      status: deriveStatus(c, today),
      term,
      action: nextAction(record, today),
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

  const removeContract = async () => {
    const ok = await confirm('계약 삭제', `'${c.title}' 계약과 원본 계약서, 일정이 모두 삭제됩니다. 삭제할까요?\n(계약이 끝났다면 삭제 대신 '해지 처리'로 기록을 남길 수 있어요)`, '삭제');
    if (ok) remove.mutate(c.id, { onSuccess: () => router.back(), onError: (e) => notify('계약 삭제', e instanceof Error ? e.message : '삭제하지 못했어요.') });
  };

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

          {/* 다음 행동 — 계약을 열었을 때 가장 먼저 보이는 영역. 단순 결제는 "다음 결제"로 구분 */}
          {live && view.action ? (
            <View style={isActionable(view.action) ? styles.action : styles.actionNeutral} testID="detail-next-action">
              <AppText variant="captionStrong" color={isActionable(view.action) ? 'primary' : 'textSecondary'} testID="detail-next-title">
                {isActionable(view.action) ? '다음 행동' : '다음 결제'}
              </AppText>
              <AppText variant="title3" style={{ marginTop: 6 }} testID="detail-next-headline">
                {view.action.headline}
              </AppText>
              <AppText variant="body2" color="textSecondary" style={{ marginTop: 4 }}>
                {view.action.guidance}
              </AppText>
              <View style={styles.actionFoot}>
                <AppText variant="caption" color="textTertiary" style={{ flex: 1 }}>
                  {view.action.label} · {formatDateKo(view.action.date, true)}
                </AppText>
                <Button
                  label="캘린더 보기"
                  size="sm"
                  variant="secondary"
                  style={styles.actionButton}
                  onPress={() => router.dismissTo({ pathname: '/calendar', params: { date: view.action!.date, t: String(Date.now()) } })}
                  testID="detail-open-calendar"
                />
              </View>
            </View>
          ) : !live ? (
            <View style={styles.action}>
              <AppText variant="body2" color="textSecondary">
                {c.lifecycle === 'cancelled' ? '해지된 계약이에요' : '종료된 계약이에요'}
                {c.lifecycleChangedOn ? ` · ${formatDateKo(c.lifecycleChangedOn)}` : ''}. 기록으로 계속 보관됩니다.
              </AppText>
            </View>
          ) : null}

          {/* D-Day (현재 회차 종료) */}
          {view.term && live ? (
            <View style={styles.ddayBlock}>
              <DDay days={daysUntil(view.term.termEnd, today)} variant="display" />
              <View>
                <AppText variant="body2Strong" color="textSecondary">
                  {c.autoRenewal ? '자동갱신 예정' : CATEGORY_PROFILES[c.category].endLabel}
                </AppText>
                <AppText variant="body2" color="textTertiary">
                  {formatDateKo(view.term.termEnd)}
                </AppText>
              </View>
            </View>
          ) : !view.term && live ? (
            <AppText variant="body2" color="textTertiary" style={{ marginTop: spacing.lg }}>
              종료일이 없는 계약이에요
            </AppText>
          ) : null}

          {/* 계약서 원본 — 계약 지갑의 핵심. Step 8에서 Signed URL 열람으로 연결 */}
          {record.documents.length > 0 ? (
            <Pressable
              onPress={() => openOriginal(record.documents[0])}
              accessibilityRole="button"
              testID="detail-open-original"
              style={({ pressed }) => [styles.original, pressed && { backgroundColor: colors.bgSubtle }]}>
              <Ionicons name="document-text-outline" size={20} color={colors.primary} />
              <AppText variant="body2Strong" color="primary" style={{ flex: 1 }}>
                계약서 원본 보기
              </AppText>
              <AppText variant="caption" color="textTertiary">
                {record.documents.length > 1 ? `파일 ${record.documents.length}개` : (record.documents[0].pageCount ? `${record.documents[0].pageCount}쪽` : '')}
              </AppText>
              <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} />
            </Pressable>
          ) : null}

          {view.term?.isEstimatedRenewal ? (
            <View style={styles.notice}>
              <Ionicons name="information-circle-outline" size={18} color={colors.check} />
              <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
                원래 종료일({formatDateKo(c.endDate!)})이 지나 자동갱신된 것으로 계산했어요. 실제 갱신 여부를 확인하고 정보를 수정해주세요.
              </AppText>
            </View>
          ) : null}
        </View>

        <SectionGap />

        {/* 금액 · 결제 */}
        <Section title="금액 · 다음 결제">
          {live && view.next ? (
            <View style={styles.nextPay} testID="detail-next-payment">
              <View style={{ flex: 1 }}>
                <AppText variant="caption" color="textTertiary">
                  다음 결제 · {view.next.label}
                </AppText>
                <AppText variant="body2Strong">{formatDateKo(view.next.date, true)}</AppText>
              </View>
              <Amount value={view.next.amount} won variant="title3" />
            </View>
          ) : null}
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
                  <Pressable
                    style={{ flex: 1 }}
                    disabled={!ev}
                    onPress={() => ev && router.push({ pathname: '/contract/[id]/event', params: { id, eventId: ev.id } })}
                    accessibilityRole={ev ? 'button' : undefined}
                    testID={ev ? `event-${ev.id}` : undefined}>
                    <AppText variant="body2Strong" style={ev?.completedAt ? styles.done : undefined}>
                      {i.title}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      {formatDateKo(i.date, true)} · {EVENT_TYPE_LABEL[i.type]}
                      {i.estimated ? ' (추정)' : ''}
                    </AppText>
                  </Pressable>
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
              보관된 원본이 없어요. 계약서를 추가해두면 언제든 다시 꺼내볼 수 있어요.
            </AppText>
          ) : null}
          {record.documents.length === 0 ? (
            <View style={styles.attachRow}>
              <Button label="PDF 추가" size="sm" variant="secondary" loading={attach.isPending} onPress={() => attachOriginal('pdf')} testID="attach-pdf" />
              <Button label="사진 추가" size="sm" variant="secondary" loading={attach.isPending} onPress={() => attachOriginal('photo')} testID="attach-photo" />
            </View>
          ) : (
            record.documents.map((d) => (
              <Pressable key={d.id} style={styles.doc} onPress={() => openOriginal(d)} accessibilityRole="button" testID={`document-${d.id}`}>
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
          <Button label="계약 삭제" variant="ghost" size="md" onPress={removeContract} loading={remove.isPending} testID="delete-contract" />
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
  ddayBlock: { marginTop: spacing.xl, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  notice: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.checkSoft },
  action: { marginTop: spacing.xl, backgroundColor: colors.primarySoft, borderRadius: radius.xl, padding: spacing.lg },
  actionNeutral: { marginTop: spacing.xl, backgroundColor: colors.bgSubtle, borderRadius: radius.xl, padding: spacing.lg },
  original: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.lg, height: 52, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  actionFoot: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  actionButton: { backgroundColor: colors.bg },
  nextPay: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginBottom: spacing.sm, borderRadius: radius.md, backgroundColor: colors.bgSubtle },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  done: { textDecorationLine: 'line-through', color: colors.textTertiary },
  attachRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  doc: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  check: { paddingVertical: spacing.md },
  checkHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  quote: { marginTop: spacing.sm, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.border },
  checkActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  applied: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ask: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  footerActions: { paddingHorizontal: spacing.gutter, paddingTop: spacing.xxl, flexDirection: 'row', gap: spacing.sm },
});
