// PDF 글자 위치 추출 + 실제 텍스트 제거(redaction) + 보호 표시본 생성 — pdf-lib 기반 (Deno·Node 공용)
// 원리: 콘텐츠 스트림의 글자 표시 연산자(Tj/TJ/'/")에서 민감한 글자 코드를 지우고, 그 너비만큼 TJ 위치 이동 숫자로 바꾼다
//   → 나머지 글자 배치는 그대로, 지운 글자는 파일 안에 남지 않는다. 그 위에 가림 상자를 그린다.
// 보호 표시본은 새 문서에 페이지를 복사해 만든다 — 페이지에서 닿는 객체만 복사되므로
// 교체 전 원래 콘텐츠 스트림·메타데이터·북마크·첨부·입력 양식·주석이 남지 않는다.
// 원본 바이트는 읽기만 한다 (원본 파일은 절대 수정하지 않음).
import {
  PDFArray,
  PDFContentStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from '../vendor/pdf-lib.js';
import { fmtNum, hexString, tokenize, type Op, type Operand } from './contentStream.ts';

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const I: M = [1, 0, 0, 1, 0, 0];
const apply = (m: M, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

export interface Glyph {
  ch: string;
  /** 페이지 기본 좌표(포인트) 상자 */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 어느 스트림의 몇 번째 연산자 / TJ 안 문자열 순번(Tj는 0) / 문자열 안 글자 순번 */
  streamKey: string;
  opIndex: number;
  part: number;
  index: number;
  /** 보이지 않는 글자 (Tr 3/7 — 스캔본 위 OCR 글자층 등) */
  invisible: boolean;
}

interface FontInfo {
  twoByte: boolean;
  /** 1/1000 em */
  width: (code: number) => number;
  toUnicode: (code: number) => string | null;
}

export interface StreamEntry {
  key: string;
  stream: PDFStream;
  ref: PDFRef | null;
  src: string;
  ops: Op[];
  resources: PDFDict | undefined;
  /** 다시 쓴 스트림 (글자 제거 또는 대체 텍스트 제거) */
  rewritten?: string;
}

export interface PageText {
  pageIndex: number;
  /** MediaBox */
  box: { x: number; y: number; width: number; height: number };
  glyphs: Glyph[];
  /** 해석할 수 없는 글자 수 (인코딩 미지원 글꼴) */
  undecodable: number;
  /** 그려진 이미지 수 (스캔본 판단용) */
  images: number;
  /** 입력 양식(위젯) 수 — 값이 콘텐츠 밖에 있어 V1은 처리하지 않는다 */
  widgets: number;
  /** 진단용: 이 페이지에서 쓴 글꼴의 형식 (글꼴 이름·글자 내용 없음) */
  fonts: FontNote[];
}

/** 진단용 글꼴 형식 — 해석 가능 여부 판단 근거 */
export interface FontNote {
  subtype: string;
  encoding: string;
  toUnicode: boolean;
  supported: boolean;
}

export function describeFont(doc: PDFDocument, fontObj: unknown): FontNote {
  const font = doc.context.lookup(fontObj as PDFRef);
  if (!(font instanceof PDFDict)) return { subtype: 'missing', encoding: '-', toUnicode: false, supported: false };
  const st = font.lookup(PDFName.of('Subtype'));
  const enc = font.lookup(PDFName.of('Encoding'));
  return {
    subtype: st instanceof PDFName ? st.asString().slice(1) : 'unknown',
    encoding: enc instanceof PDFName ? enc.asString().slice(1) : enc instanceof PDFStream ? 'embedded_cmap' : enc instanceof PDFDict ? 'differences' : 'none',
    toUnicode: font.lookup(PDFName.of('ToUnicode')) instanceof PDFStream,
    supported: loadFont(doc, fontObj) !== null,
  };
}

function num(o: unknown): number {
  return o instanceof PDFNumber ? o.asNumber() : 0;
}

function streamBytes(s: PDFStream): Uint8Array {
  if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
  if (s instanceof PDFContentStream) return s.getUnencodedContents();
  return s.getContents();
}

export const latin1 = (u8: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return s;
};
const bytesOf = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));

