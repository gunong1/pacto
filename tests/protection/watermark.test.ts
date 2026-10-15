/**
 * 기울어진 글자(대각선 워터마크) · 반복 값 · 이미 가려진 값 · 페이지별 실패 표시 — 2026-10 보험계약서 실패 회귀
 *
 * 원인: 32° 기울어진 "TEST DOCUMENT" 워터마크 글자가 같은 높이의 가로 줄에 섞여 "010-0000-S4826T"처럼 값이 깨졌고,
 *   같은 번호가 다른 칸에도 있어 원본 대조(값 종류 비교)에서도 놓친 것이 드러나지 않았다 → 보호본 검증에서 원문 발견 →
 *   verification_failed. 이때 문제없는 2~4쪽까지 모두 "보호 처리 실패"로 표시됐다.
 * 실행: npm run test:protection
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { PDFJS_OPTIONS } from '../../supabase/functions/_shared/protection/cmap.ts';
import { buildLines, protectPdf } from '../../supabase/functions/_shared/protection/protect.ts';
import { extractPage, type StreamEntry } from '../../supabase/functions/_shared/protection/pdfEngine.ts';
import { countPreMasked } from '../../supabase/functions/_shared/protection/sensitive.ts';
import { PDFDocument } from '../../supabase/functions/_shared/vendor/pdf-lib.js';
import { extractText, getDocumentProxy } from '../../supabase/functions/_shared/vendor/unpdf.js';
import { ContractPdf } from './fixtures.ts';

const numericFlat = (s: string) => s.replace(/[\s\-.]/g, '');
async function pageTexts(pdf: Uint8Array): Promise<string[]> {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf), PDFJS_OPTIONS as never), { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map(String);
}
const statuses = (r: Awaited<ReturnType<typeof protectPdf>>) => r.pages.map((p) => `${p.page}:${p.status}${p.stage ? `@${p.stage}` : ''}`);

/** 대각선 워터마크 — 표의 전화번호 줄을 가로지르도록 32° 기울여 크게 쓴다 */
async function watermark(c: ContractPdf, page: ReturnType<PDFDocument['addPage']>, x: number, y: number, angle = 32, size = 64) {
  // 글자를 하나씩 기울어진 기준선을 따라 그린다 (테스트 글꼴에 공백 글리프가 없을 수 있음)
  const rad = (angle * Math.PI) / 180;
  let d = 0;
  for (const ch of 'TEST DOCUMENT') {
    if (ch === ' ') {
      d += size * 0.3;
      continue;
    }
    const font = await c.font(ch);
    page.drawText(ch, { x: x + d * Math.cos(rad), y: y + d * Math.sin(rad), size, font, rotate: { type: 'degrees', angle } as never });
    d += font.widthOfTextAtSize(ch, size);
  }
}

describe('기울어진 워터마크가 가로 줄에 섞이지 않음', () => {
  test('줄 조립: 워터마크 글자는 따로, 전화번호 줄은 값 그대로', async () => {
    const c = await ContractPdf.create();
    const page = await c.page(['보험계약 관계인', '휴대전화 010-1234-5678 010-1234-5678 010-9876-5432', '보험료 월 89,700원 매월 25일']);
    await watermark(c, page, 60, 560);
    const doc = await PDFDocument.load(await c.save());
    const lines = buildLines(extractPage(doc, 0, new Map<string, StreamEntry>()));
    const phoneLine = lines.find((l) => l.text.startsWith('휴대전화'));
    assert.equal(phoneLine?.text, '휴대전화 010-1234-5678 010-1234-5678 010-9876-5432');
    assert.ok(lines.some((l) => l.text.replace(/\s/g, '') === 'TESTDOCUMENT'), '워터마크는 한 줄로 따로 읽힌다');
  });

  test('보호: 반복된 같은 번호 두 칸 + 다른 번호 모두 가림 → protected, 보호본에 원문 없음', async () => {
    const c = await ContractPdf.create();
    const p1 = await c.page(['보험계약 관계인', '휴대전화 010-1234-5678 010-1234-5678 010-9876-5432', '보험료 월 89,700원 매월 25일']);
    await watermark(c, p1, 60, 560);
    const p2 = await c.page(['보장 내역', '일반상해 사망 5,000만원', '보험기간 2026년 11월 1일 ~ 2046년 10월 31일']);
    await watermark(c, p2, 60, 560);
    const r = await protectPdf(await c.save());
    assert.equal(r.status, 'protected', JSON.stringify(r.diagnostics));
    assert.equal(r.regions.filter((x) => x.type === 'phone').length, 3);
    assert.deepEqual(statuses(r), ['1:protected', '2:no_sensitive_data']);
    const out = await pageTexts(r.protectedPdf!);
    for (const v of ['01012345678', '01098765432']) assert.ok(!numericFlat(out.join('\n')).includes(v), '보호본에 전화번호가 남지 않음');
    assert.ok(out[0].includes('89,700원') && out[1].includes('2046년 10월 31일'), '계약 정보는 그대로');
  });
});

