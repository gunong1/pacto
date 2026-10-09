/**
 * 스캔 PDF 테스트 fixture — 모든 값은 가짜 (src/__fixtures__/photo, scripts/fixtures/make-photo-fixtures.py)
 * - 바로 선 계약서 이미지(U)를 회전·뒤집어 저장(S)하고, CTM·/Rotate로 화면에서는 바로 보이게 배치한다
 * - 가짜 OCR: 받은 이미지 비율로 fixture 응답을 골라 크기에 맞추고, 상자 안이 검게 덮였으면 그 글자는 읽지 못한 것으로 (재-OCR 검증 재현)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { decodeImage, downscale, type RgbImage } from '../../supabase/functions/_shared/protection/imageRedact.ts';
import type { OcrImage, OcrProvider } from '../../supabase/functions/_shared/protection/ocrProvider.ts';
import { fromClova, type OcrPage } from '../../supabase/functions/_shared/protection/ocrText.ts';
import type { ScanRunner } from '../../supabase/functions/_shared/protection/protect.ts';
import { decodeScanResponse, encodeScanRequest, encodeScanResponse, decodeScanRequest, protectScanPage } from '../../supabase/functions/_shared/protection/scanWorker.ts';
import { encodeJpeg } from '../../supabase/functions/_shared/vendor/imagecodec.js';
import { PDFDocument, PDFName, PDFRef } from '../../supabase/functions/_shared/vendor/pdf-lib.js';

const FIX = path.join(import.meta.dirname, '../../src/__fixtures__/photo');
export const readFix = (f: string) => new Uint8Array(fs.readFileSync(path.join(FIX, f)));
const json = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));

type Field = { inferText: string; boundingPoly: { vertices: { x: number; y: number }[] } };
const FIXTURES: { ratio: number; file: string; base: { width: number; height: number } }[] = [
  { ratio: 3391 / 2400, file: 'lease-a4.clova.json', base: { width: 2400, height: 3391 } },
  { ratio: 1700 / 2400, file: 'lease.clova.json', base: { width: 2400, height: 1700 } },
  { ratio: 800 / 2400, file: 'plain.clova.json', base: { width: 2400, height: 800 } },
];

/** lease-a4 fixture의 글자 상자 (바로 선 이미지 0~1) */
export function leaseA4Box(text: string): { x: number; y: number; w: number; h: number } {
  const f = (json('lease-a4.clova.json').images[0].fields as Field[]).find((x) => x.inferText === text)!;
  const [a, , c] = f.boundingPoly.vertices;
  return { x: a.x / 2400, y: a.y / 3391, w: (c.x - a.x) / 2400, h: (c.y - a.y) / 3391 };
}

export class FakeOcr implements OcrProvider {
  readonly name = 'fake';
  calls = 0;
  fail: Error | null = null;
  async recognize(image: OcrImage): Promise<OcrPage> {
    this.calls++;
    if (this.fail) throw this.fail;
    const img = await decodeImage(image.bytes, image.format);
    const fx = FIXTURES.find((f) => Math.abs(img.height / img.width - f.ratio) < 0.01);
    const res = fx ? JSON.parse(JSON.stringify(json(fx.file))) : { images: [{ inferResult: 'SUCCESS', fields: [] }] };
    if (fx) {
      const sx = img.width / fx.base.width, sy = img.height / fx.base.height;
      res.images[0].fields = (res.images[0].fields as Field[]).filter((f) => {
        for (const v of f.boundingPoly.vertices) {
          v.x = Math.round(v.x * sx);
          v.y = Math.round(v.y * sy);
        }
        const [a, , c] = f.boundingPoly.vertices;
        let dark = 0, n = 0;
        for (let y = a.y; y < c.y; y += 2) for (let x = a.x; x < c.x; x += 2) {
          const i = (y * img.width + x) * 4;
          n++;
          if (img.data[i] < 40 && img.data[i + 1] < 40 && img.data[i + 2] < 40) dark++;
        }
        return n === 0 || dark / n < 0.6;
      });
    }
    return fromClova(res, image.width, image.height);
  }
}

