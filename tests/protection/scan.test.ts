/**
 * 스캔 PDF 보호 — 페이지 분류 · 좌표 변환(CLOVA bbox → 이미지 → PDF 페이지) · 혼합 PDF · 숨은 OCR 글자층 제거 · 상태 규칙
 * worker(protect-scan-page)와 같은 코드를 직접 실행하고(요청·응답 직렬화 포함), OCR은 가짜(fixture)로 대신한다. 모든 값은 가짜.
 * 화면 방향 확인은 poppler(pdftoppm, 별도 구현)로 원본·보호본을 실제로 그려서 본다.
 * 실행: npm run test:protection
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, describe, test } from 'node:test';

import { decodeImage, downscale, type RgbImage } from '../../supabase/functions/_shared/protection/imageRedact.ts';
import { PDFJS_OPTIONS } from '../../supabase/functions/_shared/protection/cmap.ts';
import { MAX_SCAN_PAGES, protectPdf, type ProtectResult } from '../../supabase/functions/_shared/protection/protect.ts';
import {
  fromUpright,
  orientationOf,
  pageBoxToUpright,
  placedRect,
  toUpright,
  uprightBoxToPage,
  uprightPlacement,
  type Mat,
  type PageFrame,
} from '../../supabase/functions/_shared/protection/scanGeometry.ts';
import { decodeAscii85, decodeScanImage, orient } from '../../supabase/functions/_shared/protection/scanImage.ts';
import { OcrError } from '../../supabase/functions/_shared/protection/ocrProvider.ts';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from '../../supabase/functions/_shared/vendor/pdf-lib.js';
import { extractText, getDocumentProxy } from '../../supabase/functions/_shared/vendor/unpdf.js';
import { ContractPdf } from './fixtures.ts';
import { FakeOcr, ascii85, asciiHex, buildPdf, flateImage, jpegOf, leaseA4Box, leaseUpright, localRunner, readFix, rot180, rot90ccw, rot90cw, type PageSpec } from './scanFixtures.ts';

const RRN = ['800101-1234567', '950505-2345678'];
const RAW_SECRETS = [...RRN, '010-1234-5678', '010-9876-5432', '800101', '1234567', '2345678'];

async function textOf(pdf: Uint8Array) {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf), PDFJS_OPTIONS as never), { mergePages: true });
  return String(text);
}
function pdftotext(pdf: Uint8Array): string {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pacto-')), 'x.pdf');
  fs.writeFileSync(f, pdf);
  return execFileSync('pdftotext', ['-layout', f, '-'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}
/** 파일 안 모든 스트림을 풀어 본 내용 (PDF 구조 분석으로 볼 수 있는 것) */
async function allStreamText(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf);
  return doc.context
    .enumerateIndirectObjects()
    .map(([, o]) => o)
    .filter((o): o is PDFRawStream => o instanceof PDFRawStream)
    .map((s) => {
      try {
        return Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
      } catch {
        return '';
      }
    })
    .join('\n');
}
/** poppler로 페이지를 화면 방향 그대로 그린다 (가로 width 픽셀) */
async function render(pdf: Uint8Array, page: number, width = 600): Promise<RgbImage> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pacto-r-'));
  fs.writeFileSync(path.join(dir, 'x.pdf'), pdf);
  execFileSync('pdftoppm', ['-png', '-f', String(page), '-l', String(page), '-scale-to-x', String(width), '-scale-to-y', '-1', '-singlefile', path.join(dir, 'x.pdf'), path.join(dir, 'out')]);
  return await decodeImage(new Uint8Array(fs.readFileSync(path.join(dir, 'out.png'))), 'png');
}
const gray = (img: RgbImage, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
};
/** 0~1 상자 안쪽(가장자리 20% 제외)에서 어두운 픽셀 비율 */
function darkRatio(img: RgbImage, b: { x: number; y: number; w: number; h: number }): number {
  const x0 = Math.ceil((b.x + b.w * 0.2) * img.width), x1 = Math.floor((b.x + b.w * 0.8) * img.width);
  const y0 = Math.ceil((b.y + b.h * 0.2) * img.height), y1 = Math.floor((b.y + b.h * 0.8) * img.height);
  let dark = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    n++;
    if (gray(img, x, y) < 60) dark++;
  }
  return n ? dark / n : 0;
}
/** 두 이미지를 같은 작은 크기로 줄여 회색 평균 차이 (화면 방향이 맞는지) */
function meanDiff(a: RgbImage, b: RgbImage): number {
  const sa = downscale(a, 48), sb = downscale(b, 48);
  const h = Math.min(sa.height, sb.height);
  let d = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < 48; x++) {
    d += Math.abs(gray(sa, x, y) - gray(sb, x, y));
    n++;
  }
  return d / n;
}
const near = (a: number, b: number, tol = 0.006) => Math.abs(a - b) <= tol;
const boxNear = (a: { x: number; y: number; w: number; h: number }, b: typeof a, tol = 0.006) => near(a.x, b.x, tol) && near(a.y, b.y, tol) && near(a.w, b.w, tol) && near(a.h, b.h, tol);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