describe('원본 대조: 같은 값이 여러 칸에 있을 때 일부만 놓쳐도 탐지 단계에서 멈춘다', () => {
  test('개수 비교 — 놓친 페이지만 실패(@detect), 다른 페이지는 처리하지 않음(skipped)', async () => {
    const c = await ContractPdf.create();
    await c.page(['보험계약 관계인', '계약자 휴대전화 010-1234-5678', '피보험자 휴대전화 010-1234-5678']);
    await c.page(['보장 내역', '월 보험료 89,700원']);
    // 1쪽 두 번째 전화번호만 놓침 — 같은 값이 다른 칸에 있어 값 종류만 비교하면 드러나지 않는다
    const r = await protectPdf(await c.save(), new Map(), { missDetection: (t, page, n) => t === 'phone' && page === 1 && n === 1 });
    assert.equal(r.status, 'failed');
    assert.equal(r.detail, 'text_mismatch');
    assert.equal(r.diagnostics.failureStage, 'detect');
    assert.deepEqual(statuses(r), ['1:failed@detect', '2:skipped']);
    assert.equal(r.protectedPdf, null);
  });

  test('한 번만 나오는 전화번호(Level 2)를 놓쳐도 protected가 되지 않음 — 예전에는 Level 1만 대조해 원문이 남은 채 protected', async () => {
    const c = await ContractPdf.create();
    await c.page(['근로계약서', '주민등록번호: 901225-1234567', '비상연락처 휴대전화 010-5555-7777']);
    const r = await protectPdf(await c.save(), new Map(), { missDetection: (t) => t === 'phone' });
    assert.equal(r.status, 'failed');
    assert.equal(r.detail, 'text_mismatch');
    assert.equal(r.protectedPdf, null);
  });
});

describe('페이지별 실패 표시 — 실패한 페이지만 실패, 나머지는 실제 결과', () => {
  test('2쪽 전화번호를 일부러 지우지 않으면 2쪽만 failed@verify, 1쪽은 protected, 3쪽은 no_sensitive_data', async () => {
    const c = await ContractPdf.create();
    await c.page(['근로계약서', '주민등록번호: 901225-1234567']);
    await c.page(['비상 연락처', '휴대전화: 010-2222-3333']);
    await c.page(['근로조건', '월 급여 3,000,000원 매월 25일 지급']);
    const r = await protectPdf(await c.save(), new Map(), { skipRemovalFor: (t) => t === 'phone' });
    assert.equal(r.status, 'failed');
    assert.equal(r.detail, 'verification_failed');
    assert.equal(r.protectedPdf, null, '실패하면 보호본을 내보내지 않는다 (AI 분석 없음)');
    assert.deepEqual(statuses(r), ['1:protected', '2:failed@verify', '3:no_sensitive_data']);
  });
});

describe('이미 가려진 값 (900101-1****** 등)', () => {
  test('개수만 센다 — 날짜·금액·장식 별표는 세지 않음', () => {
    assert.equal(countPreMasked('주민등록번호 900101-1****** 900101-1****** 920303-2******'), 3);
    assert.equal(countPreMasked('010-****-1234 / ****-****-****-1234'), 2);
    assert.equal(countPreMasked('보증금 5,000만원 · 2026-10-16 *** · ***** 강조 *****'), 0);
  });

  test('이미 가려진 값만 있으면 no_sensitive_data + preMasked 개수 (복원·추정하지 않음)', async () => {
    const c = await ContractPdf.create();
    await c.page(['보험계약 관계인', '주민등록번호 (모의) 900101-1****** 920303-2******', '월 보험료 89,700원']);
    const r = await protectPdf(await c.save());
    assert.equal(r.status, 'no_sensitive_data');
    assert.equal(r.regions.length, 0);
    assert.equal(r.pages[0].status, 'no_sensitive_data');
    assert.equal(r.pages[0].preMasked, 2);
  });
});

describe('실제 재현 문서: 4쪽 모의 보험계약서 (tests/protection/samples)', () => {
  const file = path.join(import.meta.dirname, 'samples/insurance-mock-4p.pdf');
  test('4쪽 모두 처리 · 전화번호 3·계좌번호 1 가림 · 1쪽 이미 가려진 주민번호 3 · 계약 정보 유지', async () => {
    const r = await protectPdf(new Uint8Array(fs.readFileSync(file)));
    assert.equal(r.status, 'protected', JSON.stringify({ detail: r.detail, stage: r.diagnostics.failureStage }));
    assert.equal(r.pageCount, 4);
    assert.ok(r.pages.every((p) => p.status === 'protected' || p.status === 'no_sensitive_data'), statuses(r).join(','));
    const count = (t: string) => r.regions.filter((x) => x.type === t).length;
    assert.deepEqual([count('phone'), count('bank_account'), count('resident_registration_number')], [3, 1, 0]);
    assert.equal(r.pages[0].preMasked, 3);
    const out = await pageTexts(r.protectedPdf!);
    const all = numericFlat(out.join('\n'));
    for (const v of ['01000004826', '01000007731', '00000000000000']) assert.ok(!all.includes(v), '보호본에 원문 없음');
    for (const s of ['89,700원', '매월 25일', '2046년 10월 31일', '테스트 위험조항 F']) assert.ok(out.join('\n').includes(s), `계약 정보 유지: ${s}`);
  });
});
