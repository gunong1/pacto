/**
 * 실제 문서 생성기와 같은 글꼴 구조의 테스트 PDF (값을 한 번의 Tj로 그림 — pdf.js가 여러 글자를 한 조각으로 읽는 경우)
 * - 단순 글꼴(Helvetica, WinAnsi): reportlab·워드 일부 내보내기
 * - 미리 정의된 한글 CMap(UniKS-UCS2-H, KSCms-UHC-H …): reportlab의 한글 CID 글꼴 (글꼴 미포함)
 * - Type3 글꼴(+ToUnicode): Chrome 인쇄 PDF
 */
import { Buffer } from 'node:buffer';

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from '../../supabase/functions/_shared/vendor/pdf-lib.js';
import { ContractPdf } from './fixtures.ts';

type Page = ReturnType<PDFDocument['addPage']>;

function addContent(doc: PDFDocument, page: Page, ops: string) {
  const ref = doc.context.register(doc.context.flateStream(Buffer.from(ops, 'latin1')));
  const cur = page.node.get(PDFName.of('Contents'));
  const curv = cur ? doc.context.lookup(cur) : undefined;
  if (!cur) page.node.set(PDFName.of('Contents'), ref);
  else if (curv instanceof PDFArray) curv.push(ref);
  else page.node.set(PDFName.of('Contents'), doc.context.obj([cur, ref]));
}

function fontResource(page: Page, tag: string, ref: unknown) {
  let res = page.node.Resources();
  if (!res) {
    res = page.doc.context.obj({}) as PDFDict;
    page.node.set(PDFName.of('Resources'), res);
  }
  let fonts = res.lookup(PDFName.of('Font'));
  if (!(fonts instanceof PDFDict)) {
    fonts = page.doc.context.obj({}) as PDFDict;
    res.set(PDFName.of('Font'), fonts);
  }
  (fonts as PDFDict).set(PDFName.of(tag), ref as never);
}

const hex = (bytes: number[]) => `<${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}>`;

/** 라벨은 한글 글꼴(나눔고딕, Identity-H), 값은 Helvetica 한 줄(Tj 1회) */
export async function simpleFontValuesPdf(lines: [label: string, value: string][]) {
  const c = await ContractPdf.create();
  const helv = await c.doc.embedFont('Helvetica');
  const page = c.doc.addPage([595, 842]);
  let y = 780;
  for (const [label, value] of lines) {
    await c.line(page, label, 50, y);
    page.drawText(value, { x: 170, y, size: 11, font: helv });
    y -= 24;
  }
  return c.save();
}

// ── 미리 정의된 CMap (Adobe-Korea1, 글꼴 미포함 — reportlab 한글 CID 글꼴과 같은 구조)
let eucMap: Map<string, number[]> | null = null;
/** 한글 → EUC-KR/UHC 바이트 (테스트용: TextDecoder로 역표를 만든다) */
function eucKr(s: string): number[] {
  if (!eucMap) {
    eucMap = new Map();
    const dec = new TextDecoder('euc-kr');
    for (let a = 0x81; a <= 0xfe; a++) {
      for (let b = 0x41; b <= 0xfe; b++) {
        const ch = dec.decode(new Uint8Array([a, b]));
        if (ch.length === 1 && ch !== '�' && !eucMap.has(ch)) eucMap.set(ch, [a, b]);
      }
    }
  }
  return Array.from(s).flatMap((ch) => (ch.charCodeAt(0) < 0x80 ? [ch.charCodeAt(0)] : (eucMap!.get(ch) ?? [0x3f])));
}
const ucs2 = (s: string) => Array.from(s).flatMap((ch) => [ch.charCodeAt(0) >> 8, ch.charCodeAt(0) & 0xff]);

export type CMapName = 'UniKS-UCS2-H' | 'UniKS-UCS2-V' | 'KSCms-UHC-H' | '90ms-RKSJ-H';

