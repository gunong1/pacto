import { useEffect, useMemo } from 'react';

import { buildViewerHtml, type ViewerConfig } from './viewerHtml';
import type { ViewerEvent } from './DocumentViewer';

export type { ViewerEvent } from './DocumentViewer';

/** 웹: 같은 뷰어 HTML을 iframe(srcdoc, 스크립트만 허용)으로 — 앱과 같은 화면 맞춤·확대 동작 확인용 */
export function DocumentViewer({ config, onEvent }: { config: ViewerConfig; onEvent: (e: ViewerEvent) => void }) {
  const html = useMemo(() => buildViewerHtml(config), [config]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return;
      try {
        const m = JSON.parse(e.data) as ViewerEvent;
        if (m.type === 'loaded' || m.type === 'error') onEvent(m);
      } catch {
        /* 무시 */
      }
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [onEvent]);
  // iframe 안에서는 window.ReactNativeWebView 대신 부모 창으로 알린다
  const doc = html.replace('<script>window.__PACTO_VIEWER__', '<script>window.ReactNativeWebView={postMessage:function(m){parent.postMessage(m,"*")}};</script><script>window.__PACTO_VIEWER__');
  return <iframe title="계약서" srcDoc={doc} sandbox="allow-scripts" style={{ border: 0, flex: 1, width: '100%', height: '100%' }} data-testid="document-viewer" />;
}
