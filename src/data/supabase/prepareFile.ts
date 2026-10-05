import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

import type { PickedFile } from '../ai/provider';

export interface PreparedFile {
  bytes: ArrayBuffer;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  ext: 'pdf' | 'jpg' | 'png';
}

/** 긴 변 기준 최대 픽셀 — 계약서 글자가 읽히는 수준을 유지하며 용량을 줄인다 */
const MAX_IMAGE_WIDTH = 2400;

async function readBytes(uri: string): Promise<ArrayBuffer> {
  if (Platform.OS === 'web') return (await fetch(uri)).arrayBuffer();
  return new File(uri).arrayBuffer();
}

/**
 * 업로드 전 파일 준비.
 * - PDF: 그대로
 * - 사진: HEIC 등은 JPEG로 변환, 큰 사진은 축소 (PNG는 그대로 유지)
 */
export async function prepareFile(file: PickedFile): Promise<PreparedFile> {
  const mime = file.mimeType.toLowerCase();
  if (mime === 'application/pdf') return { bytes: await readBytes(file.uri), mimeType: 'application/pdf', ext: 'pdf' };
  if (mime === 'image/png' && (!file.width || file.width <= MAX_IMAGE_WIDTH)) {
    return { bytes: await readBytes(file.uri), mimeType: 'image/png', ext: 'png' };
  }
  if (!mime.startsWith('image/')) throw new Error('unsupported_type');

  const ctx = ImageManipulator.manipulate(file.uri);
  if (file.width && file.width > MAX_IMAGE_WIDTH) ctx.resize({ width: MAX_IMAGE_WIDTH });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  return { bytes: await readBytes(saved.uri), mimeType: 'image/jpeg', ext: 'jpg' };
}
