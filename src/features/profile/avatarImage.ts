import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

/** 프로필 사진 크기 (정사각형) */
export const AVATAR_SIZE = 512;

export interface PickedAvatar {
  /** 화면 미리보기용 (기기 안 임시 파일) */
  previewUri: string;
  /** 올릴 바이트 (512x512 JPEG) */
  bytes: ArrayBuffer;
}

/** 가운데를 기준으로 정사각형으로 자르는 영역 */
export function centerSquare(
  width: number,
  height: number,
): { originX: number; originY: number; width: number; height: number } {
  const side = Math.min(width, height);
  return {
    originX: Math.floor((width - side) / 2),
    originY: Math.floor((height - side) / 2),
    width: side,
    height: side,
  };
}

async function readBytes(uri: string): Promise<ArrayBuffer> {
  if (Platform.OS === "web") return (await fetch(uri)).arrayBuffer();
  return new File(uri).arrayBuffer();
}

/**
 * 사진 한 장 선택 → 정사각형으로 자르고 512px JPEG로 줄인다 (큰 원본을 올리지 않음).
 * 기기 편집 화면이 있으면(Android·iOS) 1:1로 직접 고르게 하고, 그 결과도 한 번 더 가운데 정사각형으로 맞춘다.
 */
export async function pickAvatar(): Promise<PickedAvatar | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: Platform.OS !== "web",
    aspect: [1, 1],
    quality: 1,
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  const ctx = ImageManipulator.manipulate(a.uri);
  if (a.width && a.height && a.width !== a.height)
    ctx.crop(centerSquare(a.width, a.height));
  ctx.resize({ width: AVATAR_SIZE, height: AVATAR_SIZE });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.8,
  });
  return { previewUri: saved.uri, bytes: await readBytes(saved.uri) };
}
