// 미리 정의된 한글 CMap(UniKS-UCS2-H, KSCms-UHC-H, KSC-EUC-H …) 해석 — pdf.js의 BinaryCMapReader(Apache-2.0)를 옮긴 것
// 글자 코드(1~4바이트) → CID, CID → 유니코드(Adobe-Korea1-UCS2)를 얻는다. 데이터는 pdfjs-dist의 bcmap을 그대로 쓴다.
import { KOREAN_CMAPS } from '../vendor/korean-cmaps.js';

export interface CMap {
  name: string;
  vertical: boolean;
  /** 바이트 수별 코드 범위 */
  codespace: { n: number; lo: number; hi: number }[];
  /** 코드 → CID (cidchar/cidrange) */
  cid: Map<number, number>;
  /** 코드 → 문자 (bfchar/bfrange, *-UCS2 맵에서 CID → 유니코드) */
  bf: Map<number, string>;
}

const MAX_NUM_SIZE = 16;

class BinaryCMapStream {
  pos = 0;
  data: Uint8Array;
  constructor(data: Uint8Array) {
    this.data = data;
  }
  getByte(): number {
    return this.pos < this.data.length ? this.data[this.pos++] : -1;
  }
  must(): number {
    const b = this.getByte();
    if (b < 0) throw new Error('unexpected EOF in bcmap');
    return b;
  }
  readNumber(): number {
    let n = 0;
    let last: boolean;
    do {
      const b = this.must();
      last = !(b & 0x80);
      n = (n << 7) | (b & 0x7f);
    } while (!last);
    return n;
  }
  readSigned(): number {
    const n = this.readNumber();
    return n & 1 ? ~(n >>> 1) : n >>> 1;
  }
  readHex(num: Uint8Array, size: number) {
    for (let i = 0; i <= size; i++) num[i] = this.must();
  }
  readHexNumber(num: Uint8Array, size: number) {
    const stack: number[] = [];
    let last: boolean;
    do {
      const b = this.must();
      last = !(b & 0x80);
      stack.push(b & 0x7f);
    } while (!last);
    let sp = stack.length;
    let i = size, buffer = 0, bufferSize = 0;
    while (i >= 0) {
      while (bufferSize < 8 && sp > 0) {
        buffer |= stack[--sp] << bufferSize;
        bufferSize += 7;
      }
      num[i] = buffer & 255;
      i--;
      buffer >>= 8;
      bufferSize -= 8;
    }
  }
  readHexSigned(num: Uint8Array, size: number) {
    this.readHexNumber(num, size);
    const sign = num[size] & 1 ? 255 : 0;
    let c = 0;
    for (let i = 0; i <= size; i++) {
      c = ((c & 1) << 8) | num[i];
      num[i] = (c >> 1) ^ sign;
    }
  }
  readString(): string {
    const len = this.readNumber();
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.readNumber());
    return s;
  }
}

const hexToInt = (a: Uint8Array, size: number) => {
  let n = 0;
  for (let i = 0; i <= size; i++) n = (n << 8) | a[i];
  return n >>> 0;
};
const hexToStr = (a: Uint8Array, size: number) => String.fromCharCode(...a.subarray(0, size + 1));
function addHex(a: Uint8Array, b: Uint8Array, size: number) {
  let c = 0;
  for (let i = size; i >= 0; i--) {
    c += a[i] + b[i];
    a[i] = c & 255;
    c >>= 8;
  }
}
function incHex(a: Uint8Array, size: number) {
  let c = 1;
  for (let i = size; i >= 0 && c > 0; i--) {
    c += a[i];
    a[i] = c & 255;
    c >>= 8;
  }
}

/** UTF-16BE 바이트 문자열 → 문자열 */
const utf16 = (bytes: string) => {
  let s = '';
  for (let k = 0; k + 1 < bytes.length; k += 2) s += String.fromCharCode((bytes.charCodeAt(k) << 8) | bytes.charCodeAt(k + 1));
  return s;
};

