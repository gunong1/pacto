/**
 * 사진·스캔 민감정보 보호 파이프라인 Golden — 모든 값은 가짜다.
 *
 * 가짜 OCR이 "그 문서를 그렇게 읽었다"고 가정하고(손글씨·인쇄·기울어짐·그림자·저해상도·표), 파이프라인 판정을 고정한다.
 * - 각 문서의 주민등록번호 · 휴대전화 · 이메일 · 계좌번호가 모두 가려져야 protected. 하나라도 놓치면 테스트 실패.
 * - 값을 확정하지 못한 칸이 있으면 protected가 아니라 needs_review (보호 확인 필요) — AI 분석 차단.
 * - 가짜 OCR은 받은 이미지에서 글자 상자가 검게 칠해졌으면 그 글자를 읽지 못한 것으로 돌려준다 (재-OCR 검증 재현).
 * 실제 손글씨 인식률은 OCR마다 달라 이 테스트로 보장하지 않는다 (실제 CLOVA 평가는 scripts/protect-bench.mjs).
 */
import { decodeImage } from '../../../../supabase/functions/_shared/protection/imageRedact.ts';
import type { OcrImage, OcrProvider } from '../../../../supabase/functions/_shared/protection/ocrProvider.ts';
import { fromClova, type OcrPage } from '../../../../supabase/functions/_shared/protection/ocrText.ts';
import { aiInputPlan } from '../../../../supabase/functions/_shared/protection/aiGate.ts';
import { protectImageInput, type ImageInput } from '../../../../supabase/functions/_shared/protection/protectImage.ts';
import { encodeJpeg } from '../../../../supabase/functions/_shared/vendor/imagecodec.js';

const W = 2400;
const H = 1700;
const LINE_H = 40;

type Field = { inferText: string; inferConfidence: number; lineBreak: boolean; boundingPoly: { vertices: { x: number; y: number }[] } };
/** 한 줄: [글자, x, 너비] — y는 줄 위치(픽셀), dy는 기울기(조각마다 아래로) */
function line(y: number, parts: [string, number, number][], o: { conf?: number; dy?: number } = {}): Field[] {
  return parts.map(([text, x, w], i) => {
    const yy = y + (o.dy ?? 0) * i;
    return {
      inferText: text,
      inferConfidence: o.conf ?? 0.97,
      lineBreak: i === parts.length - 1,
      boundingPoly: { vertices: [{ x, y: yy }, { x: x + w, y: yy }, { x: x + w, y: yy + LINE_H }, { x, y: yy + LINE_H }] },
    };
  });
}
/** 민감정보와 무관한 본문 줄 (읽기 품질 기준을 넘도록) */
const BODY = [
  ...line(80, [['주택', 100, 80], ['월세', 200, 80], ['임대차계약서', 300, 240]]),
  ...line(160, [['임대차기간', 100, 200], ['2026년', 320, 120], ['10월', 460, 80], ['20일부터', 560, 160], ['2028년', 740, 120], ['10월', 880, 80], ['19일까지', 980, 160]]),
  ...line(240, [['보증금', 100, 120], ['20,000,000원', 240, 240], ['월세', 500, 80], ['850,000원', 600, 200], ['매월', 820, 80], ['20일', 920, 80]]),
];
/** 가린 상자가 칠해졌으면 그 글자를 읽지 못함 */
async function visibleOnly(fields: Field[], image: OcrImage, base: { w: number; h: number }): Promise<Field[]> {
  const img = await decodeImage(image.bytes, image.format);
  const sx = image.width / base.w, sy = image.height / base.h;
  return fields
    .map((f) => ({ ...f, boundingPoly: { vertices: f.boundingPoly.vertices.map((v) => ({ x: Math.round(v.x * sx), y: Math.round(v.y * sy) })) } }))
    .filter((f) => {
      const [a, , c] = f.boundingPoly.vertices;
      let dark = 0, n = 0;
      for (let y = a.y; y < c.y; y += 2) for (let x = a.x; x < c.x; x += 2) {
        const i = (y * img.width + x) * 4;
        n++;
        if (img.data[i] < 40 && img.data[i + 1] < 40 && img.data[i + 2] < 40) dark++;
      }
      return n === 0 || dark / n < 0.6;
    });
}

