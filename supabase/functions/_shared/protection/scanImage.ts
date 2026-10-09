// 스캔 페이지 이미지 해석 (protect-scan-page worker) — PDF에 들어 있던 이미지 스트림(인코딩된 그대로) → 픽셀 → 화면 방향으로 바로 세움
// V1 지원: JPEG(DCTDecode, 회색·RGB 8비트) · Flate 8비트 회색·RGB (PNG 예측자 10~15 포함)
// 원본 바이트는 읽기만 한다 (해석기에는 복사본).
import { decodeJpegFast, encodeJpeg, inflate } from '../vendor/imagecodec.js';
import { downscale, type RgbImage } from './imageRedact.ts';
import { IDENTITY_ORIENTATION, type Orientation } from './scanGeometry.ts';

export interface ScanImageMeta {
  filter: 'jpeg' | 'flate';
  /** 1 = 회색, 3 = RGB */
  channels: 1 | 3;
  width: number;
  height: number;
  /** Flate PNG 예측자 (없으면 1) */
  predictor: number;
  /** 압축 데이터를 글자로 한 번 더 감싼 경우 (ASCII85Decode·ASCIIHexDecode — 앞 단계 필터) */
  ascii?: 'a85' | 'hex' | null;
}

/** OCR로 보내는 이미지의 긴 변 최대 (다시 저장할 때) — 사진 등록 기준(2400)과 같게 */
export const SCAN_OCR_MAX_SIDE = 2400;
/** 원본 JPEG를 그대로 OCR로 보내도 되는 긴 변 최대 (A4 300dpi = 3508) */
export const SCAN_OCR_DIRECT_MAX_SIDE = 3600;
export const SCAN_OCR_QUALITY = 88;
/** 해석할 수 있는 최대 픽셀 수 (메모리 한도) — 넘으면 unsupported_scan */
export const MAX_SCAN_PIXELS = 25_000_000;

export class ScanImageError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** JPEG 헤더의 색 채널 수 (SOF) */
export function jpegComponents(b: Uint8Array): number | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return b[i + 9];
    i += 2 + len;
  }
  return null;
}

/** PNG 예측자 되돌리기 (행마다 앞에 필터 바이트) */
function unpredict(data: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const row = width * bpp;
  if (data.length < (row + 1) * height) throw new ScanImageError('scan_image_truncated');
  const out = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    const ft = data[y * (row + 1)];
    const src = y * (row + 1) + 1;
    const o = y * row;
    for (let x = 0; x < row; x++) {
      const raw = data[src + x];
      const a = x >= bpp ? out[o + x - bpp] : 0;
      const b = y > 0 ? out[o - row + x] : 0;
      const c = x >= bpp && y > 0 ? out[o - row + x - bpp] : 0;
      let v: number;
      switch (ft) {
        case 0: v = raw; break;
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new ScanImageError('scan_image_predictor');
      }
      out[o + x] = v & 0xff;
    }
  }
  return out;
}

const isSpace = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;

/** ASCII85 (Adobe: '<~' 생략 가능, 'z' = 0 네 바이트, '~>'로 끝) */
export function decodeAscii85(src: Uint8Array): Uint8Array {
  // 'z' 한 글자 = 4바이트이므로 먼저 세어 크기를 정한다 (모자라면 뒤가 잘린다)
  let zs = 0;
  for (const c of src) if (c === 0x7a) zs++;
  const out = new Uint8Array(zs * 4 + Math.ceil((src.length * 4) / 5) + 8);
  let n = 0;
  const group: number[] = [];
  let i = 0;
  if (src[0] === 0x3c && src[1] === 0x7e) i = 2;
  for (; i < src.length; i++) {
    const c = src[i];
    if (isSpace(c)) continue;
    if (c === 0x7e) break; // '~>'
    if (c === 0x7a && group.length === 0) {
      if (n + 4 > out.length) throw new ScanImageError('scan_image_decode');
      n += 4; // 0 네 바이트 (배열은 0으로 시작)
      continue;
    }
    if (c < 0x21 || c > 0x75) throw new ScanImageError('scan_image_decode');
    group.push(c - 0x21);
    if (group.length === 5) {
      let v = 0;
      for (const d of group) v = v * 85 + d;
      if (v > 0xffffffff) throw new ScanImageError('scan_image_decode');
      out[n++] = v >>> 24;
      out[n++] = (v >>> 16) & 0xff;
      out[n++] = (v >>> 8) & 0xff;
      out[n++] = v & 0xff;
      group.length = 0;
    }
  }
  if (group.length === 1) throw new ScanImageError('scan_image_decode');
  if (group.length > 1) {
    const k = group.length;
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const d of group) v = v * 85 + d;
    for (let j = 0; j < k - 1; j++) out[n++] = (v >>> (24 - 8 * j)) & 0xff;
  }
  return out.subarray(0, n);
}

/** ASCIIHex ('>'로 끝, 홀수 자리는 0을 붙임) */
export function decodeAsciiHex(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(src.length / 2));
  let n = 0;
  let hi = -1;
  for (const c of src) {
    if (isSpace(c)) continue;
    if (c === 0x3e) break;
    const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 0x37 : c >= 0x61 && c <= 0x66 ? c - 0x57 : -1;
    if (v < 0) throw new ScanImageError('scan_image_decode');
    if (hi < 0) hi = v;
    else {
      out[n++] = (hi << 4) | v;
      hi = -1;
    }
  }
  if (hi >= 0) out[n++] = hi << 4;
  return out.subarray(0, n);
}

