import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Divider, KeyValueRow, Section } from '@/components/ui/layout';
import { AI_DISCLAIMER, CHECK_SECTION_TITLE } from '@/domain/aiCopy';
import { formatWon } from '@/domain/money';
import { noticeLabelOf } from '@/domain/noticeKind';
import { ContractCheckCard } from '@/features/contracts/ContractCheckCard';
import { ContractForm } from '@/features/contracts/ContractForm';
import { draftToForm } from '@/features/contracts/form';
import { viewDocument } from '@/features/documents/openDocument';
import { useCreateContract, useDocumentProtection, useProtectDocument, useToday } from '@/features/contracts/queries';
import { ProtectionCard } from '@/features/documents/ProtectionCard';
import { overallProtectionCopy } from '@/features/documents/protectionCopy';
import { noticeDeadlineFor, toReviewModel, type ReviewCheck } from '@/features/registration/extraction';
import { finishRegistration } from '@/features/registration/finish';
import { useRegistration } from '@/features/registration/store';
import { colors, radius, spacing } from '@/theme';

/** "AI가 정리한 계약정보를 확인해주세요." — 저장 전 필수 확인/수정 단계 + PACTO 계약 체크(확인이 필요한 조항). */
export default function ReviewScreen() {
  const today = useToday();
  const { extraction, files, method, uploaded, validation } = useRegistration();
  // PDF의 계약과 무관한·읽기 어려운·중복 쪽 (PDF는 쪽을 지울 수 없어 안내만 — 그 쪽의 값은 서버에서 이미 뺐다)
  const pdfWarnings = (validation?.suspiciousPages ?? []).filter((p) => p.pdf);
  const create = useCreateContract();
  // 민감정보 보호 결과 (분석 전에 서버가 처리) — 원본은 그대로, 기본 표시는 보호본
  const protection = useDocumentProtection(uploaded.map((d) => d.id));
  const protect = useProtectDocument();
  const withProtection = <T extends { id: string }>(d: T) => ({ ...d, protection: protection.data?.[d.id] });
  const model = useMemo(() => (extraction ? toReviewModel(extraction, uploaded.map((d) => d.id)) : null), [extraction, uploaded]);
  // 계약 체크에서 "캘린더에 추가"를 고른 항목 (계약서에 명시된 날짜)
  const [addEvents, setAddEvents] = useState<ReadonlySet<number>>(new Set());
  // 저장 후 초안을 비울 때 "초안 없음 → 처음으로" 이동이 일어나지 않도록
  const saved = useRef(false);

  useEffect(() => {
    if (!extraction && !saved.current) router.replace('/register');
  }, [extraction]);

  if (!model || !extraction) return null;

  const counts = { caution: 0, check: 0, info: 0 };
  for (const c of model.checks) counts[c.severity] += 1;
  const lowCount = [...model.flagged].length;

  const header = (
    <View style={styles.header}>
      <AppText variant="title2">AI가 정리한 계약정보를{'\n'}확인해주세요.</AppText>
      <AppText variant="body2" color="textSecondary" style={{ marginTop: spacing.sm }}>
        자동으로 정리한 내용은 틀릴 수 있습니다.{'\n'}특히 <AppText variant="body2Strong" color="check">확인 필요</AppText> 항목은 계약서와 비교해주세요. 모든 항목을 저장 전에 수정할 수 있어요.
      </AppText>

      {extraction.provider === 'mock' ? (
        <View style={styles.mockBanner} testID="review-mock-banner">
          <AppText variant="captionStrong" color="check">
            미리보기 모드 — 예시 결과예요
          </AppText>
          <AppText variant="caption" color="textSecondary">
            지금은 계약서를 실제로 읽지 않습니다. 모든 항목을 계약서와 비교해 직접 입력해주세요.
          </AppText>
        </View>
      ) : null}

      {pdfWarnings.length > 0 ? (
        <View style={styles.mockBanner} testID="review-pdf-warning">
          <AppText variant="captionStrong" color="check">
            {pdfWarnings.map((p) => `${p.page}쪽`).join('·')}을 계약 관련 내용으로 확인하기 어려워요
          </AppText>
          <AppText variant="caption" color="textSecondary">
            {pdfWarnings.some((p) => p.duplicateOf) ? '같은 내용이 반복된 쪽이 있어요. ' : ''}이 쪽에서 읽은 날짜·금액은 계약 정보에 넣지 않았어요. 계약서와 비교해 확인해주세요.
          </AppText>
        </View>
      ) : null}
      {validation?.userConfirmedRole ? (
        <AppText variant="caption" color="textTertiary" style={{ marginTop: spacing.sm }} testID="review-user-confirmed">
          계약 관련 문서라고 직접 확인한 파일이에요. 자동 판단이 확실하지 않았던 만큼 내용을 꼼꼼히 확인해주세요.
        </AppText>
      ) : null}

      <View style={styles.summary} testID="review-summary">
        <AppText variant="captionStrong" color="textSecondary">
          확인 필요 항목 {lowCount}개
          {model.checks.length > 0 ? ` · ${CHECK_SECTION_TITLE} ${model.checks.length}건${counts.caution ? ` (주의 필요 ${counts.caution})` : ''}` : ''}
        </AppText>
      </View>

      {uploaded.length > 1 && overallProtectionCopy(uploaded.map((d) => protection.data?.[d.id])) ? (
        // 여러 장: 모든 장이 보호됨·감지되지 않음일 때만 완료로 (한 장이라도 읽지 못함·실패면 "일부 완료하지 못함")
        <AppText variant="captionStrong" color={overallProtectionCopy(uploaded.map((d) => protection.data?.[d.id]))!.tone === 'warning' ? 'check' : 'textSecondary'} style={{ marginTop: spacing.md }} testID="review-protection-overall">
          {overallProtectionCopy(uploaded.map((d) => protection.data?.[d.id]))!.title}
        </AppText>
      ) : null}
      {uploaded.map((d) => (
        <View key={d.id} style={{ marginTop: spacing.md }}>
          <ProtectionCard
            protection={protection.data?.[d.id]}
            fileName={uploaded.length > 1 ? d.fileName : undefined}
            busy={protect.isPending}
            onChangeRegion={(r, state) => protect.mutate({ documentId: d.id, regions: [{ id: r.id, state }] })}
            onProtect={() => protect.mutate({ documentId: d.id })}
            testID={`review-protection-${uploaded.indexOf(d)}`}
          />
        </View>
      ))}

      <View style={styles.files}>
        {files.map((f) => (
          <View key={f.uri} style={styles.file}>
            <Ionicons name={method === 'pdf' ? 'document-outline' : 'image-outline'} size={16} color={colors.textTertiary} />
            <AppText variant="caption" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
              {f.name}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );

  const docFor = (c: ReviewCheck) => {
    const d = uploaded.find((x) => x.id === c.evidenceDocumentId) ?? uploaded[0];
    return d ? withProtection(d) : undefined;
  };
  const noticeDate = noticeDeadlineFor(model.draft.endDate, model.draft.terminationNoticeDays);

  const trailing = (
    <View style={styles.trailing}>
      {model.references.length > 0 ? (
        <Section title="결제에 넣지 않은 금액" caption="계약서에 있지만 실제로 오가는 돈이 아니라고 본 금액이에요 (합계·참고 금액)" testID="review-references">
          {model.references.map((r, i) => (
            <KeyValueRow key={`${r.label}-${i}`} label={r.label} value={formatWon(r.amount)} />
          ))}
          <AppText variant="small" color="textTertiary" style={{ marginTop: spacing.sm }}>
            실제로 내거나 받는 돈이면 위 결제에 추가해주세요.
          </AppText>
        </Section>
      ) : null}
      <Section title={CHECK_SECTION_TITLE} caption="계약서에서 놓치기 쉬운, 확인이 필요한 조건이에요" testID="review-checks">
        {model.checks.length === 0 ? (
          <AppText variant="body2" color="textTertiary">
            따로 확인이 필요한 조건을 찾지 못했어요. 중요한 조건은 원문을 함께 확인해주세요.
          </AppText>
        ) : (
          model.checks.map((c, i) => {
            const doc = docFor(c);
            const s = c.suggestion;
            return (
              <View key={`${c.topic}-${i}`}>
                {i > 0 ? <Divider /> : null}
                <ContractCheckCard
                  testID={`review-check-${i}`}
                  check={c}
                  onOpenOriginal={doc ? () => viewDocument(doc, c.evidencePage) : undefined}
                  deadline={
                    s?.kind === 'set_termination_notice' && noticeDate
                      ? { label: noticeLabelOf(model.draft.noticeKind, model.draft.contractType), date: noticeDate }
                      : s?.kind === 'add_event'
                        ? { label: s.title, date: s.eventDate }
                        : null
                  }
                  action={
                    s?.kind === 'set_termination_notice' && noticeDate ? (
                      <AppText variant="caption" color="textSecondary">
                        저장하면 캘린더와 알림에 자동으로 추가돼요
                      </AppText>
                    ) : s?.kind === 'add_event' ? (
                      <Button
                        label={addEvents.has(i) ? '✓ 캘린더에 추가돼요' : '캘린더에 추가'}
                        size="sm"
                        variant={addEvents.has(i) ? 'primary' : 'secondary'}
                        onPress={() => setAddEvents((prev) => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          return next;
                        })}
                        testID={`review-check-${i}-add`}
                      />
                    ) : null
                  }
                />
              </View>
            );
          })
        )}
        <AppText variant="small" color="textTertiary" style={{ marginTop: spacing.sm }}>
          {AI_DISCLAIMER}
        </AppText>
      </Section>
    </View>
  );

  return (
    <ContractForm
      trailing={trailing}
      defaultValues={draftToForm(model.draft)}
      flagged={model.flagged}
      evidence={extraction.provider === 'mock' ? undefined : model.evidence}
      notes={model.notes}
      typeSuggestion={model.typeSuggestion}
      categorySuggestion={model.categorySuggestion}
      allDetails={model.allDetails}
      header={header}
      today={today}
      submitLabel="계약 저장"
      footerNote="저장 후에도 언제든 수정할 수 있어요"
      submitting={create.isPending}
      onSubmit={(draft) =>
        create.mutate(
          {
            draft,
            source: 'upload',
            documents: uploaded.map((d) => ({ id: d.id, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, storagePath: d.storagePath, localUri: d.localUri, pageCount: null })),
            aiChecks: model.checks.map((c, i) => ({ ...c, status: addEvents.has(i) ? ('acknowledged' as const) : ('new' as const) })),
            events: model.checks.flatMap((c, i) => (addEvents.has(i) && c.suggestion?.kind === 'add_event' ? [{ title: c.suggestion.title, eventDate: c.suggestion.eventDate, eventType: 'custom' as const }] : [])),
            analysisJobId: extraction.jobId ?? null,
          },
          {
            onSuccess: (record) => {
              saved.current = true;
              finishRegistration(record.contract.id);
            },
          },
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.gutter, paddingTop: spacing.lg, paddingBottom: spacing.md },
  files: { marginTop: spacing.md, gap: 6 },
  summary: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSubtle },
  mockBanner: { marginTop: spacing.lg, padding: spacing.md, gap: 2, borderRadius: radius.md, backgroundColor: colors.checkSoft },
  file: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  trailing: { marginTop: spacing.md },
});