/**
 * 대본 OCR: 처음 읽기(first) · 의심 칸 다시 읽기(reread, 페이지 픽셀 좌표 — 잘라낸 영역 안의 조각만 돌려준다) · 보호본 재검증(verify, 없으면 first)
 */
class ScriptedOcr implements OcrProvider {
  readonly name = 'scripted';
  calls = 0;
  rereads = 0;
  private n = 0;
  constructor(private readonly s: { first: Field[]; reread?: Field[]; verify?: Field[] }) {}
  async recognize(image: OcrImage): Promise<OcrPage> {
    this.calls++;
    if (image.region) {
      this.rereads++;
      const r = image.region;
      const rx = r.x * W, ry = r.y * H, rw = r.w * W, rh = r.h * H;
      const fields = (this.s.reread ?? [])
        .filter((f) => {
          const [a, , c] = f.boundingPoly.vertices;
          return a.x >= rx && a.y >= ry && c.x <= rx + rw && c.y <= ry + rh;
        })
        .map((f) => ({ ...f, boundingPoly: { vertices: f.boundingPoly.vertices.map((v) => ({ x: ((v.x - rx) / rw) * image.width, y: ((v.y - ry) / rh) * image.height })) } }));
      return fromClova({ images: [{ fields }] }, image.width, image.height);
    }
    const pass = this.n++;
    const fields = pass === 0 ? this.s.first : await visibleOnly(this.s.verify ?? this.s.first, image, { w: W, h: H });
    if (pass === 0) {
      const sx = image.width / W, sy = image.height / H;
      return fromClova({ images: [{ fields: fields.map((f) => ({ ...f, boundingPoly: { vertices: f.boundingPoly.vertices.map((v) => ({ x: v.x * sx, y: v.y * sy })) } })) }] }, image.width, image.height);
    }
    return fromClova({ images: [{ fields }] }, image.width, image.height);
  }
}

function blankInput(w = W, h = H): ImageInput {
  const data = new Uint8Array(w * h * 4).fill(250);
  const jpg = encodeJpeg({ width: w, height: h, data }, 85).data as Uint8Array;
  return { page: 1, ocr: { bytes: jpg, format: 'jpg', width: w, height: h }, width: w, height: h, decode: () => decodeImage(jpg, 'jpg') };
}
const run = async (script: ConstructorParameters<typeof ScriptedOcr>[0], input = blankInput()) => {
  const ocr = new ScriptedOcr(script);
  const r = await protectImageInput(input, { ocr });
  return { r, ocr, masked: r.regions.filter((x) => x.state === 'masked').map((x) => x.type).sort() };
};
const ALL4 = ['bank_account', 'email', 'phone', 'resident_registration_number'];

/** 인쇄 계약서 개인정보 줄 */
const PRINTED = [
  ...line(400, [['임대인', 100, 120], ['주민등록번호', 240, 240], ['800101-1234567', 500, 300]]),
  ...line(480, [['휴대전화', 100, 160], ['010-1234-5678', 280, 280]]),
  ...line(560, [['이메일', 100, 120], ['lessor@example.com', 240, 360]]),
  ...line(640, [['입금계좌', 100, 160], ['국민은행', 280, 160], ['123456-01-234567', 460, 320]]),
];

describe('1. 인쇄 계약서 — 4종 모두 가림', () => {
  test('protected · 주민·전화·이메일·계좌 모두 가림 · OCR 2회(처음 + 재검증)', async () => {
    const { r, ocr, masked } = await run({ first: [...BODY, ...PRINTED] });
    expect(r.status).toBe('protected');
    expect(masked).toEqual(ALL4);
    expect(ocr.calls).toBe(2);
    expect(r.diagnostics.unresolvedFieldCount).toBe(0);
  });
});

