/**
 * WebView 고정 설정의 값 형식 = 네이티브 정의(react-native-webview RNCWebViewNativeComponent.ts)
 * Android는 JS에서 형식을 바꾸지 않고 그대로 넘겨, 목록(Array) 설정에 글자를 넣으면 WebView를 만드는 순간 앱이 종료된다.
 * (실기기 Galaxy S26 · Android 16: dataDetectorTypes="none" → java.lang.ClassCastException: String cannot be cast to ReadableArray
 *  at RNCWebViewManagerDelegate.setProperty)
 */
import fs from 'fs';
import path from 'path';

import { VIEWER_WEBVIEW_PROPS } from '@/features/viewer/DocumentViewer';

const SPEC = fs.readFileSync(path.join(__dirname, '../../../../node_modules/react-native-webview/src/RNCWebViewNativeComponent.ts'), 'utf8');

/** 네이티브 정의에서 속성 이름 → 형식 (array · boolean · string · number) */
function specTypes(): Map<string, string> {
  const body = SPEC.slice(SPEC.indexOf('export interface NativeProps'));
  const out = new Map<string, string>();
  const re = /^ {2}([A-Za-z]+)\??:\s*([\s\S]*?);\s*$/gm;
  for (const m of body.matchAll(re)) {
    const t = m[2];
    const kind = /ReadonlyArray</.test(t) ? 'array' : /boolean/.test(t) ? 'boolean' : /Double|Int32|Float/.test(t) ? 'number' : /string|'/.test(t) ? 'string' : 'other';
    if (!out.has(m[1])) out.set(m[1], kind);
  }
  return out;
}

const kindOf = (v: unknown) => (Array.isArray(v) ? 'array' : typeof v);

describe('WebView 고정 설정 형식 = 네이티브 정의', () => {
  const spec = specTypes();
  test('네이티브 정의를 읽음 (dataDetectorTypes = 목록)', () => {
    expect(spec.get('dataDetectorTypes')).toBe('array');
    expect(spec.get('incognito')).toBe('boolean');
  });
  test.each(Object.entries(VIEWER_WEBVIEW_PROPS))('%s', (name, value) => {
    const expected = spec.get(name);
    if (!expected || expected === 'other') return; // 네이티브 정의에 없는 JS 전용 설정 (WebView 컴포넌트가 처리)
    expect(kindOf(value)).toBe(expected);
  });
  test('회귀: dataDetectorTypes는 글자가 아니라 목록', () => {
    expect(Array.isArray(VIEWER_WEBVIEW_PROPS.dataDetectorTypes)).toBe(true);
  });
});
