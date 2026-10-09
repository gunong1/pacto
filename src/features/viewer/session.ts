import type { ViewerFile } from '@/features/documents/openDocument';

import type { ViewerConfig } from './viewerHtml';

/**
 * 뷰어로 넘길 문서 정보 — 화면 주소(라우트 파라미터)에 Signed URL을 넣지 않도록 메모리에만 잠깐 둔다.
 * 뷰어 화면이 닫히면 지운다.
 */
export interface ViewerSession extends ViewerConfig {
  title: string;
  /** 계약서 파일이 여러 개일 때 전체 목록 (첫 파일 설정은 위 값) — 다른 파일은 고를 때 Signed URL을 새로 만든다 */
  files?: ViewerFile[];
  index?: number;
}

const sessions = new Map<string, ViewerSession>();
let seq = 0;

export function putViewerSession(s: ViewerSession): string {
  const id = `v${Date.now().toString(36)}${(seq++).toString(36)}`;
  sessions.set(id, s);
  return id;
}

export const getViewerSession = (id: string | undefined): ViewerSession | null => (id ? (sessions.get(id) ?? null) : null);
export const dropViewerSession = (id: string | undefined) => {
  if (id) sessions.delete(id);
};
