// 계약서 자동 정리: 본인 문서 확인 → 비공개 저장소에서 원본 읽기 → AI 1회(문서 확인 + 추출) → 서버 게이트 → 초안 반환
// - "파일을 올렸다"와 "계약서로 인정한다"를 나눈다: 계약이 아니거나 읽을 수 없거나 정보가 부족하면 추출 결과를 보내지 않는다.
//   애매하면 사용자 확인 후에만, 의심 사진 쪽은 사용자가 고른 뒤에만 결과를 보낸다 (POST { jobId, confirmRole, includeFiles, excludeFiles }).
// - 제외한 쪽에서만 근거가 나온 값은 결과에서 지우고, 근거 위치를 알 수 없으면 그 사진을 빼고 다시 분석한다.
// - AI 처리 동의(profiles.ai_processing_agreed_at)가 없으면 거부 (앱이 동의를 받은 뒤 재시도)
// - API 키는 Edge Function secret에만 존재. 계약서 내용·추출 결과는 로그에 남기지 않는다 (id·역할·신뢰도·개수·시간만).
// - AI 전송 게이트 (모든 문서, fail-closed — 규칙은 protection/aiGate.ts 한 곳):
//   protected → 민감정보를 가린 보호본만 / no_sensitive_data → 원본 (암호 PDF는 요청 body의 비밀번호로 서버 메모리에서만 연 사본, 저장·로그 없음)
//   failed·unreadable·unsupported_scan·unsupported_encryption·처리 전 → AI를 부르지 않고 protection_required로 거절 (원본 fallback 없음)
// - AI 원본 응답(raw_output)도 저장 전에 공통 가림 정책으로 가린다 (storableModelOutput)
// - 사용자가 뺀 페이지(contract_documents.analysis_excluded_pages)는 AI 요청에 넣지 않는다 (protection/pageSelection.ts):
//   남은 페이지가 0개면 no_pages_selected, 남은 페이지 중 보호 검증을 통과하지 못한 페이지가 있으면 protection_required.
//   AI는 남은 페이지만 본다 — 결과의 근거 파일·쪽은 앱에 보내기 전에 원본 기준(올린 문서 순서·원본 페이지)으로 바꾼다.
//   분석 기록(validation.selection)에 문서별 제외 페이지·실제 분석한 원본 페이지를 남기고, 선택이 바뀐 뒤에는 예전 분석을 이어 쓰지 않는다
import { finalize, FinalizeError, firstPass } from '../_shared/analysis.ts';
import type { DocumentRole, DocumentValidation, FileKind } from '../_shared/documentGate.ts';
import { selectProvider } from '../_shared/ai/index.ts';
import { ProviderError, type ContractFile, type ExtractionProvider } from '../_shared/ai/types.ts';
import {
  downloadOwnObject,
  getUserId,
  selectDerivatives,
  hasAiConsent,
  insertJob,
  linkDocumentsToJob,
  selectOwnDocuments,
  selectOwnJob,
  toBase64,
  updateDocumentRole,
  updateJob,
  type DocumentRow,
} from '../_shared/admin.ts';
import { corsHeaders, json } from '../_shared/cors.ts';
import { PROMPT_VERSION } from '../_shared/extraction.ts';
import { acceptablePassword, decryptPdf, inspectEncryption } from '../_shared/protection/pdfDecrypt.ts';
import { aiInputPlan } from '../_shared/protection/aiGate.ts';
import {
  planSelection,
  remapPages,
  remapResult,
  selectionChanged,
  selectionRecord,
  subsetPdf,
  toAiFiles,
  type PlannedFile,
  type SelectionDoc,
  type SelectionRecord,
} from '../_shared/protection/pageSelection.ts';
import { storableModelOutput } from '../_shared/protection/sensitive.ts';

