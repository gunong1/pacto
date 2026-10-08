/**
 * 사진 계약서 민감정보 보호 (CLOVA OCR 형식) — 모든 값은 가짜. fixture: scripts/fixtures/make-photo-fixtures.py
 * 가짜 OCR은 받은 이미지를 실제로 해석해, fixture 글자 상자가 검게 덮였으면 그 글자를 "읽지 못한" 것으로 돌려준다 (재-OCR 검증 재현).
 * A 주민 · B 전화 · C 계좌 · D 카드 · E 오탐 없음 · F 필드명 오타 · G 조각 합치기 · H 민감정보 없음 · I 흐림 · K 재-OCR · L 원본 불변 · N OCR 오류
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { checkCoverage, decodeImage, downscale, PROTECTED_VIEW_WIDTH, readImageInfo, toPixelRect } from '../../../supabase/functions/_shared/protection/imageRedact.ts';
import { ClovaOcr, OcrError, type OcrImage, type OcrProvider } from '../../../supabase/functions/_shared/protection/ocrProvider.ts';
import { fromClova, type OcrPage } from '../../../supabase/functions/_shared/protection/ocrText.ts';
import { protectImage, redrawImage } from '../../../supabase/functions/_shared/protection/protectImage.ts';
import { detectSensitive } from '../../../supabase/functions/_shared/protection/sensitive.ts';

const FIX = path.join(__dirname, '../../__fixtures__/photo');
const read = (f: string) => new Uint8Array(fs.readFileSync(path.join(FIX, f)));
const json = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
const sha = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');

/** fixture 응답을 받은 이미지 크기에 맞춰 돌려주되, 상자 안이 검게 덮였으면 그 글자는 빼는 가짜 OCR */
class PixelReadingOcr implements OcrProvider {
  readonly name = 'fake';
  calls = 0;
  constructor(
    private readonly response: unknown,
    private readonly base: { width: number; height: number },
    private readonly opts: { ignoreCover?: boolean } = {},
  ) {}
  async recognize(image: OcrImage): Promise<OcrPage> {
    this.calls++;
    const sx = image.width / this.base.width;
    const sy = image.height / this.base.height;
    const img = await decodeImage(image.bytes, image.format);
    const res = JSON.parse(JSON.stringify(this.response));
    res.images[0].fields = res.images[0].fields.filter((f: { boundingPoly: { vertices: { x: number; y: number }[] } }) => {
      for (const v of f.boundingPoly.vertices) {
        v.x = Math.round(v.x * sx);
        v.y = Math.round(v.y * sy);
      }
      if (this.opts.ignoreCover) return true;
      const [a, , c] = f.boundingPoly.vertices;
      let dark = 0, n = 0;
      for (let y = a.y; y < c.y; y += 2) for (let x = a.x; x < c.x; x += 2) {
        const i = (y * img.width + x) * 4;
        n++;
        if (img.data[i] < 40 && img.data[i + 1] < 40 && img.data[i + 2] < 40) dark++;
      }
      return n === 0 || dark / n < 0.6; // 대부분 검게 덮였으면 읽지 못함
    });
    return fromClova(res, image.width, image.height);
  }
}

const LEASE = read('lease.jpg');
const LEASE_OCR = () => new PixelReadingOcr(json('lease.clova.json'), { width: 2400, height: 1700 });