// ── 1. 좌표 변환 단위 ──
describe('좌표 변환 (CTM · /Rotate · 뒤집기)', () => {
  const frame = (w: number, h: number, rotate = 0, x = 0, y = 0): PageFrame => ({ box: { x, y, width: w, height: h }, rotate });
  const CASES: { name: string; m: Mat; f: PageFrame }[] = [
    { name: '회전 0', m: [595, 0, 0, 842, 0, 0], f: frame(595, 842) },
    { name: 'CTM 90', m: [0, 842, -595, 0, 595, 0], f: frame(595, 842) },
    { name: 'CTM 180', m: [-595, 0, 0, -842, 595, 842], f: frame(595, 842) },
    { name: 'CTM 270', m: [0, -842, 595, 0, 0, 842], f: frame(595, 842) },
    { name: '/Rotate 90', m: [842, 0, 0, 595, 0, 0], f: frame(842, 595, 90) },
    { name: '/Rotate 180', m: [595, 0, 0, 842, 0, 0], f: frame(595, 842, 180) },
    { name: '/Rotate 270', m: [842, 0, 0, 595, 0, 0], f: frame(842, 595, 270) },
    { name: '여백 + 원점 이동 MediaBox', m: [565, 0, 0, 800, 115, 121], f: frame(595, 842, 0, 100, 100) },
    { name: '좌우 뒤집기', m: [-595, 0, 0, 842, 595, 0], f: frame(595, 842) },
  ];
  for (const c of CASES) {
    test(`${c.name}: 바로 선 좌표 ↔ 페이지 좌표 왕복 · 새 배치가 원래 이미지 자리와 같음`, () => {
      const o = orientationOf(c.m, c.f);
      const b = { x: 0.48, y: 0.2, w: 0.2, h: 0.013 };
      const back = pageBoxToUpright(c.m, o, c.f, uprightBoxToPage(c.m, o, c.f, b));
      assert.ok(boxNear(back, b, 1e-9), JSON.stringify({ back, b }));
      const r0 = placedRect(c.m), r1 = placedRect(uprightPlacement(c.m, o));
      for (const k of ['x0', 'y0', 'x1', 'y1'] as const) assert.ok(Math.abs(r0[k] - r1[k]) < 1e-9);
      for (const [s, t] of [[0.1, 0.7], [0.9, 0.05]]) {
        const u = toUpright(o, s, t);
        const st = fromUpright(o, u.X, u.Y);
        assert.ok(near(st.s, s, 1e-12) && near(st.t, t, 1e-12));
      }
    });
  }

  test('픽셀 회전: 저장 방향(90·180·270·뒤집기) → orient → 바로 선 이미지와 픽셀이 같음', () => {
    const u: RgbImage = { width: 3, height: 2, data: new Uint8Array(24) };
    for (let p = 0; p < 6; p++) u.data.set([p * 40, p * 40, p * 40, 255], p * 4);
    const frame0 = frame(2, 3);
    const variants: { s: RgbImage; m: Mat; f: PageFrame }[] = [
      // 저장 S = U를 시계 방향 90도 → CTM 90(반시계)로 바로 보임
      { s: rot90cw(u), m: [0, 3, -2, 0, 2, 0], f: frame(2, 3) },
      { s: rot180(u), m: [-3, 0, 0, -2, 3, 2], f: frame(3, 2) },
      { s: rot90ccw(u), m: [0, -3, 2, 0, 0, 3], f: frame(2, 3) },
      // /Rotate 90: 페이지가 시계 방향으로 돌아 보이므로 저장은 반시계 방향
      { s: rot90ccw(u), m: [2, 0, 0, 3, 0, 0], f: { ...frame0, rotate: 90 } },
    ];
    for (const v of variants) {
      const back = orient(v.s, orientationOf(v.m, v.f));
      assert.equal(back.width, 3);
      assert.deepEqual([...back.data], [...u.data]);
    }
  });
});