describe('2. 손글씨 — 공통 탐지기(A)로 해결', () => {
  test('넓은 글자 간격: "010-" "1234-" "5678" 조각 사이가 넓어 공백이 들어가도 전화 가림 (이전: 주민만 가리고 전화 누락)', async () => {
    const hand = [
      ...line(400, [['주민등록번호', 100, 240], ['800101-', 380, 160], ['1234567', 620, 180]]),
      ...line(480, [['휴대전화', 100, 160], ['010-', 300, 90], ['1234-', 470, 110], ['5678', 660, 100]]),
      ...line(560, [['이메일', 100, 120], ['lessor@example.com', 240, 360]]),
      ...line(640, [['입금계좌', 100, 160], ['123456-', 300, 150], ['01-', 520, 60], ['234567', 660, 140]]),
    ];
    const { r, masked } = await run({ first: [...BODY, ...hand] });
    expect(r.status).toBe('protected');
    expect(masked).toEqual(ALL4);
  });
  test('대시 모양(—·ㅡ)과 혼동 글자(O10): 필드명이 있으면 가림', async () => {
    const hand = [
      ...line(400, [['주민등록번호', 100, 240], ['800101ㅡ1234567', 380, 320]]),
      ...line(480, [['휴대전화', 100, 160], ['O10—1234—5678', 300, 300]]),
      ...line(560, [['이메일', 100, 120], ['lessor@example.com', 240, 360]]),
      ...line(640, [['입금계좌', 100, 160], ['123456ㅡ01ㅡ234567', 300, 340]]),
    ];
    const { r, masked } = await run({ first: [...BODY, ...hand] });
    expect(r.status).toBe('protected');
    expect(masked).toEqual(ALL4);
  });
});

/** 처음 OCR이 전화 칸을 규칙 밖으로 읽은 손글씨 */
const GARBLED_PHONE = [
  ...line(400, [['주민등록번호', 100, 240], ['800101-1234567', 380, 300]]),
  ...line(480, [['휴대전화', 100, 160], ['010', 300, 80], ['.', 400, 20], ['12', 440, 50], ['34', 510, 50], ['/', 580, 20], ['5678', 620, 100]]),
  ...line(560, [['이메일', 100, 120], ['lessor@example.com', 240, 360]]),
  ...line(640, [['입금계좌', 100, 160], ['123456-01-234567', 300, 320]]),
];

describe('3. 손글씨 — 필드명 누락 검사(B) → 다시 읽기(D) → 값 영역 가리기(C) → 확인 필요(F)', () => {
  test('D: 전화 칸만 잘라 다시 읽어 값을 찾으면 그 값을 가림 → protected (전체 OCR 반복 없음: 처음 1 + 칸 1 + 재검증 1)', async () => {
    const { r, ocr, masked } = await run({ first: [...BODY, ...GARBLED_PHONE], reread: line(480, [['휴대전화', 100, 160], ['010-1234-5678', 300, 420]]) });
    expect(r.status).toBe('protected');
    expect(masked).toEqual(ALL4);
    expect([ocr.calls, ocr.rereads]).toEqual([3, 1]);
    expect(r.diagnostics.rereadResolvedCount).toBe(1);
  });
  test('C: 다시 읽어도 못 읽었지만 값 영역이 확실(한 줄 · 필드명과 다른 조각) → 값 영역만 가림 → protected', async () => {
    const { r, masked } = await run({ first: [...BODY, ...GARBLED_PHONE], reread: [] });
    expect(r.status).toBe('protected');
    expect(masked).toEqual(ALL4);
    const phone = r.regions.find((x) => x.type === 'phone')!;
    expect(phone.confidence).toBe('medium');
    expect(phone.maskedPreview).not.toMatch(/\d/); // 표시값에 숫자 원문 없음
    // 필드명 상자(x 100~260)는 가리지 않고 값 영역만 (x 300~)
    expect(Math.min(...phone.bbox.map((b) => b.x))).toBeGreaterThanOrEqual(290 / W);
    expect(r.diagnostics.fieldFallbackCount).toBe(1);
  });
  test('F: 값 영역이 불확실(값이 두 줄에 걸침) → needs_review · 보호본 없음 · AI 분석 차단', async () => {
    const twoLines = [
      ...line(400, [['주민등록번호', 100, 240], ['800101-1234567', 380, 300]]),
      ...line(480, [['휴대전화', 100, 160], ['010', 300, 80], ['.', 400, 20], ['12', 440, 50]]).map((f, i, a) => ({ ...f, lineBreak: i === a.length - 1 ? false : f.lineBreak })),
      ...line(530, [['34', 300, 50], ['/', 370, 20], ['5678', 410, 100]]),
      ...line(640, [['이메일', 100, 120], ['lessor@example.com', 240, 360]]),
    ];
    const { r } = await run({ first: [...BODY, ...twoLines], reread: [] });
    expect([r.status, r.detail]).toEqual(['needs_review', 'field_uncertain']);
    expect(r.protectedImage).toBeNull();
    expect(aiInputPlan({ protectionStatus: r.status, encrypted: false, hasProtectedView: false })).toEqual({ kind: 'blocked', code: 'protection_required' });
  });
});

