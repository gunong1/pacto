import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { DocumentViewer, type ViewerEvent } from '@/features/viewer/DocumentViewer';
import { dropViewerSession, getViewerSession } from '@/features/viewer/session';
import { colors, spacing } from '@/theme';

/** 오류 코드 → 안내 (내부 코드·주소는 보여주지 않는다) */
function errorCopy(code: string): string {
  if (code === 'pdf_password') return '암호가 걸린 문서는 앱에서 열 수 없어요.';
  if (code.startsWith('download')) return '계약서를 불러오지 못했어요. 잠시 후 다시 열어주세요.';
  return '계약서를 표시하지 못했어요. 다시 열어주세요.';
}

/**
 * 계약서 뷰어 — 보호본·원본·사진 모두 같은 화면 (원본은 이 화면에 오기 전에 requireReveal 확인을 거친다)
 * 첫 화면은 페이지 폭에 맞추고, 두 손가락으로 확대·이동할 수 있다.
 */
export default function ViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [session] = useState(() => getViewerSession(id));
  const [state, setState] = useState<'loading' | 'ready' | { error: string }>('loading');
  useEffect(() => () => dropViewerSession(id), [id]);
  const onEvent = useCallback((e: ViewerEvent) => setState(e.type === 'loaded' ? 'ready' : { error: e.code }), []);

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <Stack.Screen options={{ title: session?.title ?? '계약서' }} />
      {session ? <DocumentViewer config={session} onEvent={onEvent} /> : null}
      {state === 'loading' && session ? (
        <View style={styles.overlay} pointerEvents="none" testID="viewer-loading">
          <ActivityIndicator color={colors.textTertiary} />
        </View>
      ) : null}
      {!session || typeof state === 'object' ? (
        <View style={styles.error} testID="viewer-error">
          <Ionicons name="document-outline" size={32} color={colors.textTertiary} />
          <AppText variant="body2" color="textSecondary" style={{ textAlign: 'center' }}>
            {session && typeof state === 'object' ? errorCopy(state.error) : '계약서를 다시 열어주세요.'}
          </AppText>
          <Button label="닫기" variant="secondary" size="sm" onPress={() => router.back()} testID="viewer-close" />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#e9ecf1' },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  error: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl, backgroundColor: colors.bg },
});