// ── 2. 회전·배치 회귀: 실제 PDF → 가짜 CLOVA → 보호본을 poppler로 그려 확인 ──
interface Placement {
  name: string;
  /** 저장 이미지 = 바로 선 이미지를 이렇게 돌린 것 */
  store: (u: RgbImage) => RgbImage;
  page: (img: Uint8Array, w: number, h: number) => PageSpec;
  /** 화면에서 이미지가 차지하는 영역 (0~1) */
  display: { x: number; y: number; w: number; h: number };
  /** 화면 좌표 상자 → 회전 전 페이지 좌표 상자 (테스트 쪽 독립 계산) */
  toPage: (b: { x: number; y: number; w: number; h: number }) => { x: number; y: number; w: number; h: number };
}
const same = (u: RgbImage) => u;
const jpg = (bytes: Uint8Array, w: number, h: number) => ({ bytes, width: w, height: h });
const inDisplay = (d: Placement['display'], b: { x: number; y: number; w: number; h: number }) => ({ x: d.x + b.x * d.w, y: d.y + b.y * d.h, w: b.w * d.w, h: b.h * d.h });
const FULL = { x: 0, y: 0, w: 1, h: 1 };
const ident = (b: { x: number; y: number; w: number; h: number }) => b;
const PLACEMENTS: Placement[] = [
  { name: '회전 0 (전체 덮음)', store: same, page: (b, w, h) => ({ size: [595, 842], image: jpg(b, w, h) }), display: FULL, toPage: ident },
  { name: 'CTM 90', store: rot90cw, page: (b, w, h) => ({ size: [595, 842], image: jpg(b, w, h), cms: [[0, 842, -595, 0, 595, 0]] }), display: FULL, toPage: ident },
  { name: 'CTM 180', store: rot180, page: (b, w, h) => ({ size: [595, 842], image: jpg(b, w, h), cms: [[-595, 0, 0, -842, 595, 842]] }), display: FULL, toPage: ident },
  { name: 'CTM 270', store: rot90ccw, page: (b, w, h) => ({ size: [595, 842], image: jpg(b, w, h), cms: [[0, -842, 595, 0, 0, 842]] }), display: FULL, toPage: ident },
  {
    name: '/Rotate 90',
    store: rot90ccw,
    page: (b, w, h) => ({ size: [842, 595], rotate: 90, image: jpg(b, w, h) }),
    display: FULL,
    toPage: (d) => ({ x: d.y, y: 1 - (d.x + d.w), w: d.h, h: d.w }),
  },
  { name: '/Rotate 180', store: rot180, page: (b, w, h) => ({ size: [595, 842], rotate: 180, image: jpg(b, w, h) }), display: FULL, toPage: (d) => ({ x: 1 - (d.x + d.w), y: 1 - (d.y + d.h), w: d.w, h: d.h }) },
  {
    name: '/Rotate 270',
    store: rot90cw,
    page: (b, w, h) => ({ size: [842, 595], rotate: 270, image: jpg(b, w, h) }),
    display: FULL,
    toPage: (d) => ({ x: 1 - (d.y + d.h), y: d.x, w: d.h, h: d.w }),
  },
  {
    name: '여백 있는 스캔 (면적 약 90%)',
    store: same,
    page: (b, w, h) => ({ size: [595, 842], image: jpg(b, w, h), cms: [[565, 0, 0, 800, 15, 21]] }),
    display: { x: 15 / 595, y: 21 / 842, w: 565 / 595, h: 800 / 842 },
    toPage: ident,
  },
  {
    name: 'CTM 축소 + 이동 (cm 두 번)',
    store: same,
    page: (b, w, h) => ({ size: [595, 842], image: jpg(b, w, h), cms: [[0.5, 0, 0, 0.5, 10, 10], [1130, 0, 0, 1600, 10, 22]] }),
    display: { x: 15 / 595, y: 21 / 842, w: 565 / 595, h: 800 / 842 },
    toPage: ident,
  },
  {
    name: 'CTM 90 + /Rotate 270 (원점 이동 MediaBox)',
    store: rot180,
    page: (b, w, h) => ({ size: [842, 595], origin: [50, 30], rotate: 270, image: jpg(b, w, h), cms: [[0, 595, -842, 0, 892, 30]] }),
    display: FULL,
    toPage: (d) => ({ x: 1 - (d.y + d.h), y: d.x, w: d.h, h: d.w }),
  },
];