describe('4. 재검증(E) — 탐지한 값을 다 가렸다는 것만으로 보호 완료가 아니다', () => {
  test('처음 OCR이 필드명 없이 깨져 읽은 전화번호를 재검증 OCR이 가린 영역 밖에서 읽으면 → failed(verification_missed)', async () => {
    const first = [...BODY, ...line(400, [['주민등록번호', 100, 240], ['800101-1234567', 380, 300]]), ...line(480, [['담당', 100, 80], ['Ol0', 200, 80], ['1Z34', 300, 100], ['S678', 420, 100]])];
    const verify = [...BODY, ...line(400, [['주민등록번호', 100, 240], ['800101-1234567', 380, 300]]), ...line(480, [['담당', 100, 80], ['010-1234-5678', 200, 320]])];
    const { r } = await run({ first, verify });
    expect([r.status, r.detail]).toEqual(['failed', 'verification_missed']);
    expect(r.diagnostics.verifyMissedCount).toBe(1);
  });
});

describe('5. 촬영 조건 — 같은 정책, 4종 모두 가림', () => {
  test('기울어진 사진 (조각마다 아래로 8px)', async () => {
    const slanted = [
      ...line(400, [['주민등록번호', 100, 240], ['800101-1234567', 380, 300]], { dy: 8 }),
      ...line(480, [['휴대전화', 100, 160], ['010-', 300, 90], ['1234-', 410, 110], ['5678', 540, 100]], { dy: 8 }),
      ...line(560, [['이메일', 100, 120], ['lessor@example.com', 240, 360]], { dy: 8 }),
      ...line(640, [['입금계좌', 100, 160], ['123456-01-234567', 300, 320]], { dy: 8 }),
    ];
    const { r, masked } = await run({ first: [...BODY, ...slanted] });
    expect(r.status).toBe('protected');
    expect(masked).toEqual(ALL4);
  });
  test('그림자 (일부 줄 신뢰도 낮음)', async () => {
    const shadow = [...line(400, [['주민등록번호', 100, 240], ['800101-1234567', 380, 300]], { conf: 0.62 }), ...PRINTED.slice(3)];
    const { r, masked } = await run({ first: [...BODY, ...shadow] });
    expect(r.status).toBe('protected');
    expect(masked).toEqual(ALL4);
  });
  test('저해상도 사진 (1200×850)', async () => {
    const { r, masked } = await run({ first: [...BODY, ...PRINTED] }, blankInput(1200, 850));
    expect(r.status).toBe('protected');
    expect(masked).toEqual(ALL4);
  });
  test('복잡한 표: 머리글 줄(성명·주민등록번호·연락처) 아래 줄에 값', async () => {
    const table = [
      ...line(400, [['구분', 100, 80], ['성명', 260, 80], ['주민등록번호', 420, 240], ['연락처', 760, 120], ['이메일', 1000, 120]]),
      ...line(470, [['임대인', 100, 120], ['김민수', 260, 120], ['800101-1234567', 420, 300], ['010-1234-5678', 760, 260], ['lessor@example.com', 1040, 360]]),
      ...line(560, [['입금계좌', 100, 160], ['123456-01-234567', 300, 320]]),
    ];
    const { r, masked } = await run({ first: [...BODY, ...table] });
    expect(r.status).toBe('protected');
    expect(masked).toEqual(ALL4);
  });
});

describe('6. 민감정보 없음은 충분히 읽었을 때만', () => {
  test('개인정보 칸이 없는 업무 메모 → no_sensitive_data · 다시 읽기 없음', async () => {
    const memo = line(400, [['다음', 100, 80], ['주', 200, 40], ['회의', 260, 80], ['자료', 360, 80], ['정리', 460, 80], ['및', 560, 40], ['일정', 620, 80], ['공유', 720, 80]]);
    const { r, ocr } = await run({ first: [...BODY, ...memo] });
    expect(r.status).toBe('no_sensitive_data');
    expect(ocr.rereads).toBe(0);
  });
  test('빈 개인정보 칸(휴대전화 ( ))은 누락이 아님', async () => {
    const empty = line(480, [['휴대전화', 100, 160], ['(', 300, 20], [')', 600, 20]]);
    const { r } = await run({ first: [...BODY, ...empty] });
    expect(r.status).toBe('no_sensitive_data');
  });
});
