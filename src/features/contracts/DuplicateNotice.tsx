/**
 * 중복 등록으로 보이는 계약 안내 (홈) — 규칙: src/domain/duplicates.ts
 * - 합계에서 빼거나 지우지 않는다. 계약을 열어 확인하고, 필요하면 사용자가 직접 삭제
 * - "중복 아니에요"를 누르면 이 기기에서 그 묶음 안내만 숨김 (계약이 바뀌어 묶음이 달라지면 다시 보일 수 있음)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { formatDateKo } from '@/domain/dates';
import type { ContractRecord } from '@/domain/types';
import { colors, radius, spacing } from '@/theme';

const KEY = 'pacto.duplicates.dismissed';

export function DuplicateNotice({ groups, records }: { groups: { key: string; contractIds: string[] }[]; records: readonly ContractRecord[] }) {
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => setDismissed(v ? (JSON.parse(v) as string[]) : []))
      .catch(() => setDismissed([]));
  }, []);
  if (!dismissed) return null;
  const open = groups.filter((g) => !dismissed.includes(g.key));
  if (open.length === 0) return null;
  const dismiss = (key: string) => {
    const next = [...dismissed, key];
    setDismissed(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
  };
  return (
    <View testID="home-duplicates">
      {open.map((g) => (
        <View key={g.key} style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSubtle }} testID="home-duplicate">
          <AppText variant="body2Strong">같은 계약이 {g.contractIds.length}번 등록된 것 같아요</AppText>
          <AppText variant="caption" color="textSecondary" style={{ marginTop: 2, marginBottom: spacing.sm }}>
            계약 종류·기간·금액·당사자가 모두 같아요. 지금은 모두 합계에 들어가 있어요. 열어서 확인해주세요.
          </AppText>
          {g.contractIds.map((id, i) => {
            const r = records.find((x) => x.contract.id === id);
            if (!r) return null;
            return (
              <Pressable key={id} onPress={() => router.push(`/contract/${id}`)} accessibilityRole="link" testID={`home-duplicate-open-${i}`} style={{ paddingVertical: 6 }}>
                <AppText variant="captionStrong" color="primary">
                  {i + 1}. {r.contract.title} · {formatDateKo(r.contract.createdAt.slice(0, 10))} 등록 ›
                </AppText>
              </Pressable>
            );
          })}
          <Pressable onPress={() => dismiss(g.key)} accessibilityRole="button" testID="home-duplicate-dismiss" style={{ alignSelf: 'flex-end', paddingVertical: 6 }}>
            <AppText variant="captionStrong" color="textSecondary">
              중복 아니에요
            </AppText>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
