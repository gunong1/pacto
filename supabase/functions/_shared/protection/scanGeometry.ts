// 스캔 페이지 좌표 변환 — 외부 의존 없음 (Edge·Node·jest 공용)
// 좌표계
//   이미지 정규 좌표 (s, t): 저장된 이미지의 왼쪽 위 0, 오른쪽 아래 1 (t는 아래로)
//   PDF 이미지 단위 공간 (x, y) = (s, 1 - t) → CTM → 페이지 기본 좌표(포인트, y 위로)
//   화면 좌표: 페이지 /Rotate(시계 방향)를 적용해 사람이 보는 방향 (y 아래로)
//   바로 선 이미지 정규 좌표 (X, Y): 화면에서 보이는 방향으로 돌린 이미지의 왼쪽 위 0 — OCR·가림 상자는 이 좌표
//   페이지 정규 좌표: 회전 전 MediaBox 기준 왼쪽 위 0~1 (텍스트 페이지 영역과 같은 기준, DB bbox_json)
export type Mat = [number, number, number, number, number, number];

export interface NBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageFrame {
  /** MediaBox (포인트) */
  box: { x: number; y: number; width: number; height: number };
  /** /Rotate (0·90·180·270) */
  rotate: number;
}

/** 저장된 이미지 → 바로 선 이미지: 가로세로 바꿈 여부와 좌우·상하 뒤집기 */
export interface Orientation {
  swap: boolean;
  flipX: boolean;
  flipY: boolean;
}

export const IDENTITY_ORIENTATION: Orientation = { swap: false, flipX: false, flipY: false };

export const applyMat = (m: Mat, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

export function normalizeRotate(r: number): 0 | 90 | 180 | 270 {
  const v = (((Math.round(r / 90) * 90) % 360) + 360) % 360;
  return v as 0 | 90 | 180 | 270;
}

/** 페이지 기본 좌표 → 화면 좌표 (포인트, 왼쪽 위 0) */
export function pageToDisplay(f: PageFrame, px: number, py: number): { x: number; y: number } {
  const W = f.box.width, H = f.box.height;
  const ux = px - f.box.x, uy = f.box.y + H - py;
  switch (normalizeRotate(f.rotate)) {
    case 90: return { x: H - uy, y: ux };
    case 180: return { x: W - ux, y: H - uy };
    case 270: return { x: uy, y: W - ux };
    default: return { x: ux, y: uy };
  }
}

/** 이미지가 축에 맞게(0·90·180·270도, 뒤집기 포함) 놓였는지 — 기울어진 이미지는 V1 미지원 */
export function isAxisAligned(m: Mat): boolean {
  const scale = Math.max(Math.abs(m[0]), Math.abs(m[1]), Math.abs(m[2]), Math.abs(m[3]));
  if (!(scale > 0)) return false;
  const eps = scale * 1e-3;
  const straight = Math.abs(m[1]) <= eps && Math.abs(m[2]) <= eps && Math.abs(m[0]) > eps && Math.abs(m[3]) > eps;
  const turned = Math.abs(m[0]) <= eps && Math.abs(m[3]) <= eps && Math.abs(m[1]) > eps && Math.abs(m[2]) > eps;
  return straight || turned;
}

/** 이미지가 덮는 페이지 사각형 (페이지 기본 좌표) */
export function placedRect(m: Mat): { x0: number; y0: number; x1: number; y1: number } {
  const pts = [applyMat(m, 0, 0), applyMat(m, 1, 0), applyMat(m, 0, 1), applyMat(m, 1, 1)];
  return { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) };
}

/** 이미지가 MediaBox 면적에서 덮는 비율 (0~1) */
export function pageCoverage(m: Mat, box: PageFrame['box']): number {
  const r = placedRect(m);
  const w = Math.max(0, Math.min(r.x1, box.x + box.width) - Math.max(r.x0, box.x));
  const h = Math.max(0, Math.min(r.y1, box.y + box.height) - Math.max(r.y0, box.y));
  return (w * h) / (box.width * box.height);
}

/** 저장된 이미지 정규 좌표 → 화면 좌표 */
function imageToDisplay(m: Mat, f: PageFrame, s: number, t: number) {
  const p = applyMat(m, s, 1 - t);
  return pageToDisplay(f, p.x, p.y);
}

