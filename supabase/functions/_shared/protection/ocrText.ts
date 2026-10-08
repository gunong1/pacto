// OCR 결과 → 민감정보 탐지용 문자열 + 문자 ↔ OCR 조각(좌표) 대응표 (공급자 무관)
// 사진 계약서 보호(향후 스캔 PDF 포함)에서 재사용한다: 정규화한 문자열로 찾아도 "어느 글자를 가려야 하는지"를 잃지 않도록.
// 좌표는 이미지 크기 대비 0~1, 왼쪽 위 기준. 원문 값은 메모리에서만 다루고 저장·로그에 쓰지 않는다.
import { detectSensitive, type Detection } from './sensitive.ts';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** OCR 한 조각 (공급자마다 단위가 다르다: CLOVA General = 필드(단어~구), Google = 단어, 선택적으로 글자) */
export interface OcrToken {
  text: string;
  box: Box;
  confidence: number | null;
  /** 이 조각 뒤에 줄이 바뀜 */
  lineBreak: boolean;
  /** 글자 단위 좌표 (있을 때만 — 부분 가리기는 이것이 있을 때만 고려) */
  chars?: { text: string; box: Box }[];
}

export interface OcrPage {
  width: number;
  height: number;
  tokens: OcrToken[];
}

export interface MappedText {
  text: string;
  /** text의 각 문자가 속한 토큰 번호 (조각 사이에 넣은 공백·줄바꿈은 -1) */
  owner: number[];
}

/**
 * 숫자 조각이 붙어 있는지 — OCR이 "1234-5678-9012-3456"을 "1234-" "5678-" …처럼 나눠 돌려줘도 한 값으로 읽기 위해.
 * 같은 줄(세로 위치가 겹침) + 바로 옆(가로 간격이 글자 높이보다 좁음) + 경계가 숫자·하이픈일 때만 공백 없이 잇는다.
 */
export function joinsNumber(a: OcrToken, b: OcrToken): boolean {
  if (a.lineBreak) return false;
  if (!/[\d-]$/.test(a.text) || !/^[\d-]/.test(b.text)) return false;
  // 숫자끼리 바로 붙는 경우는 하이픈이 한쪽에 있을 때만 (금액·날짜 숫자 둘을 하나로 만들지 않도록)
  if (!/-$/.test(a.text) && !/^-/.test(b.text)) return false;
  const h = Math.max(a.box.h, b.box.h);
  const overlap = Math.min(a.box.y + a.box.h, b.box.y + b.box.h) - Math.max(a.box.y, b.box.y);
  const gap = b.box.x - (a.box.x + a.box.w);
  return overlap > h * 0.5 && gap > -h && gap < h * 0.8;
}

/** 조각을 읽는 순서대로 이어 붙인다 — 조각 사이 공백, 줄이 바뀌면 줄바꿈, 붙어 있는 숫자 조각은 그대로 잇는다 */
export function buildText(tokens: readonly OcrToken[]): MappedText {
  let text = '';
  const owner: number[] = [];
  tokens.forEach((t, i) => {
    for (const ch of t.text) {
      text += ch;
      owner.push(i);
    }
    const next = tokens[i + 1];
    if (next && joinsNumber(t, next)) return;
    const sep = t.lineBreak ? '\n' : ' ';
    text += sep;
    owner.push(-1);
  });
  return { text, owner };
}