/** 글자 포장(ASCII85·ASCIIHex)을 푼 압축 데이터 */
export function unwrapAscii(raw: Uint8Array, ascii: ScanImageMeta['ascii']): Uint8Array {
  if (ascii === 'a85') return decodeAscii85(raw);
  if (ascii === 'hex') return decodeAsciiHex(raw);
  return raw;
}

/** 이미지 스트림 → RGBA 픽셀 (저장된 방향 그대로) */
export async function decodeScanImage(input: Uint8Array, meta: ScanImageMeta): Promise<RgbImage> {
  const raw = unwrapAscii(input, meta.ascii);
  if (meta.width * meta.height > MAX_SCAN_PIXELS) throw new ScanImageError('scan_too_large');
  if (meta.filter === 'jpeg') {
    const comps = jpegComponents(raw);
    if (comps !== meta.channels) throw new ScanImageError('scan_format');
    let img: RgbImage;
    try {
      img = await decodeJpegFast(raw.slice());
    } catch {
      throw new ScanImageError('scan_image_decode');
    }
    if (img.width !== meta.width || img.height !== meta.height) throw new ScanImageError('scan_image_size');
    return img;
  }
  let data: Uint8Array;
  try {
    data = inflate(raw);
  } catch {
    throw new ScanImageError('scan_image_decode');
  }
  const bpp = meta.channels;
  if (meta.predictor >= 10) data = unpredict(data, meta.width, meta.height, bpp);
  else if (meta.predictor !== 1) throw new ScanImageError('scan_format');
  const n = meta.width * meta.height;
  if (data.length < n * bpp) throw new ScanImageError('scan_image_truncated');
  const out = new Uint8Array(n * 4);
  for (let p = 0, s = 0; p < n; p++, s += bpp) {
    const r = data[s];
    out[p * 4] = r;
    out[p * 4 + 1] = bpp === 3 ? data[s + 1] : r;
    out[p * 4 + 2] = bpp === 3 ? data[s + 2] : r;
    out[p * 4 + 3] = 255;
  }
  return { width: meta.width, height: meta.height, data: out };
}

/** 화면 방향으로 바로 세운 이미지 (90도 단위 회전·뒤집기) */
export function orient(src: RgbImage, o: Orientation): RgbImage {
  if (!o.swap && !o.flipX && !o.flipY) return src;
  const W = o.swap ? src.height : src.width;
  const H = o.swap ? src.width : src.height;
  const out = new Uint8Array(W * H * 4);
  const sw = src.width;
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      let sx: number, sy: number;
      if (!o.swap) {
        sx = o.flipX ? src.width - 1 - X : X;
        sy = o.flipY ? src.height - 1 - Y : Y;
      } else {
        sy = o.flipX ? src.height - 1 - X : X;
        sx = o.flipY ? src.width - 1 - Y : Y;
      }
      const i = (sy * sw + sx) * 4, j = (Y * W + X) * 4;
      out[j] = src.data[i];
      out[j + 1] = src.data[i + 1];
      out[j + 2] = src.data[i + 2];
      out[j + 3] = 255;
    }
  }
  return { width: W, height: H, data: out };
}

/** 긴 변이 maxSide를 넘으면 비율 유지해 줄인다 */
export function fitLongSide(src: RgbImage, maxSide: number): RgbImage {
  const long = Math.max(src.width, src.height);
  if (long <= maxSide) return src;
  return downscale(src, Math.max(1, Math.round((src.width * maxSide) / long)));
}

export interface PreparedScan {
  /** 바로 선 이미지 (보호본을 그릴 픽셀 — OCR 입력과 같은 정규 좌표) */
  upright: RgbImage;
  /** OCR로 보낼 JPEG */
  ocr: { bytes: Uint8Array; format: 'jpg'; width: number; height: number };
  /** 원본 JPEG를 그대로 OCR에 보냈는지 */
  direct: boolean;
}

/**
 * OCR 입력 준비: 방향을 바꿀 필요가 없고 크기가 적당한 JPEG는 원본 바이트를 그대로 보내고(다시 저장하지 않음),
 * 그 밖에는 바로 세우고 줄여 새 JPEG로 저장한다. 픽셀은 긴 변 SCAN_OCR_MAX_SIDE 이하로 줄여 메모리를 아낀다.
 */
export async function prepareScan(input: Uint8Array, inputMeta: ScanImageMeta, o: Orientation = IDENTITY_ORIENTATION): Promise<PreparedScan> {
  const raw = unwrapAscii(input, inputMeta.ascii);
  const meta = { ...inputMeta, ascii: null };
  const src = await decodeScanImage(raw, meta);
  const identity = !o.swap && !o.flipX && !o.flipY;
  const direct = identity && meta.filter === 'jpeg' && Math.max(meta.width, meta.height) <= SCAN_OCR_DIRECT_MAX_SIDE;
  // 원본 JPEG를 그대로 보내는 경우: 픽셀도 그대로 (보호본을 그릴 때 한 번만 줄인다 — CPU 절약)
  if (direct) return { upright: src, ocr: { bytes: raw, format: 'jpg', width: meta.width, height: meta.height }, direct };
  const upright = orient(fitLongSide(src, SCAN_OCR_MAX_SIDE), o);
  const enc = encodeJpeg({ width: upright.width, height: upright.height, data: upright.data }, SCAN_OCR_QUALITY);
  return { upright, ocr: { bytes: enc.data, format: 'jpg', width: upright.width, height: upright.height }, direct };
}
