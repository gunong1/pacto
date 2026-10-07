/**
 * 계약서 민감정보 보호 — 실제 제거(redaction) + 독립 검증 (테스트 A·B·C·D·F)
 * Edge Function과 같은 코드(공용 모듈 + 고정 버전 번들)를 Node 내장 테스트로 실행한다.
 * 실행: npm run test:protection
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, describe, test } from 'node:test';

import { protectPdf } from '../../supabase/functions/_shared/protection/protect.ts';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from '../../supabase/functions/_shared/vendor/pdf-lib.js';
import { extractText, getDocumentProxy } from '../../supabase/functions/_shared/vendor/unpdf.js';
import { ContractPdf, employmentContractPdf, rentalContractPdf } from './fixtures.ts';

type Result = Awaited<ReturnType<typeof protectPdf>>;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const flat = (s: string) => s.replace(/\s+/g, '');
async function textOf(pdf: Uint8Array) {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: true });
  return String(text);
}
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
