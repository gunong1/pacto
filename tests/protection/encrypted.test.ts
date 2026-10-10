/**
 * 암호 PDF — 판별 · 서버 메모리 복호화 (qpdf WASM) · 기존 보호 파이프라인 연결
 * 비밀번호를 우회하지 않는다: 비밀번호 없음 → password_required, 틀림 → invalid_password, 지원 안 하는 방식 → unsupported_encryption
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { decryptPdf, inspectEncryption, acceptablePassword } from '../../supabase/functions/_shared/protection/pdfDecrypt.ts';
import { PDFJS_OPTIONS } from '../../supabase/functions/_shared/protection/cmap.ts';
import { protectPdf } from '../../supabase/functions/_shared/protection/protect.ts';
import { PDFDict, PDFDocument, PDFName, PDFNumber } from '../../supabase/functions/_shared/vendor/pdf-lib.js';
import createQpdf from '../../supabase/functions/_shared/vendor/qpdf.js';
import { QPDF_WASM_BASE64 } from '../../supabase/functions/_shared/vendor/qpdf-wasm.js';
import { extractText, getDocumentProxy } from '../../supabase/functions/_shared/vendor/unpdf.js';
import { employmentContractPdf, rentalContractPdf } from './fixtures.ts';

const DIR = path.join(import.meta.dirname, 'encrypted');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const textOf = async (b: Uint8Array) => String((await extractText(await getDocumentProxy(new Uint8Array(b), PDFJS_OPTIONS as never), { mergePages: true })).text);

type Mode = 'aes256' | 'aes128' | 'rc4_128' | 'rc4_40';
/** 테스트용 암호 PDF 만들기 (qpdf --encrypt). 사용자 비밀번호가 ''이면 소유자 비밀번호만 */
async function encrypt(plain: Uint8Array, user: string, owner: string, mode: Mode): Promise<Uint8Array> {
  const q = await createQpdf({ noInitialRun: true, locateFile: () => `data:application/wasm;base64,${QPDF_WASM_BASE64}` });
  q.FS.writeFile('/p.pdf', plain);
  const opts = mode === 'aes256' ? ['256'] : mode === 'aes128' ? ['128', '--use-aes=y'] : mode === 'rc4_128' ? ['128', '--use-aes=n'] : ['40'];
  const rc = q.callMain([...(mode === 'rc4_40' || mode === 'rc4_128' ? ['--allow-weak-crypto'] : []), '--encrypt', user, owner, ...opts, '--', '/p.pdf', '/e.pdf']);
  assert.ok(rc === 0 || rc === 3, `encrypt rc=${rc}`);
  return q.FS.readFile('/e.pdf').slice();
}

describe('판별', () => {
  test('A. 비밀번호 없는 PDF → 암호 아님 (기존과 동일하게 그대로 사용)', async () => {
    const plain = await employmentContractPdf();
    assert.deepEqual(await inspectEncryption(plain), { encrypted: false });
    const r = await decryptPdf(plain, null);
    assert.equal(r.kind, 'ok');
    if (r.kind === 'ok') assert.equal(r.bytes, plain); // 복사·변환 없음
  });
  for (const mode of ['aes256', 'aes128', 'rc4_128', 'rc4_40'] as const) {
    test(`${mode}: 표준 보안 방식으로 판별`, async () => {
      const enc = await encrypt(await employmentContractPdf(), 'pw1234', 'owner-pw', mode);
      const info = await inspectEncryption(enc);
      assert.equal(info.encrypted, true);
      assert.equal(info.encrypted && info.standard, true);
    });
  }
});

