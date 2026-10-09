import { lazy, Suspense, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import type { WebViewMessageEvent } from 'react-native-webview';

import { htmlFor, isAllowedViewerNavigation, VIEWER_BASE_URL, type ViewerConfig } from './viewerHtml';
import { parseViewerMessage, type ViewerEvent } from './viewerMessages';

export type { ViewerEvent } from './viewerMessages';

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
 * 앱 안 계약서 뷰어 (Android·iOS) — PDF는 앱에 포함된 pdf.js, 사진은 pdf.js 없이 이미지 한 장.
 * 외부 주소로 이동·새 창·파일 접근을 막고, 캐시·쿠키를 남기지 않는다(incognito). 웹 콘솔 로그는 앱으로 넘기지 않는다.
 * WebView 렌더러가 죽어도(onRenderProcessGone) 앱은 종료하지 않고 오류로 알린다.
 */
export function DocumentViewer({
  config,
  onEvent,
  onMounted,
  variant = 'full',
}: {
  config: ViewerConfig;
  onEvent: (e: ViewerEvent) => void;
  onMounted?: () => void;
  /** 진단용: min = 설정 없이 HTML만 / base = + 가상 주소(baseUrl) / full = 실제 뷰어 설정 전부 */
  variant?: 'min' | 'base' | 'full';
}) {
  const html = useMemo(() => htmlFor(config), [config]);
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
        javaScriptEnabled
        domStorageEnabled={false}
        incognito
        cacheEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        allowsLinkPreview={false}
        dataDetectorTypes="none"
        mixedContentMode="never"
        setBuiltInZoomControls
        setDisplayZoomControls={false}
        bounces={false}
        overScrollMode="never"
        testID="document-viewer"
      />
    </Suspense>
  );
}

const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: '#e9ecf1' } });