describe('회전·배치 회귀 (CLOVA bbox → 추출 이미지 → PDF 페이지)', () => {
  let U: RgbImage;
  before(async () => {
    U = await leaseUpright();
  });
  for (const pl of PLACEMENTS) {
    test(`${pl.name}: 바로 세워 OCR → 주민번호 2곳을 원래 화면 위치에서 가림 · 다른 글자는 그대로 · 숨은 글자 없음`, async () => {
      const S = pl.store(U);
      const pdf = await buildPdf([pl.page(jpegOf(S), S.width, S.height)]);
      // fixture 확인: poppler로 그린 원본이 바로 선 계약서와 같은 방향
      const shown = await render(pdf, 1);
      const crop = (img: RgbImage, d: Placement['display']) => {
        const x0 = Math.round(d.x * img.width), y0 = Math.round(d.y * img.height), w = Math.round(d.w * img.width), h = Math.round(d.h * img.height);
        const out = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) out.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
        return { width: w, height: h, data: out };
      };
      assert.ok(meanDiff(crop(shown, pl.display), U) < 12, `fixture 방향 불일치 diff=${meanDiff(crop(shown, pl.display), U)}`);

      const ocr = new FakeOcr();
      const r = await protectPdf(pdf, new Map(), {}, { scan: localRunner(ocr) });
      assert.equal(r.status, 'protected', JSON.stringify({ d: r.detail, pages: r.pages }));
      assert.deepEqual(r.pages, [{ page: 1, kind: 'scan', status: 'protected', detail: null }]);
      assert.equal(ocr.calls, 2); // 1차 OCR + 재-OCR 검증
      const rrn = r.regions.filter((x) => x.type === 'resident_registration_number');
      assert.equal(rrn.length, 2);
      // 영역 좌표 = 회전 전 페이지 좌표 (텍스트 페이지와 같은 기준)
      for (const [k, value] of RRN.entries()) {
        const expected = pl.toPage(inDisplay(pl.display, leaseA4Box(value)));
        const got = rrn.find((x) => x.maskedPreview.startsWith(value.slice(0, 6)))!;
        assert.ok(boxNear(got.bbox[0], expected, 0.01), `${k} ${JSON.stringify({ got: got.bbox[0], expected })}`);
      }
      // 보호본: 화면에서 주민번호 자리가 검고, 계약번호(가리지 않음)는 그대로
      const out = r.protectedPdf!;
      const view = await render(out, 1);
      for (const value of RRN) assert.ok(darkRatio(view, inDisplay(pl.display, leaseA4Box(value))) > 0.95, value);
      assert.ok(darkRatio(view, inDisplay(pl.display, leaseA4Box('2026-1234-5678-0001'))) < 0.5);
      assert.ok(meanDiff(crop(view, pl.display), U) < 25, '보호본 방향');
      // 크기·회전 동일 · 텍스트 추출 0
      const a = await PDFDocument.load(pdf), b = await PDFDocument.load(out);
      assert.deepEqual(b.getPage(0).getMediaBox(), a.getPage(0).getMediaBox());
      assert.equal(b.getPage(0).getRotation().angle, a.getPage(0).getRotation().angle);
      assert.equal((await textOf(out)).trim(), '');
      const all = await allStreamText(out);
      for (const s of RAW_SECRETS) assert.ok(!all.includes(s));
      assert.ok(!JSON.stringify(r).includes('1234567'));
    });
  }

  test('가림 바꾸기: 저장된 위치로 다시 그림 — OCR 0회, 해제한 주민번호만 보이고 나머지는 가림', async () => {
    const S = rot90cw(U);
    const pdf = await buildPdf([{ size: [595, 842], image: jpg(jpegOf(S), S.width, S.height), cms: [[0, 842, -595, 0, 595, 0]] }]);
    const first = await protectPdf(pdf, new Map(), {}, { scan: localRunner(new FakeOcr()) });
    assert.equal(first.status, 'protected');
    const target = first.regions.find((x) => x.maskedPreview.startsWith('800101'))!;
    const stored = first.regions.map((x) => (x.key === target.key ? { ...x, state: 'unmasked' as const } : x));
    const ocr = new FakeOcr();
    const re = await protectPdf(pdf, new Map(stored.map((x) => [x.key, x.state])), {}, { scan: localRunner(ocr), redrawScanRegions: stored });
    assert.equal(re.status, 'protected');
    assert.equal(ocr.calls, 0);
    const view = await render(re.protectedPdf!, 1);
    assert.ok(darkRatio(view, leaseA4Box('800101-1234567')) < 0.5);
    assert.ok(darkRatio(view, leaseA4Box('950505-2345678')) > 0.95);
  });
});

