/**
 * 분석 대상 페이지 선택 Golden (보호 단계, 실제 PDF 처리) — 모든 값은 가짜, OCR은 가짜(fixture)
 *
 * 실제 사례 구조: 1쪽 = 계약서 스캔(보호 성공) · 2쪽 = 글자를 거의 읽을 수 없는 메모 스캔(low_ocr_quality)
 * - 선택 없음 → 문서 unreadable (2쪽 때문에 전체 차단), 페이지별 결과·글자 인식 품질(숫자만) 기록
 * - 사용자가 2쪽을 빼면 → 남은 1쪽만으로 보호·검증, 보호본은 1쪽만 · 2쪽은 OCR에도 보내지 않음
 * - 모든 페이지를 빼면 → no_pages_selected (보호·분석 안 함)
 * - 원본 PDF는 바뀌지 않음 · 사용자 가림 선택(region key)은 원본 페이지 번호로 유지
 * 실행: npm run test:protection
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, describe, test } from 'node:test';

import type { RgbImage } from '../../supabase/functions/_shared/protection/imageRedact.ts';
import { protectPdf, protectPdfSelected, protectPdfWithPolicy } from '../../supabase/functions/_shared/protection/protect.ts';
import { subsetPdf } from '../../supabase/functions/_shared/protection/pageSelection.ts';
import { PDFDocument } from '../../supabase/functions/_shared/vendor/pdf-lib.js';
import { extractText, getDocumentProxy } from '../../supabase/functions/_shared/vendor/unpdf.js';
import { PDFJS_OPTIONS } from '../../supabase/functions/_shared/protection/cmap.ts';
import { ContractPdf } from './fixtures.ts';
import { FakeOcr, buildPdf, jpegOf, leaseUpright, localRunner, type PageSpec } from './scanFixtures.ts';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
async function textOf(pdf: Uint8Array) {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf), PDFJS_OPTIONS as never), { mergePages: true });
  return String(text);
}
/** OCR이 본 이미지 크기 비율 기록 (어떤 페이지를 OCR에 보냈는지) */
class RecordingOcr extends FakeOcr {
  ratios: number[] = [];
  override async recognize(image: Parameters<FakeOcr['recognize']>[0]) {
    this.ratios.push(Math.round((image.height / image.width) * 100) / 100);
    return await super.recognize(image);
  }
}

