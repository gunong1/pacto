// PDF 페이지 분류(텍스트 · 스캔 · 지원 안 함) + 스캔 이미지 꺼내기 + 보호본 재조합 — pdf-lib 기반 (protect-document에서)
// 스캔 페이지 = 보이는 글자가 거의 없고, 이미지 한 장이 페이지 대부분(DOMINANT_IMAGE_MIN_COVERAGE 이상)을 축에 맞게 덮는 페이지.
// 작은 로고·서명 이미지가 있는 일반 텍스트 페이지는 글자가 많으므로 텍스트 페이지로 남는다.
// 보호본에서 스캔 페이지는 원본 페이지를 복사하지 않고, 가린 이미지 한 장으로 새 페이지를 만든다
//   → 숨은 OCR 글자층·원본 이미지·주석·링크가 따라오지 않는다 (V1: 스캔 페이지의 링크·주석은 보호본에서 빠진다)
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream } from '../vendor/pdf-lib.js';
import { fmtNum } from './contentStream.ts';
import type { PageText } from './pdfEngine.ts';
import { isAxisAligned, normalizeRotate, orientationOf, pageCoverage, uprightPlacement, type Mat, type Orientation, type PageFrame } from './scanGeometry.ts';
import { MAX_SCAN_PIXELS, type ScanImageMeta } from './scanImage.ts';

/** 이미지가 보이는 페이지 면적(CropBox)에서 이 비율 이상을 덮어야 스캔 페이지 */
export const DOMINANT_IMAGE_MIN_COVERAGE = 0.85;
/** 보이는 글자가 이 수 이상이면 텍스트 페이지 */
export const TEXT_PAGE_MIN_VISIBLE_GLYPHS = 10;
/** 글자·이미지 없이 칠하는 연산이 이보다 많으면 글자를 윤곽선으로 바꾼 페이지로 본다 (읽을 수 없음) */
const OUTLINE_PAINT_MIN = 20;

export type PageKind = 'text' | 'scan' | 'blank' | 'unsupported';

export interface ScanSource {
  ref: PDFRef;
  meta: ScanImageMeta;
  ctm: Mat;
  frame: PageFrame;
  /** CropBox (없으면 MediaBox와 같음) */
  crop: { x: number; y: number; width: number; height: number };
  orientation: Orientation;
}

export interface PageClass {
  kind: PageKind;
  /** unsupported 사유 (scan_format · scan_layout · scan_too_large · no_text) */
  detail: string | null;
  scan: ScanSource | null;
}

function nameOf(o: unknown): string | null {
  return o instanceof PDFName ? o.asString().slice(1) : null;
}
function numOf(o: unknown, dflt: number): number {
  return o instanceof PDFNumber ? o.asNumber() : dflt;
}

/** 이미지 형식 확인 — V1: JPEG(DCTDecode) · Flate 8비트 회색·RGB. 그 밖(CCITT·JBIG2·JPX·CMYK·특수 색공간·마스크)은 null */
export function scanImageMeta(doc: PDFDocument, ref: PDFRef): { meta: ScanImageMeta } | { unsupported: string } {
  const xo = doc.context.lookup(ref);
  if (!(xo instanceof PDFRawStream)) return { unsupported: 'scan_format' };
  const d = xo.dict;
  const get = (k: string) => d.lookup(PDFName.of(k));
  // 필터: [글자 포장(ASCII85·ASCIIHex) 0~1개] + DCTDecode 또는 FlateDecode
  const filterObj = get('Filter');
  const filters = filterObj instanceof PDFArray ? Array.from({ length: filterObj.size() }, (_, k) => nameOf(filterObj.lookup(k))) : [nameOf(filterObj)];
  let ascii: ScanImageMeta['ascii'] = null;
  if (filters.length === 2 && (filters[0] === 'ASCII85Decode' || filters[0] === 'A85')) ascii = 'a85';
  else if (filters.length === 2 && (filters[0] === 'ASCIIHexDecode' || filters[0] === 'AHx')) ascii = 'hex';
  else if (filters.length !== 1) return { unsupported: 'scan_format' };
  const f = filters[filters.length - 1];
  if (f !== 'DCTDecode' && f !== 'FlateDecode') return { unsupported: 'scan_format' };
  if (get('ImageMask') || get('SMask') || get('Mask') || get('Decode') || get('SMaskInData')) return { unsupported: 'scan_format' };
  const bpc = numOf(get('BitsPerComponent'), f === 'DCTDecode' ? 8 : 0);
  if (bpc !== 8) return { unsupported: 'scan_format' };
  const cs = get('ColorSpace');
  let channels = 0;
  const csName = nameOf(cs);
  if (csName === 'DeviceGray') channels = 1;
  else if (csName === 'DeviceRGB') channels = 3;
  else if (cs instanceof PDFArray && cs.size() === 2 && nameOf(cs.lookup(0)) === 'ICCBased') {
    const icc = cs.lookup(1);
    const n = icc instanceof PDFStream ? numOf(icc.dict.lookup(PDFName.of('N')), 0) : 0;
    if (n === 1 || n === 3) channels = n;
  }
  if (channels !== 1 && channels !== 3) return { unsupported: 'scan_format' };
  const width = numOf(get('Width'), 0), height = numOf(get('Height'), 0);
  if (!(width > 0 && height > 0 && Number.isInteger(width) && Number.isInteger(height))) return { unsupported: 'scan_format' };
  if (width * height > MAX_SCAN_PIXELS) return { unsupported: 'scan_too_large' };
  let predictor = 1;
  if (f === 'FlateDecode') {
    let parms = get('DecodeParms');
    // 필터 배열과 같은 순서의 배열 — Flate는 마지막 필터
    if (parms instanceof PDFArray) parms = parms.lookup(parms.size() - 1);
    if (parms instanceof PDFDict) {
      predictor = numOf(parms.lookup(PDFName.of('Predictor')), 1);
      const colors = numOf(parms.lookup(PDFName.of('Colors')), 1);
      const pbpc = numOf(parms.lookup(PDFName.of('BitsPerComponent')), 8);
      const cols = numOf(parms.lookup(PDFName.of('Columns')), 1);
      if (predictor !== 1 && (predictor < 10 || predictor > 15 || colors !== channels || pbpc !== 8 || cols !== width)) return { unsupported: 'scan_format' };
    }
  }
  return { meta: { filter: f === 'DCTDecode' ? 'jpeg' : 'flate', channels: channels as 1 | 3, width, height, predictor, ascii } };
}

