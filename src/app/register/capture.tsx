import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { capturePage, discardCaptured } from '@/features/registration/camera';
import { MAX_PHOTOS } from '@/features/registration/pickers';
import { useRegistration } from '@/features/registration/store';
import { colors, hitSlop, radius, spacing } from '@/theme';

/**
 * 계약서 촬영 — 페이지마다 시스템 카메라를 열고, 촬영 완료 전에 순서 확인·삭제·다시 촬영을 할 수 있다 (최대 10장).
 * 촬영 완료 → 앨범 선택과 같은 등록 흐름(이미지 준비 → 보관 → 문서 확인 → 계약 분석).
 */
export default function CaptureScreen() {
  const captured = useRegistration((s) => s.captured);
  const setCaptured = useRegistration((s) => s.setCaptured);
  const start = useRegistration((s) => s.start);
  const [busy, setBusy] = useState(false);
  const opened = useRef(false);

  const shoot = async (replaceIndex?: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const pages = useRegistration.getState().captured;
      const page = await capturePage(replaceIndex != null ? replaceIndex + 1 : pages.length + 1);
      if (!page) return;
      if (replaceIndex != null) {
        discardCaptured([pages[replaceIndex]]);
        setCaptured(pages.map((p, i) => (i === replaceIndex ? page : p)));
      } else if (pages.length < MAX_PHOTOS) {
        setCaptured([...pages, page]);
      }
    } finally {
      setBusy(false);
    }
  };

  // 처음 들어오면 첫 페이지 촬영부터
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (useRegistration.getState().captured.length > 0) return;
    const t = setTimeout(() => shoot(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = (i: number) => {
    discardCaptured([captured[i]]);
    // 남은 페이지 번호를 다시 매긴다
    setCaptured(captured.filter((_, j) => j !== i).map((p, j) => ({ ...p, name: `계약서_촬영_${j + 1}.jpg` })));
  };

  const done = () => {
    start('photo', captured, 'camera');
    router.replace('/register/analyzing');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']} testID="capture">
      <ScrollView contentContainerStyle={styles.body}>
        <AppText variant="title2" testID="capture-count">
          {captured.length > 0 ? `${captured.length}장 촬영됨` : '계약서를 촬영해주세요'}
        </AppText>
        <AppText variant="body2" color="textSecondary" style={{ marginTop: spacing.sm }}>
          글자가 잘 보이도록 밝은 곳에서 한 페이지씩 촬영해주세요. 잘못 찍은 페이지는 지우거나 다시 찍을 수 있어요. (최대 {MAX_PHOTOS}장)
        </AppText>
        <View style={styles.grid}>
          {captured.map((p, i) => (
            <View key={p.uri} style={styles.page} testID={`capture-page-${i + 1}`}>
              <Image source={{ uri: p.uri }} style={styles.thumb} contentFit="cover" accessibilityLabel={`${i + 1}페이지`} />
              <AppText variant="captionStrong" style={{ marginTop: 4 }}>
                {i + 1}페이지
              </AppText>
              <View style={styles.pageActions}>
                <Pressable onPress={() => shoot(i)} hitSlop={hitSlop} accessibilityRole="button" testID={`capture-retake-${i + 1}`}>
                  <AppText variant="small" color="primary">
                    다시 촬영
                  </AppText>
                </Pressable>
                <Pressable onPress={() => remove(i)} hitSlop={hitSlop} accessibilityRole="button" testID={`capture-delete-${i + 1}`}>
                  <AppText variant="small" color="caution">
                    삭제
                  </AppText>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={styles.actions}>
        <Button
          label={captured.length === 0 ? '촬영하기' : '다음 페이지 촬영'}
          variant={captured.length === 0 ? 'primary' : 'secondary'}
          disabled={busy || captured.length >= MAX_PHOTOS}
          onPress={() => shoot()}
          testID="capture-next"
        />
        {captured.length > 0 ? <Button label="촬영 완료" disabled={busy} onPress={done} testID="capture-done" /> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.gutter },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xl },
  page: { width: 100 },
  thumb: { width: 100, height: 134, borderRadius: radius.sm, backgroundColor: colors.bgSubtle, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  pageActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  actions: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.lg, gap: spacing.sm },
});