const BUCKET = 'contract-files';
const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function todayInSeoul(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 작업에 저장하는 판정 (원문 없음) + 문서 순서 */
type StoredValidation = DocumentValidation & {
  /** AI에 보낸 문서 (AI 파일 순서) */
  documentIds: string[];
  files: FileKind[];
  reanalyzedFrom?: string;
  /** 요청한 문서 (앱 문서 순서) · AI 파일 → 원본 파일·페이지 · 문서별 제외/분석 페이지 (이전 버전 기록에는 없음) */
  requestIds?: string[];
  plan?: PlannedFile[];
  selection?: SelectionRecord[];
};

const selectionDocs = (docs: DocumentRow[]): SelectionDoc[] =>
  docs.map((d) => ({ id: d.id, pdf: d.mime_type === 'application/pdf', excludedPages: d.analysis_excluded_pages ?? [], autoExcludedPages: d.analysis_auto_excluded_pages ?? [], pageCount: d.protection_pages?.length ?? null }));
/** 이전 버전 기록(선택 없음): AI 파일 순서 = 요청 순서, 모든 페이지 */
const planOf = (v: StoredValidation): PlannedFile[] => v.plan ?? v.documentIds.map((documentId, i) => ({ requestFile: i + 1, documentId, pages: null }));

const fileNos = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x) && x >= 1 && x <= MAX_FILES) : []);

/** AI에 보낼 수 없는 문서 — 사용자에게 먼저 안내해야 함 (AI 호출 전에 거절) */
class NotReady extends Error {
  constructor(
    readonly code: 'protection_required' | 'password_required' | 'invalid_password',
    readonly documentId: string,
  ) {
    super(code);
  }
}

/** 문서별 비밀번호 (요청 body) — 문서 id → 비밀번호. 메모리에서만 쓰고 저장·로그하지 않는다 */
type Passwords = ReadonlyMap<string, string>;
function passwordsOf(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, pw] of Object.entries(raw as Record<string, unknown>)) if (UUID.test(id) && acceptablePassword(pw)) out.set(id, pw);
  return out;
}

/**
 * AI에 보낼 파일 — 암호 없는 문서는 지금처럼 원본. 암호 PDF(사용자 비밀번호·소유자 비밀번호 모두)는 원본을 보내지 않는다:
 *   보호됨(protected) → 민감정보를 지운 보호본 / 민감정보 없음(no_sensitive_data) → 메모리 복호화 사본 / 그 밖 → 거절
 * 복호화 사본·보호본은 이 요청 메모리에서만 쓰고 저장하지 않는다.
 */
async function filesFor(userId: string, docs: DocumentRow[], passwords: Passwords, selection: readonly PlannedFile[]): Promise<ContractFile[]> {
  const files: ContractFile[] = [];
  for (const [i, d] of docs.entries()) {
    const fileName = d.original_filename ?? `contract.${d.mime_type === 'application/pdf' ? 'pdf' : 'jpg'}`;
    // 보호 완료면 보호본만 본다 (원본은 읽지 않음). 민감정보 없음이면 원본(암호 PDF면 메모리에서 연 사본)
    const view = d.protection_status === 'protected' ? (await selectDerivatives(userId, d.id)).find((x) => x.kind === 'protected_view') : undefined;
    const original = d.protection_status === 'no_sensitive_data' ? await downloadOwnObject(BUCKET, userId, d.storage_path) : null;
    const enc = original && d.mime_type === 'application/pdf' ? await inspectEncryption(original) : { encrypted: false as const };
    const pages = selection[i]?.pages ?? null;
    const plan = aiInputPlan({
      protectionStatus: d.protection_status,
      encrypted: enc.encrypted,
      hasProtectedView: !!view,
      ...(d.mime_type === 'application/pdf' ? { selection: { pages, viewPages: d.protection_view_pages ?? null, pageStatuses: d.protection_pages ?? null } } : {}),
    });
    if (plan.kind === 'protected_view' && view) {
      // 보호본 형식: PDF는 PDF, 사진·스캔은 가린 JPEG
      const mimeType: ContractFile['mimeType'] = view.storage_path.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
      files.push({ mimeType, fileName, base64: toBase64(await downloadOwnObject(BUCKET, userId, view.storage_path)) });
    } else if (plan.kind === 'original' && original) {
      files.push({ mimeType: d.mime_type as ContractFile['mimeType'], fileName, base64: toBase64(original) });
    } else if (plan.kind === 'original_subset' && original) {
      // 민감정보 없음으로 검증된 남은 페이지만 — 메모리에서 잘라 보낸다 (제외한 페이지·원본 전체는 보내지 않음, 저장하지 않음)
      files.push({ mimeType: 'application/pdf', fileName, base64: toBase64(await subsetPdf(original, plan.pages)) });
    } else if (plan.kind === 'decrypted_subset' && original && enc.encrypted) {
      const r = await decryptPdf(original, passwords.get(d.id) ?? null, enc);
      if (r.kind === 'invalid_password' || r.kind === 'password_required') throw new NotReady(r.kind, d.id);
      if (r.kind !== 'ok') throw new NotReady('protection_required', d.id);
      files.push({ mimeType: 'application/pdf', fileName, base64: toBase64(await subsetPdf(r.bytes, plan.pages)) });
    } else if (plan.kind === 'decrypted_original' && original && enc.encrypted) {
      const r = await decryptPdf(original, passwords.get(d.id) ?? null, enc);
      if (r.kind === 'invalid_password' || r.kind === 'password_required') throw new NotReady(r.kind, d.id);
      if (r.kind !== 'ok') throw new NotReady('protection_required', d.id);
      files.push({ mimeType: 'application/pdf', fileName, base64: toBase64(r.bytes) });
    } else {
      // fail-closed: 보호 실패·읽기 어려움·지원하지 않는 스캔/암호·처리 전 — 원본으로 대신 보내지 않고 AI를 부르지 않는다
      throw new NotReady('protection_required', d.id);
    }
  }
  return files;
}