/** 같은 worker 코드를 직접 실행 (요청·응답 직렬화까지 거친다 — 배포의 HTTP 왕복과 같은 형식) */
export function localRunner(ocr: OcrProvider | null): ScanRunner & { jobs: number } {
  const run = async (job: Parameters<ScanRunner>[0], raw: Uint8Array) => {
    run.jobs++;
    const req = decodeScanRequest(encodeScanRequest(job, raw));
    return decodeScanResponse(encodeScanResponse(await protectScanPage(req.raw, req.job, ocr)));
  };
  run.jobs = 0;
  return run;
}

// ── 픽셀 회전 (테스트 쪽 독립 구현) ──
export function rot90cw(u: RgbImage): RgbImage {
  const W = u.height, H = u.width, out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.set(u.data.subarray(((u.height - 1 - x) * u.width + y) * 4, ((u.height - 1 - x) * u.width + y) * 4 + 4), (y * W + x) * 4);
  return { width: W, height: H, data: out };
}
export const rot180 = (u: RgbImage) => rot90cw(rot90cw(u));
export const rot90ccw = (u: RgbImage) => rot90cw(rot90cw(rot90cw(u)));

export const jpegOf = (img: RgbImage, q = 90) => encodeJpeg(img, q).data;

let leaseCache: RgbImage | null = null;
/** 바로 선 lease-a4 (1200×1695로 줄임 — 테스트 속도) */
export async function leaseUpright(): Promise<RgbImage> {
  leaseCache ??= downscale(await decodeImage(readFix('lease-a4.jpg'), 'jpg'), 1200);
  return leaseCache;
}

export interface ImageSpec {
  /** 이미지 스트림 바이트 (인코딩된 그대로) */
  bytes: Uint8Array;
  width: number;
  height: number;
  filter?: string | string[];
  colorSpace?: string;
  bpc?: number;
  decodeParms?: Record<string, number>;
  extra?: Record<string, unknown>;
}

export interface PageSpec {
  size: [number, number];
  /** MediaBox 원점 (기본 0,0) */
  origin?: [number, number];
  rotate?: number;
  /** 이미지 그리기 연산 앞에 넣을 cm 목록 (각 6개 숫자) — 마지막이 이미지 크기 */
  cms?: number[][];
  image?: ImageSpec;
  /** 추가 이미지 (복잡한 다중 이미지 페이지) */
  images?: { spec: ImageSpec; cm: number[] }[];
  /** 보이지 않는 글자(Tr 3) — [글자, x, y, 크기] */
  hidden?: [string, number, number, number][];
  /** 보이는 글자 줄 (텍스트 페이지) — [글자, x, y] */
  lines?: [string, number, number][];
}

/** 이미지 XObject 하나 등록 */
function imageXObject(doc: PDFDocument, s: ImageSpec): PDFRef {
  const dict: Record<string, unknown> = {
    Type: 'XObject',
    Subtype: 'Image',
    Width: s.width,
    Height: s.height,
    ColorSpace: s.colorSpace ?? 'DeviceRGB',
    BitsPerComponent: s.bpc ?? 8,
    Filter: s.filter ?? 'DCTDecode',
    ...(s.decodeParms ? { DecodeParms: s.decodeParms } : {}),
    ...(s.extra ?? {}),
  };
  return doc.context.register(doc.context.stream(s.bytes, dict as never));
}

