import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { CategoryIcon, DDay, EVENT_COLOR, SourceBadge, StatusBadge } from '@/components/pacto';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/controls';
import { DateField } from '@/components/ui/DateField';
import { Divider, EmptyState, KeyValueRow, Screen, Section, SectionGap } from '@/components/ui/layout';
import { AI_DISCLAIMER, CHECK_SECTION_TITLE } from '@/domain/aiCopy';
import { addDays, addMonths, formatDateKo, normalizeDateInput } from '@/domain/dates';
import { daysUntil } from '@/domain/dday';
import { contractTypeLabel, isConfirmedPayment } from '@/domain/contractTypes';
import { coreInfo, extraCosts, otherDetails, type ExtraCostRow } from '@/domain/coreInfo';
import { categoryLabel, EVENT_TYPE_LABEL } from '@/domain/labels';
import { formatWon } from '@/domain/money';
import { noticeLabelOf } from '@/domain/noticeKind';
import { contractSchedule, isPaymentDayUnknown, nextPayment } from '@/domain/schedule';
import { contractMonthlyEquivalent } from '@/domain/spending';
import { currentTerm, deriveStatus, terminationNoticeDeadline } from '@/domain/status';
import { endProfile, isActionable, nextAction } from '@/domain/nextAction';
import type { AiCheck, ContractRecord } from '@/domain/types';
import { ContractCheckCard } from '@/features/contracts/ContractCheckCard';
import { viewDocument, viewDocuments, viewOriginal } from '@/features/documents/openDocument';
import { ProtectionCard } from '@/features/documents/ProtectionCard';
import { ContractNotificationSection, PushOpenedBanner, PushPromptSheet } from '@/features/notifications/ContractNotificationParts';
import { overallProtectionCopy } from '@/features/documents/protectionCopy';
import { useAttachOriginal, useContract, useContractActions, useProtectDocument, useRemoveContract, useToday } from '@/features/contracts/queries';
import { pickPdf, pickPhotos } from '@/features/registration/pickers';
import { confirm, notify } from '@/lib/dialog';
import { colors, hitSlop, radius, spacing } from '@/theme';

/** 푸시 알림 종류 → 화면 문구 */
const PUSH_EVENT_LABEL: Record<string, string> = {
  termination_notice: '해지 통보기한',
  renewal_notice: '갱신 통보기한',
  renewal_decision: '갱신 여부 확인',
  notice_unknown: '통보·갱신 관련 기한',
  renewal: '자동갱신 예정일',
  contract_end: '계약 만료',
  maturity: '만기',
  payment: '결제',
  income: '입금',
  test: '테스트 알림',
};