// ── 3. 이미지 형식 · 페이지 판단 ──
describe('이미지 형식 · scan page 판단 (dominant image)', () => {
  let U: RgbImage;
  before(async () => {
    U = await leaseUpright();
  });
  const fill = (spec: PageSpec['image']): PageSpec => ({ size: [595, 842], image: spec });

  for (const [channels, predictor] of [[1, false], [1, true], [3, false], [3, true]] as const) {
    test(`Flate 8비트 ${channels === 1 ? '회색' : 'RGB'}${predictor ? ' + PNG 예측자' : ''} → 해석 · protected`, async () => {
      const spec = flateImage(U, channels, predictor);
      const decoded = await decodeScanImage(spec.bytes, { filter: 'flate', channels, width: U.width, height: U.height, predictor: predictor ? 15 : 1 });
      const px = (y: number, x: number) => decoded.data[(y * U.width + x) * 4];
      const ex = (y: number, x: number) => (channels === 1 ? Math.round((U.data[(y * U.width + x) * 4] + U.data[(y * U.width + x) * 4 + 1] + U.data[(y * U.width + x) * 4 + 2]) / 3) : U.data[(y * U.width + x) * 4]);
      for (const [y, x] of [[0, 0], [700, 600], [1694, 1199]]) assert.equal(px(y, x), ex(y, x));
      const r = await protectPdf(await buildPdf([fill(spec)]), new Map(), {}, { scan: localRunner(new FakeOcr()) });
      assert.equal(r.status, 'protected', String(r.detail));
    });
  }

  test('ASCII85 디코더: z(0 네 바이트)가 많아도 잘리지 않음 · 마지막 부분 묶음', () => {
    const data = new Uint8Array(4003);
    for (let i = 3000; i < 4003; i++) data[i] = (i * 37) & 0xff;
    assert.deepEqual([...decodeAscii85(ascii85(data))], [...data]);
  });

  test('글자 포장 필터: [ASCII85Decode FlateDecode] RGB · [ASCIIHexDecode DCTDecode] → 스캔 페이지로 보호 (예: reportlab 등이 만든 PDF)', async () => {
    const flate = flateImage(U, 3, false);
    const a85 = { ...flate, bytes: ascii85(flate.bytes), filter: ['ASCII85Decode', 'FlateDecode'] };
    const hex = { bytes: asciiHex(jpegOf(U)), width: U.width, height: U.height, filter: ['ASCIIHexDecode', 'DCTDecode'] };
    for (const spec of [a85, hex]) {
      const ocr = new FakeOcr();
      const r = await protectPdf(await buildPdf([fill(spec)]), new Map(), {}, { scan: localRunner(ocr) });
      assert.equal(r.status, 'protected', String(r.detail));
      assert.equal(ocr.calls, 2);
      const view = await render(r.protectedPdf!, 1);
      assert.ok(darkRatio(view, leaseA4Box('800101-1234567')) > 0.95);
    }
  });

  test('필터가 세 개 이상이거나 글자 포장만 있는 경우 → unsupported_scan', async () => {
    const flate = flateImage(U, 3, false);
    for (const filter of [['ASCII85Decode', 'ASCIIHexDecode', 'FlateDecode'], ['ASCII85Decode']]) {
      const run = localRunner(new FakeOcr());
      const r = await protectPdf(await buildPdf([fill({ ...flate, filter })]), new Map(), {}, { scan: run });
      assert.equal(r.status, 'unsupported_scan');
      assert.equal(run.jobs, 0);
    }
  });

  const UNSUPPORTED: [string, Partial<NonNullable<PageSpec['image']>>][] = [
    ['CCITT (팩스)', { filter: 'CCITTFaxDecode', colorSpace: 'DeviceGray', bpc: 1 }],
    ['JBIG2', { filter: 'JBIG2Decode', colorSpace: 'DeviceGray', bpc: 1 }],
    ['JPEG2000', { filter: 'JPXDecode' }],
    ['CMYK JPEG', { colorSpace: 'DeviceCMYK' }],
    ['특수 색공간 (Indexed)', { colorSpace: '__indexed__' }],
    ['투명 마스크(SMask)', { extra: { SMask: 0 } }],
    ['1비트 Flate', { filter: 'FlateDecode', bpc: 1, colorSpace: 'DeviceGray' }],
  ];
  for (const [name, over] of UNSUPPORTED) {
    test(`${name} → unsupported_scan (OCR 호출 없음)`, async () => {
      const c = await ContractPdf.create();
      const base = { bytes: jpegOf(U), width: U.width, height: U.height, ...over };
      if (over.colorSpace === '__indexed__') base.colorSpace = undefined;
      const extra = { ...(over.extra ?? {}) } as Record<string, unknown>;
      if ('SMask' in extra) extra.SMask = c.doc.context.register(c.doc.context.stream(new Uint8Array(1), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8 } as never));
      if (over.colorSpace === '__indexed__') extra.ColorSpace = c.doc.context.obj(['Indexed', 'DeviceRGB', 1, c.doc.context.obj([0, 0, 0, 255, 255, 255]) as never]);
      const pdf = await buildPdf([fill({ ...base, extra } as never)], undefined, c.doc);
      const ocr = new FakeOcr();
      const run = localRunner(ocr);
      const r = await protectPdf(pdf, new Map(), {}, { scan: run });
      assert.equal(r.status, 'unsupported_scan');
      assert.equal(r.detail, 'scan_format');
      assert.equal(run.jobs, 0);
      assert.equal(r.protectedPdf, null);
    });
  }

  test('기울어진 이미지 · 여러 장으로 나뉜 페이지 · 페이지 일부(60%)만 덮는 이미지 → unsupported_scan(scan_layout)', async () => {
    const b = jpegOf(U);
    const img = { bytes: b, width: U.width, height: U.height };
    const cases: PageSpec[] = [
      { size: [595, 842], image: img, cms: [[560, 60, -60, 790, 40, 0]] },
      { size: [595, 842], images: [{ spec: img, cm: [595, 0, 0, 421, 0, 421] }, { spec: img, cm: [595, 0, 0, 421, 0, 0] }] },
      { size: [595, 842], image: img, cms: [[460, 0, 0, 650, 60, 100]] },
    ];
    for (const pc of cases) {
      const run = localRunner(new FakeOcr());
      const r = await protectPdf(await buildPdf([pc]), new Map(), {}, { scan: run });
      assert.equal(r.status, 'unsupported_scan');
      assert.equal(r.detail, 'scan_layout');
      assert.equal(run.jobs, 0);
    }
  });

  test('작은 로고·서명 이미지가 있는 일반 텍스트 PDF → scan page로 오판하지 않음 (텍스트로 보호, OCR 없음)', async () => {
    const c = await ContractPdf.create();
    await c.page(['근로계약서', '근로자: 박민준', '주민등록번호: 901225-1234567', '월 임금 3,600,000원, 매월 25일 지급']);
    const logo = await c.doc.embedJpg(jpegOf(downscale(U, 120)));
    c.doc.getPage(0).drawImage(logo, { x: 470, y: 740, width: 70, height: 99 });
    const run = localRunner(new FakeOcr());
    const r = await protectPdf(await c.save(), new Map(), {}, { scan: run });
    assert.equal(r.status, 'protected');
    assert.equal(run.jobs, 0);
    assert.deepEqual(r.pages, [{ page: 1, kind: 'text', status: 'protected', detail: null }]);
  });

  test(`스캔 페이지 ${MAX_SCAN_PAGES}장 초과 → unsupported_scan(too_many_scan_pages), OCR 호출 없음`, async () => {
    const small = downscale(U, 60);
    const b = jpegOf(small);
    const pages = Array.from({ length: MAX_SCAN_PAGES + 1 }, () => fill({ bytes: b, width: small.width, height: small.height }));
    const run = localRunner(new FakeOcr());
    const r = await protectPdf(await buildPdf(pages), new Map(), {}, { scan: run });
    assert.equal(r.status, 'unsupported_scan');
    assert.equal(r.detail, 'too_many_scan_pages');
    assert.equal(run.jobs, 0);
  });
});

