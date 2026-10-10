import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { signViewerFile, VIEWER_TITLE } from '@/features/documents/openDocument';
import { PdfPasswordModal } from '@/features/documents/PdfPasswordForm';
import { DocumentViewer, type ViewerControl, type ViewerEvent } from '@/features/viewer/DocumentViewer';
import { dropViewerSession, getViewerSession } from '@/features/viewer/session';
import { ViewerErrorBoundary } from '@/features/viewer/ViewerErrorBoundary';
import type { ViewerConfig } from '@/features/viewer/viewerHtml';
import { colors, spacing } from '@/theme';

const LOAD_FAILED = '계약서를 불러오지 못했어요.\n잠시 후 다시 시도해주세요.';

/** 오류 코드 → 안내 (내부 코드·주소는 보여주지 않는다) */
function errorCopy(code: string): string {
  if (code === 'pdf_password') return 'PDF 비밀번호를 입력해야 원본을 볼 수 있어요.';
  return LOAD_FAILED;
}

/** 오류 객체 → 짧은 코드 (메시지는 쓰지 않는다 — 주소가 섞일 수 있음) */
function errorCode(e: unknown): string {
  const name = e instanceof Error ? e.name : typeof e;
  return `js_${name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30) || 'unknown'}`;
}

type ErrorUtilsLike = { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void };

/**
 * 계약서 뷰어 — 보호본·원본·사진 모두 같은 화면 (원본은 이 화면에 오기 전에 requireReveal 확인을 거친다)
 * 첫 화면은 페이지 폭에 맞추고, 두 손가락으로 확대·이동할 수 있다.
 * 문서를 불러오지 못해도 앱을 종료하지 않고 오류 화면을 보여준다.
 */
export default function ViewerScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [session] = useState(() => getViewerSession(id));
  const files = session?.files && session.files.length > 1 ? session.files : null;
  // 여러 파일: 지금 보는 파일 번호와 그 설정 (다른 파일을 고르면 Signed URL을 새로 만든다)
  const [index, setIndex] = useState(session?.index ?? 0);
  const [config, setConfig] = useState<ViewerConfig | null>(session);
  const [state, setState] = useState<'loading' | 'ready' | { error: string }>(() => (config ? 'loading' : { error: 'no_session' }));
  const [showWeb, setShowWeb] = useState(false);
  /** 암호 원본: 비밀번호 입력 (기기 안 뷰어로만 전달 — 저장·서버 전송 없음) */
  const control = useRef<ViewerControl | null>(null);
  const [askPassword, setAskPassword] = useState<{ invalid: boolean } | null>(null);

  useEffect(() => {
    if (!config) return;
    // WebView는 다음 화면 갱신에서 붙인다
    const t = setTimeout(() => setShowWeb(true), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 뷰어가 열려 있는 동안의 자바스크립트 오류는 앱을 종료하지 않고 오류 화면으로 (오류 이름만 기록)
  useEffect(() => {
    const eu = (globalThis as unknown as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
    if (!eu) return;
    const prev = eu.getGlobalHandler();
    eu.setGlobalHandler((e) => setState({ error: errorCode(e) }));
    return () => eu.setGlobalHandler(prev);
  }, []);

  useEffect(() => () => dropViewerSession(id), [id]);

  const onEvent = useCallback(
    (e: ViewerEvent) => {
      if (e.type === 'step') return;
      if (e.type === 'password') return setAskPassword({ invalid: e.invalid });
      if (e.type === 'loaded') return setState('ready');
      setState({ error: e.code });
    },
    [],
  );

  const selectFile = useCallback(
    async (i: number) => {
      if (!files || i === index) return;
      setIndex(i);
      setConfig(null);
      setState('loading');
      try {
        setConfig(await signViewerFile(files[i]));
      } catch {
        setState({ error: 'sign' });
      }
    },
    [files, index],
  );

  const title = files ? VIEWER_TITLE[files[index].variant] : (session?.title ?? '계약서');
  const failed = typeof state === 'object';
  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <Stack.Screen options={{ title }} />
      <PdfPasswordModal
        visible={askPassword !== null}
        invalid={askPassword?.invalid}
        submitLabel="원본 열기"
        onSubmit={(pw) => {
          setAskPassword(null);
          control.current?.sendPassword(pw);
        }}
        onCancel={() => {
          setAskPassword(null);
          control.current?.cancelPassword();
        }}
      />
      {files ? (
        <View style={styles.tabsBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {files.map((_, i) => (
              <Pressable
                key={i}
                onPress={() => selectFile(i)}
                accessibilityRole="tab"
                accessibilityState={{ selected: i === index }}
                testID={`viewer-file-${i + 1}`}
                style={[styles.tab, i === index && styles.tabActive]}>
                <AppText variant="caption" color={i === index ? 'textInverse' : 'textSecondary'}>
                  파일 {i + 1}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
          <AppText variant="caption" color="textTertiary">
            {index + 1} / {files.length}
          </AppText>
        </View>
      ) : null}
      <View style={styles.body}>
      {config && showWeb && !failed ? (
        <ViewerErrorBoundary
          fallback={null}
          onError={() => setState({ error: 'render' })}
        >
          <DocumentViewer
            key={index}
            config={config}
            onEvent={onEvent}
            controlRef={control}
          />
        </ViewerErrorBoundary>
      ) : null}
      {state === 'loading' && !failed ? (
        <View style={styles.overlay} pointerEvents="none" testID="viewer-loading">
          <ActivityIndicator color={colors.textTertiary} />
        </View>
      ) : null}
      {failed ? (
        <View style={styles.error} testID="viewer-error">
          <Ionicons name="document-outline" size={32} color={colors.textTertiary} />
          <AppText variant="body2" color="textSecondary" style={{ textAlign: 'center' }}>
            {errorCopy(state.error)}
          </AppText>
          <Button label="닫기" variant="secondary" size="sm" onPress={() => router.back()} testID="viewer-close" />
        </View>
      ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#e9ecf1' },
  body: { flex: 1 },
  tabsBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.bg },
  tabs: { gap: spacing.xs },
  tab: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 999, backgroundColor: colors.bgSubtle },
  tabActive: { backgroundColor: colors.primary },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  error: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl, backgroundColor: colors.bg },
});