async function runModel(provider: ExtractionProvider, files: ContractFile[]) {
  return await provider.extract(files, todayInSeoul());
}

/** 문서별 역할 기록: 사진은 그 쪽의 판정, PDF는 문서 전체 판정 */
async function recordRoles(userId: string, docs: DocumentRow[], v: DocumentValidation, pages: { file: number; role: DocumentRole }[], confirmed: (file: number) => boolean) {
  await Promise.all(
    docs.map((d, i) => {
      const file = i + 1;
      const role = d.mime_type === 'application/pdf' ? v.role : (pages.find((p) => p.file === file)?.role ?? v.role);
      return updateDocumentRole(userId, d.id, { document_role: role, role_confirmed_by_user: confirmed(file) });
    }),
  );
}

const pagesOf = (raw: unknown): { file: number; role: DocumentRole }[] => {
  const dc = (raw as { document_check?: { pages?: { file?: number; role?: DocumentRole }[] } })?.document_check;
  return (dc?.pages ?? []).filter((p): p is { file: number; role: DocumentRole } => typeof p.file === 'number' && typeof p.role === 'string');
};

/** 1차: AI 호출 → 판정 → 진행일 때만 결과 */
async function analyze(userId: string, requested: DocumentRow[], provider: ExtractionProvider, passwords: Passwords, carry?: { confirmed: boolean; from: string; excludedFiles: number[] }) {
  const started = Date.now();
  // 사용자가 뺀 페이지·사진을 빼고 AI에 보낼 문서 (모든 페이지를 뺐으면 분석할 수 없다)
  const sel = selectionDocs(requested);
  const selPlan = planSelection(sel);
  if (selPlan.kind === 'error') {
    console.log(`analyze-contract: selection code=${selPlan.code} files=${requested.length}`);
    return json({ error: selPlan.code }, 422);
  }
  const plan = selPlan.files;
  const docs = plan.map((f) => requested[f.requestFile - 1]);
  const files: FileKind[] = docs.map((d, i) => ({ file: i + 1, pdf: d.mime_type === 'application/pdf' }));
  // AI에 보낼 파일을 먼저 준비 — 보낼 수 없는 문서가 있으면 작업을 만들지 않고 알린다 (문서 id·코드만)
  let input: ContractFile[];
  try {
    input = await filesFor(userId, docs, passwords, plan);
  } catch (e) {
    if (!(e instanceof NotReady)) throw e;
    console.log(`analyze-contract: not_ready doc=${e.documentId} code=${e.code}`);
    return json({ error: e.code, documentId: e.documentId }, 422);
  }
  const jobId = await insertJob({ user_id: userId, status: 'processing', provider: provider.name, prompt_version: PROMPT_VERSION, started_at: new Date().toISOString() });
  try {
    const out = await runModel(provider, input);
    input = [];
    let { validation, result } = firstPass(out.json, files, provider.name);
    // 다시 분석(사용자가 이미 확인·쪽 선택을 마친 경우): 남은 쪽은 사용자가 포함하기로 한 쪽 → 그대로 마무리
    if (carry && !validation.decision.startsWith('stop_') && validation.decision !== 'proceed') {
      const fin = finalize(out.json, { ...validation, userConfirmedRole: carry.confirmed }, files, { confirmRole: carry.confirmed, includeFiles: files.map((f) => f.file), excludeFiles: [] }, provider.name);
      if (fin.kind === 'done') ({ validation, result } = fin);
    }
    const stored: StoredValidation = {
      ...validation,
      documentIds: docs.map((d) => d.id),
      files,
      requestIds: requested.map((d) => d.id),
      plan,
      selection: selectionRecord(sel, plan),
      ...(carry ? { reanalyzedFrom: carry.from, userConfirmedRole: validation.userConfirmedRole || carry.confirmed } : {}),
    };
    // 원본 모델 출력은 사용자 선택을 반영할 때만 쓴다 — Level 1 민감정보는 가려서 저장
    // 저장하는 결과도 원본 기준 쪽 번호 (계약 상세의 근거 보기가 같은 번호로 원본을 연다)
    await updateJob(jobId, { status: 'succeeded', model: out.model, result: remapResult(result, plan), validation: stored, raw_output: storableModelOutput(out.json), completed_at: new Date().toISOString() });
    await linkDocumentsToJob(requested.map((d) => d.id), jobId);
    await recordRoles(userId, docs, validation, pagesOf(out.json), () => stored.userConfirmedRole);
    console.log(`analyze-contract: job=${jobId} selected=${plan.length}/${requested.length} excludedPages=${sel.reduce((n, d) => n + d.excludedPages.length, 0)} role=${validation.role} confidence=${validation.confidence} decision=${validation.decision} files=${docs.length} suspicious=${validation.suspiciousPages.length} signals=${validation.signalCount} ms=${Date.now() - started}`);
    return json({ jobId, validation: publicValidation(stored), result: remapResult(result, plan), ...(carry ? { excludedFiles: carry.excludedFiles } : {}) });
  } catch (e) {
    const code = e instanceof ProviderError ? e.code : e instanceof Error && /^[a-z_0-9]+$/.test(e.message) ? e.message : 'extract_failed';
    await updateJob(jobId, { status: 'failed', error_code: code, completed_at: new Date().toISOString() });
    console.error(`analyze-contract: failed job=${jobId} code=${code} ms=${Date.now() - started}`);
    return json({ error: code, jobId }, 502);
  }
}

