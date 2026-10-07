/**
 * 테스트용 한글 계약서 PDF 생성 — Word·한글 내보내기와 같은 구조 (Type0 / Identity-H 글꼴 + ToUnicode)
 * 글꼴: @fontsource/nanum-gothic (OFL) WOFF를 TTF로 풀어 글자마다 글리프가 있는 서브셋 파일을 고른다.
 */
import fontkit from '@pdf-lib/fontkit';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { PDFDocument } from '../../supabase/functions/_shared/vendor/pdf-lib.js';

type PDFFont = Awaited<ReturnType<PDFDocument['embedFont']>>;
type PDFPage = ReturnType<PDFDocument['addPage']>;

const FONT_DIR = path.join(import.meta.dirname, '../../node_modules/@fontsource/nanum-gothic/files');

function woffToTtf(buf: Buffer): Buffer {
  const numTables = buf.readUInt16BE(12);
  const tables: { tag: string; checksum: number; data: Buffer }[] = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const offset = buf.readUInt32BE(o + 4), compLen = buf.readUInt32BE(o + 8), origLen = buf.readUInt32BE(o + 12);
    const raw = buf.subarray(offset, offset + compLen);
    tables.push({ tag: buf.toString('ascii', o, o + 4), checksum: buf.readUInt32BE(o + 16), data: compLen < origLen ? zlib.inflateSync(raw) : Buffer.from(raw) });
  }
  let pow = 1, lg = 0;
  while (pow * 2 <= numTables) {
    pow *= 2;
    lg++;
  }
  const head = Buffer.alloc(12 + numTables * 16);
  head.writeUInt32BE(buf.readUInt32BE(4), 0);
  head.writeUInt16BE(numTables, 4);
  head.writeUInt16BE(pow * 16, 6);
  head.writeUInt16BE(lg, 8);
  head.writeUInt16BE(numTables * 16 - pow * 16, 10);
  let off = head.length;
  const bodies: Buffer[] = [];
  tables.forEach((t, i) => {
    const o = 12 + i * 16;
    head.write(t.tag, o, 'ascii');
    head.writeUInt32BE(t.checksum, o + 4);
    head.writeUInt32BE(off, o + 8);
    head.writeUInt32BE(t.data.length, o + 12);
    const pad = (4 - (t.data.length % 4)) % 4;
    bodies.push(t.data, Buffer.alloc(pad));
    off += t.data.length + pad;
  });
  return Buffer.concat([head, ...bodies]);
}

let fontFiles: { ttf: Buffer; kit: ReturnType<typeof fontkit.create> }[] | null = null;
function fonts() {
  if (!fontFiles) {
    fontFiles = fs
      .readdirSync(FONT_DIR)
      .filter((f) => f.endsWith('-400-normal.woff'))
      .map((f) => {
        const ttf = woffToTtf(fs.readFileSync(path.join(FONT_DIR, f)));
        return { ttf, kit: fontkit.create(ttf) };
      });
  }
  return fontFiles;
}
const hasGlyph = (kit: ReturnType<typeof fontkit.create>, ch: string) => {
  const cp = ch.codePointAt(0)!;
  return kit.hasGlyphForCodePoint(cp) && (kit.glyphForCodePoint(cp).path as unknown as { commands: unknown[] }).commands.length > 0;
};

export class ContractPdf {
  private embedded = new Map<number, PDFFont>();
  readonly doc: PDFDocument;
  private constructor(doc: PDFDocument) {
    this.doc = doc;
  }

  static async create() {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit as never);
    return new ContractPdf(doc);
  }

  async font(sample: string): Promise<PDFFont> {
    const i = fonts().findIndex((f) => [...sample].every((ch) => hasGlyph(f.kit, ch)));
    if (i < 0) throw new Error(`no font for ${sample}`);
    if (!this.embedded.has(i)) this.embedded.set(i, await this.doc.embedFont(fonts()[i].ttf, { subset: false }));
    return this.embedded.get(i)!;
  }

  /** 한 줄 쓰기 — 글리프가 있는 글꼴별로 나눠 그린다 (공백은 띄우기만) */
  async line(page: PDFPage, text: string, x: number, y: number, size = 11) {
    let cx = x;
    for (const ch of text) {
      if (ch === ' ') {
        cx += size * 0.3;
        continue;
      }
      const f = await this.font(ch);
      page.drawText(ch, { x: cx, y, size, font: f });
      cx += f.widthOfTextAtSize(ch, size);
    }
  }

  /** 한 쪽짜리 문서 (줄 목록) */
  async page(lines: string[]) {
    const page = this.doc.addPage([595, 842]);
    let y = 780;
    for (const l of lines) {
      await this.line(page, l, 50, y);
      y -= 24;
    }
    return page;
  }

  /** 스캔본처럼 이미지만 있는 쪽 (+ 선택: 투명 OCR 글자층) */
  async scanPage(ocrText?: string) {
    const png = await this.doc.embedPng(TINY_PNG);
    const page = this.doc.addPage([595, 842]);
    page.drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
    if (ocrText) {
      const f = await this.font('0123456789-');
      const name = page.node.newFontDictionary('Focr', f.ref);
      const hex = f.encodeText(ocrText).toString();
      const ops = `BT 3 Tr /${name.asString().slice(1)} 11 Tf 130 735 Td ${hex} Tj ET`;
      (page.node.Contents() as unknown as { push(r: unknown): void }).push(this.doc.context.register(this.doc.context.flateStream(Buffer.from(ops, 'latin1'))));
    }
    return page;
  }

  save() {
    return this.doc.save();
  }
}

/** 1×1 흰 PNG */
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC', 'base64');

/** 테스트 A: 주민등록번호 + 전화번호가 있는 근로계약서 */
export async function employmentContractPdf() {
  const c = await ContractPdf.create();
  await c.page([
    '근로계약서',
    '사용자: 주식회사 네오링크   근로자: 박민준',
    '주민등록번호: 901225-1234567',
    '연락처: 010-1234-5678   이메일: minjun@example.com',
    '근로계약기간: 2026년 10월 1일부터 2027년 9월 30일까지',
    '월 임금 3,600,000원, 매월 25일 지급',
  ]);
  return c.save();
}

/** 테스트 B·C: 계좌번호 + 카드번호처럼 보이는 계약번호가 있는 렌탈계약서 */
export async function rentalContractPdf() {
  const c = await ContractPdf.create();
  await c.page([
    '공기청정기 렌탈 계약서',
    '계약번호: 1234-5678-9012-3456',
    '월 렌탈료 29,900원, 매월 10일 자동이체',
    '자동이체 계좌: 국민은행 123456-01-234567',
    '사업자등록번호: 123-45-67890',
    '고객센터 대표번호 1588-1234',
  ]);
  return c.save();
}