describe('주택 월세 임대차계약서 사진 (fixture)', () => {
  let result: Awaited<ReturnType<typeof protectImage>>;
  let ocr: PixelReadingOcr;
  const before = sha(LEASE);
  beforeAll(async () => {
    ocr = LEASE_OCR();
    result = await protectImage(LEASE, { ocr });
  });

  test('A~D: 주민번호 2 · 전화 2 · 계좌 3 · 카드 1 탐지 → 모두 가림 → protected (OCR 2회: 1차 + 검증)', () => {
    expect(result.status).toBe('protected');
    const count = (t: string) => result.regions.filter((r) => r.type === t).length;
    expect([count('resident_registration_number'), count('phone'), count('bank_account'), count('credit_card')]).toEqual([2, 2, 3, 1]);
    expect(result.regions.every((r) => r.state === 'masked')).toBe(true);
    expect(result.diagnostics).toMatchObject({ ocrCalls: 2, verification: 'passed', detectedSensitiveCount: 8, redactedRegionCount: 8 });
    expect(ocr.calls).toBe(2);
    // 가린 표시값만 (원문 전체 값 없음)
    expect(result.regions.map((r) => r.maskedPreview).sort()).toEqual(
      ['010-****-5678', '010-****-5432', '800101-1******', '950505-2******', '***-***-**9012', '***-***-**1098', '****-***-**8901', '1234-****-****-3456'].sort(),
    );
    const all = JSON.stringify(result.regions);
    for (const raw of ['800101-1234567', '950505-2345678', '010-1234-5678', '123-456-789012', '1234-5678-9012-3456']) expect(all).not.toContain(raw);
  });

  test('E: 계약번호 · 사업자등록번호 · 중개사 등록번호 · 금액 · 날짜 · 주소 · 면적은 가리지 않음', () => {
    const previews = result.regions.map((r) => r.maskedPreview).join(' ');
    for (const s of ['2026-', '123-45', '30170', '20,000,000', '39.8', '101동']) expect(previews).not.toContain(s);
  });

  test('F: 필드명 OCR 오타 "주민동록번호"도 값 모양(생년월일·성별 자리) + 문맥으로 탐지', () => {
    const r = result.regions.find((x) => x.maskedPreview.startsWith('800101'))!;
    expect(r).toMatchObject({ type: 'resident_registration_number', confidence: 'high', contextLabel: '주민등록번호' });
  });

  test('G: "1234-" "5678-" "9012-" "3456" 네 조각 → 하나의 카드번호, 상자는 조각 전체를 덮음', () => {
    const r = result.regions.find((x) => x.type === 'credit_card')!;
    expect(r.bbox).toHaveLength(1);
    const pieces = json('lease.clova.json').images[0].fields.filter((f: { inferText: string }) => ['1234-', '5678-', '9012-', '3456'].includes(f.inferText));
    const xs = pieces.flatMap((f: { boundingPoly: { vertices: { x: number }[] } }) => f.boundingPoly.vertices.map((v) => v.x / 2400));
    expect(r.bbox[0].x).toBeCloseTo(Math.min(...xs), 5);
    expect(r.bbox[0].x + r.bbox[0].w).toBeCloseTo(Math.max(...xs), 5);
  });

  test('보호본: 1600px · 가린 영역 픽셀이 실제로 검정(원본 픽셀 없음) · 가리지 않은 글자는 그대로', async () => {
    const img = result.protectedImage!;
    const info = readImageInfo(img)!;
    expect([info.format, info.width]).toEqual(['jpg', PROTECTED_VIEW_WIDTH]);
    const boxes = result.regions.flatMap((r) => r.bbox);
    // 칠한 상자(여유 포함) 안은 모두 어두움
    const { padRedactionBox } = jest.requireActual('../../../supabase/functions/_shared/protection/imageRedact.ts');
    expect(await checkCoverage(img, boxes.map(padRedactionBox))).toMatchObject({ decodable: true, uncovered: 0 });
    // 계약번호 줄(가리지 않음)은 밝은 픽셀이 대부분
    const dec = await decodeImage(img, 'jpg');
    const r = toPixelRect({ x: 0.05, y: 140 / 1700, w: 0.2, h: 50 / 1700 }, dec.width, dec.height);
    let bright = 0, n = 0;
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
      n++;
      if (dec.data[(y * dec.width + x) * 4] > 150) bright++;
    }
    expect(bright / n).toBeGreaterThan(0.6);
  });

  test('K: 보호본 재-OCR에서 가린 값 전체가 다시 읽히지 않음 (가짜 OCR이 덮인 글자를 읽지 못함)', async () => {
    const re = await LEASE_OCR().recognize({ bytes: result.protectedImage!, format: 'jpg', width: PROTECTED_VIEW_WIDTH, height: readImageInfo(result.protectedImage!)!.height });
    const text = re.tokens.map((t) => t.text).join(' ');
    for (const raw of ['800101-1234567', '950505-2345678', '010-1234-5678', '010-9876-5432', '123-456-789012', '987-654-321098', '1002-345-678901', '3456']) expect(text).not.toContain(raw);
    expect(text).toContain('2026-1234-5678-0001'); // 가리지 않은 계약번호는 그대로 읽힘
  });

  test('L: 원본 바이트(해시)는 처리 전후 같음', () => {
    expect(sha(LEASE)).toBe(before);
  });

  test('가리기 해제 → OCR 없이 저장된 위치로 다시 그림 (해석·덮임 확인), 해제한 값은 보이고 나머지는 가림', async () => {
    const regions = result.regions.map((r) => (r.type === 'phone' ? { ...r, state: 'unmasked' as const } : r));
    const counting = LEASE_OCR();
    const redrawn = await redrawImage(LEASE, regions);
    expect(redrawn).toMatchObject({ status: 'protected', detail: null });
    expect(redrawn.diagnostics).toMatchObject({ ocrCalls: 0, verification: 'coverage_only', redactedRegionCount: 6 });
    expect(counting.calls).toBe(0);
    const re = await counting.recognize({ bytes: redrawn.protectedImage!, format: 'jpg', width: PROTECTED_VIEW_WIDTH, height: readImageInfo(redrawn.protectedImage!)!.height });
    const text = re.tokens.map((t) => t.text).join(' ');
    expect(text).toContain('010-1234-5678');
    expect(text).not.toContain('800101-1234567');
  });
});

