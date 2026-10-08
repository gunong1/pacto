import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/controls';
import type { DocumentProtection, SensitiveRegion } from '@/domain/types';
import { colors, hitSlop, radius, spacing } from '@/theme';

import { canProtect, IMAGES_UNCHECKED_NOTE, needsReview, PROTECTION_DISCLAIMER, protectionCopy, sensitiveLabel } from './protectionCopy';

/**
 * 민감정보 보호 결과 카드 — 보호 결과를 알리고(신뢰), 항목별로 확인·가리기 해제를 할 수 있게 한다.
 * 상태(보호됨 / 감지되지 않음 / 미지원(사진·스캔) / 실패 / 처리 전)를 서로 다르게 보여준다.
 */
export function ProtectionCard({
  protection,
  fileName,
  busy,
  onChangeRegion,
  onProtect,
  onViewOriginal,
  defaultOpen = false,
  testID,
}: {
  protection: DocumentProtection | undefined;
  fileName?: string;
  busy?: boolean;
  /** 가리기 해제(unmasked) / 다시 가리기(masked) */
  onChangeRegion?: (region: SensitiveRegion, state: 'masked' | 'unmasked') => void;
  /** 처리 전·실패 문서 보호 처리 */
  onProtect?: () => void;
  onViewOriginal?: () => void;
  defaultOpen?: boolean;
  testID?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const copy = protectionCopy(protection);
  if (!protection || !copy) return null;
  const regions = protection.regions;
  const review = regions.filter(needsReview).length;
  const icon = copy.tone === 'protected' ? 'shield-checkmark' : copy.tone === 'warning' ? 'alert-circle-outline' : 'shield-outline';
  const iconColor = copy.tone === 'protected' ? colors.primary : copy.tone === 'warning' ? colors.check : colors.textTertiary;

  return (
    <View style={[styles.card, copy.tone === 'protected' ? styles.protected : copy.tone === 'warning' ? styles.warning : styles.neutral]} testID={testID}>
      <View style={styles.head}>
        <Ionicons name={icon} size={20} color={iconColor} />
        <View style={{ flex: 1 }}>
          <AppText variant="body2Strong" testID={testID ? `${testID}-title` : undefined}>
            {copy.title}
          </AppText>
          {fileName ? (
            <AppText variant="small" color="textTertiary" numberOfLines={1}>
              {fileName}
            </AppText>
          ) : null}
        </View>
        {review > 0 ? <Badge label={`확인 필요 ${review}`} tone="check" /> : null}
      </View>
      <AppText variant="caption" color="textSecondary" style={{ marginTop: spacing.xs }} testID={testID ? `${testID}-body` : undefined}>
        {copy.body}
      </AppText>
      {protection.imagesUnchecked && protection.status !== 'unsupported_scan' ? (
        <AppText variant="small" color="textTertiary" style={{ marginTop: spacing.xs }}>
          {IMAGES_UNCHECKED_NOTE}
        </AppText>
      ) : null}

      {regions.length > 0 ? (
        <Pressable onPress={() => setOpen((v) => !v)} hitSlop={hitSlop} accessibilityRole="button" style={styles.toggle} testID={testID ? `${testID}-toggle` : undefined}>
          <AppText variant="captionStrong" color="primary">
            {open ? '접기' : '보호된 정보 보기'}
          </AppText>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primary} />
        </Pressable>
      ) : null}

      {open
        ? regions.map((r) => (
            <View key={r.id} style={styles.region} testID={testID ? `${testID}-region-${r.type}` : undefined}>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.regionHead}>
                  <AppText variant="captionStrong">{sensitiveLabel(r.type)}</AppText>
                  <AppText variant="small" color="textTertiary">
                    {r.page}쪽 · {r.state === 'masked' ? '가림' : r.state === 'unmasked' ? '표시' : '가리지 않음'}
                  </AppText>
                  {needsReview(r) ? <Badge label="확인 필요" tone="check" /> : null}
                </View>
                <AppText variant="caption" color="textSecondary" tabular>
                  {r.maskedPreview}
                </AppText>
              </View>
              {onChangeRegion ? (
                <Button
                  label={r.state === 'masked' ? '가리기 해제' : '가리기'}
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onPress={() => onChangeRegion(r, r.state === 'masked' ? 'unmasked' : 'masked')}
                  testID={testID ? `${testID}-region-${r.type}-toggle` : undefined}
                />
              ) : null}
            </View>
          ))
        : null}

      {onProtect || onViewOriginal ? (
        <View style={styles.actions}>
          {onProtect && canProtect(protection) ? (
            <Button
              label={protection.status === 'failed' ? '다시 시도' : '민감정보 보호하기'}
              size="sm"
              variant="secondary"
              loading={busy}
              onPress={onProtect}
              testID={testID ? `${testID}-protect` : undefined}
            />
          ) : null}
          {onViewOriginal ? <Button label="원본 보기" size="sm" variant="ghost" onPress={onViewOriginal} testID={testID ? `${testID}-original` : undefined} /> : null}
        </View>
      ) : null}
      <AppText variant="small" color="textTertiary" style={{ marginTop: spacing.sm }}>
        {PROTECTION_DISCLAIMER}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md },
  protected: { backgroundColor: colors.primarySoft },
  neutral: { backgroundColor: colors.bgSubtle },
  warning: { backgroundColor: colors.checkSoft },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm, alignSelf: 'flex-start' },
  region: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  regionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
});