/** 페이지에서 보이는 영역 (CropBox, 없으면 MediaBox) */
function visibleBox(doc: PDFDocument, pageIndex: number) {
  const page = doc.getPage(pageIndex);
  const c = page.getCropBox();
  return { x: c.x, y: c.y, width: c.width, height: c.height };
}

/** 페이지 종류 판단 */
export function classifyPage(doc: PDFDocument, p: PageText): PageClass {
  const visible = p.glyphs.filter((g) => !g.invisible).length;
  if (p.unsupportedVisibleText > 0 || visible >= TEXT_PAGE_MIN_VISIBLE_GLYPHS) return { kind: 'text', detail: null, scan: null };
  if (p.images === 0) {
    if (p.glyphs.length > 0) return { kind: 'text', detail: null, scan: null };
    return p.paints > OUTLINE_PAINT_MIN ? { kind: 'unsupported', detail: 'no_text', scan: null } : { kind: 'blank', detail: null, scan: null };
  }
  // 글자가 거의 없고 이미지가 있다: 이미지 한 장이 페이지 대부분을 덮어야 스캔 페이지 (여러 장·작은 이미지·기울어진 이미지는 미지원)
  if (p.placements.length !== 1) return { kind: 'unsupported', detail: 'scan_layout', scan: null };
  const pl = p.placements[0];
  if (pl.inline || !pl.ref) return { kind: 'unsupported', detail: 'scan_format', scan: null };
  if (!isAxisAligned(pl.ctm)) return { kind: 'unsupported', detail: 'scan_layout', scan: null };
  if (pageCoverage(pl.ctm, visibleBox(doc, p.pageIndex)) < DOMINANT_IMAGE_MIN_COVERAGE) return { kind: 'unsupported', detail: 'scan_layout', scan: null };
  const fmt = scanImageMeta(doc, pl.ref);
  if ('unsupported' in fmt) return { kind: 'unsupported', detail: fmt.unsupported, scan: null };
  const frame: PageFrame = { box: p.box, rotate: normalizeRotate(doc.getPage(p.pageIndex).getRotation().angle) };
  return { kind: 'scan', detail: null, scan: { ref: pl.ref, meta: fmt.meta, ctm: pl.ctm, frame, crop: visibleBox(doc, p.pageIndex), orientation: orientationOf(pl.ctm, frame) } };
}

/** 이미지 스트림 원본 바이트 (인코딩된 그대로 — worker가 해석) */
export function rawImageBytes(doc: PDFDocument, ref: PDFRef): Uint8Array {
  const xo = doc.context.lookup(ref);
  if (!(xo instanceof PDFRawStream)) throw new Error('scan_format');
  return xo.getContents();
}

export interface AssemblePage {
  kind: 'copy' | 'image';
  /** copy: 보호된 텍스트 문서의 페이지 번호(0부터) */
  from?: number;
  /** image: 가린 이미지(JPEG, 바로 선 방향)와 원래 이미지 자리 */
  jpeg?: Uint8Array;
  source?: ScanSource;
}

/**
 * 보호본 재조합: 텍스트 페이지는 이미 보호된 문서에서 복사하고, 스캔 페이지는 가린 이미지 한 장으로 새로 만든다.
 * MediaBox·CropBox·회전·페이지 순서는 원본과 같다.
 */
export async function assembleProtectedPdf(textProtected: PDFDocument | null, plan: AssemblePage[]): Promise<Uint8Array> {
  const out = await PDFDocument.create({ updateMetadata: false });
  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    if (item.kind === 'copy') {
      if (!textProtected) throw new Error('assemble_missing_text');
      const [p] = await out.copyPages(textProtected, [item.from ?? i]);
      out.addPage(p);
      continue;
    }
    const src = item.source!;
    const mb = src.frame.box;
    const page = out.addPage([mb.width, mb.height]);
    page.setMediaBox(mb.x, mb.y, mb.width, mb.height);
    const crop = src.crop;
    if (crop.x !== mb.x || crop.y !== mb.y || crop.width !== mb.width || crop.height !== mb.height) page.setCropBox(crop.x, crop.y, crop.width, crop.height);
    if (src.frame.rotate) page.node.set(PDFName.of('Rotate'), out.context.obj(src.frame.rotate));
    const img = await out.embedJpg(item.jpeg!);
    const name = page.node.newXObject('ScanImg', img.ref);
    const m = uprightPlacement(src.ctm, src.orientation);
    const ops = `q ${m.map(fmtNum).join(' ')} cm ${name.asString()} Do Q\n`;
    page.node.set(PDFName.of('Contents'), out.context.register(out.context.flateStream(new TextEncoder().encode(ops))));
  }
  out.setProducer('PACTO');
  out.setCreator('PACTO');
  out.setTitle('PACTO 보호 표시본');
  return await out.save({ useObjectStreams: true });
}