/** 스캔·텍스트 페이지를 섞은 PDF (fontPage: 글자를 그릴 때 쓰는 ContractPdf 글꼴 함수) */
export async function buildPdf(pages: PageSpec[], font?: (sample: string) => Promise<{ ref: PDFRef; encodeText(t: string): { toString(): string }; widthOfTextAtSize(t: string, s: number): number }>, base?: PDFDocument): Promise<Uint8Array> {
  const doc = base ?? (await PDFDocument.create());
  for (const p of pages) {
    const page = doc.addPage(p.size);
    const [ox, oy] = p.origin ?? [0, 0];
    if (p.origin) page.setMediaBox(ox, oy, p.size[0], p.size[1]);
    if (p.rotate) page.node.set(PDFName.of('Rotate'), doc.context.obj(p.rotate));
    let ops = '';
    if (p.image) {
      const name = page.node.newXObject('Im', imageXObject(doc, p.image)).asString();
      ops += `q ${(p.cms ?? [[p.size[0], 0, 0, p.size[1], ox, oy]]).map((m) => `${m.join(' ')} cm`).join(' ')} ${name} Do Q\n`;
    }
    for (const extra of p.images ?? []) {
      const name = page.node.newXObject('Im', imageXObject(doc, extra.spec)).asString();
      ops += `q ${extra.cm.join(' ')} cm ${name} Do Q\n`;
    }
    const text = async (str: string, x: number, y: number, size: number, mode: number) => {
      let cx = x;
      for (const ch of str) {
        if (ch === ' ') {
          cx += size * 0.3;
          continue;
        }
        const f = await font!(ch);
        const fname = page.node.newFontDictionary('F', f.ref).asString();
        ops += `BT ${mode} Tr ${fname} ${size} Tf ${cx.toFixed(2)} ${y.toFixed(2)} Td ${f.encodeText(ch).toString()} Tj ET\n`;
        cx += f.widthOfTextAtSize(ch, size);
      }
    };
    for (const [s, x, y, size] of p.hidden ?? []) await text(s, x, y, size, 3);
    for (const [s, x, y] of p.lines ?? []) await text(s, x, y, 11, 0);
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(new TextEncoder().encode(ops))));
  }
  return await doc.save();
}

/** RGBA → Flate 이미지 스트림 (회색 1채널 또는 RGB 3채널, 선택: PNG 예측자 Up(2)) */
export function flateImage(img: RgbImage, channels: 1 | 3, predictor: boolean): ImageSpec {
  const row = img.width * channels;
  const raw = new Uint8Array((row + (predictor ? 1 : 0)) * img.height);
  let o = 0;
  let prev = new Uint8Array(row);
  for (let y = 0; y < img.height; y++) {
    const cur = new Uint8Array(row);
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (channels === 1) cur[x] = Math.round((img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3);
      else cur.set(img.data.subarray(i, i + 3), x * 3);
    }
    if (predictor) {
      raw[o++] = 2; // Up
      for (let k = 0; k < row; k++) raw[o++] = (cur[k] - prev[k]) & 0xff;
    } else {
      raw.set(cur, o);
      o += row;
    }
    prev = cur;
  }
  return {
    bytes: new Uint8Array(zlib.deflateSync(raw)),
    width: img.width,
    height: img.height,
    filter: 'FlateDecode',
    colorSpace: channels === 1 ? 'DeviceGray' : 'DeviceRGB',
    ...(predictor ? { decodeParms: { Predictor: 15, Colors: channels, BitsPerComponent: 8, Columns: img.width } } : {}),
  };
}

/** ASCII85 인코딩 (4바이트 0은 'z') — 글자 포장 필터 테스트용 */
export function ascii85(b: Uint8Array): Uint8Array {
  let s = '';
  for (let i = 0; i < b.length; i += 4) {
    const chunk = [b[i], b[i + 1] ?? 0, b[i + 2] ?? 0, b[i + 3] ?? 0];
    const n = Math.min(4, b.length - i);
    let v = ((chunk[0] << 24) | (chunk[1] << 16) | (chunk[2] << 8) | chunk[3]) >>> 0;
    if (v === 0 && n === 4) {
      s += 'z';
      continue;
    }
    const d: string[] = [];
    for (let k = 0; k < 5; k++) {
      d.unshift(String.fromCharCode((v % 85) + 33));
      v = Math.floor(v / 85);
    }
    s += d.slice(0, n + 1).join('');
    if (i % 64 === 0) s += '\n';
  }
  return new TextEncoder().encode(s + '~>');
}
export const asciiHex = (b: Uint8Array) => new TextEncoder().encode(Buffer.from(b).toString('hex').toUpperCase().replace(/(.{80})/g, '$1\n') + '>');
