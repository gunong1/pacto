/* eslint-disable import/first -- jest.mock 다음에 불러와야 한다 */
/** 계약서 파일이 여러 개일 때 — 한 뷰어에서 모든 파일을 넘겨 볼 수 있어야 한다 (첫 파일만 열리던 문제) */
const mockOpenUrl = jest.fn(async (_doc: unknown, variant: string) => `https://x.supabase.co/storage/v1/object/sign/${variant}.pdf?token=t`);
const mockPush = jest.fn();
const mockConfirm = jest.fn(async () => true);
jest.mock('@/data', () => ({ documentStore: { openUrl: (d: unknown, v: string) => mockOpenUrl(d, v) } }));
jest.mock('expo-web-browser', () => ({}));
jest.mock('expo-router', () => ({ router: { push: (a: unknown) => mockPush(a) } }));
jest.mock('@/lib/dialog', () => ({ confirm: () => mockConfirm(), notify: jest.fn() }));

import { viewDocuments } from '@/features/documents/openDocument';
import { getViewerSession } from '@/features/viewer/session';

const protectedDoc = (n: number) => ({
  storagePath: `u/${n}.jpg`,
  localUri: null,
  mimeType: 'image/jpeg',
  protection: { status: 'protected', protectedViewPath: `u/${n}.protected.jpg` } as never,
});

beforeEach(() => {
  mockOpenUrl.mockClear();
  mockPush.mockClear();
  mockConfirm.mockClear();
});

test('보호본 2개 → 한 뷰어에 파일 2개, 첫 파일만 미리 서명(나머지는 고를 때)', async () => {
  await viewDocuments([protectedDoc(1), protectedDoc(2)]);
  expect(mockConfirm).not.toHaveBeenCalled();
  expect(mockOpenUrl).toHaveBeenCalledTimes(1);
  const id = mockPush.mock.calls[0][0].params.id;
  const s = getViewerSession(id)!;
  expect(s.files).toHaveLength(2);
  expect(s.files!.map((f) => f.variant)).toEqual(['protected_view', 'protected_view']);
  expect(s.kind).toBe('image');
  // 화면 주소(파라미터)에는 Signed URL이 없다
  expect(JSON.stringify(mockPush.mock.calls[0][0])).not.toContain('token');
});

test('보호본이 없는 파일이 섞이면 원본 확인을 한 번 묻고, 거절하면 보호본만', async () => {
  const raw = { storagePath: 'u/3.jpg', localUri: null, mimeType: 'image/jpeg', protection: { status: 'unreadable' } as never };
  mockConfirm.mockResolvedValueOnce(false);
  await viewDocuments([raw, protectedDoc(1)]);
  expect(mockConfirm).toHaveBeenCalledTimes(1);
  const s = getViewerSession(mockPush.mock.calls[0][0].params.id)!;
  expect(s.files).toHaveLength(1);
  expect(s.files![0].variant).toBe('protected_view');
});

test('파일 1개는 기존과 같이 한 파일', async () => {
  await viewDocuments([protectedDoc(1)]);
  const s = getViewerSession(mockPush.mock.calls[0][0].params.id)!;
  expect(s.files).toBeUndefined();
});
