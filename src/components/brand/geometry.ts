/**
 * PACTO 브랜드 로고 벡터 데이터.
 * 전달받은 브랜드 시안(심볼 + 워드마크)을 측정해 벡터로 옮긴 것이다.
 * 원본 벡터 파일(SVG/AI)을 받으면 이 값을 원본 path로 교체한다.
 *
 * 이 파일은 의존성이 없어 앱과 에셋 생성 스크립트(scripts/generate-brand-assets.ts)에서 함께 쓴다.
 */

export const BRAND_COLORS = {
  navy: '#142C4C',
  navyDeep: '#102848',
  sky: '#7894BC',
  ink: '#252525',
  white: '#FFFFFF',
} as const;

type Pt = readonly [number, number];

/** 모서리를 둥글린 다각형 path */
function roundedPolygon(points: readonly Pt[], r: number): string {
  const n = points.length;
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = '';
  for (let i = 0; i < n; i++) {
    const [px, py] = points[(i - 1 + n) % n];
    const [cx, cy] = points[i];
    const [nx, ny] = points[(i + 1) % n];
    const l1 = Math.hypot(px - cx, py - cy);
    const l2 = Math.hypot(nx - cx, ny - cy);
    const a: Pt = [cx + ((px - cx) / l1) * r, cy + ((py - cy) / l1) * r];
    const b: Pt = [cx + ((nx - cx) / l2) * r, cy + ((ny - cy) / l2) * r];
    d += `${i === 0 ? 'M' : 'L'}${f(a[0])} ${f(a[1])}Q${f(cx)} ${f(cy)} ${f(b[0])} ${f(b[1])}`;
  }
  return `${d}Z`;
}

/** 기울어진 카드 한 장 (세로변 수직, 위/아래 변 기울기 0.4) */
function card(dx: number, dy: number): Pt[] {
  return [
    [0 + dx, 66 + dy],
    [166 + dx, 132.4 + dy],
    [166 + dx, 296 + dy],
    [0 + dx, 229.2 + dy],
  ];
}

const CARD_RADIUS = 20;

/** 심볼: 겹친 카드 3장 (뒤 → 앞). 앞 카드일수록 배경색 간격(gap)이 넓다. */
export const SYMBOL = {
  viewBox: '-4 -4 256 304',
  width: 256,
  height: 304,
  back: roundedPolygon(card(82, -64), CARD_RADIUS),
  middle: roundedPolygon(card(46.5, -37.4), CARD_RADIUS),
  front: roundedPolygon(card(0, 0), CARD_RADIUS),
  /** 카드 사이 간격 (배경색 외곽선 두께 = gap * 2) */
  middleGap: 7,
  frontGap: 20,
} as const;

/** 워드마크 "PACTO" — 기하학적 산세리프, A는 가로획 없는 Λ 형태. 캡 높이 132 기준. */
export const WORDMARK = {
  viewBox: '0 -2 737 137',
  width: 737,
  height: 137,
  stroke: 23,
  /** P: 세로획 + 반원 볼 (stroke) */
  p: 'M12 133V11.5H83.5A33 33.75 0 0 1 83.5 79H0',
  /** Λ (fill) */
  a: 'M131 133L203.5 0H213.5L286 133H259L208.5 36.5L158 133Z',
  /** C: 오른쪽이 열린 타원 호 (stroke) */
  c: 'M420.3 33.1A60.5 55.5 0 1 0 420.3 99.9',
  /** T (fill) */
  t: 'M454 0H574V22H525V133H503V22H454Z',
  /** O (stroke) */
  o: { cx: 664, cy: 66.5, rx: 60.5, ry: 55.5 },
} as const;

export interface SymbolColors {
  front: string;
  middle: string;
  back: string;
  /** 카드 사이 간격 색 = 배경색 */
  gap: string;
}

export const SYMBOL_COLORS = {
  /** 흰 배경용 (기본) */
  color: { front: BRAND_COLORS.navy, middle: BRAND_COLORS.navy, back: BRAND_COLORS.sky, gap: BRAND_COLORS.white },
  /** 네이비 배경용 (앱 아이콘) */
  inverse: { front: BRAND_COLORS.white, middle: BRAND_COLORS.white, back: BRAND_COLORS.sky, gap: BRAND_COLORS.navyDeep },
  /** 단색 */
  mono: { front: BRAND_COLORS.ink, middle: BRAND_COLORS.ink, back: BRAND_COLORS.ink, gap: BRAND_COLORS.white },
} as const satisfies Record<string, SymbolColors>;

/**
 * 심볼 SVG 요소 문자열 (에셋 생성 스크립트용, 앱은 Logo.tsx 사용).
 * gap이 'transparent'면 mask로 카드 사이 간격을 실제로 비운다 (Android monochrome 등).
 */
export function symbolSvgElements(c: SymbolColors): string {
  if (c.gap === 'transparent') {
    const cut = (d: string, gap: number) => `<path d="${d}" fill="black" stroke="black" stroke-width="${gap * 2}" stroke-linejoin="round"/>`;
    return [
      `<defs>`,
      `<mask id="mb" maskUnits="userSpaceOnUse" x="-50" y="-100" width="400" height="450"><rect x="-50" y="-100" width="400" height="450" fill="white"/>${cut(SYMBOL.middle, SYMBOL.middleGap)}${cut(SYMBOL.front, SYMBOL.frontGap)}</mask>`,
      `<mask id="mm" maskUnits="userSpaceOnUse" x="-50" y="-100" width="400" height="450"><rect x="-50" y="-100" width="400" height="450" fill="white"/>${cut(SYMBOL.front, SYMBOL.frontGap)}</mask>`,
      `</defs>`,
      `<path d="${SYMBOL.back}" fill="${c.back}" mask="url(#mb)"/>`,
      `<path d="${SYMBOL.middle}" fill="${c.middle}" mask="url(#mm)"/>`,
      `<path d="${SYMBOL.front}" fill="${c.front}"/>`,
    ].join('');
  }
  return [
    `<path d="${SYMBOL.back}" fill="${c.back}"/>`,
    `<path d="${SYMBOL.middle}" fill="${c.middle}" stroke="${c.gap}" stroke-width="${SYMBOL.middleGap * 2}" stroke-linejoin="round" paint-order="stroke"/>`,
    `<path d="${SYMBOL.middle}" fill="${c.middle}"/>`,
    `<path d="${SYMBOL.front}" fill="${c.gap}" stroke="${c.gap}" stroke-width="${SYMBOL.frontGap * 2}" stroke-linejoin="round"/>`,
    `<path d="${SYMBOL.front}" fill="${c.front}"/>`,
  ].join('');
}

export function wordmarkSvgElements(color: string): string {
  const s = `stroke="${color}" stroke-width="${WORDMARK.stroke}" fill="none"`;
  return [
    `<path d="${WORDMARK.p}" ${s} stroke-linejoin="miter"/>`,
    `<path d="${WORDMARK.a}" fill="${color}"/>`,
    `<path d="${WORDMARK.c}" ${s}/>`,
    `<path d="${WORDMARK.t}" fill="${color}"/>`,
    `<ellipse cx="${WORDMARK.o.cx}" cy="${WORDMARK.o.cy}" rx="${WORDMARK.o.rx}" ry="${WORDMARK.o.ry}" ${s}/>`,
  ].join('');
}
