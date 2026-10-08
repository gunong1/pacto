/* OCR 조각 → 민감정보 위치 (공급자 무관). 정규화한 문자열로 찾아도 가릴 조각·좌표를 잃지 않는다 */
import { buildText, detectOnTokens, fromClova, fromGoogleVision, padBox, readQuality, type OcrToken } from '../../../supabase/functions/_shared/protection/ocrText.ts';

const box = (x: number, y: number, w = 0.1, h = 0.02) => ({ x, y, w, h });
const tok = (text: string, x: number, y: number, lineBreak = false, w = 0.1): OcrToken => ({ text, box: box(x, y, w), confidence: 0.95, lineBreak });

test('조각 하나에 값 전체 (CLOVA 필드형) → 그 조각만, 위치 완전', () => {
  const ds = detectOnTokens([tok('주민등록번호', 0.1, 0.2), tok('800101-1234567', 0.4, 0.2, true, 0.2)]);
  expect(ds).toHaveLength(1);
  expect(ds[0]).toMatchObject({ tokens: [1], complete: true, overcover: 1 });
  expect(ds[0].detection.maskedPreview).toBe('800101-1******');
});

test('하이픈에서 조각이 나뉨 (단어형) → 세 조각을 모두 덮는 한 줄 상자', () => {
  const ds = detectOnTokens([tok('주민등록번호', 0.1, 0.2), tok('800101', 0.4, 0.2, false, 0.08), tok('-', 0.49, 0.2, false, 0.01), tok('1234567', 0.51, 0.2, true, 0.09)]);
  expect(ds).toHaveLength(1);
  expect(ds[0].tokens).toEqual([1, 2, 3]);
  expect(ds[0].boxes).toHaveLength(1);
  expect(ds[0].boxes[0].x).toBeCloseTo(0.4);
  expect(ds[0].boxes[0].x + ds[0].boxes[0].w).toBeCloseTo(0.6);
});

test('필드명과 값이 한 조각 → 조각 전체를 가림 (주변 글자도 가려짐: overcover > 1)', () => {
  const ds = detectOnTokens([tok('연락처010-1234-5678', 0.1, 0.3, true, 0.3)]);
  expect(ds[0].overcover).toBeGreaterThan(1);
  expect(ds[0].complete).toBe(true);
});

test('계약번호처럼 오탐 방지 규칙은 그대로 (사업자·중개 등록번호는 민감정보 아님)', () => {
  expect(detectOnTokens([tok('등록번호', 0.1, 0.1), tok('제', 0.2, 0.1), tok('30170-2020-000123', 0.25, 0.1), tok('호', 0.4, 0.1, true)])).toEqual([]);
});

test('여유(padding)는 글자 높이 비례, 이미지 밖으로 나가지 않음', () => {
  expect(padBox({ x: 0, y: 0.5, w: 0.2, h: 0.02 })).toEqual({ x: 0, y: 0.497, w: expect.closeTo(0.203), h: expect.closeTo(0.026) });
});

test('공급자 응답 변환: CLOVA(픽셀 꼭짓점) / Google(단어 + 글자 좌표)', () => {
  const clova = fromClova({ images: [{ fields: [{ inferText: '010-1234-5678', inferConfidence: 0.99, lineBreak: true, boundingPoly: { vertices: [{ x: 100, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 230 }, { x: 100, y: 230 }] } }] }] }, 1000, 1000);
  expect(clova.tokens[0]).toMatchObject({ text: '010-1234-5678', confidence: 0.99, lineBreak: true, box: { x: 0.1, y: 0.2, w: 0.2 } });
  const g = fromGoogleVision({ responses: [{ fullTextAnnotation: { pages: [{ width: 1000, height: 1000, blocks: [{ paragraphs: [{ words: [{ confidence: 0.9, boundingBox: { vertices: [{ x: 10, y: 10 }, { x: 50, y: 30 }] }, symbols: [{ text: '0', boundingBox: { vertices: [{ x: 10, y: 10 }, { x: 20, y: 30 }] } }, { text: '1', property: { detectedBreak: { type: 'LINE_BREAK' } }, boundingBox: { vertices: [{ x: 20, y: 10 }, { x: 30, y: 30 }] } }] }] }] }] }] } }] }, 0, 0);
  expect(g.tokens[0]).toMatchObject({ text: '01', lineBreak: true, confidence: 0.9 });
  expect(g.tokens[0].chars).toHaveLength(2);
  expect(buildText(g.tokens).text).toBe('01\n');
});

test('읽기 품질 지표 (민감정보 없음 vs 읽지 못함 구분용)', () => {
  expect(readQuality([])).toEqual({ chars: 0, meanConfidence: null, lowConfidenceRatio: null });
  expect(readQuality([{ ...tok('가나', 0, 0), confidence: 0.5 }, tok('다', 0, 0)])).toEqual({ chars: 3, meanConfidence: 0.725, lowConfidenceRatio: 0.5 });
});
