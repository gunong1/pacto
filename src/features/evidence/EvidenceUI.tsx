/**
 * "계약서 근거 보기" 공통 UI — 등록 확인 · 계약 수정 · 계약 상세가 같은 아이콘·시트를 쓴다.
 * 규칙은 src/domain/evidence.ts (근거 있을 때만 아이콘 · 민감정보 가림 · 사용자 수정 후에도 AI 값·근거 유지).
 * 근거 문장은 입력칸 아래에 늘 펼쳐 두지 않고, 아이콘을 누를 때만 시트로 보여준다.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import type { FieldEvidenceView } from '@/domain/evidence';
import { colors, hitSlop, radius, spacing } from '@/theme';

type Shown = { label: string; view: FieldEvidenceView } | null;
interface EvidenceCtx {
  show: (label: string, view: FieldEvidenceView) => void;
}
const Ctx = createContext<EvidenceCtx | null>(null);

/** 시트 하나를 화면에 두고, 아이콘들이 이 시트를 연다 */
export function EvidenceProvider({ children, openDocument }: { children: ReactNode; openDocument?: (documentId: string | null, page: number | null) => void }) {
  const [shown, setShown] = useState<Shown>(null);
  const show = useCallback((label: string, view: FieldEvidenceView) => setShown({ label, view }), []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <EvidenceSheet shown={shown} onClose={() => setShown(null)} openDocument={openDocument} />
    </Ctx.Provider>
  );
}

/** 입력칸 라벨 옆의 작은 아이콘 — 근거가 없으면(직접 입력) 그리지 않는다 */
export function EvidenceButton({ label, view, testID }: { label: string; view: FieldEvidenceView; testID?: string }) {
  const ctx = useContext(Ctx);
  if (!view.hasEvidence || !ctx) return null;
  return (
    <Pressable
      onPress={() => ctx.show(label, view)}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={`${label} 계약서 근거 보기`}
      testID={testID}
      style={styles.button}
    >
      <Ionicons name="document-text-outline" size={14} color={colors.textTertiary} />
      {view.edited ? (
        <AppText variant="small" color="textTertiary">
          수정함
        </AppText>
      ) : null}
    </Pressable>
  );
}

function EvidenceSheet({ shown, onClose, openDocument }: { shown: Shown; onClose: () => void; openDocument?: (documentId: string | null, page: number | null) => void }) {
  const v = shown?.view;
  return (
    <Modal visible={!!shown} transparent animationType="fade" onRequestClose={onClose}>
      {/* 배경(누르면 닫힘)과 시트를 겹치지 않게 나란히 둔다 — 버튼 안에 버튼이 들어가지 않도록 */}
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="닫기" testID="evidence-backdrop" />
        <View style={styles.sheet} testID="evidence-sheet">
          <AppText variant="captionStrong" color="textTertiary">
            계약서 근거
          </AppText>
          <AppText variant="bodyStrong" style={{ marginTop: 2 }}>
            {shown?.label}
          </AppText>
          {v?.quote ? (
            <View style={styles.quote}>
              <AppText variant="body2" color="textSecondary" testID="evidence-quote">
                “{v.quote}”
              </AppText>
              {v.page ? (
                <AppText variant="caption" color="textTertiary" style={{ marginTop: 4 }}>
                  계약서 {v.page}쪽
                </AppText>
              ) : null}
            </View>
          ) : null}
          {v?.needsReview ? (
            <AppText variant="caption" color="check" style={{ marginTop: spacing.sm }}>
              확인이 필요한 값이에요. 계약서와 비교해주세요.
            </AppText>
          ) : null}
          {v?.edited && v.aiValue ? (
            <AppText variant="caption" color="textSecondary" style={{ marginTop: spacing.sm }} testID="evidence-ai-value">
              AI가 읽은 값: {v.aiValue} · 고친 값으로 저장돼요
            </AppText>
          ) : null}
          <View style={styles.actions}>
            {openDocument ? (
              <Button
                label="계약서에서 보기"
                variant="secondary"
                size="sm"
                onPress={() => {
                  onClose();
                  openDocument(v?.documentId ?? null, v?.page ?? null);
                }}
                testID="evidence-open-document"
              />
            ) : null}
            <Button label="닫기" size="sm" onPress={onClose} testID="evidence-close" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.bgSubtle },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, padding: spacing.xl, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, gap: 2 },
  quote: { marginTop: spacing.md, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.border },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
});
