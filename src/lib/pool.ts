/**
 * 동시에 limit개까지만 실행 — 끝나는 대로 다음 것을 시작한다 (결과는 입력 순서대로).
 * 예: 사진 10장 보호 → 2장씩 (OCR·Edge 부하를 줄이기 위해)
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
