import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { SwitchRow } from '@/components/ui/controls';
import { Section } from '@/components/ui/layout';
import type { AiCheck } from '@/domain/types';
import { notify } from '@/lib/dialog';
import { colors, hitSlop, radius, spacing } from '@/theme';

import { enablePush, shouldOfferPushPrompt, snoozePushPrompt } from './push';
import { useContractNotificationOverride } from './queries';

/** 계약 상세 — 이 계약의 알림: 받기 + 지금 쓰는 설정 + 변경 */
export function ContractNotificationSection({ contractId, enabled, onToggle }: { contractId: string; enabled: boolean; onToggle: (v: boolean) => void }) {
  const { data: override } = useContractNotificationOverride(contractId);
  return (
    <Section title="계약 알림" testID="contract-notifications">
      <SwitchRow label="알림 받기" description="만료·해지 통보기한·결제일 알림" value={enabled} onValueChange={onToggle} testID="detail-notifications" />
      {enabled ? (
        <Pressable style={styles.row} onPress={() => router.push(`/contract/${contractId}/notifications`)} accessibilityRole="button" hitSlop={hitSlop} testID="open-contract-notifications">
          <View style={{ flex: 1 }}>
            <AppText variant="caption" color="textTertiary">
              현재
            </AppText>
            <AppText variant="body2" testID="contract-notification-mode">
              {override ? '이 계약만 직접 설정' : '내 기본 알림 설정 사용'}
            </AppText>
          </View>
          <AppText variant="captionStrong" color="primary">
            알림 설정 변경
          </AppText>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </Pressable>
      ) : null}
    </Section>
  );
}

/** 푸시를 눌러 들어왔을 때: 어떤 알림인지 + 관련 조항 보기 */
export function PushOpenedBanner({ eventLabel, check, onOpenCheck }: { eventLabel: string | null; check: AiCheck | null; onOpenCheck?: () => void }) {
  return (
    <View style={styles.banner} testID="push-opened">
      <Ionicons name="notifications" size={16} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <AppText variant="captionStrong">알림에서 열었어요{eventLabel ? ` · ${eventLabel}` : ''}</AppText>
        {check?.evidenceQuote ? (
          <AppText variant="caption" color="textSecondary" numberOfLines={2} style={{ marginTop: 2 }}>
            관련 조항: {check.title}
          </AppText>
        ) : null}
      </View>
      {check && onOpenCheck ? <Button label="관련 조항 보기" size="sm" variant="secondary" onPress={onOpenCheck} testID="push-open-check" /> : null}
    </View>
  );
}

/**
 * 첫 계약 저장 직후 안내 — OS 권한 팝업을 바로 띄우지 않고, 알림의 가치를 먼저 설명한 뒤 "알림 받기"를 눌렀을 때만 요청한다.
 */
export function PushPromptSheet({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    shouldOfferPushPrompt()
      .then((v) => alive && setOpen(v))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [active]);
  const later = () => {
    snoozePushPrompt();
    setOpen(false);
  };
  const accept = async () => {
    setOpen(false);
    const r = await enablePush().catch(() => 'denied' as const);
    if (r === 'blocked') notify('알림이 꺼져 있어요', '휴대폰 설정에서 PACTO 알림을 허용해주세요.');
    if (r !== 'granted') snoozePushPrompt();
  };
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={later}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="push-prompt">
          <Ionicons name="notifications-outline" size={28} color={colors.primary} />
          <AppText variant="title3" style={{ marginTop: spacing.sm }}>
            중요한 계약 일정을 알려드릴까요?
          </AppText>
          <AppText variant="body2" color="textSecondary" style={{ marginTop: spacing.xs }}>
            결제일, 만료, 갱신·해지기한을 놓치지 않도록 알려드려요.
          </AppText>
          <Button label="알림 받기" onPress={accept} style={{ marginTop: spacing.lg }} testID="push-prompt-accept" />
          <Button label="나중에" variant="ghost" onPress={later} testID="push-prompt-later" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.gutter, marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, padding: spacing.gutter, paddingBottom: spacing.xl, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
});
