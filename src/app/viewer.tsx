import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { signViewerFile, VIEWER_TITLE } from '@/features/documents/openDocument';
import { PdfPasswordModal } from '@/features/documents/PdfPasswordForm';
import { DocumentViewer, type ViewerControl, type ViewerEvent } from '@/features/viewer/DocumentViewer';
import { errorCode, recordViewerStep, VIEWER_DIAGNOSTICS, type ViewerMode, type ViewerStep } from '@/features/viewer/diagnostics';
import { SAMPLE_PDF_BASE64 } from '@/features/viewer/samplePdf';
import { dropViewerSession, getViewerSession } from '@/features/viewer/session';
import { ViewerErrorBoundary } from '@/features/viewer/ViewerErrorBoundary';
import type { ViewerConfig } from '@/features/viewer/viewerHtml';
import { colors, spacing } from '@/theme';

const LOAD_FAILED = '계약서를 불러오지 못했어요.\n잠시 후 다시 시도해주세요.';

/** 오류 코드 → 안내 (내부 코드·주소는 보여주지 않는다. 진단 모드에서만 코드를 함께 보여준다) */
function errorCopy(code: string): string {
  if (code === 'pdf_password') return 'PDF 비밀번호를 입력해야 원본을 볼 수 있어요.';
  return LOAD_FAILED;
}

const DIAG_MODES = ['route', 'blank_min', 'blank_base', 'blank', 'init', 'sample'] as const;
const DIAG_TITLE: Record<Exclude<ViewerMode, 'real'>, string> = {
  route: '진단 1 · 화면만',
  blank_min: '진단 2-1 · WebView 최소 설정',
  blank_base: '진단 2-2 · WebView + 가상 주소',
  blank: '진단 2-3 · WebView 전체 설정',
  init: '진단 3 · pdf.js 초기화',
  sample: '진단 4 · 내장 테스트 PDF',
};

type ErrorUtilsLike = { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void };

/**
 * 계약서 뷰어 — 보호본·원본·사진 모두 같은 화면 (원본은 이 화면에 오기 전에 requireReveal 확인을 거친다)
 * 첫 화면은 페이지 폭에 맞추고, 두 손가락으로 확대·이동할 수 있다.
 * 문서를 불러오지 못해도 앱을 종료하지 않고 오류 화면을 보여준다.
 * 진단 모드(diag=route|blank|init|sample): 단계별로 나눠 어디서 문제가 생기는지 확인한다.
 */