describe('정상 1쪽 + 읽기 어려운 2쪽', () => {
  let U: RgbImage;
  let contractScan: PageSpec;
  let memoScan: PageSpec;
  let pdf: Uint8Array;
  before(async () => {
    U = await leaseUpright();
    contractScan = { size: [595, 842], image: { bytes: jpegOf(U), width: U.width, height: U.height } };
    // 글자가 거의 없는 메모 (가짜 OCR이 글자를 찾지 못하는 정사각형 이미지)
    const memo: RgbImage = { width: 800, height: 800, data: new Uint8Array(800 * 800 * 4).fill(245) };
    memoScan = { size: [595, 595], image: { bytes: jpegOf(memo), width: 800, height: 800 } };
    pdf = await buildPdf([contractScan, memoScan]);
  });

  test('1. 선택 없음 → 문서 unreadable · 1쪽 protected · 2쪽 unreadable(low_ocr_quality) · 보호본 없음 · 품질 숫자 기록', async () => {
    const r = await protectPdf(pdf, new Map(), {}, { scan: localRunner(new FakeOcr()) });
    assert.equal(r.status, 'unreadable');
    assert.equal(r.protectedPdf, null);
    assert.deepEqual(r.pages.map((p) => [p.page, p.status, p.detail]), [[1, 'protected', null], [2, 'unreadable', 'low_ocr_quality']]);
    // C: 실패 원인 — 숫자·코드만 (원문 없음)
    assert.deepEqual(r.pages[1].quality, { chars: 0, meanConfidence: null, lowConfidenceRatio: null, reason: 'too_few_chars' });
    assert.equal(r.pages[0].quality?.reason, null);
    assert.ok((r.pages[0].quality?.chars ?? 0) >= 40);
    assert.ok(!JSON.stringify(r.pages).match(/\d{6}-\d{7}/), '페이지 기록에 원문 없음');
  });

  test('2. 사용자가 2쪽을 빼면 → protected · 보호본은 1쪽만 · 2쪽은 OCR에 보내지 않음 · 페이지 번호는 원본 기준', async () => {
    const before = sha(pdf);
    const ocr = new RecordingOcr();
    const r = await protectPdfSelected(pdf, [2], new Map(), {}, { scan: localRunner(ocr) });
    assert.equal(r.status, 'protected', String(r.detail));
    assert.deepEqual(r.viewPages, [1]);
    assert.equal(r.pageCount, 2);
    assert.deepEqual(r.pages.map((p) => [p.page, p.kind, p.status]), [[1, 'scan', 'protected'], [2, 'excluded', 'excluded']]);
    assert.ok(r.regions.length > 0 && r.regions.every((x) => x.page === 1 && x.key.startsWith('p1:')));
    const out = await PDFDocument.load(r.protectedPdf!);
    assert.equal(out.getPageCount(), 1);
    // 2쪽(정사각형 메모)은 OCR에 한 번도 가지 않음
    assert.ok(ocr.ratios.length > 0 && ocr.ratios.every((x) => x !== 1), String(ocr.ratios));
    // 원본 PDF 보존
    assert.equal(sha(pdf), before);
  });

  test('3. 정상 페이지까지 모두 빼면 → no_pages_selected (보호·OCR 없음)', async () => {
    const run = localRunner(new FakeOcr());
    const r = await protectPdfSelected(pdf, [1, 2], new Map(), {}, { scan: run });
    assert.equal(r.detail, 'no_pages_selected');
    assert.equal(r.protectedPdf, null);
    assert.equal(run.jobs, 0);
    assert.equal((await protectPdfSelected(pdf, [3], new Map(), {}, { scan: run })).detail, 'selection_invalid');
  });

  test('4. 읽지 못한 쪽이 1쪽이고 계약서가 2쪽 → 1쪽을 빼면 남은 페이지·가림 선택(region key)이 원본 번호(p2:)로 유지', async () => {
    const pdf2 = await buildPdf([memoScan, contractScan]);
    const first = await protectPdfSelected(pdf2, [1], new Map(), {}, { scan: localRunner(new FakeOcr()) });
    assert.equal(first.status, 'protected', String(first.detail));
    assert.ok(first.regions.every((x) => x.page === 2 && x.key.startsWith('p2:')));
    // 사용자가 한 영역의 가림을 해제한 뒤 다시 처리해도 같은 영역(원본 번호)에 적용
    const k = first.regions[0].key;
    const again = await protectPdfSelected(pdf2, [1], new Map([[k, 'unmasked' as const]]), {}, { scan: localRunner(new FakeOcr()) });
    assert.equal(again.regions.find((x) => x.key === k)?.state, 'unmasked');
  });

  test('5. 텍스트 + 이미지 혼합: 텍스트 계약서 1쪽 + 읽기 어려운 스캔 2쪽 → 2쪽을 빼면 텍스트만 보호 (2쪽 OCR 없음)', async () => {
    const c = await ContractPdf.create();
    await c.page(['임대차계약서', '임차인: 박지훈', '주민등록번호: 901225-1234567']);
    const mixed = await buildPdf([memoScan], undefined, c.doc);
    const run = localRunner(new FakeOcr());
    const all = await protectPdf(mixed, new Map(), {}, { scan: run });
    assert.equal(all.status, 'unreadable');
    const run2 = localRunner(new FakeOcr());
    const r = await protectPdfSelected(mixed, [2], new Map(), {}, { scan: run2 });
    assert.equal(r.status, 'protected', String(r.detail));
    assert.equal(run2.jobs, 0);
    assert.deepEqual(r.pages.map((p) => [p.page, p.kind, p.status]), [[1, 'text', 'protected'], [2, 'excluded', 'excluded']]);
    const text = await textOf(r.protectedPdf!);
    assert.ok(text.includes('임대차계약서'));
    assert.ok(!text.includes('1234567'));
  });

  test('7. 자동 제외(공통 정책): 정상 1쪽 + 읽지 못한 2쪽 → 2쪽만 자동으로 빼고 protected · 보호본 1쪽 · 자동/직접 구분 · 품질 숫자 유지 · 원본 그대로', async () => {
    const before = sha(pdf);
    const r = await protectPdfWithPolicy(pdf, { userExcluded: [] }, new Map(), {}, { scan: localRunner(new FakeOcr()) });
    assert.equal(r.status, 'protected', String(r.detail));
    assert.deepEqual(r.autoExcluded, [2]);
    assert.deepEqual(r.viewPages, [1]);
    assert.deepEqual(r.pages.map((p) => [p.page, p.status, p.detail]), [[1, 'protected', null], [2, 'excluded', 'auto_unreadable']]);
    assert.equal(r.pages[1].quality?.reason, 'too_few_chars');
    assert.equal((await PDFDocument.load(r.protectedPdf!)).getPageCount(), 1);
    assert.equal(sha(pdf), before);
  });

  test('8. 모든 페이지를 읽지 못하면 자동 제외하지 않음 → 문서 unreadable 그대로 (분석 중단)', async () => {
    const allMemo = await buildPdf([memoScan, memoScan]);
    const r = await protectPdfWithPolicy(allMemo, { userExcluded: [] }, new Map(), {}, { scan: localRunner(new FakeOcr()) });
    assert.equal(r.status, 'unreadable');
    assert.deepEqual(r.autoExcluded, []);
    assert.equal(r.protectedPdf, null);
  });

  test('9. 사용자 제외 + 자동 제외 함께: 사용자가 1쪽을 빼고, 읽지 못한 3쪽은 자동 → 2쪽만 보호 · 표시 구분', async () => {
    const three = await buildPdf([contractScan, contractScan, memoScan]);
    const r = await protectPdfWithPolicy(three, { userExcluded: [1] }, new Map(), {}, { scan: localRunner(new FakeOcr()) });
    assert.equal(r.status, 'protected', String(r.detail));
    assert.deepEqual(r.autoExcluded, [3]);
    assert.deepEqual(r.viewPages, [2]);
    assert.deepEqual(r.pages.map((p) => [p.page, p.status, p.detail]), [[1, 'excluded', 'user'], [2, 'protected', null], [3, 'excluded', 'auto_unreadable']]);
  });

  test('6. 남은 페이지에 민감정보가 없으면 no_sensitive_data · 보호본 없음 (분석은 남은 페이지만 메모리에서 잘라 보냄)', async () => {
    const c = await ContractPdf.create();
    await c.page(['헬스장 1년권 계약서', '1년 회원권 660,000원']);
    await c.page(['메모: 연락처 010-1234-5678']);
    const two = await c.doc.save();
    const r = await protectPdfSelected(two, [2], new Map(), {}, { scan: localRunner(new FakeOcr()) });
    assert.equal(r.status, 'no_sensitive_data');
    assert.equal(r.protectedPdf, null);
    assert.equal(r.viewPages, null);
    // 분석에 보내는 사본(메모리) — 2쪽 내용이 없다
    const sent = await subsetPdf(two, [1]);
    assert.equal((await PDFDocument.load(sent)).getPageCount(), 1);
    const t = await textOf(sent);
    assert.ok(t.includes('헬스장'));
    assert.ok(!t.includes('010-1234-5678') && !t.includes('메모'));
  });
});