function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  const hex = (h: string) => parseInt(h, 16);
  const uni = (h: string) => {
    let s = '';
    for (let k = 0; k + 4 <= h.length; k += 4) s += String.fromCharCode(parseInt(h.slice(k, k + 4), 16));
    return s;
  };
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(hex(m[1]), uni(m[2]));
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = hex(m[1]), hi = hex(m[2]);
      if (hi < lo || hi - lo > 65535) continue;
      if (m[3].startsWith('[')) {
        const items = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => uni(x[1]));
        for (let c = lo; c <= hi; c++) map.set(c, items[c - lo] ?? '');
      } else {
        const base = m[3].slice(1, -1);
        if (base.length < 4) continue;
        const last = parseInt(base.slice(-4), 16);
        const prefix = uni(base.slice(0, -4));
        for (let c = lo; c <= hi; c++) map.set(c, prefix + String.fromCharCode(last + (c - lo)));
      }
    }
  }
  return map;
}

function loadFont(doc: PDFDocument, fontObj: unknown): FontInfo | null {
  const font = doc.context.lookup(fontObj as PDFRef);
  if (!(font instanceof PDFDict)) return null;
  const subtype = font.lookup(PDFName.of('Subtype'));
  let toUni: Map<number, string> | null = null;
  const tu = font.lookup(PDFName.of('ToUnicode'));
  if (tu instanceof PDFStream) toUni = parseToUnicode(latin1(streamBytes(tu)));
  if (subtype === PDFName.of('Type0')) {
    const enc = font.lookup(PDFName.of('Encoding'));
    // Identity-H/V만 지원 (KSC 계열 등 미리 정의된 CMap은 해석하지 않고 실패 처리)
    if (!(enc instanceof PDFName) || !/Identity-[HV]/.test(enc.asString()) || !toUni) return null;
    const desc = font.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
    const dw = desc.lookup(PDFName.of('DW')) ? num(desc.lookup(PDFName.of('DW'))) : 1000;
    const widths = new Map<number, number>();
    const w = desc.lookup(PDFName.of('W'));
    if (w instanceof PDFArray) {
      let k = 0;
      while (k < w.size()) {
        const first = num(w.lookup(k));
        const next = w.lookup(k + 1);
        if (next instanceof PDFArray) {
          for (let j = 0; j < next.size(); j++) widths.set(first + j, num(next.lookup(j)));
          k += 2;
        } else {
          const last = num(next);
          const ww = num(w.lookup(k + 2));
          for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, ww);
          k += 3;
        }
      }
    }
    const map = toUni;
    return { twoByte: true, width: (c) => widths.get(c) ?? dw, toUnicode: (c) => map.get(c) ?? null };
  }
  if (subtype === PDFName.of('Type3')) return null;
  // 단순 글꼴 (Type1/TrueType): ToUnicode가 없으면 ASCII 범위만 (숫자·영문은 표준 인코딩과 같다)
  const firstChar = num(font.lookup(PDFName.of('FirstChar')));
  const ws = font.lookup(PDFName.of('Widths'));
  const widths: number[] = ws instanceof PDFArray ? Array.from({ length: ws.size() }, (_, k) => num(ws.lookup(k))) : [];
  const map = toUni;
  return {
    twoByte: false,
    width: (c) => widths[c - firstChar] ?? 500,
    toUnicode: (c) => map?.get(c) ?? (c >= 32 && c < 127 ? String.fromCharCode(c) : null),
  };
}

function pageContents(doc: PDFDocument, pageIndex: number): string {
  const contents = doc.getPage(pageIndex).node.Contents();
  if (!contents) return '';
  const parts: PDFStream[] =
    contents instanceof PDFArray ? Array.from({ length: contents.size() }, (_, k) => contents.lookup(k, PDFStream)) : [contents as unknown as PDFStream];
  return parts.map((p) => latin1(streamBytes(p))).join('\n');
}

