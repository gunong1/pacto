import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { buildViewerHtml, isAllowedViewerNavigation, VIEWER_BASE_URL, type ViewerConfig } from './viewerHtml';

export type ViewerEvent = { type: 'loaded'; kind: string; pages: number; fit: boolean } | { type: 'error'; code: string };

/**
 * 앱 안 계약서 뷰어 (Android·iOS) — 앱에 포함된 pdf.js로 그린다.
 * 외부 주소로 이동·새 창·파일 접근을 막고, 캐시·쿠키를 남기지 않는다(incognito). 웹 콘솔 로그는 앱으로 넘기지 않는다.
 */
export function DocumentViewer({ config, onEvent }: { config: ViewerConfig; onEvent: (e: ViewerEvent) => void }) {
  const html = useMemo(() => buildViewerHtml(config), [config]);
  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data) as ViewerEvent;
      if (m.type === 'loaded' || m.type === 'error') onEvent(m);
    } catch {
      /* 형식이 다른 메시지는 무시 */
    }
  };
  return (
    <WebView
      style={styles.web}
      source={{ html, baseUrl: VIEWER_BASE_URL }}
      originWhitelist={[VIEWER_BASE_URL, 'about:*']}
      onShouldStartLoadWithRequest={(req) => isAllowedViewerNavigation(req.url)}
      onMessage={onMessage}
      onError={() => onEvent({ type: 'error', code: 'webview' })}
      onRenderProcessGone={() => onEvent({ type: 'error', code: 'webview_crash' })}
      onContentProcessDidTerminate={() => onEvent({ type: 'error', code: 'webview_crash' })}
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
      textInteractionEnabled={false}
      mixedContentMode="never"
      setBuiltInZoomControls
      setDisplayZoomControls={false}
      scalesPageToFit={false}
      bounces={false}
      overScrollMode="never"
      testID="document-viewer"
    />
  );
}

const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: '#e9ecf1' } });
