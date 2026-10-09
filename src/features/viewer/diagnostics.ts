import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * 계약서 뷰어 진단 기록 — 앱이 갑자기 종료돼도 마지막 단계가 남도록 기기 안 파일에 바로(동기) 쓴다.
 * 기록하는 것: 시각·진단 모드·단계 이름·오류 코드뿐. 계약서 주소·토큰·문서 내용·오류 메시지는 기록하지 않는다.
 * 켜기: 개발 빌드 또는 EXPO_PUBLIC_VIEWER_DIAGNOSTICS=true (preview APK)
 */
export const VIEWER_DIAGNOSTICS = __DEV__ || process.env.EXPO_PUBLIC_VIEWER_DIAGNOSTICS === 'true';

export const VIEWER_STEPS = [
  'viewer_route',
  'webview_mounting',
  'webview_mounted',
  'pdfjs_loaded',
  'pdf_fetch_started',
  'pdf_loaded',
  'first_page_render_started',
  'first_page_rendered',
  'image_loaded',
  'loaded',
  'error',
] as const;
export type ViewerStep = (typeof VIEWER_STEPS)[number];
export type ViewerMode = 'route' | 'blank' | 'init' | 'sample' | 'real';

export interface ViewerLogEntry {
  /** 기록 시각 (ms) */
  t: number;
  mode: ViewerMode;
  step: ViewerStep;
  /** 오류·세부 코드 (영문 소문자·숫자·밑줄만) */
  code?: string;
}

const MAX_LINES = 200;
const CODE = /^[a-z0-9_]{1,40}$/;
let memory: ViewerLogEntry[] = [];

function file(): File | null {
  if (Platform.OS === 'web') return null;
  try {
    return new File(Paths.document, 'pacto-viewer-diagnostics.log');
  } catch {
    return null;
  }
}

/** 기록된 단계 (오래된 것부터) */
export function readViewerLog(): ViewerLogEntry[] {
  const f = file();
  if (!f) return [...memory];
  try {
    if (!f.exists) return [];
    return f
      .textSync()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ViewerLogEntry);
  } catch {
    return [];
  }
}

/** 단계 기록 — 진단이 꺼져 있으면 아무것도 하지 않는다 */
export function recordViewerStep(mode: ViewerMode, step: ViewerStep, code?: string): void {
  if (!VIEWER_DIAGNOSTICS) return;
  if (!(VIEWER_STEPS as readonly string[]).includes(step)) return;
  const entry: ViewerLogEntry = { t: Date.now(), mode, step, ...(code && CODE.test(code) ? { code } : {}) };
  const f = file();
  if (!f) {
    memory = [...memory, entry].slice(-MAX_LINES);
    return;
  }
  try {
    const lines = [...readViewerLog(), entry].slice(-MAX_LINES).map((e) => JSON.stringify(e));
    f.write(`${lines.join('\n')}\n`);
  } catch {
    /* 기록 실패는 무시 (뷰어 동작에 영향 없음) */
  }
}

export function clearViewerLog(): void {
  memory = [];
  const f = file();
  try {
    if (f?.exists) f.delete();
  } catch {
    /* 무시 */
  }
}

/** 오류 객체 → 짧은 코드 (메시지는 쓰지 않는다 — 주소가 섞일 수 있음) */
export function errorCode(e: unknown): string {
  const name = e instanceof Error ? e.name : typeof e;
  return `js_${name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30) || 'unknown'}`;
}
