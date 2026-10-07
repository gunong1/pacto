/**
 * 계약서 민감정보 보호 — 실제 제거(redaction) + 독립 검증 (테스트 A·B·C·D·F)
 * Edge Function과 같은 코드(공용 모듈 + 고정 버전 번들)를 Node 내장 테스트로 실행한다.
 * 실행: npm run test:protection
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, describe, test } from 'node:test';

import { protectPdf } from '../../supabase/functions/_shared/protection/protect.ts';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from '../../supabase/functions/_shared/vendor/pdf-lib.js';
import { PDFJS_OPTIONS } from '../../supabase/functions/_shared/protection/cmap.ts';
import { extractText, getDocumentProxy } from '../../supabase/functions/_shared/vendor/unpdf.js';
import { ContractPdf, employmentContractPdf, rentalContractPdf } from './fixtures.ts';
import { predefinedCMapPdf, simpleFontValuesPdf, type3ValuesPdf } from './lowlevel.ts';

type Result = Awaited<ReturnType<typeof protectPdf>>;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const flat = (s: string) => s.replace(/\s+/g, '');
async function textOf(pdf: Uint8Array) {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf), PDFJS_OPTIONS as never), { mergePages: true });
  return String(text);
}
/** 숫자형 값 비교: 공백·하이픈·점을 빼고 본다 ('4111-1111-…' = '4111 1111 …') */
const numericFlat = (s: string) => s.replace(/[\s\-.]/g, '');
/** 설치돼 있으면 poppler pdftotext(세 번째 독립 구현)로 텍스트 추출 */
function pdftotext(pdf: Uint8Array): string | null {
  try {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pacto-')), 'x.pdf');
    fs.writeFileSync(f, pdf);
    return execFileSync('pdftotext', ['-layout', f, '-'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return null;
  }
}

/** 같은 숫자 조각이 여러 값에 반복되는 문서 — 예전 부분 문자열 검사가 오탐하던 경우 */
const REPEATED: [string, string][] = [
  ['카드번호:', '4111-1111-1111-1111'],
  ['법인카드 번호:', '5500-0000-0008-1111'], // 마지막 4자리(표시) = 다른 카드의 가린 숫자
  ['휴대전화:', '010-2222-1111'], // 카드와 1111 공유
  ['연락처:', '010-1234-5678'],
  ['비상연락처:', '010-1234-9876'], // 가운데 번호 같음
  ['보호자 연락처:', '010-5678-1234'], // 표시되는 끝자리 = 다른 번호의 가린 가운데
];
const REPEATED_VISIBLE = ['4111-', '-1111', '5500-', '010-', '-5678', '-9876', '-1234'];

/** 파일 안 모든 스트림을 풀어 본 내용 (PDF 구조 분석으로 볼 수 있는 것) */
async function allStreams(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf);
  return doc.context
    .enumerateIndirectObjects()
    .map(([, o]) => o)
    .filter((o): o is PDFRawStream => o instanceof PDFRawStream)
    .map((s) => {
      try {
        return Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
      } catch {
        return '';
      }
    });
}

describe('A. 근로계약서 — 주민등록번호 자동 가림 · 전화번호 부분 가림 · 계약 정보는 그대로', () => {
  let original: Uint8Array;
  let result: Result;
  before(async () => {
    original = await employmentContractPdf();
    result = await protectPdf(original);
  });

  test('보호됨: 종류·신뢰도·가린 표시값·위치만 (원문 값 없음)', () => {
    assert.equal(result.status, 'protected');
    assert.deepEqual(
      result.regions.map((r) => [r.type, r.confidence, r.state, r.maskedPreview, r.page]),
      [
        ['resident_registration_number', 'high', 'masked', '901225-1******', 1],
        ['phone', 'high', 'masked', '010-****-5678', 1],
        ['email', 'high', 'masked', 'mi****@example.com', 1],
      ],
    );
    assert.doesNotMatch(JSON.stringify(result.regions), /1234567|1234-5678|minjun@/);
    for (const r of result.regions) for (const b of r.bbox) assert.ok(b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0 && b.x + b.w <= 1 && b.y + b.h <= 1);
  });

  test('F. 보호본 텍스트 추출·검색에 원문이 나오지 않음 (pdf.js)', async () => {
    const text = await textOf(result.protectedPdf!);
    for (const secret of ['1234567', '1234-5678', 'minjun']) assert.ok(!text.includes(secret), `leak: ${secret.length}자`);
    assert.ok(text.includes('901225-1'));
    // 계약 이해에 필요한 정보는 그대로 (이름·회사·급여·기간)
    for (const keep of ['박민준', '네오링크', '3,600,000원', '2027년', '5678']) assert.ok(flat(text).includes(flat(keep)), keep);
  });

  test('F. PDF 구조 분석: 원래 글자 표시 스트림·메타데이터에 원문이 남지 않음', async () => {
    const before = await allStreams(original);
    const after = await allStreams(result.protectedPdf!);
    const textStreams = before.filter((s) => /<[0-9A-Fa-f]+>\s*Tj/.test(s));
    assert.ok(textStreams.length > 0);
    for (const s of textStreams) assert.ok(!after.some((a) => a.includes(s)), '원래 콘텐츠 스트림이 그대로 남음');
    assert.ok(!after.join('\n').includes('1234567'));
  });

  test('D. 원본 파일은 바뀌지 않음 (처리 전후 해시 동일, 원본에는 원문 그대로)', async () => {
    const h = sha(original);
    await protectPdf(original);
    assert.equal(sha(original), h);
    assert.ok((await textOf(original)).includes('901225-1234567'));
  });
});

describe('B·C. 렌탈계약서 — 계좌번호 가림, 계약번호·사업자번호·대표번호는 오탐하지 않음', () => {
  test('계좌번호만 가림, 월 렌탈료·결제일·계약번호 그대로', async () => {
    const r = await protectPdf(await rentalContractPdf());
    assert.equal(r.status, 'protected');
    assert.deepEqual(r.regions.map((x) => [x.type, x.maskedPreview]), [['bank_account', '******-**-**4567']]);
    const text = flat(await textOf(r.protectedPdf!));
    assert.ok(!text.includes('123456-01-2345'));
    for (const keep of ['1234-5678-9012-3456', '29,900원', '10일', '123-45-67890', '1588-1234', '4567']) assert.ok(text.includes(keep), keep);
  });
});

describe('상태 구분 (보호됨으로 잘못 표시하지 않기)', () => {
  test('민감정보를 찾지 못하면 no_sensitive_data (보호본 없음)', async () => {
    const c = await ContractPdf.create();
    await c.page(['헬스장 1년권 계약서', '1년 회원권 660,000원 (계약 시 일시불 결제)']);
    const r = await protectPdf(await c.save());
    assert.equal(r.status, 'no_sensitive_data');
    assert.equal(r.protectedPdf, null);
  });

  test('사진·스캔본(이미지만) → unsupported_scan', async () => {
    const c = await ContractPdf.create();
    await c.scanPage();
    const r = await protectPdf(await c.save());
    assert.equal(r.status, 'unsupported_scan');
    assert.equal(r.protectedPdf, null);
  });

  test('스캔 이미지 위 투명 OCR 글자층 → unsupported_scan (글자만 지워도 이미지에 보이므로)', async () => {
    const c = await ContractPdf.create();
    await c.scanPage('901225-1234567');
    assert.equal((await protectPdf(await c.save())).status, 'unsupported_scan');
  });

  test('텍스트 + 스캔 페이지가 섞이면 문서 전체 unsupported_scan', async () => {
    const c = await ContractPdf.create();
    await c.page(['주민등록번호: 901225-1234567']);
    await c.scanPage();
    const r = await protectPdf(await c.save());
    assert.equal(r.status, 'unsupported_scan');
    assert.deepEqual(r.regions, []);
  });

  test('PDF가 아니거나 깨진 파일 → failed', async () => {
    const r = await protectPdf(new TextEncoder().encode('not a pdf'));
    assert.equal(r.status, 'failed');
    assert.equal(r.detail, 'unreadable');
  });
});

describe('사용자 선택 유지 · 확신 낮은 후보', () => {
  test('가리기 해제한 영역은 보호본에 원문 표시 (검증 통과), 나머지는 계속 가림', async () => {
    const pdf = await employmentContractPdf();
    const first = await protectPdf(pdf);
    const phone = first.regions.find((r) => r.type === 'phone')!;
    const r = await protectPdf(pdf, new Map([[phone.key, 'unmasked']]));
    assert.equal(r.status, 'protected');
    assert.equal(r.regions.find((x) => x.key === phone.key)!.state, 'unmasked');
    const text = flat(await textOf(r.protectedPdf!));
    assert.ok(text.includes('010-1234-5678'));
    assert.ok(!text.includes('1234567'));
  });

  test('필드명 없는 13자리 숫자는 후보(가리지 않음)', async () => {
    const c = await ContractPdf.create();
    await c.page(['참고 9012251234567']);
    const r = await protectPdf(await c.save());
    assert.deepEqual(r.regions.map((x) => [x.type, x.confidence, x.state]), [['resident_registration_number', 'low', 'candidate']]);
    assert.equal(r.status, 'protected');
  });
});

describe('위치 기반 검증 — 반복 숫자 회귀 (예전 오탐 사례)', () => {
  for (const [name, make] of [
    ['단순 글꼴(Helvetica) 값', () => simpleFontValuesPdf(REPEATED)],
    ['Type3 글꼴 값 (Chrome 인쇄 구조)', () => type3ValuesPdf(REPEATED)],
  ] as const) {
    test(`${name}: 올바르게 지우면 protected, 원문 값은 어디에도 없음`, async () => {
      const r = await protectPdf(await make());
      assert.equal(r.status, 'protected', `${r.detail} ${JSON.stringify(r.diagnostics.verifyLeakTypes)}`);
      assert.deepEqual(r.regions.map((x) => x.type), ['credit_card', 'credit_card', 'phone', 'phone', 'phone', 'phone']);
      assert.equal(r.diagnostics.verifyLeakCount, 0);
      assert.ok(r.diagnostics.alignMatchedCount === r.diagnostics.alignItemCount && r.diagnostics.alignItemCount > 0);
      const text = await textOf(r.protectedPdf!);
      for (const [, v] of REPEATED) assert.ok(!numericFlat(text).includes(numericFlat(v)), `전체 값 남음 (${v.length}자)`);
      for (const keep of REPEATED_VISIBLE) assert.ok(text.includes(keep), keep);
    });
  }

  test('실제로 지우지 않고 상자만 덮으면(눈으로만 가림) verification_failed', async () => {
    const r = await protectPdf(await simpleFontValuesPdf(REPEATED), new Map(), { skipRemovalFor: (t) => t === 'credit_card' });
    assert.equal(r.status, 'failed');
    assert.equal(r.detail, 'verification_failed');
    assert.equal(r.protectedPdf, null);
    assert.deepEqual(r.diagnostics.verifyLeakTypes, ['credit_card']);
    assert.ok(r.diagnostics.verifyPositionLeakOwn > 0, '우리 추출기 위치 검사');
    assert.ok(r.diagnostics.verifyPositionLeakPdfjs > 0, 'pdf.js 위치 검사');
    assert.ok(r.diagnostics.verifyValueLeakCount > 0, '전체 값 검사');
  });

  test('한 값만 덜 지워져도 실패 (전화번호 하나)', async () => {
    let n = 0;
    const r = await protectPdf(await type3ValuesPdf(REPEATED), new Map(), { skipRemovalFor: (t) => t === 'phone' && n++ === 0 });
    assert.equal(r.detail, 'verification_failed');
    assert.deepEqual(r.diagnostics.verifyLeakTypes, ['phone']);
  });

  test('pdftotext(poppler)로도 원문 전체 값이 나오지 않음', async (t) => {
    const r = await protectPdf(await simpleFontValuesPdf(REPEATED));
    const text = pdftotext(r.protectedPdf!);
    if (text === null) return t.skip('pdftotext 미설치');
    for (const [, v] of REPEATED) assert.ok(!text.split('\n').some((l) => numericFlat(l).includes(numericFlat(v))), `pdftotext에 전체 값 (${v.length}자)`);
    assert.ok(text.includes('-1111') && text.includes('010-'));
    // 원본에는 있었는지 (도구가 제대로 읽는지) 확인
    const orig = pdftotext(await simpleFontValuesPdf(REPEATED))!;
    assert.ok(numericFlat(orig).includes('4111111111111111'));
  });
});

describe('글꼴 지원 범위 — 한글 CMap(스캔본으로 잘못 분류하던 문제) · Type3 · 위치 신뢰성', () => {
  const lines = ['주민등록번호: 900101-1234567', '휴대전화: 010-1234-5678', '카드번호: 4111-1111-1111-1111', '배우자 연락처: 010-2222-1111'];
  for (const enc of ['UniKS-UCS2-H', 'KSCms-UHC-H'] as const) {
    test(`${enc}: 텍스트로 읽고 protected (unsupported_scan 아님)`, async () => {
      const r = await protectPdf(await predefinedCMapPdf(enc, lines));
      assert.equal(r.status, 'protected', `${r.detail}`);
      assert.deepEqual(r.regions.map((x) => [x.type, x.maskedPreview]), [
        ['resident_registration_number', '900101-1******'],
        ['phone', '010-****-5678'],
        ['credit_card', '4111-****-****-1111'],
        ['phone', '010-****-1111'],
      ]);
      assert.ok(r.diagnostics.alignItemCount > 0 && r.diagnostics.alignMatchedCount === r.diagnostics.alignItemCount);
      const text = await textOf(r.protectedPdf!);
      assert.ok(text.includes('주민등록번호') && text.includes('900101-1'));
      for (const v of ['1234567', '010-1234-5678', '4111-1111-1111-1111', '2222']) assert.ok(!numericFlat(text).includes(numericFlat(v)), `${v.length}자 값 남음`);
    });
  }

  test('세로쓰기 CMap(-V)·한글 외 CMap은 위치를 보장할 수 없어 failed(unsupported_font) — 스캔본으로 표시하지 않음', async () => {
    const v = await protectPdf(await predefinedCMapPdf('UniKS-UCS2-V', lines));
    assert.deepEqual([v.status, v.detail], ['failed', 'unsupported_font']);
    const j = await protectPdf(await predefinedCMapPdf('90ms-RKSJ-H', ['TEL 010-1234-5678']));
    assert.deepEqual([j.status, j.detail], ['failed', 'unsupported_font']);
  });

  test('글자 너비를 알 수 없는 글꼴(미포함·Widths 없음·표준 글꼴 아님)은 위치가 pdf.js와 어긋나 failed(text_mismatch)', async () => {
    const doc = await PDFDocument.load(await simpleFontValuesPdf([['카드번호:', '4111-1111-1111-1111']]));
    for (const [, o] of doc.context.enumerateIndirectObjects()) {
      if (o instanceof PDFDict && o.get(PDFName.of('BaseFont')) === PDFName.of('Helvetica')) o.set(PDFName.of('BaseFont'), PDFName.of('UnknownSans'));
    }
    const r = await protectPdf(await doc.save());
    assert.deepEqual([r.status, r.detail], ['failed', 'text_mismatch']);
    assert.ok(r.diagnostics.alignMatchedCount < r.diagnostics.alignItemCount);
  });

  test('ToUnicode 없는 Type3 글꼴은 글자를 확정할 수 없어 failed(unsupported_font)', async () => {
    const r = await protectPdf(await type3ValuesPdf(REPEATED, { toUnicode: false }));
    assert.deepEqual([r.status, r.detail], ['failed', 'unsupported_font']);
  });
});