/** 페이지(와 그 안의 Form XObject)의 글자 위치를 모은다 */
export function extractPage(doc: PDFDocument, pageIndex: number, streams: Map<string, StreamEntry>): PageText {
  const page = doc.getPage(pageIndex);
  const mb = page.getMediaBox();
  const glyphs: Glyph[] = [];
  const fontNotes = new Map<string, FontNote>();
  let undecodable = 0;
  let images = 0;
  const annots = page.node.lookup(PDFName.of('Annots'));
  let widgets = 0;
  if (annots instanceof PDFArray) {
    for (let k = 0; k < annots.size(); k++) {
      const a = annots.lookup(k);
      if (a instanceof PDFDict && a.lookup(PDFName.of('Subtype')) === PDFName.of('Widget')) widgets++;
    }
  }

  const walk = (entry: StreamEntry, baseCtm: M, depth: number) => {
    const fontCache = new Map<string, FontInfo | null>();
    let ctm = baseCtm;
    const gstack: M[] = [];
    let tm: M = I, tlm: M = I;
    let font: FontInfo | null = null, fs = 0, tc = 0, tw = 0, th = 1, tl = 0, rise = 0, mode = 0;
    const fontsDict = entry.resources?.lookup(PDFName.of('Font'));
    const xobjs = entry.resources?.lookup(PDFName.of('XObject'));
    const show = (bytes: number[], opIndex: number, part: number) => {
      if (!font) {
        undecodable += bytes.length;
        return;
      }
      const step = font.twoByte ? 2 : 1;
      for (let k = 0, idx = 0; k + step - 1 < bytes.length; k += step, idx++) {
        const c = step === 2 ? (bytes[k] << 8) | bytes[k + 1] : bytes[k];
        const w0 = font.width(c) / 1000;
        // 매핑이 없는 좁은 글리프(0.4em 미만)는 공백으로 본다 — 숫자·한글처럼 넓은 글자는 해석 불가로 센다
        const mapped = font.toUnicode(c);
        const ch = mapped ?? (w0 < 0.4 ? ' ' : null);
        if (ch == null) undecodable++;
        const trm = mul([fs * th, 0, 0, fs, 0, rise], mul(tm, ctm));
        const p0 = apply(trm, 0, -0.22), p1 = apply(trm, w0, 0.9);
        glyphs.push({
          ch: ch ?? '�',
          x0: Math.min(p0.x, p1.x), y0: Math.min(p0.y, p1.y), x1: Math.max(p0.x, p1.x), y1: Math.max(p0.y, p1.y),
          streamKey: entry.key, opIndex, part, index: idx, invisible: mode === 3 || mode === 7,
        });
        tm = mul([1, 0, 0, 1, (w0 * fs + tc + (!font.twoByte && c === 32 ? tw : 0)) * th, 0], tm);
      }
    };
    entry.ops.forEach((o, opIndex) => {
      const a = o.operands;
      const nv = (k: number) => (a[k]?.t === 'num' ? (a[k] as { v: number }).v : 0);
      switch (o.op) {
        case 'q': gstack.push(ctm); break;
        case 'Q': ctm = gstack.pop() ?? baseCtm; break;
        case 'cm': ctm = mul([nv(0), nv(1), nv(2), nv(3), nv(4), nv(5)], ctm); break;
        case 'BT': tm = I; tlm = I; break;
        case 'Tf': {
          const name = a[0]?.t === 'name' ? a[0].v : '';
          fs = nv(1);
          if (!fontCache.has(name)) {
            const ref = fontsDict instanceof PDFDict ? fontsDict.get(PDFName.of(name)) : undefined;
            fontCache.set(name, ref ? loadFont(doc, ref) : null);
            const noteKey = ref instanceof PDFRef ? `${ref.objectNumber}` : `${entry.key}:${name}`;
            if (!fontNotes.has(noteKey)) fontNotes.set(noteKey, ref ? describeFont(doc, ref) : { subtype: 'missing', encoding: '-', toUnicode: false, supported: false });
          }
          font = fontCache.get(name) ?? null;
          break;
        }
        case 'Tc': tc = nv(0); break;
        case 'Tw': tw = nv(0); break;
        case 'Tz': th = nv(0) / 100; break;
        case 'TL': tl = nv(0); break;
        case 'Ts': rise = nv(0); break;
        case 'Tr': mode = nv(0); break;
        case 'Td': tlm = mul([1, 0, 0, 1, nv(0), nv(1)], tlm); tm = tlm; break;
        case 'TD': tl = -nv(1); tlm = mul([1, 0, 0, 1, nv(0), nv(1)], tlm); tm = tlm; break;
        case 'Tm': tlm = [nv(0), nv(1), nv(2), nv(3), nv(4), nv(5)]; tm = tlm; break;
        case 'T*': tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; break;
        case 'Tj': if (a[0]?.t === 'str') show(a[0].bytes, opIndex, 0); break;
        case "'": tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; if (a[0]?.t === 'str') show(a[0].bytes, opIndex, 0); break;
        case '"': tw = nv(0); tc = nv(1); tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; if (a[2]?.t === 'str') show(a[2].bytes, opIndex, 0); break;
        case 'TJ': {
          const arr = a[0]?.t === 'arr' ? a[0].items : [];
          let part = 0;
          for (const it of arr) {
            if (it.t === 'str') show(it.bytes, opIndex, part++);
            else if (it.t === 'num') tm = mul([1, 0, 0, 1, (-it.v / 1000) * fs * th, 0], tm);
          }
          break;
        }
        case 'BI': images++; break;
        case 'Do': {
          const name = a[0]?.t === 'name' ? a[0].v : '';
          const ref = xobjs instanceof PDFDict ? xobjs.get(PDFName.of(name)) : undefined;
          const xo = ref ? doc.context.lookup(ref) : undefined;
          if (!(xo instanceof PDFStream)) break;
          const st = xo.dict.lookup(PDFName.of('Subtype'));
          if (st === PDFName.of('Image')) images++;
          else if (st === PDFName.of('Form') && depth < 8) {
            const key = ref instanceof PDFRef ? `ref:${ref.objectNumber}:${ref.generationNumber}` : `xo:${pageIndex}:${name}`;
            let child = streams.get(key);
            if (!child) {
              const src = latin1(streamBytes(xo));
              const res = xo.dict.lookup(PDFName.of('Resources'));
              child = { key, stream: xo, ref: ref instanceof PDFRef ? ref : null, src, ops: tokenize(src), resources: res instanceof PDFDict ? res : entry.resources };
              streams.set(key, child);
            }
            const mx = xo.dict.lookup(PDFName.of('Matrix'));
            const m: M = mx instanceof PDFArray ? ([0, 1, 2, 3, 4, 5].map((k) => num(mx.lookup(k))) as M) : I;
            walk(child, mul(m, ctm), depth + 1);
          }
          break;
        }
      }
    });
  };

  const src = pageContents(doc, pageIndex);
  const key = `page:${pageIndex}`;
  const entry: StreamEntry = { key, stream: undefined as unknown as PDFStream, ref: null, src, ops: tokenize(src), resources: page.node.Resources() };
  streams.set(key, entry);
  walk(entry, I, 0);
  return { pageIndex, box: { x: mb.x, y: mb.y, width: mb.width, height: mb.height }, glyphs, undecodable, images, widgets, fonts: [...fontNotes.values()] };
}

