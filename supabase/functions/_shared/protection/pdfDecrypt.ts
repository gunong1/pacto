// 암호가 걸린 PDF — 판별과 "서버 메모리 안에서만" 여는 복호화.
// - 사용자가 입력한 비밀번호로만 연다. 비밀번호 추측·우회는 하지 않는다.
// - 복호화한 PDF는 이 함수가 돌려준 메모리 값으로만 쓰고, 저장소·DB·임시 파일(디스크)·로그에 남기지 않는다.
//   qpdf는 emscripten 메모리 파일 시스템(MEMFS, RAM) 안에서만 읽고 쓰며, 끝나면 그 파일들을 지우고 인스턴스를 버린다.
// - 비밀번호·qpdf 출력은 어디에도 출력하지 않는다 (로그 함수에 넘기지 않음). 결과는 종류 코드만.
// - 표준 보안 방식(Standard: RC4 40/128, AES-128, AES-256 R5·R6)만 지원한다. 인증서(공개키) 방식 등은 unsupported_encryption.
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from '../vendor/pdf-lib.js';
import createQpdf from '../vendor/qpdf.js';
import { QPDF_WASM_BASE64 } from '../vendor/qpdf-wasm.js';

export type EncryptionInfo =
  | { encrypted: false }
  /** standard: 표준 보안 방식인지 (아니면 지원하지 않음) */
  | { encrypted: true; standard: boolean; v: number | null; r: number | null };

/**
 * 암호화 여부와 방식 — 트레일러의 /Encrypt 사전만 본다 (내용은 읽지 않음).
 * 구조를 읽지 못하면 encrypted: false (기존 파이프라인이 unreadable로 처리)
 */
export async function inspectEncryption(bytes: Uint8Array): Promise<EncryptionInfo> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return { encrypted: false };
  }
  if (!doc.isEncrypted) return { encrypted: false };
  const raw = doc.context.trailerInfo.Encrypt;
  const dict = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
  if (!(dict instanceof PDFDict)) return { encrypted: true, standard: false, v: null, r: null };
  const filter = dict.get(PDFName.of('Filter'));
  const num = (k: string) => {
    const n = dict.get(PDFName.of(k));
    return n instanceof PDFNumber ? n.asNumber() : null;
  };
  const v = num('V');
  const r = num('R');
  const standard = filter instanceof PDFName && filter.decodeText() === 'Standard' && r != null && r >= 2 && r <= 6;
  return { encrypted: true, standard, v, r };
}

export type DecryptResult =
  /** 열었음 — bytes는 메모리에서만 쓰고 버릴 것. needsPassword: 원본을 여는 데 비밀번호가 필요한지 (소유자 비밀번호만 걸린 문서는 false) */
  | { kind: 'ok'; bytes: Uint8Array; needsPassword: boolean }
  /** 비밀번호가 필요한데 받지 못함 */
  | { kind: 'password_required' }
  /** 받은 비밀번호가 맞지 않음 */
  | { kind: 'invalid_password' }
  /** 이 엔진이 열 수 없는 보안 방식 */
  | { kind: 'unsupported_encryption' }
  /** 그 밖의 오류 (손상 등) */
  | { kind: 'error' };

let wasmUrl: string | null = null;
const wasmDataUrl = () => (wasmUrl ??= `data:application/wasm;base64,${QPDF_WASM_BASE64}`);

/**
 * qpdf 한 번 실행 (새 인스턴스 · 메모리 파일 시스템). 종료 코드: 0 성공 · 2 오류(비밀번호 필요·틀림 포함) · 3 경고.
 * qpdf 메시지는 번들에서 콘솔 대신 globalThis.__pactoQpdfSink로만 나온다 — callMain은 동기라 그동안만 이 호출의 지역 배열로 받고 곧바로 해제한다.
 * 메시지는 판정에만 쓰고 어디에도 출력·저장하지 않는다.
 */
async function runQpdf(input: Uint8Array, password: string | null): Promise<{ rc: number; out: Uint8Array | null; messages: string }> {
  const q = await createQpdf({ noInitialRun: true, locateFile: wasmDataUrl });
  const lines: string[] = [];
  const g = globalThis as { __pactoQpdfSink?: (s: string) => void };
  try {
    q.FS.writeFile('/in.pdf', input);
    let rc: number;
    g.__pactoQpdfSink = (s) => lines.push(s);
    try {
      // 비밀번호는 qpdf 인자로만 (메모리). 없으면 넘기지 않는다 → 소유자 비밀번호만 걸린 문서는 그대로 열림
      rc = q.callMain([...(password ? [`--password=${password}`] : []), '--decrypt', '/in.pdf', '/out.pdf']);
    } catch (e) {
      rc = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : 2;
    } finally {
      delete g.__pactoQpdfSink;
    }
    let out: Uint8Array | null = null;
    if (rc === 0 || rc === 3) {
      try {
        out = q.FS.readFile('/out.pdf').slice();
      } catch {
        out = null;
      }
    }
    return { rc, out, messages: lines.join('\n') };
  } finally {
    for (const p of ['/in.pdf', '/out.pdf']) {
      try {
        q.FS.unlink(p);
      } catch {
        // 없음
      }
    }
  }
}

/**
 * 암호 PDF를 메모리에서 연다. 원본 bytes는 바꾸지 않는다.
 * 먼저 비밀번호 없이 시도한다 (소유자 비밀번호만 걸린 문서는 묻지 않고 연다). 그다음 받은 비밀번호로.
 */
export async function decryptPdf(bytes: Uint8Array, password: string | null, info?: EncryptionInfo): Promise<DecryptResult> {
  const enc = info ?? (await inspectEncryption(bytes));
  if (!enc.encrypted) return { kind: 'ok', bytes, needsPassword: false };
  if (!enc.standard) return { kind: 'unsupported_encryption' };
  const classify = (r: { out: Uint8Array | null; messages: string }, withPassword: boolean): DecryptResult => {
    if (r.out && r.out.byteLength > 0) return { kind: 'ok', bytes: r.out, needsPassword: withPassword };
    if (/invalid password/i.test(r.messages)) return withPassword ? { kind: 'invalid_password' } : { kind: 'password_required' };
    if (/unsupported|not supported|unknown (security|encryption)|public[- ]key|security handler/i.test(r.messages)) return { kind: 'unsupported_encryption' };
    return { kind: 'error' };
  };
  const open = classify(await runQpdf(bytes, null), false);
  if (open.kind !== 'password_required' || !password) return open;
  return classify(await runQpdf(bytes, password), true);
}

/** 비밀번호 입력값 확인 (형식만): 1~128자, 줄바꿈 없음 — 내용은 보지 않는다 */
export function acceptablePassword(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= 128 && !/[\r\n\0]/.test(v);
}