describe('상태 판정', () => {
  test('H: 민감정보 없음 → no_sensitive_data, 재-OCR 안 함 (OCR 1회), 보호본 없음', async () => {
    const ocr = new PixelReadingOcr(json('plain.clova.json'), readImageInfo(read('plain.jpg'))!);
    const r = await protectImage(read('plain.jpg'), { ocr });
    expect(r).toMatchObject({ status: 'no_sensitive_data', protectedImage: null });
    expect(ocr.calls).toBe(1);
  });

  test('I: 거의 읽지 못한 사진 → unreadable (no_sensitive_data로 오판하지 않음)', async () => {
    const ocr = new PixelReadingOcr(json('blurry.clova.json'), readImageInfo(read('plain.jpg'))!);
    const r = await protectImage(read('plain.jpg'), { ocr });
    expect(r).toMatchObject({ status: 'unreadable', detail: 'low_ocr_quality', protectedImage: null });
  });

  test('K-실패: 보호본에서도 원문이 다시 읽히면 verification_failed → protected 아님, 보호본 없음', async () => {
    const leaky = new PixelReadingOcr(json('lease.clova.json'), { width: 2400, height: 1700 }, { ignoreCover: true });
    const r = await protectImage(LEASE, { ocr: leaky });
    expect(r).toMatchObject({ status: 'failed', detail: 'verification_failed', protectedImage: null });
    expect(r.diagnostics.verifyValueLeakCount).toBeGreaterThan(0);
  });

  test('사용자가 이전에 해제한 항목은 다시 처리해도 해제 상태 유지', async () => {
    const r = await protectImage(LEASE, { ocr: LEASE_OCR(), prevStates: new Map([['p1:phone:1', 'unmasked']]) });
    expect(r.status).toBe('protected');
    expect(r.regions.find((x) => x.key === 'p1:phone:1')?.state).toBe('unmasked');
  });

  test('숫자 조각(예: 3456)이 문서 다른 곳에 있다는 이유만으로는 실패하지 않음', async () => {
    // 카드번호 끝 4자리 "3456"은 가린 값의 일부일 뿐 — 가짜 OCR이 다른 곳에 "3456"을 읽어도 값 전체가 아니면 통과
    const res = json('lease.clova.json');
    res.images[0].fields.push({ inferText: '3456', inferConfidence: 0.99, lineBreak: true, boundingPoly: { vertices: [{ x: 1900, y: 1600 }, { x: 2000, y: 1600 }, { x: 2000, y: 1640 }, { x: 1900, y: 1640 }] } });
    const r = await protectImage(LEASE, { ocr: new PixelReadingOcr(res, { width: 2400, height: 1700 }) });
    expect(r.status).toBe('protected');
  });

  test('EXIF 회전이 남은 JPEG는 좌표가 어긋날 수 있어 보호됨으로 표시하지 않음', async () => {
    // APP1 Exif(Orientation=6)를 SOI 뒤에 끼운다
    const exif = Uint8Array.from([0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const rotated = new Uint8Array(LEASE.length + exif.length);
    rotated.set(LEASE.subarray(0, 2));
    rotated.set(exif, 2);
    rotated.set(LEASE.subarray(2), 2 + exif.length);
    expect(readImageInfo(rotated)?.orientation).toBe(6);
    const ocr = LEASE_OCR();
    expect(await protectImage(rotated, { ocr })).toMatchObject({ status: 'failed', detail: 'image_orientation' });
    expect(ocr.calls).toBe(0);
  });
});

describe('N: CLOVA 오류 구분 · 제한된 재시도 · 개인정보 로그 없음', () => {
  const img: OcrImage = { bytes: LEASE, format: 'jpg', width: 2400, height: 1700 };
  const resp = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

  test.each([
    [401, 'ocr_auth', 1],
    [429, 'ocr_rate_limited', 2],
    [503, 'ocr_server', 2],
    [400, 'ocr_bad_request', 1],
  ])('HTTP %i → %s (시도 %i번)', async (status, code, attempts) => {
    let calls = 0;
    const ocr = new ClovaOcr('https://example.invalid/ocr', 'secret', (async () => {
      calls++;
      return resp(status);
    }) as typeof fetch);
    await expect(ocr.recognize(img)).rejects.toMatchObject({ code });
    expect(calls).toBe(attempts);
  });

  test('시간 초과 → ocr_timeout, 1번만 다시 시도 → 사진은 failed (보호됨 아님)', async () => {
    let calls = 0;
    const ocr = new ClovaOcr('https://example.invalid/ocr', 'secret', (async () => {
      calls++;
      throw new DOMException('aborted', 'AbortError');
    }) as typeof fetch);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await protectImage(LEASE, { ocr });
    expect(r).toMatchObject({ status: 'failed', detail: 'ocr_timeout', protectedImage: null, regions: [] });
    expect(calls).toBe(2);
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    log.mockRestore();
    err.mockRestore();
  });

  test('응답 형식이 틀리면 ocr_invalid_response (재시도 안 함)', async () => {
    let calls = 0;
    const ocr = new ClovaOcr('https://example.invalid/ocr', 'secret', (async () => {
      calls++;
      return resp(200, { images: [{}] });
    }) as typeof fetch);
    await expect(ocr.recognize(img)).rejects.toBeInstanceOf(OcrError);
    expect(calls).toBe(1);
  });

  test('요청: 비밀키는 헤더로만, 이미지는 base64 본문, 언어 ko', async () => {
    let seen: { headers: Record<string, string>; body: { lang: string; images: { format: string; data: string }[] } } | null = null;
    const ocr = new ClovaOcr('https://example.invalid/ocr', 'secret-value', (async (_u: string, init: RequestInit) => {
      seen = { headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
      return resp(200, json('plain.clova.json'));
    }) as unknown as typeof fetch);
    const page = await ocr.recognize({ bytes: read('plain.jpg'), format: 'jpg', width: 2400, height: 800 });
    expect(page.tokens.length).toBeGreaterThan(10);
    expect(seen!.headers['X-OCR-SECRET']).toBe('secret-value');
    expect(seen!.body.lang).toBe('ko');
    expect(Buffer.from(seen!.body.images[0].data, 'base64').equals(Buffer.from(read('plain.jpg')))).toBe(true);
  });
});

describe('탐지기 보강', () => {
  test('필드명 한 글자 오타는 문맥으로 인정하되, 값 모양이 틀리면 탐지하지 않음', () => {
    expect(detectSensitive('주민동록번호 800101-1234567')[0]).toMatchObject({ confidence: 'high', contextLabel: '주민등록번호' });
    expect(detectSensitive('주민동록번호 801301-1234567')).toEqual([]); // 13월 — 생년월일 아님
  });
  test('"계약번호"는 "계좌번호"와 한 글자 차이지만 제외 필드명이 우선', () => {
    expect(detectSensitive('계약번호 1002-345-678901')).toEqual([]);
  });
});

describe('1600px 보호본 가독성 (작은 글자)', () => {
  test('6pt 상당 글자도 1600px에서 글자 높이 약 11px 이상 — 결과 이미지는 사람이 직접 확인 (scratch 저장)', async () => {
    const src = await decodeImage(read('smallprint.jpg'), 'jpg');
    const view = downscale(src, PROTECTED_VIEW_WIDTH);
    expect(view.width).toBe(1600);
    // fixture의 6pt = 글자 크기 24px(2400 기준) → 1600 기준 16px (글자 몸통 높이는 그보다 작음)
    expect((24 * view.width) / src.width).toBeGreaterThanOrEqual(15.9);
    const out = process.env.PHOTO_READABILITY_OUT;
    if (out) {
      const { renderProtectedView } = jest.requireActual('../../../supabase/functions/_shared/protection/imageRedact.ts');
      fs.writeFileSync(out, renderProtectedView(src, []).bytes);
    }
  });
});