describe('복호화 (서버 메모리)', () => {
  for (const mode of ['aes256', 'aes128', 'rc4_128', 'rc4_40'] as const) {
    test(`B·C. ${mode}: 없음 → password_required / 틀림 → invalid_password / 맞음 → 열림, 원본은 그대로`, async () => {
      const enc = await encrypt(await employmentContractPdf(), 'pw1234', 'owner-pw', mode);
      const before = sha(enc);
      assert.deepEqual(await decryptPdf(enc, null), { kind: 'password_required' });
      assert.deepEqual(await decryptPdf(enc, 'wrong-pw'), { kind: 'invalid_password' });
      const ok = await decryptPdf(enc, 'pw1234');
      assert.equal(ok.kind, 'ok');
      if (ok.kind !== 'ok') return;
      assert.equal(ok.needsPassword, true);
      assert.equal((await inspectEncryption(ok.bytes)).encrypted, false);
      assert.match(await textOf(ok.bytes), /근로계약서/);
      assert.equal(sha(enc), before, '원본 바이트가 바뀌면 안 됨');
    });
  }

  test('G. 한글·영문·숫자·특수문자 비밀번호 (AES-256)', async () => {
    const pw = 'Ab1!@#$%^&*()_+계약 비번';
    const enc = await encrypt(await rentalContractPdf(), pw, 'owner-pw', 'aes256');
    assert.deepEqual(await decryptPdf(enc, 'Ab1!@#$%^&*()_+계약비번'), { kind: 'invalid_password' });
    const ok = await decryptPdf(enc, pw);
    assert.equal(ok.kind, 'ok');
  });

  test('소유자 비밀번호만 걸린 문서 → 비밀번호 없이 열림 (묻지 않음)', async () => {
    const enc = await encrypt(await employmentContractPdf(), '', 'owner-pw', 'aes128');
    const r = await decryptPdf(enc, null);
    assert.equal(r.kind, 'ok');
    if (r.kind === 'ok') assert.equal(r.needsPassword, false);
  });

  test('H. 틀린 비밀번호를 여러 번 → 매번 invalid_password, 오류·예외 없음', async () => {
    const enc = await encrypt(await employmentContractPdf(), 'pw1234', 'owner-pw', 'aes256');
    for (let i = 0; i < 6; i++) assert.deepEqual(await decryptPdf(enc, `wrong-${i}`), { kind: 'invalid_password' });
    assert.equal((await decryptPdf(enc, 'pw1234')).kind, 'ok');
  });

  test('다른 구현(pypdf)으로 만든 암호 PDF도 같은 결과 (AES-256 · RC4-40 · 한글 비밀번호 · 소유자 전용)', async () => {
    const read = (f: string) => new Uint8Array(fs.readFileSync(path.join(DIR, f)));
    for (const f of ['pypdf-aes256.pdf', 'pypdf-rc4-40.pdf']) {
      assert.deepEqual(await decryptPdf(read(f), null), { kind: 'password_required' }, f);
      assert.deepEqual(await decryptPdf(read(f), 'nope'), { kind: 'invalid_password' }, f);
      const ok = await decryptPdf(read(f), 'pw1234');
      assert.equal(ok.kind, 'ok', f);
      if (ok.kind === 'ok') assert.match(await textOf(ok.bytes), /Contract 010-1234-5678/);
    }
    assert.equal((await decryptPdf(read('pypdf-aes256-unicode.pdf'), '계약비번A1!@')).kind, 'ok');
    const owner = await decryptPdf(read('pypdf-owner-only-aes128.pdf'), null);
    assert.equal(owner.kind === 'ok' && owner.needsPassword, false);
  });

  test('I. 지원하지 않는 보안 방식(인증서 /Adobe.PubSec) → unsupported_encryption (우회 시도 없음)', async () => {
    const doc = await PDFDocument.load(await employmentContractPdf());
    const encDict = doc.context.obj({ Filter: PDFName.of('Adobe.PubSec'), V: PDFNumber.of(4), R: PDFNumber.of(4) }) as PDFDict;
    doc.context.trailerInfo.Encrypt = doc.context.register(encDict);
    const bytes = await doc.save({ useObjectStreams: false });
    const info = await inspectEncryption(bytes);
    assert.equal(info.encrypted, true);
    assert.equal(info.encrypted && info.standard, false);
    assert.deepEqual(await decryptPdf(bytes, 'anything'), { kind: 'unsupported_encryption' });
  });

  test('비밀번호 형식 확인 (내용은 보지 않음)', () => {
    assert.equal(acceptablePassword('pw1234'), true);
    assert.equal(acceptablePassword(''), false);
    assert.equal(acceptablePassword('a\nb'), false);
    assert.equal(acceptablePassword('x'.repeat(129)), false);
    assert.equal(acceptablePassword(1234), false);
  });
});

describe('기존 보호 파이프라인 연결 (복호화 사본 → 보호본)', () => {
  test('B·E. 올바른 비밀번호 → 민감정보 제거한 보호본 (암호 없음 · 주민번호·전화·이메일 없음 · 날짜·금액은 남음)', async () => {
    const enc = await encrypt(await employmentContractPdf(), 'pw1234', 'owner-pw', 'aes256');
    const dec = await decryptPdf(enc, 'pw1234');
    assert.equal(dec.kind, 'ok');
    if (dec.kind !== 'ok') return;
    const r = await protectPdf(dec.bytes);
    assert.equal(r.status, 'protected');
    assert.ok(r.protectedPdf);
    assert.equal((await inspectEncryption(r.protectedPdf!)).encrypted, false, '보호본은 비밀번호 없이 열림');
    const text = (await textOf(r.protectedPdf!)).replace(/\s+/g, '');
    for (const secret of ['901225-1234567', '9012251234567', '010-1234-5678', 'minjun@example.com']) assert.ok(!text.includes(secret.replace(/\s+/g, '')), `보호본에 ${secret}`);
    for (const keep of ['2026년10월1일', '2027년9월30일', '3,600,000원', '매월25일']) assert.ok(text.includes(keep), `보호본에 ${keep} 없음`);
  });

  test('계좌번호·카드번호처럼 보이는 값도 보호본(=AI 입력)에서 제거', async () => {
    const enc = await encrypt(await rentalContractPdf(), 'pw1234', 'owner-pw', 'aes128');
    const dec = await decryptPdf(enc, 'pw1234');
    assert.equal(dec.kind, 'ok');
    if (dec.kind !== 'ok') return;
    const r = await protectPdf(dec.bytes);
    assert.equal(r.status, 'protected');
    const text = (await textOf(r.protectedPdf!)).replace(/\s+/g, '');
    assert.ok(!text.includes('123456-01-234567'), '계좌번호');
    assert.ok(text.includes('29,900원') && text.includes('매월10일'));
  });

  test('비밀번호 없이 기존 파이프라인에 넣으면 지금처럼 encrypted로 실패 (복호화 없이 처리하지 않음)', async () => {
    const enc = await encrypt(await employmentContractPdf(), 'pw1234', 'owner-pw', 'aes256');
    const r = await protectPdf(enc);
    assert.equal(r.status, 'failed');
    assert.equal(r.detail, 'encrypted');
  });
});
