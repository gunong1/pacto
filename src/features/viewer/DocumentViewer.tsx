import { lazy, Suspense, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { StyleSheet } from 'react-native';
import type { WebView as WebViewType, WebViewMessageEvent, WebViewProps } from 'react-native-webview';

import { htmlFor, isAllowedViewerNavigation, VIEWER_BASE_URL, type ViewerConfig } from './viewerHtml';
import { parseViewerMessage, type ViewerEvent } from './viewerMessages';

export type { ViewerEvent } from './viewerMessages';

/** 앱 → 뷰어: 암호 PDF 비밀번호 전달 / 입력 취소 (비밀번호는 기기 안 뷰어로만, 기록하지 않음) */
export interface ViewerControl {
  sendPassword: (password: string) => void;
  cancelPassword: () => void;
}

/**
 * react-native-webview는 불러오는 순간 네이티브 모듈(RNCWebViewModule)을 찾고, 없으면 오류를 던진다.
 * 화면 파일 맨 위에서 불러오면 그 오류가 앱 전체 종료로 이어질 수 있어, 화면에 붙일 때 불러오고(lazy)
 * 실패하면 이름 있는 오류(WebViewUnavailable)로 바꿔 뷰어의 Error Boundary가 잡게 한다.
 */
const LazyWebView = lazy(() =>
  import('react-native-webview')
    .then((m) => ({ default: m.WebView }))
    .catch(() => {
      throw Object.assign(new Error('webview_unavailable'), { name: 'WebViewUnavailable' });
    }),
);

/**
 * 고정 설정 — 값의 형식은 네이티브 정의(react-native-webview RNCWebViewNativeComponent)와 맞아야 한다.
 * Android는 JS 쪽 변환 없이 그대로 네이티브로 넘기므로, 목록(Array) 설정에 글자를 넣으면 WebView를 만들 때 앱이 종료된다
 * (실기기 확인: dataDetectorTypes="none" → ClassCastException at RNCWebViewManagerDelegate.setProperty). 테스트가 형식을 대조한다.
 */
export const VIEWER_WEBVIEW_PROPS = {
  javaScriptEnabled: true,
  domStorageEnabled: false,
  incognito: true,
  cacheEnabled: false,
  allowFileAccess: false,
  allowFileAccessFromFileURLs: false,
  allowUniversalAccessFromFileURLs: false,
  setSupportMultipleWindows: false,
  javaScriptCanOpenWindowsAutomatically: false,
  allowsLinkPreview: false,
  // 목록 형식 (iOS 전화번호·주소 자동 링크 끔). 글자 "none"으로 넣으면 Android에서 종료된다
  dataDetectorTypes: ['none'],
  mixedContentMode: 'never',
  setBuiltInZoomControls: true,
  setDisplayZoomControls: false,
  bounces: false,
  overScrollMode: 'never',
} as const satisfies Partial<WebViewProps>;

/**
 * 앱 안 계약서 뷰어 (Android·iOS) — PDF는 앱에 포함된 pdf.js, 사진은 pdf.js 없이 이미지 한 장.
 * 외부 주소로 이동·새 창·파일 접근을 막고, 캐시·쿠키를 남기지 않는다(incognito). 웹 콘솔 로그는 앱으로 넘기지 않는다.
 * WebView 렌더러가 죽어도(onRenderProcessGone) 앱은 종료하지 않고 오류로 알린다.
 */
export function DocumentViewer({
  config,
  onEvent,
  onMounted,
  variant = 'full',
  controlRef,
}: {
  config: ViewerConfig;
  onEvent: (e: ViewerEvent) => void;
  onMounted?: () => void;
  /** 진단용: min = 설정 없이 HTML만 / base = + 가상 주소(baseUrl) / full = 실제 뷰어 설정 전부 */
  variant?: 'min' | 'base' | 'full';
  /** 비밀번호 전달용 (원본 보기) */
  controlRef?: MutableRefObject<ViewerControl | null>;
}) {
  const html = useMemo(() => htmlFor(config), [config]);
  const web = useRef<WebViewType | null>(null);
  // 비밀번호 전달 통로 (원본 보기) — 화면에 붙은 뒤에 연결
  useEffect(() => {
    if (!controlRef) return;
      controlRef.current = {
        sendPassword: (password) => web.current?.postMessage(JSON.stringify({ type: 'pacto_password', password })),
        cancelPassword: () => web.current?.postMessage(JSON.stringify({ type: 'pacto_password_cancel' })),
      };
    return () => {
      controlRef.current = null;
    };
  }, [controlRef]);
  const onMessage = (e: WebViewMessageEvent) => {
    const m = parseViewerMessage(e.nativeEvent.data);
    if (m) onEvent(m);
  };
  if (variant !== 'full') {
    return (
      <Suspense fallback={null}>
        <LazyWebView
          style={styles.web}
          source={variant === 'base' ? { html, baseUrl: VIEWER_BASE_URL } : { html }}
          onMessage={onMessage}
          onLoadEnd={() => onMounted?.()}
          onRenderProcessGone={() => onEvent({ type: 'error', code: 'webview_renderer_gone' })}
        />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={null}>
      <LazyWebView
        ref={web}
        style={styles.web}
        source={{ html, baseUrl: VIEWER_BASE_URL }}
        originWhitelist={[VIEWER_BASE_URL, 'about:*']}
        onShouldStartLoadWithRequest={(req) => isAllowedViewerNavigation(req.url)}
        onMessage={onMessage}
        onLoadEnd={() => onMounted?.()}
        onError={() => onEvent({ type: 'error', code: 'webview_load' })}
        onHttpError={() => onEvent({ type: 'error', code: 'webview_http' })}
        onRenderProcessGone={() => onEvent({ type: 'error', code: 'webview_renderer_gone' })}
        onContentProcessDidTerminate={() => onEvent({ type: 'error', code: 'webview_renderer_gone' })}
        {...VIEWER_WEBVIEW_PROPS}
        testID="document-viewer"
      />
    </Suspense>
  );
}

const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: '#e9ecf1' } });