/** 표시용 대체 텍스트(ActualText/Alt/E)에 원문이 남지 않도록 marked-content 속성에서 제거 */
function stripAltText(src: string): string {
  return src.replace(/\/(ActualText|Alt|E)\s*(\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]*>)/g, '');
}

/** 지울 글자들을 콘텐츠 스트림에서 실제로 제거 (너비만큼 위치 이동으로 대체) */
export function removeGlyphs(doc: PDFDocument, streams: Map<string, StreamEntry>, remove: Glyph[]): void {
  const byStream = new Map<string, Glyph[]>();
  for (const g of remove) byStream.set(g.streamKey, [...(byStream.get(g.streamKey) ?? []), g]);
  for (const [key, gs] of byStream) {
    const entry = streams.get(key);
    if (!entry) continue;
    const byOp = new Map<number, Set<string>>();
    for (const g of gs) byOp.set(g.opIndex, (byOp.get(g.opIndex) ?? new Set()).add(`${g.part}:${g.index}`));
    let out = '';
    let cursor = 0;
    let fontInfo: FontInfo | null = null, fs = 0, tc = 0, tw = 0;
    const fontsDict = entry.resources?.lookup(PDFName.of('Font'));
    const cache = new Map<string, FontInfo | null>();
    entry.ops.forEach((o, opIndex) => {
      const a = o.operands;
      const nv = (k: number) => (a[k]?.t === 'num' ? (a[k] as { v: number }).v : 0);
      if (o.op === 'Tf') {
        const name = a[0]?.t === 'name' ? a[0].v : '';
        fs = nv(1);
        if (!cache.has(name)) {
          const ref = fontsDict instanceof PDFDict ? fontsDict.get(PDFName.of(name)) : undefined;
          cache.set(name, ref ? loadFont(doc, ref) : null);
        }
        fontInfo = cache.get(name) ?? null;
      }
      if (o.op === 'Tc') tc = nv(0);
      if (o.op === 'Tw') tw = nv(0);
      if (o.op === '"') {
        tw = nv(0);
        tc = nv(1);
      }
      const kill = byOp.get(opIndex);
      if (!kill || !fontInfo) return;
      const f: FontInfo = fontInfo;
      const step = f.twoByte ? 2 : 1;
      const rewrite = (bytes: number[], part: number): Operand[] => {
        const res: Operand[] = [];
        let keep: number[] = [];
        let shift = 0;
        const pushKeep = () => {
          if (keep.length) res.push({ t: 'str', bytes: keep, raw: hexString(keep) });
          keep = [];
        };
        const pushShift = () => {
          if (shift) res.push({ t: 'num', v: shift, raw: fmtNum(shift) });
          shift = 0;
        };
        for (let k = 0, idx = 0; k + step - 1 < bytes.length; k += step, idx++) {
          const c = step === 2 ? (bytes[k] << 8) | bytes[k + 1] : bytes[k];
          if (kill.has(`${part}:${idx}`)) {
            pushKeep();
            // 글자 너비 + 자간(+어간) 만큼 이동: TJ 숫자는 1/1000 em, 음수가 오른쪽
            shift -= f.width(c) + (fs ? ((tc + (!f.twoByte && c === 32 ? tw : 0)) * 1000) / fs : 0);
          } else {
            pushShift();
            keep.push(...bytes.slice(k, k + step));
          }
        }
        pushKeep();
        pushShift();
        return res;
      };
      let items: Operand[] = [];
      let prefix = '';
      if (o.op === 'TJ' && a[0]?.t === 'arr') {
        let part = 0;
        for (const it of a[0].items) items.push(...(it.t === 'str' ? rewrite(it.bytes, part++) : [it]));
      } else if ((o.op === 'Tj' || o.op === "'") && a[0]?.t === 'str') {
        if (o.op === "'") prefix = 'T* ';
        items = rewrite(a[0].bytes, 0);
      } else if (o.op === '"' && a[2]?.t === 'str') {
        prefix = `${a[0].raw} Tw ${a[1].raw} Tc T* `;
        items = rewrite(a[2].bytes, 0);
      } else return;
      out += entry.src.slice(cursor, o.start) + `${prefix}[${items.map((x) => x.raw).join(' ')}] TJ`;
      cursor = o.end;
    });
    entry.rewritten = out + entry.src.slice(cursor);
  }
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 보호 표시본 만들기: 다시 쓴 스트림을 반영하고 가림 상자를 그린 뒤, 새 문서로 페이지만 복사한다.
 * - 페이지 주석(입력 양식 포함)·메타데이터·썸네일·구조 정보를 지운다
 * - 모든 콘텐츠 스트림에서 대체 텍스트(ActualText 등)를 지운다
 */
export async function buildProtectedView(doc: PDFDocument, streams: Map<string, StreamEntry>, boxesByPage: Map<number, Box[]>): Promise<Uint8Array> {
  for (const entry of streams.values()) {
    const src = stripAltText(entry.rewritten ?? entry.src);
    if (entry.rewritten === undefined && src === entry.src) continue;
    const bytes = bytesOf(src);
    if (entry.key.startsWith('page:')) {
      const page = doc.getPage(Number(entry.key.slice(5)));
      page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(bytes)));
    } else if (entry.ref) {
      const keepDict: Record<string, unknown> = {};
      for (const [k, v] of entry.stream.dict.entries()) {
        const name = k.asString().slice(1);
        if (!['Length', 'Filter', 'DecodeParms', 'Metadata', 'PieceInfo', 'StructParent', 'StructParents'].includes(name)) keepDict[name] = v;
      }
      doc.context.assign(entry.ref, doc.context.flateStream(bytes, keepDict as never));
    }
  }
  const pageCount = doc.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.getPage(i);
    // 상위 Pages에서 물려받는 속성은 복사 전에 페이지에 직접 둔다
    const res = page.node.Resources();
    if (res) page.node.set(PDFName.of('Resources'), res);
    page.node.set(PDFName.of('MediaBox'), page.node.MediaBox());
    const rot = page.node.Rotate();
    if (rot) page.node.set(PDFName.of('Rotate'), rot);
    for (const k of ['Annots', 'Metadata', 'PieceInfo', 'StructParents', 'Thumb', 'B', 'AA']) page.node.delete(PDFName.of(k));
    const boxes = boxesByPage.get(i) ?? [];
    if (boxes.length === 0) continue;
    // 원래 그래픽 상태와 섞이지 않도록 기존 콘텐츠를 q…Q로 감싸고, 그 뒤에 페이지 기본 좌표로 상자를 그린다
    const open = doc.context.register(doc.context.flateStream(bytesOf('q\n')));
    const draw = 'Q\nq 0.17 0.19 0.23 rg\n' + boxes.map((b) => `${fmtNum(b.x0)} ${fmtNum(b.y0)} ${fmtNum(b.x1 - b.x0)} ${fmtNum(b.y1 - b.y0)} re f`).join('\n') + '\nQ\n';
    const close = doc.context.register(doc.context.flateStream(bytesOf(draw)));
    const cur = page.node.get(PDFName.of('Contents'));
    const arr = doc.context.obj([open]) as PDFArray;
    const curv = cur ? doc.context.lookup(cur) : undefined;
    if (curv instanceof PDFArray) for (let k = 0; k < curv.size(); k++) arr.push(curv.get(k));
    else if (cur) arr.push(cur);
    arr.push(close);
    page.node.set(PDFName.of('Contents'), arr);
  }
  // 새 문서로 페이지만 복사 — 닿지 않는 객체(교체 전 콘텐츠 등)는 따라오지 않는다
  const out = await PDFDocument.create({ updateMetadata: false });
  const copied = await out.copyPages(doc, Array.from({ length: pageCount }, (_, i) => i));
  for (const p of copied) out.addPage(p);
  out.setProducer('PACTO');
  out.setCreator('PACTO');
  out.setTitle('PACTO 보호 표시본');
  return await out.save({ useObjectStreams: true });
}
