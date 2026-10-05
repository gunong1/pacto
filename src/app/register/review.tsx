import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { SeverityLabel } from '@/components/pacto';
import { AppText } from '@/components/ui/AppText';
import { AI_DISCLAIMER } from '@/domain/aiCopy';
import { ContractForm } from '@/features/contracts/ContractForm';
import { draftToForm } from '@/features/contracts/form';
import { useCreateContract, useToday } from '@/features/contracts/queries';
import { toReviewModel } from '@/features/registration/extraction';
import { finishRegistration } from '@/features/registration/finish';
import { useRegistration } from '@/features/registration/store';
import { colors, radius, spacing } from '@/theme';

/** "AI가 정리한 계약정보를 확인해주세요." — 저장 전 필수 확인/수정 단계. AI 체크는 폼 아래 보조 영역. */
export default function ReviewScreen() {
  const today = useToday();
  const { extraction, files, method } = useRegistration();
  const create = useCreateContract();
  const model = useMemo(() => (extraction ? toReviewModel(extraction) : null), [extraction]);
  // 저장 후 초안을 비울 때 "초안 없음 → 처음으로" 이동이 일어나지 않도록
  const saved = useRef(false);

  useEffect(() => {
    if (!extraction && !saved.current) router.replace('/register');
  }, [extraction]);

  if (!model || !extraction) return null;

  const header = (
    <View style={styles.header}>
      <AppText variant="title2">AI가 정리한 계약정보를{'\n'}확인해주세요.</AppText>
      <AppText variant="body2" color="textSecondary" style={{ marginTop: spacing.sm }}>
        자동으로 정리한 내용은 틀릴 수 있습니다.{'\n'}특히 <AppText variant="body2Strong" color="check">확인 필요</AppText> 항목은 계약서와 비교해주세요. 모든 항목을 저장 전에 수정할 수 있어요.
      </AppText>

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

  const trailing =
    extraction.checks.length > 0 ? (
      <View style={styles.trailing}>
        <View style={styles.checks} testID="review-checks">
          <AppText variant="captionStrong" color="textSecondary" style={{ marginBottom: spacing.sm }}>
            참고: 계약서에서 확인이 필요한 조항 {extraction.checks.length}건
          </AppText>
          {extraction.checks.map((c) => (
            <View key={c.title} style={styles.check}>
              <SeverityLabel severity={c.severity} />
              <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
                <AppText variant="captionStrong">{c.title}</AppText> — {c.description}
              </AppText>
            </View>
          ))}
          <AppText variant="small" color="textTertiary" style={{ marginTop: spacing.xs }}>
            {AI_DISCLAIMER}
          </AppText>
        </View>
      </View>
    ) : null;

  return (
    <ContractForm
      trailing={trailing}
      defaultValues={draftToForm(model.draft)}
      flagged={model.flagged}
      evidence={model.evidence}
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
            documents: files.map((f) => ({ fileName: f.name, mimeType: f.mimeType, sizeBytes: f.size, localUri: f.uri, pageCount: null })),
            aiChecks: extraction.checks.map((c) => ({ ...c, status: 'new' as const })),
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
  files: { marginTop: spacing.lg, gap: 6 },
  file: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  trailing: { paddingHorizontal: spacing.gutter },
  checks: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSubtle },
  check: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginBottom: spacing.sm },
});