export async function predefinedCMapPdf(encoding: CMapName, lines: string[]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const japanese = encoding === '90ms-RKSJ-H';
  const fd = doc.context.register(
    doc.context.obj({
      Type: 'FontDescriptor', FontName: 'HYSMyeongJo-Medium', Flags: 6, FontBBox: [0, -148, 1001, 880], ItalicAngle: 0,
      Ascent: 880, Descent: -120, CapHeight: 880, StemV: 93,
    }),
  );
  const desc = doc.context.register(
    doc.context.obj({
      Type: 'Font', Subtype: 'CIDFontType0', BaseFont: 'HYSMyeongJo-Medium', FontDescriptor: fd, DW: 1000,
      // Adobe-Korea1: CID 1~95 = ASCII 0x20~0x7E (반각)
      W: [1, 95, 500],
      CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of(japanese ? 'Japan1' : 'Korea1'), Supplement: 2 },
    }),
  );
  const font = doc.context.register(
    doc.context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: `HYSMyeongJo-Medium-${encoding}`, Encoding: encoding, DescendantFonts: [desc] }),
  );
  fontResource(page, 'F1', font);
  const enc = (s: string) => (encoding.startsWith('UniKS') ? ucs2(s) : eucKr(s));
  addContent(doc, page, lines.map((l, i) => `BT /F1 12 Tf 1 0 0 1 50 ${780 - i * 24} Tm ${hex(enc(l))} Tj ET`).join('\n'));
  return doc.save();
}

// ── Type3 글꼴 (Chrome 인쇄 PDF와 같은 구조: FontMatrix y 뒤집힘, ToUnicode)
export async function type3ValuesPdf(lines: [label: string, value: string][], { toUnicode = true } = {}) {
  const c = await ContractPdf.create();
  const doc = c.doc;
  const page = doc.addPage([595, 842]);
  const chars = [...new Set(lines.flatMap(([, v]) => Array.from(v)))].sort();
  const code = (ch: string) => 1 + chars.indexOf(ch);
  const procs: Record<string, unknown> = {};
  const widths: number[] = [];
  const diffs: unknown[] = [1];
  for (const ch of chars) {
    const w = ch === ' ' ? 250 : /\d/.test(ch) ? 556 : 600;
    widths.push(w);
    const name = `g${code(ch)}`;
    diffs.push(name);
    procs[name] = doc.context.register(doc.context.flateStream(Buffer.from(`${w} 0 d0 40 -10 ${w - 80} -680 re f`, 'latin1')));
  }
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def',
    '1 begincodespacerange <00> <FF> endcodespacerange',
    `${chars.length} beginbfchar`,
    ...chars.map((ch) => `<${code(ch).toString(16).padStart(2, '0')}> <${ch.charCodeAt(0).toString(16).padStart(4, '0')}>`),
    'endbfchar endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
  const dict: Record<string, unknown> = {
    Type: 'Font', Subtype: 'Type3', FontMatrix: [0.001, 0, 0, -0.001, 0, 0], FontBBox: [0, 10, 1000, -800],
    FirstChar: 1, LastChar: chars.length, Widths: widths, CharProcs: doc.context.obj(procs as never),
    Encoding: doc.context.obj({ Type: 'Encoding', Differences: diffs } as never), Resources: doc.context.obj({}),
  };
  if (toUnicode) dict.ToUnicode = doc.context.register(doc.context.flateStream(Buffer.from(cmap, 'latin1')));
  const font = doc.context.register(doc.context.obj(dict as never));
  let y = 780;
  const ops: string[] = [];
  for (const [label, value] of lines) {
    await c.line(page, label, 50, y);
    ops.push(`BT /T3 11 Tf 1 0 0 1 170 ${y} Tm ${hex(Array.from(value).map(code))} Tj ET`);
    y -= 24;
  }
  fontResource(page, 'T3', font);
  addContent(doc, page, ops.join('\n'));
  return c.save();
}
