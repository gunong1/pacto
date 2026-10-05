/* 통합 테스트(Node)에서 네이티브 모듈 대체 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock 팩토리는 require 필요
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `pacto://${path}` }));
// jest-expo 환경의 performance 객체에 undici가 쓰는 API가 없어 보완
const perf = globalThis.performance as unknown as Record<string, unknown> | undefined;
if (perf && typeof perf.markResourceTiming !== 'function') perf.markResourceTiming = () => {};
jest.setTimeout(30_000);