/** 앱에 보내는 판정 (문서 id 목록 등 내부 값 제외) — 쪽 번호는 원본 기준 (앱 문서 순서·원본 페이지) */
function publicValidation(v: StoredValidation): DocumentValidation {
  const { documentIds: _d, files: _f, reanalyzedFrom: _r, requestIds: _q, plan: _p, selection: _s, ...rest } = v;
  return { ...rest, suspiciousPages: remapPages(rest.suspiciousPages, planOf(v)) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  const userId = token ? await getUserId(token) : null;
  if (!userId) return json({ error: 'unauthorized' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!(await hasAiConsent(userId))) return json({ error: 'ai_consent_required' }, 403);

  let provider: ExtractionProvider;
  try {
    provider = selectProvider();
  } catch (e) {
    return json({ error: e instanceof ProviderError ? e.code : 'ai_not_configured' }, 503);
  }

  // ── 마무리: 사용자 확인·쪽 선택 반영 ──
  if (typeof body.jobId === 'string') {
    if (!UUID.test(body.jobId)) return json({ error: 'bad_request' }, 400);
    const job = await selectOwnJob(userId, body.jobId);
    if (!job || job.status !== 'succeeded' || !job.validation) return json({ error: 'not_found' }, 404);
    const prev = job.validation as unknown as StoredValidation;
    const plan = planOf(prev);
    // 앱이 고른 파일 번호(원본 문서 순서) → AI 파일 번호
    const input = { confirmRole: body.confirmRole === true, includeFiles: toAiFiles(fileNos(body.includeFiles), plan), excludeFiles: toAiFiles(fileNos(body.excludeFiles), plan) };
    const requestIds = prev.requestIds ?? prev.documentIds;
    const requestedDocs = await selectOwnDocuments(userId, requestIds);
    if (requestedDocs.length !== requestIds.length) return json({ error: 'not_found' }, 404);
    // 분석 뒤 페이지 선택이 바뀌었으면 이 분석 결과를 이어 쓰지 않는다 (새로 분석)
    if (selectionChanged(prev.selection, selectionDocs(requestedDocs))) return json({ error: 'selection_changed' }, 409);
    const docs = requestedDocs.filter((d) => prev.documentIds.includes(d.id));
    let outcome;
    try {
      outcome = finalize(job.raw_output, prev, prev.files, input, job.provider ?? provider.name);
    } catch (e) {
      return json({ error: e instanceof FinalizeError ? e.message : 'bad_request' }, 409);
    }
    const ordered = prev.documentIds.map((id) => docs.find((d) => d.id === id)!);
    /** AI 파일 번호 → 원본 문서 순서 */
    const toRequest = (f: number) => plan[f - 1]?.requestFile ?? f;
    if (outcome.kind === 'reanalyze') {
      // 근거 위치를 모르는 값이 있어 제외한 사진의 값이 섞였는지 알 수 없다 → 그 사진을 빼고 다시 분석
      console.log(`analyze-contract: reanalyze job=${job.id} keep=${outcome.keepFiles.length} excluded=${outcome.excluded.length}`);
      const excludedFiles = outcome.excluded.filter((e) => e.page === null).map((e) => toRequest(e.file));
      const ordReq = requestIds.map((id) => requestedDocs.find((d) => d.id === id)!);
      return await analyze(userId, ordReq.filter((_, i) => !excludedFiles.includes(i + 1)), provider, passwordsOf(body.passwords), { confirmed: input.confirmRole || prev.userConfirmedRole, from: job.id, excludedFiles });
    }
    const stored: StoredValidation = { ...prev, ...outcome.validation, documentIds: prev.documentIds, files: prev.files };
    await updateJob(job.id, { result: remapResult(outcome.result, plan), validation: { ...stored, excluded: outcome.excluded } });
    const aiExcluded = outcome.excluded.filter((e) => e.page === null).map((e) => e.file);
    const excludedFiles = aiExcluded.map(toRequest);
    await recordRoles(userId, ordered, outcome.validation, pagesOf(job.raw_output), (f) => input.includeFiles.includes(f) || (outcome.validation.userConfirmedRole && !aiExcluded.includes(f)));
    console.log(`analyze-contract: finalize job=${job.id} decision=${outcome.validation.decision} excluded=${outcome.excluded.length} removed=${outcome.removedValues}`);
    return json({ jobId: job.id, validation: publicValidation(stored), result: remapResult(outcome.result, plan), excludedFiles });
  }

  // ── 1차 분석 ──
  const ids = Array.isArray(body.documentIds) ? body.documentIds.filter((x: unknown): x is string => typeof x === 'string' && UUID.test(x)) : [];
  if (ids.length === 0 || ids.length > MAX_FILES) return json({ error: 'bad_request' }, 400);
  const docs = await selectOwnDocuments(userId, ids);
  if (docs.length !== ids.length) return json({ error: 'not_found' }, 404);
  if (docs.reduce((n, d) => n + d.size_bytes, 0) > MAX_TOTAL_BYTES) return json({ error: 'too_large' }, 413);
  return await analyze(userId, docs, provider, passwordsOf(body.passwords));
});
