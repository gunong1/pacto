// 사진 보호본 — 원본 이미지(읽기 전용)에서 실제 픽셀을 덮은 새 JPEG를 만든다 (화면 위에 상자를 얹는 방식이 아님).
// - 원본 바이트는 바꾸지 않는다: 해석한 픽셀을 새 버퍼로 줄이고(가로 PROTECTED_VIEW_WIDTH), 그 위에 불투명 상자를 칠한 뒤 새로 저장한다.
// - 상자는 줄인 뒤의 좌표에서 칠한다 → 상자 안에는 원본 픽셀이 한 점도 남지 않는다 (반투명·흐림 없음)
// - Edge Runtime(Deno) 코덱: _shared/vendor/imagecodec.js (scripts/vendor-image.mjs) — JPEG 해석은 mozjpeg WASM, 저장은 jpeg-js, PNG는 fast-png
//   (Edge CPU 한도: 순수 JS 해석은 2400×3400 사진 한 장에 0.6~1.1초가 걸려 한도에 걸렸다 → WASM 해석 약 0.15초)
import { decodeJpegFast, decodePng, encodeJpeg } from '../vendor/imagecodec.js';
import type { Box } from './ocrText.ts';

/** 보호본 가로 픽셀 (원본은 prepareFile 기준 최대 2400) — Edge CPU·메모리 한도 안에서 다시 저장하기 위해 줄인다 */
export const PROTECTED_VIEW_WIDTH = 1600;
export const PROTECTED_VIEW_QUALITY = 85;
/** 칠하는 색 (불투명 검정) */
const FILL = 0;
/** 상자 안이 덮였는지 볼 때 허용하는 밝기 (JPEG 저장 잡음) */
const DARK_MAX = 48;

export type ImageFormat = 'jpg' | 'png';

export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
  /** JPEG EXIF 방향 (1 = 그대로). 1이 아니면 좌표 기준이 어긋날 수 있다 */
  orientation: number;
}

/** 헤더만 읽어 형식·크기 (해석하지 않음) */
export function readImageInfo(b: Uint8Array): ImageInfo | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { format: 'png', width: dv.getUint32(16), height: dv.getUint32(20), orientation: 1 };
  }
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  let orientation = 1;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1) orientation = exifOrientation(b, i + 4, len - 2) ?? orientation;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { format: 'jpg', height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8], orientation };
    }
    i += 2 + len;
  }
  return null;
}

function exifOrientation(b: Uint8Array, start: number, len: number): number | null {
  if (String.fromCharCode(...b.subarray(start, start + 4)) !== 'Exif') return null;
  const t = start + 6;
  const le = b[t] === 0x49;
  const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  const ifd = t + u32(t + 4);
  if (ifd + 2 > start + len) return null;
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > start + len) break;
    if (u16(e) === 0x0112) return u16(e + 8);
  }
  return null;
}

export interface RgbImage {
  width: number;
  height: number;
  /** RGBA 4채널 (A는 항상 255) */
  data: Uint8Array;
}

/** 원본 바이트 → 픽셀 (원본 배열은 바꾸지 않음 — 해석기에는 복사본을 넘긴다) */
export async function decodeImage(bytes: Uint8Array, format: ImageFormat): Promise<RgbImage> {
  if (format === 'jpg') return await decodeJpegFast(bytes.slice());
  const png = decodePng(bytes.slice());
  const { width, height } = png;
  const out = new Uint8Array(width * height * 4);
  const src = png.data;
  const shift = png.depth === 16 ? 8 : 0;
  const ch = png.palette ? 1 : png.channels;
  for (let p = 0; p < width * height; p++) {
    let r: number, g: number, bl: number, a = 255;
    if (png.palette) {
      const c = png.palette[src[p]] ?? [0, 0, 0];
      [r, g, bl] = c;
      if (c.length > 3) a = c[3];
    } else {
      const s = p * ch;
      r = src[s] >> shift;
      g = ch >= 3 ? src[s + 1] >> shift : r;
      bl = ch >= 3 ? src[s + 2] >> shift : r;
      if (ch === 2) a = src[s + 1] >> shift;
      if (ch === 4) a = src[s + 3] >> shift;
    }
    // 투명 부분은 흰 배경 위에 (화면에서 보이는 모습과 같게)
    out[p * 4] = (r * a + 255 * (255 - a)) / 255;
    out[p * 4 + 1] = (g * a + 255 * (255 - a)) / 255;
    out[p * 4 + 2] = (bl * a + 255 * (255 - a)) / 255;
    out[p * 4 + 3] = 255;
  }
  return { width, height, data: out };
}