function parse(name: string, data: Uint8Array): { cmap: CMap; useCMap: string | null } {
  const cmap: CMap = { name, vertical: false, codespace: [], cid: new Map(), bf: new Map() };
  const s = new BinaryCMapStream(data);
  cmap.vertical = !!(s.must() & 1);
  let useCMap: string | null = null;
  const start = new Uint8Array(MAX_NUM_SIZE), end = new Uint8Array(MAX_NUM_SIZE), char = new Uint8Array(MAX_NUM_SIZE);
  const charCode = new Uint8Array(MAX_NUM_SIZE), tmp = new Uint8Array(MAX_NUM_SIZE);
  const mapBfRange = (lo: number, hi: number, dst: string) => {
    const last = dst.length - 1;
    for (let c = lo; c <= hi; c++) {
      cmap.bf.set(c, utf16(dst));
      const next = dst.charCodeAt(last) + 1;
      dst = next > 0xff ? dst.slice(0, last - 1) + String.fromCharCode(dst.charCodeAt(last - 1) + 1) + '\x00' : dst.slice(0, last) + String.fromCharCode(next);
    }
  };
  let b: number;
  while ((b = s.getByte()) >= 0) {
    const type = b >> 5;
    if (type === 7) {
      if ((b & 0x1f) === 0) s.readString();
      else if ((b & 0x1f) === 1) useCMap = s.readString();
      continue;
    }
    const sequence = !!(b & 0x10);
    const size = b & 15;
    if (size + 1 > MAX_NUM_SIZE) throw new Error('invalid bcmap data size');
    const count = s.readNumber();
    let code: number;
    switch (type) {
      case 0: // codespacerange
        s.readHex(start, size);
        s.readHexNumber(end, size);
        addHex(end, start, size);
        cmap.codespace.push({ n: size + 1, lo: hexToInt(start, size), hi: hexToInt(end, size) });
        for (let i = 1; i < count; i++) {
          incHex(end, size);
          s.readHexNumber(start, size);
          addHex(start, end, size);
          s.readHexNumber(end, size);
          addHex(end, start, size);
          cmap.codespace.push({ n: size + 1, lo: hexToInt(start, size), hi: hexToInt(end, size) });
        }
        break;
      case 1: // notdefrange (무시)
        s.readHex(start, size);
        s.readHexNumber(end, size);
        addHex(end, start, size);
        s.readNumber();
        for (let i = 1; i < count; i++) {
          incHex(end, size);
          s.readHexNumber(start, size);
          addHex(start, end, size);
          s.readHexNumber(end, size);
          addHex(end, start, size);
          s.readNumber();
        }
        break;
      case 2: // cidchar
        s.readHex(char, size);
        code = s.readNumber();
        cmap.cid.set(hexToInt(char, size), code);
        for (let i = 1; i < count; i++) {
          incHex(char, size);
          if (!sequence) {
            s.readHexNumber(tmp, size);
            addHex(char, tmp, size);
          }
          code = s.readSigned() + (code + 1);
          cmap.cid.set(hexToInt(char, size), code);
        }
        break;
      case 3: { // cidrange
        const range = (lo: number, hi: number, c0: number) => {
          for (let c = lo; c <= hi && c - lo < 0x10000; c++) cmap.cid.set(c, c0 + (c - lo));
        };
        s.readHex(start, size);
        s.readHexNumber(end, size);
        addHex(end, start, size);
        code = s.readNumber();
        range(hexToInt(start, size), hexToInt(end, size), code);
        for (let i = 1; i < count; i++) {
          incHex(end, size);
          if (!sequence) {
            s.readHexNumber(start, size);
            addHex(start, end, size);
          } else start.set(end);
          s.readHexNumber(end, size);
          addHex(end, start, size);
          code = s.readNumber();
          range(hexToInt(start, size), hexToInt(end, size), code);
        }
        break;
      }
      case 4: // bfchar (키는 2바이트)
        s.readHex(char, 1);
        s.readHex(charCode, size);
        cmap.bf.set(hexToInt(char, 1), utf16(hexToStr(charCode, size)));
        for (let i = 1; i < count; i++) {
          incHex(char, 1);
          if (!sequence) {
            s.readHexNumber(tmp, 1);
            addHex(char, tmp, 1);
          }
          incHex(charCode, size);
          s.readHexSigned(tmp, size);
          addHex(charCode, tmp, size);
          cmap.bf.set(hexToInt(char, 1), utf16(hexToStr(charCode, size)));
        }
        break;
      case 5: // bfrange
        s.readHex(start, 1);
        s.readHexNumber(end, 1);
        addHex(end, start, 1);
        s.readHex(charCode, size);
        mapBfRange(hexToInt(start, 1), hexToInt(end, 1), hexToStr(charCode, size));
        for (let i = 1; i < count; i++) {
          incHex(end, 1);
          if (!sequence) {
            s.readHexNumber(start, 1);
            addHex(start, end, 1);
          } else start.set(end);
          s.readHexNumber(end, 1);
          addHex(end, start, 1);
          s.readHex(charCode, size);
          mapBfRange(hexToInt(start, 1), hexToInt(end, 1), hexToStr(charCode, size));
        }
        break;
      default:
        throw new Error('unknown bcmap record');
    }
  }
  return { cmap, useCMap };
}

