/* eslint-disable import/first -- jest.mock 다음에 불러와야 한다 */
/** 계약서 뷰어 진단 기록 · 파일 형식 분기 · WebView 신호 검사 (민감정보가 기록에 남지 않는지) */
const store: Record<string, string> = {};
jest.mock('expo-file-system', () => ({
  Paths: { document: 'doc' },
  File: class {
    name: string;
    constructor(_d: string, name: string) {
      this.name = name;
    }
    get exists() {
      return this.name in store;
    }
    textSync() {
      return store[this.name] ?? '';
    }
    write(s: string) {
      store[this.name] = s;
    }
    delete() {
      delete store[this.name];
    }
  },
}));
jest.mock('@/data', () => ({ documentStore: {} }));
jest.mock('expo-web-browser', () => ({}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

import { documentKind } from '@/features/documents/openDocument';
import { parseViewerMessage } from '@/features/viewer/viewerMessages';
import { clearViewerLog, errorCode, readViewerLog, recordViewerStep } from '@/features/viewer/diagnostics';
import { isUsableDocumentUrl } from '@/features/viewer/viewerHtml';

describe('진단 기록 — 단계 이름·코드·시각만, 앱이 종료돼도 남도록 바로 파일에', () => {
  beforeEach(() => clearViewerLog());
  test('단계 순서대로 기록되고 다시 읽힘', () => {
    for (const s of ['viewer_route', 'webview_mounting', 'webview_mounted', 'pdfjs_loaded'] as const) recordViewerStep('real', s);
    expect(readViewerLog().map((e) => e.step)).toEqual(['viewer_route', 'webview_mounting', 'webview_mounted', 'pdfjs_loaded']);
    expect(Object.keys(readViewerLog()[0]).sort()).toEqual(['mode', 'step', 't']);
  });
  test('주소·토큰처럼 생긴 코드는 버림 · 모르는 단계는 기록하지 않음', () => {
    recordViewerStep('real', 'error', 'https://x.supabase.co/object/sign/a.pdf?token=abc');
    recordViewerStep('real', 'error', 'download_missing');
    recordViewerStep('real', 'token=abc' as never);
    const raw = JSON.stringify(readViewerLog());
    expect(raw).not.toContain('token');
    expect(raw).not.toContain('supabase');
    expect(readViewerLog()).toHaveLength(2);
    expect(readViewerLog()[1].code).toBe('download_missing');
  });
  test('오류는 이름만 코드로 (메시지는 쓰지 않음)', () => {
    expect(errorCode(new TypeError('cannot read https://secret/?token=1'))).toBe('js_typeerror');
  });
  test('최근 200줄만 보관', () => {
    for (let i = 0; i < 250; i++) recordViewerStep('sample', 'loaded');
    expect(readViewerLog()).toHaveLength(200);
  });
});

describe('파일 형식 분기 — 사진은 pdf.js로 보내지 않음 (문서마다)', () => {
  test.each([
    [{ mimeType: 'application/pdf', storagePath: 'u/a.pdf' }, 'protected_view', 'pdf'],
    [{ mimeType: 'application/pdf', storagePath: 'u/a.pdf' }, 'original', 'pdf'],
    [{ mimeType: 'image/jpeg', storagePath: 'u/a.jpg' }, 'protected_view', 'image'],
    [{ mimeType: 'image/jpeg', storagePath: 'u/a.jpg' }, 'original', 'image'],
    [{ mimeType: 'image/png', storagePath: 'u/a.png' }, 'original', 'image'],
    [{ mimeType: '', storagePath: 'u/a.PDF' }, 'original', 'pdf'],
    [{ mimeType: '', storagePath: 'u/a.jpeg' }, 'original', 'image'],
  ] as const)('%o %s → %s', (doc, variant, kind) => {
    expect(documentKind(doc as never, variant)).toBe(kind);
  });
  test('파일 2개(PDF + 사진) 계약 — 각자 형식대로', () => {
    const docs = [{ mimeType: 'application/pdf', storagePath: 'u/1.pdf' }, { mimeType: 'image/png', storagePath: 'u/2.png' }];
    expect(docs.map((d) => documentKind(d as never, 'original'))).toEqual(['pdf', 'image']);
  });
});

describe('Signed URL 확인 — 만들지 못했거나 이상하면 뷰어를 열지 않음', () => {
  test.each([[null], [undefined], [''], ['http://x/a.pdf'], ['file:///a.pdf'], ['https://'], ['not a url']])('%p → 사용 안 함', (u) => {
    expect(isUsableDocumentUrl(u)).toBe(false);
  });
  test('https Signed URL(특수문자 포함) → 사용', () => {
    expect(isUsableDocumentUrl('https://p.supabase.co/storage/v1/object/sign/contract-files/u/%ED%95%9C.pdf?token=a.b-c_d')).toBe(true);
  });
});

describe('WebView 신호 — 형식이 맞는 것만', () => {
  test('단계·완료·오류 / 이상한 값은 무시·정리', () => {
    expect(parseViewerMessage('{"type":"step","step":"pdf_loaded"}')).toEqual({ type: 'step', step: 'pdf_loaded' });
    expect(parseViewerMessage('{"type":"error","code":"https://evil?token=1"}')).toEqual({ type: 'error', code: 'unknown' });
    expect(parseViewerMessage('{"type":"step","step":"<script>"}')).toBeNull();
    expect(parseViewerMessage('not json')).toBeNull();
  });
});
