/*
 * 암호 PDF (Edge Function protect-document · analyze-contract · Deno · qpdf WASM · mock AI) — 모든 값은 가짜
 * 원본(암호)은 그대로 보관 · 복호화 사본은 서버 메모리에서만 · 보호본(민감정보 제거, 암호 없음)을 AI 분석에 사용
 * 비밀번호는 요청 body로만, DB·저장소에 남지 않음
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { PactoSupabase } from '@/data/supabase/client';
import { SupabaseAIProvider } from '@/data/supabase/SupabaseAIProvider';
import { SupabaseDocumentStore } from '@/data/supabase/SupabaseDocumentStore';
import type { PreparedFile } from '@/data/supabase/prepareFile';
import { SupabaseAuthService } from '@/features/auth/authService';

import { adminClient, newUser, testFetch } from './helpers';

jest.setTimeout(240_000);

const ROOT = path.resolve(__dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pacto-enc-'));
const cli = (...args: string[]) => execFileSync('node', ['--experimental-strip-types', '--no-warnings', path.join(ROOT, 'tests/protection/cli.ts'), ...args], { cwd: ROOT, encoding: 'utf8' });
/** 테스트 PDF → (암호) */
function fixture(kind: 'employment' | 'rental' | 'clean', enc?: { mode: 'aes256' | 'aes128' | 'rc4_128'; user: string } | 'pubsec'): Uint8Array {
  const plain = path.join(tmp, `${kind}.pdf`);
  if (!fs.existsSync(plain)) cli('make', kind, plain);
  if (!enc) return new Uint8Array(fs.readFileSync(plain));
  const out = path.join(tmp, `${randomUUID()}.pdf`);
  if (enc === 'pubsec') cli('pubsec', plain, out);
  else cli('encrypt', plain, enc.mode, enc.user, out);
  return new Uint8Array(fs.readFileSync(out));
}
const textOf = (bytes: Uint8Array) => {
  const f = path.join(tmp, `${randomUUID()}.pdf`);
  fs.writeFileSync(f, bytes);
  return cli('text', f).replace(/\s+/g, '');
};
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const hasEncrypt = (b: Uint8Array) => Buffer.from(b).includes('/Encrypt');
const store = (client: PactoSupabase, bytes: Uint8Array) =>
  new SupabaseDocumentStore(client, async (): Promise<PreparedFile> => ({ bytes: bytes.slice().buffer, mimeType: 'application/pdf', ext: 'pdf' }), () => randomUUID());
const file = (name: string) => ({ name, uri: `file:///${name}`, mimeType: 'application/pdf', size: 100 });
const download = async (url: string) => new Uint8Array(await (await testFetch(url)).arrayBuffer());
const today = '2026-10-10';
/** 이 테스트에서 쓴 비밀번호 — DB·저장소 검사용 */
const PASSWORDS = ['pw-Enc-1234', 'Ab1!@#$%^&*()_+계약 비번', 'clean-pw-77'];

async function setup(prefix: string, bytes: Uint8Array, name = '근로계약서.pdf') {
  const a = await newUser(prefix);
  const docs = store(a.client, bytes);
  const ai = new SupabaseAIProvider(a.client);
  await ai.grantConsent();
  const up = await docs.upload(file(name));
  return { a, docs, ai, up };
}
const row = async (id: string) => (await adminClient().from('contract_documents').select('protection_status, protection_detail, access_status').eq('id', id).single()).data!;
const jobs = async (userId: string) => (await adminClient().from('analysis_jobs').select('id, raw_output').eq('user_id', userId)).data ?? [];