/** 화면에서 바로 보이도록 이미지를 어떻게 돌려야 하는지 (CTM + /Rotate) */
export function orientationOf(m: Mat, f: PageFrame): Orientation {
  const d00 = imageToDisplay(m, f, 0, 0);
  const d10 = imageToDisplay(m, f, 1, 0);
  const d01 = imageToDisplay(m, f, 0, 1);
  const es = { x: d10.x - d00.x, y: d10.y - d00.y };
  const et = { x: d01.x - d00.x, y: d01.y - d00.y };
  const swap = Math.abs(es.x) < Math.abs(es.y);
  if (!swap) return { swap, flipX: es.x < 0, flipY: et.y < 0 };
  return { swap, flipX: et.x < 0, flipY: es.y < 0 };
}

/** 바로 선 이미지 크기 (저장된 이미지 크기에서) */
export function uprightSize(o: Orientation, width: number, height: number): { width: number; height: number } {
  return o.swap ? { width: height, height: width } : { width, height };
}

/** 저장된 이미지 정규 좌표 → 바로 선 이미지 정규 좌표 */
export function toUpright(o: Orientation, s: number, t: number): { X: number; Y: number } {
  if (!o.swap) return { X: o.flipX ? 1 - s : s, Y: o.flipY ? 1 - t : t };
  return { X: o.flipX ? 1 - t : t, Y: o.flipY ? 1 - s : s };
}

/** 바로 선 이미지 정규 좌표 → 저장된 이미지 정규 좌표 */
export function fromUpright(o: Orientation, X: number, Y: number): { s: number; t: number } {
  if (!o.swap) return { s: o.flipX ? 1 - X : X, t: o.flipY ? 1 - Y : Y };
  return { s: o.flipY ? 1 - Y : Y, t: o.flipX ? 1 - X : X };
}

/** 바로 선 이미지 정규 좌표 → 페이지 기본 좌표 */
export function uprightToPagePoint(m: Mat, o: Orientation, X: number, Y: number): { x: number; y: number } {
  const { s, t } = fromUpright(o, X, Y);
  return applyMat(m, s, 1 - t);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** OCR 상자(바로 선 이미지 0~1) → 페이지 정규 좌표 상자 (회전 전 MediaBox, 왼쪽 위 0~1) */
export function uprightBoxToPage(m: Mat, o: Orientation, f: PageFrame, b: NBox): NBox {
  const pts = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ].map(([X, Y]) => {
    const p = uprightToPagePoint(m, o, X, Y);
    return { x: (p.x - f.box.x) / f.box.width, y: (f.box.y + f.box.height - p.y) / f.box.height };
  });
  const x0 = clamp01(Math.min(...pts.map((p) => p.x))), x1 = clamp01(Math.max(...pts.map((p) => p.x)));
  const y0 = clamp01(Math.min(...pts.map((p) => p.y))), y1 = clamp01(Math.max(...pts.map((p) => p.y)));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 페이지 정규 좌표 상자 → 바로 선 이미지 정규 좌표 상자 (가림을 바꿀 때 저장된 위치로 다시 그리기) */
export function pageBoxToUpright(m: Mat, o: Orientation, f: PageFrame, b: NBox): NBox {
  const inv = invert(m);
  const pts = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ].map(([nx, ny]) => {
    const px = f.box.x + nx * f.box.width;
    const py = f.box.y + f.box.height - ny * f.box.height;
    const u = applyMat(inv, px, py);
    return toUpright(o, u.x, 1 - u.y);
  });
  const x0 = clamp01(Math.min(...pts.map((p) => p.X))), x1 = clamp01(Math.max(...pts.map((p) => p.X)));
  const y0 = clamp01(Math.min(...pts.map((p) => p.Y))), y1 = clamp01(Math.max(...pts.map((p) => p.Y)));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) throw new Error('singular_matrix');
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(m[4] * a + m[5] * c), -(m[4] * b + m[5] * d)];
}

/**
 * 새 페이지에 바로 선 보호 이미지를 그릴 CTM — 원본 이미지가 있던 자리·방향 그대로 보이도록.
 * 바로 선 이미지의 단위 공간 (x', y') = (X, 1 - Y)
 */
export function uprightPlacement(m: Mat, o: Orientation): Mat {
  const p0 = uprightToPagePoint(m, o, 0, 1); // 단위 (0,0)
  const p1 = uprightToPagePoint(m, o, 1, 1); // 단위 (1,0)
  const p2 = uprightToPagePoint(m, o, 0, 0); // 단위 (0,1)
  return [p1.x - p0.x, p1.y - p0.y, p2.x - p0.x, p2.y - p0.y, p0.x, p0.y];
}
