import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';

import type { ViewerControl } from './DocumentViewer';

import { htmlFor, type ViewerConfig } from './viewerHtml';
import { parseViewerMessage, type ViewerEvent } from './viewerMessages';

export type { ViewerEvent } from './viewerMessages';

/** 웹: 같은 뷰어 HTML을 iframe(srcdoc, 스크립트만 허용)으로 — 앱과 같은 화면 맞춤·확대 동작 확인용 */
export function DocumentViewer({
  config,
  onEvent,
  onMounted,
  controlRef,
}: {
  config: ViewerConfig;
  onEvent: (e: ViewerEvent) => void;
  onMounted?: () => void;
  variant?: 'min' | 'base' | 'full';
  controlRef?: MutableRefObject<ViewerControl | null>;
}) {
  const html = useMemo(() => htmlFor(config), [config]);
  const frame = useRef<HTMLIFrameElement | null>(null);
  // 비밀번호 전달 통로 (원본 보기) — 화면에 붙은 뒤에 연결
  useEffect(() => {
    if (!controlRef) return;
      controlRef.current = {
        sendPassword: (password) => frame.current?.contentWindow?.postMessage(JSON.stringify({ type: 'pacto_password', password }), '*'),
        cancelPassword: () => frame.current?.contentWindow?.postMessage(JSON.stringify({ type: 'pacto_password_cancel' }), '*'),
      };
    return () => {
      controlRef.current = null;
    };
  }, [controlRef]);
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
  return <iframe ref={frame} title="계약서" srcDoc={doc} sandbox="allow-scripts" style={{ border: 0, flex: 1, width: '100%', height: '100%' }} data-testid="document-viewer" onLoad={() => onMounted?.()} />;
}