export function unionBox(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 가릴 영역 여유 — 글자 높이 비율만큼 (이미지 크기에 비례), 이미지 밖으로 나가지 않게 */
export function padBox(b: Box, ratio = 0.15): Box {
  const p = b.h * ratio;
  const x = Math.max(0, b.x - p);
  const y = Math.max(0, b.y - p);
  return { x, y, w: Math.min(1, b.x + b.w + p) - x, h: Math.min(1, b.y + b.h + p) - y };
}

export interface OcrDetection {
  detection: Detection;
  /** 이 값을 담은 토큰들 (값 전체를 가리면 이 토큰 영역을 모두 덮는다 — 단위가 크면 주변 글자도 함께 가려진다) */
  tokens: number[];
  /** 토큰 단위로 가릴 영역 (줄마다 하나) */
  boxes: Box[];
  /** 값의 모든 글자가 토큰에 대응됨 (false면 위치를 잃은 글자가 있다 → 보호 실패로 본다) */
  complete: boolean;
  /** 덮는 토큰 글자 수 / 값 글자 수 — 1에 가까울수록 주변을 덜 가린다 */
  overcover: number;
}

/** 민감정보 찾기 + 위치 연결 */
export function detectOnTokens(tokens: readonly OcrToken[]): OcrDetection[] {
  const { text, owner } = buildText(tokens);
  return detectSensitive(text).map((d) => {
    const idx = new Set<number>();
    let complete = true;
    for (let i = d.start; i < d.end; i++) {
      const o = owner[i];
      if (o >= 0) idx.add(o);
      else if (!/\s/.test(text[i])) complete = false;
    }
    const list = [...idx].sort((a, b) => a - b);
    // 같은 줄(비슷한 y)끼리 묶어 줄마다 상자 하나
    const lines: Box[][] = [];
    for (const i of list) {
      const b = tokens[i].box;
      const line = lines.find((l) => Math.abs(l[0].y - b.y) < Math.max(l[0].h, b.h) * 0.5);
      if (line) line.push(b);
      else lines.push([b]);
    }
    const covered = list.reduce((n, i) => n + [...tokens[i].text].length, 0);
    const valueLen = [...text.slice(d.start, d.end)].filter((c) => !/\s/.test(c)).length;
    return { detection: d, tokens: list, boxes: lines.map((l) => unionBox(l)!), complete: complete && list.length > 0, overcover: valueLen ? covered / valueLen : 0 };
  });
}

/** 읽기 품질 — 민감정보가 "없다"와 "읽지 못했다"를 구분하기 위한 최소 지표 */
export function readQuality(tokens: readonly OcrToken[]): { chars: number; meanConfidence: number | null; lowConfidenceRatio: number | null } {
  const chars = tokens.reduce((n, t) => n + [...t.text].length, 0);
  const cs = tokens.map((t) => t.confidence).filter((c): c is number => c != null);
  return {
    chars,
    meanConfidence: cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : null,
    lowConfidenceRatio: cs.length ? cs.filter((c) => c < 0.8).length / cs.length : null,
  };
}

// ===== 공급자 응답 → OcrPage =====

type Vertex = { x?: number; y?: number };
const toBox = (vs: Vertex[] | undefined, w: number, h: number): Box => {
  const xs = (vs ?? []).map((v) => v.x ?? 0);
  const ys = (vs ?? []).map((v) => v.y ?? 0);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
  return { x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h };
};

/** CLOVA OCR General V2: images[0].fields[] { inferText, inferConfidence, boundingPoly.vertices, lineBreak } */
export function fromClova(res: unknown, width: number, height: number): OcrPage {
  const img = (res as { images?: { fields?: unknown[] }[] })?.images?.[0];
  const fields = (img?.fields ?? []) as { inferText?: string; inferConfidence?: number; boundingPoly?: { vertices?: Vertex[] }; lineBreak?: boolean }[];
  return {
    width,
    height,
    tokens: fields
      .filter((f) => typeof f.inferText === 'string' && f.inferText.length)
      .map((f) => ({ text: f.inferText!, box: toBox(f.boundingPoly?.vertices, width, height), confidence: typeof f.inferConfidence === 'number' ? f.inferConfidence : null, lineBreak: f.lineBreak === true })),
  };
}

/** Google Vision DOCUMENT_TEXT_DETECTION: fullTextAnnotation.pages[].blocks[].paragraphs[].words[].symbols[] */
export function fromGoogleVision(res: unknown, width: number, height: number): OcrPage {
  type Sym = { text?: string; confidence?: number; boundingBox?: { vertices?: Vertex[] }; property?: { detectedBreak?: { type?: string } } };
  type Word = { symbols?: Sym[]; confidence?: number; boundingBox?: { vertices?: Vertex[] } };
  const page = (res as { responses?: { fullTextAnnotation?: { pages?: { width?: number; height?: number; blocks?: { paragraphs?: { words?: Word[] }[] }[] }[] } }[] })?.responses?.[0]?.fullTextAnnotation?.pages?.[0];
  const w = page?.width || width;
  const h = page?.height || height;
  const tokens: OcrToken[] = [];
  for (const b of page?.blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const word of p.words ?? []) {
        const syms = word.symbols ?? [];
        const last = syms[syms.length - 1]?.property?.detectedBreak?.type;
        tokens.push({
          text: syms.map((s) => s.text ?? '').join(''),
          box: toBox(word.boundingBox?.vertices, w, h),
          confidence: typeof word.confidence === 'number' ? word.confidence : null,
          lineBreak: last === 'LINE_BREAK' || last === 'EOL_SURE_SPACE',
          chars: syms.map((s) => ({ text: s.text ?? '', box: toBox(s.boundingBox?.vertices, w, h) })),
        });
      }
    }
  }
  return { width: w, height: h, tokens };
}