export default function ContractDetailScreen() {
  // from=push: 알림을 눌러 들어옴 (event = 알림 종류, check = 관련 계약 체크) / created=1: 방금 저장
  const { id, from, event, check: checkParam, created } = useLocalSearchParams<{ id: string; from?: string; event?: string; check?: string; created?: string }>();
  const today = useToday();
  const { data: record, isLoading } = useContract(id);
  const actions = useContractActions(id);
  const remove = useRemoveContract();
  const attach = useAttachOriginal(id);
  const protect = useProtectDocument();
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
      // 지급일이 없는 정기 수입(급여 등) — 반복 일정을 만들지 않았다
      dayUnknown: record.payments.filter((p) => isConfirmedPayment(p) && isPaymentDayUnknown(p)),
      monthly: contractMonthlyEquivalent(record),
      core: coreInfo(record, today),
      other: otherDetails(record),
      extra: extraCosts(record),
      schedule: contractSchedule(record, { start: today, end: addMonths(today, 12) }, today)
        .filter((i) => i.type !== 'payment')
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }, [record, today]);

  if (isLoading) return <ActivityIndicator style={{ marginTop: 80 }} color={colors.primary} />;
  if (!record || !view) return <EmptyState title="계약을 찾을 수 없어요" />;

  const c = record.contract;
  const live = c.lifecycle === 'active';
  const pushedCheck = checkParam ? (record.aiChecks.find((x) => x.id === checkParam && x.status !== 'dismissed') ?? null) : null;
  const pushedDoc = pushedCheck ? (record.documents.find((d) => d.id === pushedCheck.evidenceDocumentId) ?? record.documents[0] ?? null) : null;

  const removeContract = async () => {
    const ok = await confirm('계약 삭제', `'${c.title}' 계약과 원본 계약서, 일정이 모두 삭제됩니다. 삭제할까요?\n(계약이 끝났다면 삭제 대신 '해지 처리'로 기록을 남길 수 있어요)`, '삭제');
    if (ok) remove.mutate(c.id, { onSuccess: () => router.back(), onError: (e) => notify('계약 삭제', e instanceof Error ? e.message : '삭제하지 못했어요.') });
  };

  const confirmInferred = async (label: string, path: string) => {
    const ok = await confirm('AI 추정 값 확인', `'${label}' 값은 AI가 문맥으로 추정한 값이에요. 계약서와 같은지 확인하셨나요?\n다르면 '수정'에서 고쳐주세요.`, '계약서와 같아요');
    if (ok) actions.confirmValue.mutate([path]);
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
        <PushPromptSheet active={created === '1'} />
        {from === 'push' ? (
          <PushOpenedBanner
            eventLabel={event && event in PUSH_EVENT_LABEL ? PUSH_EVENT_LABEL[event] : null}
            check={pushedCheck}
            onOpenCheck={pushedCheck && pushedDoc ? () => viewDocument(pushedDoc, pushedCheck.evidencePage) : undefined}
          />
        ) : null}
        {/* 헤더: 이름 · 상대방 · 상태 · D-Day */}
        <View style={styles.head}>
          <View style={styles.headRow}>
            <CategoryIcon category={c.category} size={44} />
            <View style={{ flex: 1 }}>
              <AppText variant="caption" color="textTertiary">
                {[categoryLabel(c.category), contractTypeLabel(c.contractType), c.counterparty].filter(Boolean).join(' · ')}
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
                {isActionable(view.action) ? '다음 행동' : view.action.label}
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
                  {c.autoRenewal ? '자동갱신 예정' : endProfile(c).endLabel}
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

          {/* 계약서 보기 — 기본은 민감정보를 가린 보호 표시본. 원본은 아래 "계약서" 섹션의 "원본 보기"(확인 후) */}
          {record.documents.length > 0 ? (
            <Pressable
              onPress={() => viewDocuments(record.documents)}
              accessibilityRole="button"
              testID="detail-open-document"
              style={({ pressed }) => [styles.original, pressed && { backgroundColor: colors.bgSubtle }]}>
              <Ionicons name={record.documents[0].protection?.protectedViewPath ? 'shield-checkmark-outline' : 'document-text-outline'} size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <AppText variant="body2Strong" color="primary">
                  {record.documents[0].protection?.protectedViewPath ? '보호된 계약서 보기' : '계약서 보기'}
                </AppText>
                {overallProtectionCopy(record.documents.map((d) => d.protection)) ? (
                  <AppText variant="small" color="textTertiary" testID="detail-protection-status">
                    {overallProtectionCopy(record.documents.map((d) => d.protection))!.title}
                  </AppText>
                ) : null}
              </View>
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

        {/* 유형별 핵심 정보 — 공통 틀은 같고 유형(월 납입형·임대차·할부·대출·보험·일회성)에 따라 항목이 다르다 */}
        <Section title="핵심 정보" caption={contractTypeLabel(c.contractType)} testID="detail-core">
          {live && view.next ? (
            <View style={styles.nextPay} testID="detail-next-payment">
              <View style={{ flex: 1 }}>
                <AppText variant="caption" color="textTertiary">
                  {view.next.direction === 'income' ? '다음 지급' : '다음 결제'} · {view.next.label}
                  {view.next.amountNote ? ` (${view.next.amountNote})` : ''}
                  {view.next.installment ? ` ${view.next.installment.no}/${view.next.installment.total}회` : ''}
                </AppText>
                <AppText variant="body2Strong">{formatDateKo(view.next.date, true)}</AppText>
              </View>
              <AppText variant="title3" tabular color={view.next.direction === 'income' ? 'positive' : 'text'}>
                {view.next.direction === 'income' ? '+' : ''}
                {formatWon(view.next.amount)}
              </AppText>
            </View>
          ) : null}
          {live && view.dayUnknown.length > 0 ? (
            <View style={styles.notice} testID="detail-payday-unknown">
              <Ionicons name="information-circle-outline" size={18} color={colors.check} />
              <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
                {view.dayUnknown[0].kind === 'salary' ? '급여' : view.dayUnknown[0].label} 지급일 확인 필요 — 계약서에 지급일이 없어 캘린더에 반복 일정을 만들지 않았어요. 지급일을 알면 정보 수정에서 입력해주세요.
              </AppText>
            </View>
          ) : null}
          {view.core.map((row) => (
            <KeyValueRow
              key={row.key}
              label={row.label}
              value={row.value}
              emphasis={row.emphasis}
              testID={`core-${row.key}`}
              badge={
                row.source === 'inferred' && row.key.startsWith('d:') ? (
                  <Pressable onPress={() => confirmInferred(row.label, `details.${row.key.slice(2)}`)} accessibilityRole="button" testID={`confirm-${row.key}`}>
                    <SourceBadge source="inferred" />
                  </Pressable>
                ) : (
                  <SourceBadge source={row.source} />
                )
              }
            />
          ))}
          {view.core.some((r) => r.source === 'inferred' || r.source === 'calculated') ? (
            <AppText variant="small" color="textTertiary" style={{ marginTop: spacing.sm }}>
              AI 추정: 계약서에 그대로 적힌 값이 아니라 문맥으로 판단한 값이에요. 눌러서 확인할 수 있어요.{'\n'}PACTO 계산: 계약 조건으로 계산한 값이에요.
            </AppText>
          ) : null}
          {view.monthly > 0 && record.payments.some((p) => p.frequency !== 'monthly' && p.frequency !== 'one_time') ? (
            <KeyValueRow label="월 환산 (참고)" value={formatWon(view.monthly)} />
          ) : null}
          {view.core.length === 0 ? (
            <AppText variant="body2" color="textTertiary">
              등록된 정보가 없어요. 수정에서 결제와 날짜를 추가해주세요.
            </AppText>
          ) : null}
        </Section>

        {view.extra.length > 0 ? (
          <>
            <SectionGap />
            <Section title="추가로 발생할 수 있는 비용" caption="상황이나 선택에 따라 생기는 돈이에요. 캘린더·지출에는 넣지 않았어요." testID="detail-extra-costs">
              {view.extra.map((x, i) => (
                <View key={x.key}>
                  {i > 0 ? <Divider /> : null}
                  <ExtraCost row={x} onActivate={(date) => actions.activateCost.mutate([x.paymentId, date])} />
                </View>
              ))}
            </Section>
          </>
        ) : null}

        <SectionGap />

        {/* 기록성 정보 */}
        <Section title="계약 조건 · 기록">
          {c.contractDate ? <KeyValueRow label="계약 체결일" value={formatDateKo(c.contractDate)} testID="detail-contract-date" /> : null}
          {c.earlyTerminationTerms ? <KeyValueRow label={c.contractType === 'loan' ? '중도상환' : '중도해지'} value={c.earlyTerminationTerms} /> : null}
          {c.penaltyTerms ? <KeyValueRow label="위약금" value={c.penaltyTerms} /> : null}
          {view.other.map((row) => (
            <KeyValueRow key={row.key} label={row.label} value={row.value} />
          ))}
          {!c.contractDate && !c.earlyTerminationTerms && !c.penaltyTerms && view.other.length === 0 ? (
            <AppText variant="body2" color="textTertiary">
              기록된 조건이 없어요.
            </AppText>
          ) : null}
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

        {/* 계약서 — 원본은 수정하지 않고 비공개로 보관, 기본 표시는 민감정보를 가린 보호본 */}
        <Section title="계약서" caption="원본은 비공개로 보관하고, 지원되는 문서는 민감정보를 가려서 보여드려요" testID="detail-documents">
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
              <View key={d.id} style={{ marginBottom: spacing.md }}>
              <Pressable style={styles.doc} onPress={() => viewDocument(d)} accessibilityRole="button" testID={`document-${d.id}`}>
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
              <ProtectionCard
                protection={d.protection}
                busy={protect.isPending}
                onChangeRegion={(r, state) => protect.mutate({ documentId: d.id, regions: [{ id: r.id, state }] }, { onError: () => notify('민감정보 보호', '변경하지 못했어요. 잠시 후 다시 시도해주세요.') })}
                onProtect={() => protect.mutate({ documentId: d.id })}
                onViewOriginal={d.storagePath ? () => viewOriginal(d) : undefined}
                testID={`protection-${d.id}`}
              />
              </View>
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
        <ContractNotificationSection contractId={c.id} enabled={c.notificationsEnabled} onToggle={(v) => actions.setNotifications.mutate([v])} />

        {/* 자동 정리 정보 — 보조 영역 */}
        <SectionGap />
        <AiSection
          record={record}
          today={today}
          onApply={(checkId) => actions.applyAiSuggestion.mutate([checkId])}
          onAck={(checkId) => actions.setAiCheckStatus.mutate([checkId, 'acknowledged'])}
          onScheduleRule={(checkId, title, date) => actions.scheduleRule.mutate([checkId, title, date])}
        />

        <View style={styles.footerActions}>
          <Button label={live ? '해지 처리' : '진행중으로 되돌리기'} variant={live ? 'danger' : 'secondary'} size="md" onPress={changeLifecycle} testID="lifecycle-button" />
          <Button label="계약 삭제" variant="ghost" size="md" onPress={removeContract} loading={remove.isPending} testID="delete-contract" />
        </View>
      </Screen>
    </>
  );
}

/** PACTO 계약 체크 — 확인이 필요한 조항 + 원문 근거 + 관리 연결(해지 통보기한·명시된 날짜를 캘린더에) */
function AiSection({
  record,
  today,
  onApply,
  onAck,
  onScheduleRule,
}: {
  record: ContractRecord;
  today: string;
  onApply: (id: string) => void;
  onAck: (id: string) => void;
  onScheduleRule: (id: string, title: string, date: string) => void;
}) {
  const c = record.contract;
  const checks = record.aiChecks.filter((x) => x.status !== 'dismissed');
  const notice = terminationNoticeDeadline(c, today);
  const isApplied = (x: AiCheck) => {
    const s = x.suggestion;
    if (s?.kind === 'set_termination_notice') return c.terminationNoticeDays === s.terminationNoticeDays && (!s.autoRenewal || c.autoRenewal);
    if (s?.kind === 'add_event') return record.events.some((e) => e.eventDate === s.eventDate && e.title === s.title);
    return false;
  };
  const docFor = (x: AiCheck) => record.documents.find((d) => d.id === x.evidenceDocumentId) ?? record.documents[0];

  return (
    <Section title={CHECK_SECTION_TITLE} caption={c.source === 'upload' ? '계약서에서 놓치기 쉬운, 확인이 필요한 조건이에요' : undefined} testID="detail-checks">
      {checks.length === 0 ? (
        <AppText variant="body2" color="textTertiary">
          {c.source === 'upload' ? '따로 확인이 필요한 조건을 찾지 못했어요.' : '직접 입력한 계약은 계약 체크 정보가 없어요.'}
        </AppText>
      ) : (
        checks.map((x, i) => {
          const s = x.suggestion;
          const doc = docFor(x);
          const applied = isApplied(x);
          const deadline =
            s?.kind === 'set_termination_notice'
              ? applied && notice
                ? { label: noticeLabelOf(c.noticeKind, c.contractType), date: notice.date }
                : c.endDate
                  ? { label: noticeLabelOf(c.noticeKind, c.contractType), date: addDays(c.endDate, -s.terminationNoticeDays) }
                  : null
              : s?.kind === 'add_event'
                ? { label: s.title, date: s.eventDate }
                : null;
          return (
            <View key={x.id}>
              {i > 0 ? <Divider /> : null}
              <ContractCheckCard
                testID={`check-${x.id}`}
                check={x}
                deadline={deadline}
                onOpenOriginal={doc ? () => viewDocument(doc, x.evidencePage) : undefined}
                action={
                  <>
                    {x.behavior === 'conditional_rule' && x.rule ? <RuleScheduler check={x} onSchedule={(title, date) => onScheduleRule(x.id, title, date)} /> : null}
                    {s ? (
                      applied ? (
                        <View style={styles.applied}>
                          <Ionicons name="checkmark-circle" size={16} color={colors.positive} />
                          <AppText variant="caption" color="textSecondary">
                            캘린더와 알림에 등록되어 있어요
                          </AppText>
                        </View>
                      ) : (
                        <Button label="캘린더에 추가" size="sm" variant="secondary" onPress={() => onApply(x.id)} testID={`apply-${x.id}`} />
                      )
                    ) : null}
                    {x.status === 'new' && !(s && !applied) ? <Button label="확인했어요" size="sm" variant="ghost" onPress={() => onAck(x.id)} /> : null}
                  </>
                }
              />
            </View>
          );
        })
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

/**
 * 추가로 발생할 수 있는 비용 한 건 — 조건이 실제로 생기면 날짜를 정해 결제로 전환한다.
 * 선택형: "이용 시작" (그날부터 정기 결제) / 조건부: "발생했어요" (그날 1회 결제)
 */
function ExtraCost({ row, onActivate }: { row: ExtraCostRow; onActivate: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const date = normalizeDateInput(input);
  const verb = row.obligation === 'optional' ? '이용 시작' : '발생했어요';
  return (
    <View style={styles.extra} testID={`extra-${row.paymentId}`}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="body2Strong">{row.label}</AppText>
          <View style={{ alignSelf: 'flex-start' }}>
            <Badge label={row.condition} tone="check" />
          </View>
        </View>
        <AppText variant="body2Strong" tabular>
          {row.value}
        </AppText>
      </View>
      {open ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          <DateField
            label={row.obligation === 'optional' ? '이용 시작일 (이날부터 결제)' : '실제 지급 예정일'}
            value={input}
            onChangeText={setInput}
            testID={`extra-${row.paymentId}-date`}
          />
          <Button label="결제로 등록 (캘린더·지출에 반영)" size="sm" disabled={!date} onPress={() => date && onActivate(date)} testID={`extra-${row.paymentId}-save`} />
        </View>
      ) : (
        <View style={{ alignSelf: 'flex-start', marginTop: spacing.sm }}>
          <Button label={verb} size="sm" variant="secondary" onPress={() => setOpen(true)} testID={`extra-${row.paymentId}-open`} />
        </View>
      )}
    </View>
  );
}

/**
 * 조건부 규칙 (예: 자진 퇴직 시 30일 전 통보) — 계약서만으로는 날짜가 없다.
 * 사용자가 기준일(예: 퇴직 예정일)을 입력하면 그때 기준일 − N일 일정을 만든다.
 */
function RuleScheduler({ check, onSchedule }: { check: AiCheck; onSchedule: (title: string, date: string) => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const rule = check.rule!;
  const base = normalizeDateInput(input);
  const target = base ? addDays(base, -(rule.offsetDays ?? 0)) : null;
  if (!open) return <Button label="기준 날짜 입력" size="sm" variant="secondary" onPress={() => setOpen(true)} testID={`rule-${check.id}-open`} />;
  return (
    <View style={{ width: '100%', gap: spacing.sm }} testID={`rule-${check.id}`}>
      <DateField label="기준 날짜 (예: 희망 퇴직일)" value={input} onChangeText={setInput} testID={`rule-${check.id}-date`} />
      {target ? (
        <AppText variant="body2" color="textSecondary" testID={`rule-${check.id}-result`}>
          기한 <AppText variant="body2Strong">{formatDateKo(target, true)}</AppText>
          {rule.offsetDays ? ` (기준일 ${rule.offsetDays}일 전)` : ''} · {rule.action}
        </AppText>
      ) : null}
      <Button
        label="캘린더에 추가"
        size="sm"
        disabled={!target}
        onPress={() => target && onSchedule(`${check.title} 기한`, target)}
        testID={`rule-${check.id}-add`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  extra: { paddingVertical: spacing.md },
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
