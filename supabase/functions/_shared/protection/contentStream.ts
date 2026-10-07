// PDF 콘텐츠 스트림 토크나이저 — 바이트를 보존하도록 latin1 문자열로 다룬다 (Deno·Node 공용, 외부 의존성 없음)
export type Operand =
  | { t: 'num'; v: number; raw: string }
  | { t: 'name'; v: string; raw: string }
  | { t: 'str'; bytes: number[]; raw: string }
  | { t: 'arr'; items: Operand[]; raw: string }
  | { t: 'dict'; raw: string; entries: Map<string, Operand> }
  | { t: 'kw'; v: string; raw: string };

export interface Op {
  op: string;
  operands: Operand[];
  start: number;
  end: number;
}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set('()<>[]{}/%'.split('').map((c) => c.charCodeAt(0)));

export function tokenize(src: string): Op[] {
  const ops: Op[] = [];
  let i = 0;
  let stack: Operand[] = [];
  let opStart = -1;
  const n = src.length;
  const code = (k: number) => src.charCodeAt(k);
  const skipWs = () => {
    while (i < n) {
      const c = code(i);
      if (WS.has(c)) i++;
      else if (c === 0x25) {
        while (i < n && code(i) !== 0x0a && code(i) !== 0x0d) i++;
      } else break;
    }
  };
  const readOperand = (): Operand | null => {
    const s = i;
    const c = src[i];
    if (c === '(') {
      const bytes: number[] = [];
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const ch = src[i];
        if (ch === '\\') {
          const nx = src[i + 1];
          const map: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
          if (nx in map) {
            bytes.push(map[nx]);
            i += 2;
          } else if (/[0-7]/.test(nx)) {
            let o = '';
            let k = i + 1;
            while (k < i + 4 && /[0-7]/.test(src[k])) o += src[k++];
            bytes.push(parseInt(o, 8) & 0xff);
            i = k;
          } else if (nx === '\r' || nx === '\n') {
            i += 2;
            if (nx === '\r' && src[i] === '\n') i++;
          } else {
            bytes.push(nx.charCodeAt(0));
            i += 2;
          }
          continue;
        }
        if (ch === '(') depth++;
        if (ch === ')') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        bytes.push(src.charCodeAt(i));
        i++;
      }
      return { t: 'str', bytes, raw: src.slice(s, i) };
    }
    if (c === '<' && src[i + 1] === '<') {
      i += 2;
      const entries = new Map<string, Operand>();
      for (;;) {
        skipWs();
        if (src[i] === '>' && src[i + 1] === '>') {
          i += 2;
          break;
        }
        if (i >= n) break;
        const key = readOperand();
        skipWs();
        const val = readOperand();
        if (key?.t === 'name' && val) entries.set(key.v, val);
      }
      return { t: 'dict', raw: src.slice(s, i), entries };
    }
    if (c === '<') {
      i++;
      let hex = '';
      while (i < n && src[i] !== '>') {
        if (/[0-9a-fA-F]/.test(src[i])) hex += src[i];
        i++;
      }
      i++;
      if (hex.length % 2) hex += '0';
      const bytes: number[] = [];
      for (let k = 0; k < hex.length; k += 2) bytes.push(parseInt(hex.slice(k, k + 2), 16));
      return { t: 'str', bytes, raw: src.slice(s, i) };
    }
    if (c === '[') {
      i++;
      const items: Operand[] = [];
      for (;;) {
        skipWs();
        if (src[i] === ']') {
          i++;
          break;
        }
        if (i >= n) break;
        const v = readOperand();
        if (v) items.push(v);
      }
      return { t: 'arr', items, raw: src.slice(s, i) };
    }
    if (c === '/') {
      i++;
      while (i < n && !WS.has(code(i)) && !DELIM.has(code(i))) i++;
      const v = src.slice(s + 1, i).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      return { t: 'name', v, raw: src.slice(s, i) };
    }
    // 숫자 또는 키워드
    while (i < n && !WS.has(code(i)) && !DELIM.has(code(i))) i++;
    if (i === s) {
      i++; // 알 수 없는 구분자 건너뜀 (예: 짝 없는 '>' ')' '{' '}')
      return null;
    }
    const word = src.slice(s, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: 'num', v: parseFloat(word), raw: word };
    return { t: 'kw', v: word, raw: word };
  };

  for (;;) {
    skipWs();
    if (i >= n) break;
    if (opStart < 0) opStart = i;
    const tok = readOperand();
    if (!tok) continue;
    if (tok.t === 'kw' && tok.v !== 'true' && tok.v !== 'false' && tok.v !== 'null') {
      if (tok.v === 'BI') {
        // 인라인 이미지: ID 다음 이진 데이터는 공백 + EI + 공백까지
        const id = src.indexOf('ID', i);
        let k = id + 3;
        for (; k < n - 2; k++) {
          if (WS.has(code(k - 1)) && src[k] === 'E' && src[k + 1] === 'I' && (k + 2 >= n || WS.has(code(k + 2)))) break;
        }
        i = k + 2;
        ops.push({ op: 'BI', operands: [], start: opStart, end: i });
      } else {
        ops.push({ op: tok.v, operands: stack, start: opStart, end: i });
      }
      stack = [];
      opStart = -1;
    } else {
      stack.push(tok);
    }
  }
  return ops;
}

export function hexString(bytes: number[]): string {
  return '<' + bytes.map((b) => b.toString(16).padStart(2, '0')).join('') + '>';
}

export function fmtNum(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