// ── 4. 혼합 PDF A~D · 상태 규칙 ──
describe('혼합 PDF · 문서 상태 규칙', () => {
  let U: RgbImage;
  let leaseJpg: Uint8Array;
  before(async () => {
    U = await leaseUpright();
    leaseJpg = jpegOf(U);
  });
  const scanPage = (): PageSpec => ({ size: [595, 842], image: { bytes: leaseJpg, width: U.width, height: U.height } });
  const plainPage = async (): Promise<PageSpec> => {
    const plain = await decodeImage(readFix('plain.jpg'), 'jpg');
    const p = downscale(plain, 1200);
    return { size: [595, Math.round((595 * p.height) / p.width)], image: { bytes: jpegOf(p), width: p.width, height: p.height } };
  };
  const report: Record<string, unknown> = {};

  test('A: 텍스트 페이지 + 스캔 페이지 → protected (텍스트는 글자 제거, 스캔은 가린 이미지로 새 페이지)', async () => {
    const c = await ContractPdf.create();
    await c.page(['근로계약서', '근로자: 박민준', '주민등록번호: 901225-1234567', '연락처: 010-2222-3333']);
    const pdf = await buildPdf([scanPage()], undefined, c.doc);
    const ocr = new FakeOcr();
    const r = await protectPdf(pdf, new Map(), {}, { scan: localRunner(ocr) });
    assert.equal(r.status, 'protected', String(r.detail));
    assert.deepEqual(r.pages.map((p) => [p.kind, p.status]), [['text', 'protected'], ['scan', 'protected']]);
    assert.ok(r.regions.some((x) => x.page === 1 && x.type === 'resident_registration_number'));
    assert.equal(r.regions.filter((x) => x.page === 2 && x.type === 'resident_registration_number').length, 2);
    const text = await textOf(r.protectedPdf!);
    assert.ok(text.includes('근로계약서'));
    for (const s of ['901225-1234567', '1234567', ...RAW_SECRETS]) assert.ok(!text.includes(s), s);
    const view = await render(r.protectedPdf!, 2);
    for (const v of RRN) assert.ok(darkRatio(view, leaseA4Box(v)) > 0.95);
    assert.equal(ocr.calls, 2);
    report.A = { status: r.status, pages: r.pages.map((p) => `${p.kind}:${p.status}`), ocrCalls: ocr.calls, srcBytes: pdf.byteLength, outBytes: r.protectedPdf!.byteLength };
  });

  test('B: 텍스트 + 보호된 스캔 + 민감정보 없는 스캔 → protected, 페이지별 상태 [no_sensitive, protected, no_sensitive]', async () => {
    const c = await ContractPdf.create();
    await c.page(['헬스장 1년권 계약서', '1년 회원권 660,000원 (계약 시 일시불 결제)']);
    const pdf = await buildPdf([scanPage(), await plainPage()], undefined, c.doc);
    const ocr = new FakeOcr();
    const r = await protectPdf(pdf, new Map(), {}, { scan: localRunner(ocr) });
    assert.equal(r.status, 'protected', String(r.detail));
    assert.deepEqual(r.pages.map((p) => [p.kind, p.status]), [['text', 'no_sensitive_data'], ['scan', 'protected'], ['scan', 'no_sensitive_data']]);
    assert.equal(ocr.calls, 3); // 민감정보 없는 스캔은 재-OCR 없음
    const out = await PDFDocument.load(r.protectedPdf!);
    assert.equal(out.getPageCount(), 3);
    const src = await PDFDocument.load(pdf);
    for (let i = 0; i < 3; i++) assert.deepEqual(out.getPage(i).getMediaBox(), src.getPage(i).getMediaBox());
    report.B = { pages: r.pages.map((p) => `${p.kind}:${p.status}`), ocrCalls: ocr.calls, srcBytes: pdf.byteLength, outBytes: r.protectedPdf!.byteLength };
  });

  test('C: 텍스트 + 특수 스캔(CCITT) → unsupported_scan, OCR 없음, 보호본 없음 (텍스트 페이지만 보호됨으로 표시하지 않음)', async () => {
    const c = await ContractPdf.create();
    await c.page(['주민등록번호: 901225-1234567']);
    const pdf = await buildPdf([{ size: [595, 842], image: { bytes: new Uint8Array(100), width: 1700, height: 2400, filter: 'CCITTFaxDecode', colorSpace: 'DeviceGray', bpc: 1 } }], undefined, c.doc);
    const run = localRunner(new FakeOcr());
    const r = await protectPdf(pdf, new Map(), {}, { scan: run });
    assert.equal(r.status, 'unsupported_scan');
    assert.equal(r.protectedPdf, null);
    assert.deepEqual(r.regions, []);
    assert.equal(run.jobs, 0);
    assert.deepEqual(r.pages.map((p) => [p.kind, p.status]), [['text', 'skipped'], ['unsupported', 'unsupported_scan']]);
  });

  async function hiddenLayerPdf(at: { x: number; y: number }) {
    const c = await ContractPdf.create();
    const page: PageSpec = { ...scanPage(), hidden: [['주민등록번호', at.x - 110, at.y, 10], ['800101-1234567', at.x, at.y, 10], ['연락처 010-1234-5678', 40, 590, 10]] };
    return await buildPdf([page], (s) => c.font(s), c.doc);
  }

  test('D: 숨은 OCR 글자층이 있는 스캔 → 보호본 텍스트 추출(pdf.js · pdftotext · 스트림 전체)에서 주민번호 등이 나오지 않음', async () => {
    const pdf = await hiddenLayerPdf({ x: 300, y: 660.5 });
    assert.ok((await textOf(pdf)).replace(/\s/g, '').includes('800101-1234567'), 'fixture: 원본에는 숨은 글자층이 있음');
    const r = await protectPdf(pdf, new Map(), {}, { scan: localRunner(new FakeOcr()) });
    assert.equal(r.status, 'protected', String(r.detail));
    const out = r.protectedPdf!;
    const pj = await textOf(out), pt = pdftotext(out), streams = await allStreamText(out);
    for (const s of RAW_SECRETS) {
      assert.ok(!pj.includes(s), `pdf.js ${s}`);
      assert.ok(!pt.includes(s), `pdftotext ${s}`);
      assert.ok(!streams.includes(s), `stream ${s}`);
    }
    assert.equal(pj.trim(), '');
    assert.equal(r.diagnostics.verifyScanTextCount, 0);
  });

  test('숨은 글자층의 주민번호 위치가 OCR 결과와 맞지 않으면 → failed(ocr_layer_mismatch), 보호본 없음', async () => {
    const r = await protectPdf(await hiddenLayerPdf({ x: 300, y: 90 }), new Map(), {}, { scan: localRunner(new FakeOcr()) });
    assert.equal(r.status, 'failed');
    assert.equal(r.detail, 'ocr_layer_mismatch');
    assert.equal(r.protectedPdf, null);
  });

  test('모든 페이지 민감정보 없음 → no_sensitive_data, 보호본 없음', async () => {
    const c = await ContractPdf.create();
    await c.page(['헬스장 1년권 계약서', '1년 회원권 660,000원']);
    const r = await protectPdf(await buildPdf([await plainPage()], undefined, c.doc), new Map(), {}, { scan: localRunner(new FakeOcr()) });
    assert.equal(r.status, 'no_sensitive_data');
    assert.equal(r.protectedPdf, null);
  });

  test('읽지 못한 스캔 페이지 → 문서 unreadable, 남은 스캔 페이지는 처리하지 않음(skipped), 보호본 없음', async () => {
    const noise: RgbImage = { width: 800, height: 800, data: new Uint8Array(800 * 800 * 4).fill(255) };
    const blank = { size: [595, 595] as [number, number], image: { bytes: jpegOf(noise), width: 800, height: 800 } };
    const run = localRunner(new FakeOcr());
    const r = await protectPdf(await buildPdf([blank, scanPage(), scanPage(), scanPage()]), new Map(), {}, { scan: run });
    assert.equal(r.status, 'unreadable');
    assert.equal(r.protectedPdf, null);
    assert.equal(r.pages[0].status, 'unreadable');
    assert.ok(r.pages.some((p) => p.status === 'skipped'));
    assert.ok(run.jobs < 4);
  });

  test('OCR 오류 → failed, 보호본 없음 (원문·응답 없이 사유 코드만)', async () => {
    const ocr = new FakeOcr();
    ocr.fail = new OcrError('ocr_timeout', true);
    const r = await protectPdf(await buildPdf([scanPage()]), new Map(), {}, { scan: localRunner(ocr) });
    assert.equal(r.status, 'failed');
    assert.equal(r.detail, 'ocr_timeout');
    assert.equal(r.protectedPdf, null);
  });

  test('worker 호출 실패 → failed (보호됨으로 표시하지 않음)', async () => {
    const r = await protectPdf(await buildPdf([scanPage()]), new Map(), {}, { scan: async () => { throw new Error('scan_worker_error'); } });
    assert.equal(r.status, 'failed');
    assert.equal(r.detail, 'scan_worker_error');
  });

  test('1600px 보호 이미지 · 원본 불변 · 크기 기록 (원본 2400×3391 JPEG)', async () => {
    const full = readFix('lease-a4.jpg');
    const pdf = await buildPdf([{ size: [595, 842], image: { bytes: full, width: 2400, height: 3391 } }]);
    const before = sha(pdf);
    const r: ProtectResult = await protectPdf(pdf, new Map(), {}, { scan: localRunner(new FakeOcr()) });
    assert.equal(r.status, 'protected');
    assert.equal(sha(pdf), before);
    assert.equal(r.scanMetrics[0].viewWidth, 1600);
    assert.equal(r.scanMetrics[0].directOcrInput, true);
    report.fullSize = { srcBytes: pdf.byteLength, outBytes: r.protectedPdf!.byteLength, view: `${r.scanMetrics[0].viewWidth}x${r.scanMetrics[0].viewHeight}`, imageBytes: r.scanMetrics[0].imageBytes, timings: r.scanMetrics[0].timings };
    console.log(`scan-report ${JSON.stringify(report)}`);
  });
});