describe('Step 16 — 암호 PDF', () => {
  test('A. 비밀번호 없는 PDF → 기존과 동일 (accessible · AI에는 원본)', async () => {
    const original = fixture('employment');
    const { a, docs, ai, up } = await setup('enc-a', original);
    expect(await docs.protect(up.id)).toEqual({ status: 'protected', detail: null, access: 'accessible' });
    expect((await row(up.id)).access_status).toBe('accessible');
    const out = await ai.analyze({ files: [], documentIds: [up.id], today });
    expect(out.validation.decision).toBe('proceed');
    const [job] = await jobs(a.user.id);
    expect((job.raw_output as { _mock_input: { sha256: string }[] })._mock_input[0].sha256).toBe(sha(original));
  });

  test('B·E. 비밀번호 PDF: 없음 → password_required(분석 안 함) / 맞음 → 보호본(암호 없음·민감정보 제거) · 원본은 암호 그대로 · AI에는 보호본', async () => {
    const original = fixture('employment', { mode: 'aes256', user: PASSWORDS[0] });
    const { a, docs, ai, up } = await setup('enc-b', original);

    expect(await docs.protect(up.id)).toEqual({ status: 'pending', detail: null, access: 'password_required' });
    expect(await row(up.id)).toEqual({ protection_status: 'pending', protection_detail: null, access_status: 'password_required' });
    // 보호 전에는 AI 분석을 시작하지 않는다 (작업도 만들지 않음)
    await expect(ai.analyze({ files: [], documentIds: [up.id], today })).rejects.toThrow('민감정보 보호를 마치지 못한');
    expect(await jobs(a.user.id)).toEqual([]);

    expect(await docs.protect(up.id, undefined, { password: PASSWORDS[0] })).toEqual({ status: 'protected', detail: null, access: 'password_required' });
    expect(await row(up.id)).toMatchObject({ protection_status: 'protected', access_status: 'password_required' });
    const prot = (await docs.getProtection([up.id]))[up.id];
    expect(prot.access).toBe('password_required');
    expect(prot.regions.map((r) => r.type)).toEqual(['resident_registration_number', 'phone', 'email']);

    // E. 보호본: 비밀번호 없이 열림(암호 없음) · 주민번호·전화·이메일 없음 · 날짜·금액은 그대로
    const view = await download(await docs.openUrl({ ...up, protection: prot }, 'protected_view'));
    expect(hasEncrypt(view)).toBe(false);
    const viewText = textOf(view);
    for (const s of ['901225-1234567', '1234567', '010-1234-5678', 'minjun@example.com']) expect(viewText).not.toContain(s);
    for (const k of ['2026년10월1일', '2027년9월30일', '3,600,000원', '매월25일']) expect(viewText).toContain(k);

    // 원본: 암호 상태 그대로 (덮어쓰지 않음)
    const orig = await download(await docs.openUrl(up, 'original'));
    expect(sha(orig)).toBe(sha(original));
    expect(hasEncrypt(orig)).toBe(true);

    // AI 입력 = 보호본 (원본·복호화 사본이 아님)
    const out = await ai.analyze({ files: [], documentIds: [up.id], today });
    expect(out.validation.decision).toBe('proceed');
    const [job] = await jobs(a.user.id);
    const input = (job.raw_output as { _mock_input: { sha256: string; encrypted: boolean }[] })._mock_input;
    expect(input).toEqual([{ sha256: sha(view), encrypted: false, mimeType: 'application/pdf' }]);
    expect(input[0].sha256).not.toBe(sha(original));

    // 저장소: 원본 + 보호본만 (복호화 사본 없음)
    const listed = (await adminClient().storage.from('contract-files').list(a.user.id)).data!.map((o) => o.name).sort();
    expect(listed).toEqual([`${up.id}.pdf`, `${up.id}.protected_view.pdf`].sort());
  });

  test('C·H. 틀린 비밀번호 → invalid_password (보호·분석 시작 안 함) · 여러 번 틀려도 오류 없음 · 상태는 저장 안 함', async () => {
    const original = fixture('rental', { mode: 'aes128', user: PASSWORDS[0] });
    const { a, docs, ai, up } = await setup('enc-c', original);
    for (let i = 0; i < 4; i++) expect(await docs.protect(up.id, undefined, { password: `wrong-${i}` })).toEqual({ status: 'pending', detail: null, access: 'invalid_password' });
    expect(await row(up.id)).toEqual({ protection_status: 'pending', protection_detail: null, access_status: 'password_required' });
    await expect(ai.analyze({ files: [], documentIds: [up.id], today, passwords: { [up.id]: 'wrong-x' } })).rejects.toThrow();
    expect(await jobs(a.user.id)).toEqual([]);
    expect((await docs.protect(up.id, undefined, { password: PASSWORDS[0] })).status).toBe('protected');
  });

  test('D. 비밀번호 입력 전 등록 취소 → 원본 삭제 (계약 미등록, 고아 파일 없음)', async () => {
    const { a, docs, up } = await setup('enc-d', fixture('employment', { mode: 'aes256', user: PASSWORDS[0] }));
    expect((await docs.protect(up.id)).access).toBe('password_required');
    await docs.discard([up.id]);
    expect((await adminClient().from('contract_documents').select('id').eq('id', up.id)).data).toEqual([]);
    expect((await adminClient().storage.from('contract-files').list(a.user.id)).data).toEqual([]);
  });

  test('G. 한글·영문·숫자·특수문자 비밀번호 (AES-256)', async () => {
    const { docs, up } = await setup('enc-g', fixture('employment', { mode: 'aes256', user: PASSWORDS[1] }));
    expect((await docs.protect(up.id, undefined, { password: 'Ab1!@#$%^&*()_+계약비번' })).access).toBe('invalid_password');
    expect((await docs.protect(up.id, undefined, { password: PASSWORDS[1] })).status).toBe('protected');
  });

  test('민감정보 없는 암호 PDF → no_sensitive_data (보호본 없음) · AI에는 서버 메모리 복호화 사본 (비밀번호 필요, 저장 안 함)', async () => {
    const original = fixture('clean', { mode: 'rc4_128', user: PASSWORDS[2] });
    const { a, docs, ai, up } = await setup('enc-n', original, '헬스장.pdf');
    expect(await docs.protect(up.id, undefined, { password: PASSWORDS[2] })).toEqual({ status: 'no_sensitive_data', detail: null, access: 'password_required' });
    // 비밀번호 없이 분석 → 거절 (AI 호출·작업 없음)
    await expect(ai.analyze({ files: [], documentIds: [up.id], today })).rejects.toThrow('비밀번호');
    expect(await jobs(a.user.id)).toEqual([]);
    const out = await ai.analyze({ files: [], documentIds: [up.id], today, passwords: { [up.id]: PASSWORDS[2] } });
    expect(out.validation.decision).toBe('proceed');
    const [job] = await jobs(a.user.id);
    const input = (job.raw_output as { _mock_input: { sha256: string; encrypted: boolean }[] })._mock_input[0];
    expect(input.encrypted).toBe(false);
    expect(input.sha256).not.toBe(sha(original));
    // 저장소: 원본뿐 (복호화 사본·보호본 없음)
    expect((await adminClient().storage.from('contract-files').list(a.user.id)).data!.map((o) => o.name)).toEqual([`${up.id}.pdf`]);
  });

  test('소유자 비밀번호만 걸린 PDF → 비밀번호 묻지 않고 보호 (accessible) · AI에는 보호본', async () => {
    const original = fixture('employment', { mode: 'aes128', user: '-' });
    const { a, docs, ai, up } = await setup('enc-o', original);
    expect(await docs.protect(up.id)).toEqual({ status: 'protected', detail: null, access: 'accessible' });
    await ai.analyze({ files: [], documentIds: [up.id], today });
    const [job] = await jobs(a.user.id);
    expect((job.raw_output as { _mock_input: { encrypted: boolean; sha256: string }[] })._mock_input[0]).toMatchObject({ encrypted: false });
  });

  test('I. 지원하지 않는 보안 방식 → failed(unsupported_encryption) · 분석 거절', async () => {
    const { a, docs, ai, up } = await setup('enc-i', fixture('employment', 'pubsec'));
    expect(await docs.protect(up.id, undefined, { password: 'anything-1' })).toEqual({ status: 'failed', detail: 'unsupported_encryption', access: 'unsupported_encryption' });
    expect(await row(up.id)).toEqual({ protection_status: 'failed', protection_detail: 'unsupported_encryption', access_status: 'unsupported_encryption' });
    await expect(ai.analyze({ files: [], documentIds: [up.id], today })).rejects.toThrow();
    expect(await jobs(a.user.id)).toEqual([]);
  });

  test('K. DB 어디에도 비밀번호 문자열 없음 (모든 공개 테이블 · 분석 작업 원본 출력 포함)', async () => {
    const admin = adminClient();
    const tables = ['contract_documents', 'document_derivatives', 'document_sensitive_regions', 'analysis_jobs', 'contracts', 'profiles'];
    for (const t of tables) {
      const { data, error } = await admin.from(t as never).select('*').limit(1000);
      expect(error).toBeNull();
      const dump = JSON.stringify(data);
      for (const pw of PASSWORDS) expect(dump.includes(pw)).toBe(false);
    }
  });

  test('L. 회원탈퇴 → 암호 원본·보호본·기록 모두 삭제', async () => {
    const { a, docs, up } = await setup('enc-l', fixture('employment', { mode: 'aes256', user: PASSWORDS[0] }));
    await docs.protect(up.id, undefined, { password: PASSWORDS[0] });
    const { data: cid, error } = await a.client.rpc('save_contract', { p_contract: { title: '암호 PDF 계약' }, p_document_ids: [up.id] });
    expect(error).toBeNull();
    expect((await adminClient().storage.from('contract-files').list(a.user.id)).data).toHaveLength(2);
    await new SupabaseAuthService(a.client).deleteAccount();
    const admin = adminClient();
    expect((await admin.from('contracts').select('id').eq('id', cid!)).data).toEqual([]);
    expect((await admin.from('contract_documents').select('id').eq('id', up.id)).data).toEqual([]);
    expect((await admin.from('document_derivatives').select('id').eq('document_id', up.id)).data).toEqual([]);
    expect((await admin.storage.from('contract-files').list(a.user.id)).data).toEqual([]);
  });
});
