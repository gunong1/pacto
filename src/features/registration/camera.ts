import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Linking, Platform } from 'react-native';

import type { PickedFile } from '@/data/ai/provider';

/**
 * 계약서 촬영 (V1: 시스템 카메라 — expo-image-picker launchCameraAsync, Expo Go에서 동작).
 * 한 번에 한 장을 찍고, "다음 페이지 촬영"마다 카메라를 다시 연다.
 * 실시간 테두리 인식·자동 자르기·원근 보정 같은 문서 스캐너는 이 모듈을 expo-camera 기반으로 바꿔 확장한다
 * (화면은 capturePage / ensureCameraPermission / discardCaptured만 사용).
 */

export type CameraPermission = 'granted' | 'denied' | 'blocked';

/** 권한 확인 — 처음 거부(다시 물을 수 있음)와 영구 거부(설정에서만 허용)를 구분 */
export async function ensureCameraPermission(): Promise<CameraPermission> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (current.granted) return 'granted';
  if (!current.canAskAgain) return 'blocked';
  const asked = await ImagePicker.requestCameraPermissionsAsync();
  if (asked.granted) return 'granted';
  return asked.canAskAgain ? 'denied' : 'blocked';
}

export function openAppSettings() {
  Linking.openSettings().catch(() => undefined);
}

/** 한 장 촬영. 취소하면 null */
export async function capturePage(pageNo: number): Promise<PickedFile | null> {
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9, exif: false });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return {
    name: `계약서_촬영_${pageNo}.jpg`,
    uri: a.uri,
    mimeType: a.mimeType ?? 'image/jpeg',
    size: a.fileSize ?? null,
    width: a.width ?? null,
    height: a.height ?? null,
    captured: true,
  };
}

/** 촬영한 임시 사진 지우기 (앨범에서 고른 사진은 건드리지 않는다) */
export function discardCaptured(files: readonly PickedFile[]) {
  if (Platform.OS === 'web') return;
  for (const f of files) {
    if (!f.captured) continue;
    try {
      const file = new File(f.uri);
      if (file.exists) file.delete();
    } catch {
      // 이미 지워짐
    }
  }
}
