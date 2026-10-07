import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import type { PickedFile } from '@/data/ai/provider';
import { MAX_DOCUMENT_BYTES } from '@/data/documents';
import { notify } from '@/lib/dialog';

export const MAX_PHOTOS = 10;

function tooLarge(files: PickedFile[]) {
  return files.some((f) => f.size != null && f.size > MAX_DOCUMENT_BYTES);
}

/** PDF 1개 선택. 취소/용량 초과면 null */
export async function pickPdf(): Promise<PickedFile[] | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple: false, copyToCacheDirectory: true });
  if (res.canceled) return null;
  const files = res.assets.map((a) => ({ name: a.name, uri: a.uri, mimeType: a.mimeType ?? 'application/pdf', size: a.size ?? null }));
  if (tooLarge(files)) {
    notify('파일이 너무 커요', '20MB 이하의 PDF를 선택해주세요.');
    return null;
  }
  return files;
}

/** 사진 여러 장 선택. iOS의 HEIC는 호환 형식(JPEG)으로 받고, 업로드 전에 한 번 더 JPEG로 변환한다. */
export async function pickPhotos(limit = MAX_PHOTOS): Promise<PickedFile[] | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    quality: 0.9,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (res.canceled) return null;
  const files = res.assets.map((a, i) => ({
    name: a.fileName ?? `계약서_${i + 1}.jpg`,
    uri: a.uri,
    mimeType: a.mimeType ?? 'image/jpeg',
    size: a.fileSize ?? null,
    width: a.width ?? null,
    height: a.height ?? null,
  }));
  if (tooLarge(files)) {
    notify('사진이 너무 커요', '한 장당 20MB 이하로 선택해주세요.');
    return null;
  }
  return files;
}

/** 업로드 전 사진 점검 (AI 비용 없음): 너무 작은 사진, 같은 사진 중복 */
export const MIN_PHOTO_LONG_SIDE = 800;
export function checkPhotos(files: readonly PickedFile[]): { lowResolution: number[]; duplicates: number[] } {
  const lowResolution: number[] = [];
  const duplicates: number[] = [];
  files.forEach((f, i) => {
    if (!f.mimeType.startsWith('image/')) return;
    const long = Math.max(f.width ?? 0, f.height ?? 0);
    if (long > 0 && long < MIN_PHOTO_LONG_SIDE) lowResolution.push(i);
    // 같은 파일(크기·가로·세로가 모두 같음)을 두 번 고른 경우
    const same = files.findIndex((g, j) => j < i && g.size != null && g.size === f.size && g.width === f.width && g.height === f.height);
    if (same >= 0) duplicates.push(i);
  });
  return { lowResolution, duplicates };
}