/** 면적 평균으로 줄인다 (작은 글자가 최근접 방식보다 덜 깨진다). 원본보다 크게 만들지 않음 */
export function downscale(src: RgbImage, targetWidth: number): RgbImage {
  if (src.width <= targetWidth) return { width: src.width, height: src.height, data: src.data.slice() };
  const W = targetWidth;
  const H = Math.max(1, Math.round((src.height * W) / src.width));
  const sx = src.width / W;
  const sy = src.height / H;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(src.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(src.width, Math.floor((x + 1) * sx)));
      let r = 0, g = 0, b = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * src.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * W + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { width: W, height: H, data: out };
}

/**
 * 가릴 상자 여유 — OCR 상자가 글자보다 조금 작을 수 있어 넓힌다 (이미지 비율 0~1 좌표).
 * 좌우: 글자 높이의 35% (값 앞뒤 숫자가 상자 밖으로 남지 않게) / 상하: 글자 높이의 20%
 */
export function padRedactionBox(b: Box): Box {
  const px = b.h * 0.35;
  const py = b.h * 0.2;
  const x = Math.max(0, b.x - px);
  const y = Math.max(0, b.y - py);
  return { x, y, w: Math.min(1, b.x + b.w + px) - x, h: Math.min(1, b.y + b.h + py) - y };
}

/** 0~1 좌표 → 픽셀 사각형 (바깥쪽으로 반올림 — 덜 덮는 일이 없게) */
export function toPixelRect(b: Box, width: number, height: number): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.max(0, Math.floor(b.x * width)),
    y0: Math.max(0, Math.floor(b.y * height)),
    x1: Math.min(width, Math.ceil((b.x + b.w) * width)),
    y1: Math.min(height, Math.ceil((b.y + b.h) * height)),
  };
}

function fill(img: RgbImage, b: Box) {
  const r = toPixelRect(b, img.width, img.height);
  for (let y = r.y0; y < r.y1; y++) {
    for (let i = (y * img.width + r.x0) * 4, end = (y * img.width + r.x1) * 4; i < end; i += 4) {
      img.data[i] = FILL;
      img.data[i + 1] = FILL;
      img.data[i + 2] = FILL;
      img.data[i + 3] = 255;
    }
  }
}

export interface RenderedView {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** 칠한 상자 (여유 포함, 0~1) — 검증에 쓴다 */
  painted: Box[];
}

/** 보호본: 줄이기 → 상자 칠하기 → JPEG로 새로 저장 */
export function renderProtectedView(src: RgbImage, boxes: readonly Box[], targetWidth = PROTECTED_VIEW_WIDTH): RenderedView {
  const view = downscale(src, targetWidth);
  const painted = boxes.map(padRedactionBox);
  for (const b of painted) fill(view, b);
  const enc = encodeJpeg({ width: view.width, height: view.height, data: view.data }, PROTECTED_VIEW_QUALITY);
  return { bytes: enc.data, width: view.width, height: view.height, painted };
}

/**
 * 보호본 확인: 다시 해석되는지 + 칠한 상자 안이 모두 어두운지 (원본 픽셀이 비치지 않는지).
 * JPEG 저장 잡음 때문에 상자 테두리 1~2픽셀은 빼고 본다. 반환: 덮이지 않은 상자 수
 */
export async function checkCoverage(bytes: Uint8Array, painted: readonly Box[]): Promise<{ decodable: boolean; width: number; height: number; uncovered: number }> {
  let img: { width: number; height: number; data: Uint8Array };
  try {
    img = await decodeJpegFast(bytes);
  } catch {
    return { decodable: false, width: 0, height: 0, uncovered: painted.length };
  }
  let uncovered = 0;
  for (const b of painted) {
    const r = toPixelRect(b, img.width, img.height);
    const inset = Math.min(2, Math.floor((r.x1 - r.x0) / 3), Math.floor((r.y1 - r.y0) / 3));
    let bright = 0;
    let total = 0;
    for (let y = r.y0 + inset; y < r.y1 - inset; y++) {
      for (let x = r.x0 + inset; x < r.x1 - inset; x++) {
        const i = (y * img.width + x) * 4;
        total++;
        if (img.data[i] > DARK_MAX || img.data[i + 1] > DARK_MAX || img.data[i + 2] > DARK_MAX) bright++;
      }
    }
    if (total === 0 || bright > 0) uncovered++;
  }
  return { decodable: true, width: img.width, height: img.height, uncovered };
}