export default function ViewerScreen() {
  const { id, diag } = useLocalSearchParams<{ id?: string; diag?: string }>();
  const mode: ViewerMode = VIEWER_DIAGNOSTICS && (DIAG_MODES as readonly string[]).includes(diag ?? '') ? (diag as ViewerMode) : 'real';
  const [session] = useState(() => (mode === 'real' ? getViewerSession(id) : null));
  const files = session?.files && session.files.length > 1 ? session.files : null;
  // 여러 파일: 지금 보는 파일 번호와 그 설정 (다른 파일을 고르면 Signed URL을 새로 만든다)
  const [index, setIndex] = useState(session?.index ?? 0);
  const [fileConfig, setFileConfig] = useState<ViewerConfig | null>(session);
  const config = useMemo<ViewerConfig | null>(() => {
    if (mode === 'blank' || mode === 'blank_min' || mode === 'blank_base') return { kind: 'blank' };
    if (mode === 'init') return { kind: 'init' };
    if (mode === 'sample') return { kind: 'pdf', data: SAMPLE_PDF_BASE64 };
    return fileConfig;
  }, [mode, fileConfig]);
  const [state, setState] = useState<'loading' | 'ready' | { error: string }>(() => (mode === 'route' ? 'ready' : config ? 'loading' : { error: 'no_session' }));
  const [showWeb, setShowWeb] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  /** 암호 원본: 비밀번호 입력 (기기 안 뷰어로만 전달 — 저장·서버 전송 없음) */
  const control = useRef<ViewerControl | null>(null);
  const [askPassword, setAskPassword] = useState<{ invalid: boolean } | null>(null);

  const record = useCallback(
    (step: ViewerStep, code?: string) => {
      recordViewerStep(mode, step, code);
      // 화면 표시는 다음 틱에 (기록 자체는 위에서 바로 파일에 남았다)
      if (VIEWER_DIAGNOSTICS) setTimeout(() => setSteps((s) => [...s, code ? `${step}(${code})` : step]), 0);
    },
    [mode],
  );

  useEffect(() => {
    record('viewer_route');
    if (mode === 'route') return;
    if (!config) return record('error', 'no_session');
    // WebView를 붙이기 직전 기록 → 다음 화면 갱신에서 붙인다 (붙이는 순간 종료되는지 구분)
    record('webview_mounting');
    const t = setTimeout(() => setShowWeb(true), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 뷰어가 열려 있는 동안의 자바스크립트 오류는 앱을 종료하지 않고 오류 화면으로 (오류 이름만 기록)
  useEffect(() => {
    const eu = (globalThis as unknown as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
    if (!eu) return;
    const prev = eu.getGlobalHandler();
    eu.setGlobalHandler((e) => {
      record('error', errorCode(e));
      setState({ error: errorCode(e) });
    });
    return () => eu.setGlobalHandler(prev);
  }, [record]);

  useEffect(() => () => dropViewerSession(id), [id]);

  const onEvent = useCallback(
    (e: ViewerEvent) => {
      if (e.type === 'step') return record(e.step as ViewerStep, e.code);
      if (e.type === 'password') return setAskPassword({ invalid: e.invalid });
      if (e.type === 'loaded') {
        record('loaded');
        return setState('ready');
      }
      record('error', e.code);
      setState({ error: e.code });
    },
    [record],
  );

  const selectFile = useCallback(
    async (i: number) => {
      if (!files || i === index) return;
      setIndex(i);
      setFileConfig(null);
      setState('loading');
      record('webview_mounting');
      try {
        setFileConfig(await signViewerFile(files[i]));
      } catch {
        record('error', 'sign');
        setState({ error: 'sign' });
      }
    },
    [files, index, record],
  );

  const title = mode === 'real' ? (files ? VIEWER_TITLE[files[index].variant] : (session?.title ?? '계약서')) : DIAG_TITLE[mode];
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
      {mode === 'route' ? (
        <View style={styles.center}>
          <AppText variant="body2">1단계: 뷰어 화면만 열렸어요 (WebView 없음).</AppText>
        </View>
      ) : null}
      {config && showWeb && !failed ? (
        <ViewerErrorBoundary
          fallback={null}
          onError={(name) => {
            record('error', errorCode(Object.assign(new Error(), { name })));
            setState({ error: 'render' });
          }}
        >
          <DocumentViewer
            key={index}
            config={config}
            onEvent={onEvent}
            onMounted={() => record('webview_mounted')}
            variant={mode === 'blank_min' ? 'min' : mode === 'blank_base' ? 'base' : 'full'}
            controlRef={control}
          />
        </ViewerErrorBoundary>
      ) : null}
      {state === 'loading' && mode !== 'route' && !failed ? (
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
          {mode !== 'real' ? (
            <AppText variant="caption" color="textTertiary">
              오류 코드: {state.error}
            </AppText>
          ) : null}
          <Button label="닫기" variant="secondary" size="sm" onPress={() => router.back()} testID="viewer-close" />
        </View>
      ) : null}
      </View>
      {/* 단계 표시는 진단 화면에서 연 진단 단계에서만 (실제 문서 보기에서는 기록만 남기고 화면에 보이지 않는다) */}
      {VIEWER_DIAGNOSTICS && mode !== 'real' ? (
        <View style={styles.diag} pointerEvents="none" testID="viewer-diag-steps">
          <AppText variant="caption" color="textSecondary">
            {steps.join(' → ')}
          </AppText>
        </View>
      ) : null}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  error: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl, backgroundColor: colors.bg },
  diag: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.sm, backgroundColor: 'rgba(255,255,255,0.92)' },
});
