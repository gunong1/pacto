/**
 * 사용자가 직접 연 외부 화면(사진 선택·카메라·파일 선택·권한 요청·브라우저) 진행 수.
 * 이 동안 앱이 백그라운드로 가도 앱 잠금은 잠그지 않는다 (최대 5분 — src/domain/appLock.ts).
 * 네이티브 모듈을 쓰지 않는 가벼운 모듈 (사진 선택 등 여러 곳에서 불러도 부담 없게).
 */
let count = 0;

export function externalActivityInProgress(): boolean {
  return count > 0;
}

export async function withoutAppLock<T>(fn: () => Promise<T>): Promise<T> {
  count++;
  try {
    return await fn();
  } finally {
    count--;
  }
}

/** 테스트 전용 */
export function __resetExternalActivityForTest() {
  count = 0;
}