const cache = new Map<string, CMap | null>();

export function koreanCMapBytes(name: string): Uint8Array | null {
  const b64 = (KOREAN_CMAPS as Record<string, string>)[name];
  if (!b64) return null;
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** 내장 한글 CMap 불러오기 (usecmap으로 이어진 상위 CMap까지 합친다). 없으면 null */
export function builtInCMap(name: string, depth = 0): CMap | null {
  if (cache.has(name)) return cache.get(name)!;
  const data = koreanCMapBytes(name);
  let result: CMap | null = null;
  if (data && depth < 4) {
    const { cmap, useCMap } = parse(name, data);
    if (useCMap) {
      const parent = builtInCMap(useCMap, depth + 1);
      if (!parent) throw new Error('missing parent cmap');
      if (cmap.codespace.length === 0) cmap.codespace = parent.codespace;
      for (const [k, v] of parent.cid) if (!cmap.cid.has(k)) cmap.cid.set(k, v);
      for (const [k, v] of parent.bf) if (!cmap.bf.has(k)) cmap.bf.set(k, v);
    }
    result = cmap;
  }
  cache.set(name, result);
  return result;
}

/** 코드 공간에 맞춰 문자열 바이트를 글자 코드로 나눈다 (맞는 범위가 없으면 1바이트, code = -1) */
export function splitCodes(codespace: CMap['codespace'], bytes: number[]): { code: number; at: number; len: number }[] {
  const out: { code: number; at: number; len: number }[] = [];
  let k = 0;
  while (k < bytes.length) {
    let c = 0;
    let found: { code: number; at: number; len: number } | null = null;
    for (let n = 1; n <= 4 && k + n - 1 < bytes.length; n++) {
      c = ((c << 8) | bytes[k + n - 1]) >>> 0;
      if (codespace.some((r) => r.n === n && c >= r.lo && c <= r.hi)) {
        found = { code: c, at: k, len: n };
        break;
      }
    }
    if (!found) found = { code: -1, at: k, len: 1 };
    out.push(found);
    k += found.len;
  }
  return out;
}

/** pdf.js 검증용: 내장 한글 CMap 데이터를 파일 대신 제공하는 BinaryDataFactory */
export class KoreanCMapDataFactory {
  constructor(_opts?: unknown) {}
  // deno-lint-ignore require-await
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const data = kind === 'cMapUrl' ? koreanCMapBytes(filename.replace(/\.bcmap$/, '')) : null;
    if (!data) throw new Error('builtin data not available');
    return data;
  }
}

/** pdf.js getDocument 옵션 (CMap은 내장 데이터, 외부 네트워크·파일 접근 없음) */
export const PDFJS_OPTIONS = { BinaryDataFactory: KoreanCMapDataFactory, useWorkerFetch: false, cMapPacked: true } as const;
