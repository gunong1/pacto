import { useEffect, useMemo } from 'react';

import { htmlFor, type ViewerConfig } from './viewerHtml';
import { parseViewerMessage, type ViewerEvent } from './viewerMessages';

export type { ViewerEvent } from './viewerMessages';

/** 웹: 같은 뷰어 HTML을 iframe(srcdoc, 스크립트만 허용)으로 — 앱과 같은 화면 맞춤·확대 동작 확인용 */
export function DocumentViewer({ config, onEvent, onMounted }: { config: ViewerConfig; onEvent: (e: ViewerEvent) => void; onMounted?: () => void }) {
  const html = useMemo(() => htmlFor(config), [config]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return;
      const m = parseViewerMessage(e.data);
      if (m) onEvent(m);
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [onEvent]);
  // iframe 안에서는 window.ReactNativeWebView 대신 부모 창으로 알린다
  const doc = html.replace('<head>', '<head><script>window.ReactNativeWebView={postMessage:function(m){parent.postMessage(m,"*")}};</script>');
  return <iframe title="계약서" srcDoc={doc} sandbox="allow-scripts" style={{ border: 0, flex: 1, width: '100%', height: '100%' }} data-testid="document-viewer" onLoad={() => onMounted?.()} />;
}
