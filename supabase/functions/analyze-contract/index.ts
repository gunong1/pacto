// 계약서 자동 정리: 본인 문서 확인 → 비공개 저장소에서 원본 읽기 → AI 1회(문서 확인 + 추출) → 서버 게이트 → 초안 반환
// - "파일을 올렸다"와 "계약서로 인정한다"를 나눈다: 계약이 아니거나 읽을 수 없거나 정보가 부족하면 추출 결과를 보내지 않는다.
//   애매하면 사용자 확인 후에만, 의심 사진 쪽은 사용자가 고른 뒤에만 결과를 보낸다 (POST { jobId, confirmRole, includeFiles, excludeFiles }).
// - 제외한 쪽에서만 근거가 나온 값은 결과에서 지우고, 근거 위치를 알 수 없으면 그 사진을 빼고 다시 분석한다.
// - AI 처리 동의(profiles.ai_processing_agreed_at)가 없으면 거부 (앱이 동의를 받은 뒤 재시도)
// - API 키는 Edge Function secret에만 존재. 계약서 내용·추출 결과는 로그에 남기지 않는다 (id·역할·신뢰도·개수·시간만).
import { finalize, FinalizeError, firstPass } from '../_shared/analysis.ts';
import type { DocumentRole, DocumentValidation, FileKind } from '../_shared/documentGate.ts';
import { selectProvider } from '../_shared/ai/index.ts';
import { ProviderError, type ContractFile, type ExtractionProvider } from '../_shared/ai/types.ts';
import {
  downloadObject,
  getUserId,
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
import { maskLevel1Deep } from '../_shared/protection/sensitive.ts';

const BUCKET = 'contract-files';
const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function todayInSeoul(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 작업에 저장하는 판정 (원문 없음) + 문서 순서 */
type StoredValidation = DocumentValidation & { documentIds: string[]; files: FileKind[]; reanalyzedFrom?: string };

const fileNos = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x) && x >= 1 && x <= MAX_FILES) : []);

async function runModel(provider: ExtractionProvider, docs: DocumentRow[]) {
  const files: ContractFile[] = [];
  for (const d of docs) {
    files.push({ mimeType: d.mime_type as ContractFile['mimeType'], fileName: d.original_filename ?? `contract.${d.mime_type === 'application/pdf' ? 'pdf' : 'jpg'}`, base64: toBase64(await downloadObject(BUCKET, d.storage_path)) });
  }
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
async function analyze(userId: string, docs: DocumentRow[], provider: ExtractionProvider, carry?: { confirmed: boolean; from: string; excludedFiles: number[] }) {
  const started = Date.now();
  const files: FileKind[] = docs.map((d, i) => ({ file: i + 1, pdf: d.mime_type === 'application/pdf' }));
  const jobId = await insertJob({ user_id: userId, status: 'processing', provider: provider.name, prompt_version: PROMPT_VERSION, started_at: new Date().toISOString() });
  try {
    const out = await runModel(provider, docs);
    let { validation, result } = firstPass(out.json, files, provider.name);
    // 다시 분석(사용자가 이미 확인·쪽 선택을 마친 경우): 남은 쪽은 사용자가 포함하기로 한 쪽 → 그대로 마무리
    if (carry && !validation.decision.startsWith('stop_') && validation.decision !== 'proceed') {
      const fin = finalize(out.json, { ...validation, userConfirmedRole: carry.confirmed }, files, { confirmRole: carry.confirmed, includeFiles: files.map((f) => f.file), excludeFiles: [] }, provider.name);
      if (fin.kind === 'done') ({ validation, result } = fin);
    }
    const stored: StoredValidation = { ...validation, documentIds: docs.map((d) => d.id), files, ...(carry ? { reanalyzedFrom: carry.from, userConfirmedRole: validation.userConfirmedRole || carry.confirmed } : {}) };
    // 원본 모델 출력은 사용자 선택을 반영할 때만 쓴다 — Level 1 민감정보는 가려서 저장
    await updateJob(jobId, { status: 'succeeded', model: out.model, result, validation: stored, raw_output: maskLevel1Deep(out.json), completed_at: new Date().toISOString() });
    await linkDocumentsToJob(docs.map((d) => d.id), jobId);
    await recordRoles(userId, docs, validation, pagesOf(out.json), () => stored.userConfirmedRole);
    console.log(`analyze-contract: job=${jobId} role=${validation.role} confidence=${validation.confidence} decision=${validation.decision} files=${docs.length} suspicious=${validation.suspiciousPages.length} signals=${validation.signalCount} ms=${Date.now() - started}`);
    return json({ jobId, validation: publicValidation(stored), result, ...(carry ? { excludedFiles: carry.excludedFiles } : {}) });
  } catch (e) {
    const code = e instanceof ProviderError ? e.code : e instanceof Error && /^[a-z_0-9]+$/.test(e.message) ? e.message : 'extract_failed';
    await updateJob(jobId, { status: 'failed', error_code: code, completed_at: new Date().toISOString() });
    console.error(`analyze-contract: failed job=${jobId} code=${code} ms=${Date.now() - started}`);
    return json({ error: code, jobId }, 502);
  }
}

/** 앱에 보내는 판정 (문서 id 목록 등 내부 값 제외) */
function publicValidation(v: StoredValidation): DocumentValidation {
  const { documentIds: _d, files: _f, reanalyzedFrom: _r, ...rest } = v;
  return rest;
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
    const input = { confirmRole: body.confirmRole === true, includeFiles: fileNos(body.includeFiles), excludeFiles: fileNos(body.excludeFiles) };
    const docs = await selectOwnDocuments(userId, prev.documentIds);
    if (docs.length !== prev.documentIds.length) return json({ error: 'not_found' }, 404);
    let outcome;
    try {
      outcome = finalize(job.raw_output, prev, prev.files, input, job.provider ?? provider.name);
    } catch (e) {
      return json({ error: e instanceof FinalizeError ? e.message : 'bad_request' }, 409);
    }
    const ordered = prev.documentIds.map((id) => docs.find((d) => d.id === id)!);
    if (outcome.kind === 'reanalyze') {
      // 근거 위치를 모르는 값이 있어 제외한 사진의 값이 섞였는지 알 수 없다 → 그 사진을 빼고 다시 분석
      console.log(`analyze-contract: reanalyze job=${job.id} keep=${outcome.keepFiles.length} excluded=${outcome.excluded.length}`);
      const excludedFiles = outcome.excluded.filter((e) => e.page === null).map((e) => e.file);
      return await analyze(userId, outcome.keepFiles.map((f) => ordered[f - 1]), provider, { confirmed: input.confirmRole || prev.userConfirmedRole, from: job.id, excludedFiles });
    }
    const stored: StoredValidation = { ...prev, ...outcome.validation, documentIds: prev.documentIds, files: prev.files };
    await updateJob(job.id, { result: outcome.result, validation: { ...stored, excluded: outcome.excluded } });
    const excludedFiles = outcome.excluded.filter((e) => e.page === null).map((e) => e.file);
    await recordRoles(userId, ordered, outcome.validation, pagesOf(job.raw_output), (f) => input.includeFiles.includes(f) || (outcome.validation.userConfirmedRole && !excludedFiles.includes(f)));
    console.log(`analyze-contract: finalize job=${job.id} decision=${outcome.validation.decision} excluded=${outcome.excluded.length} removed=${outcome.removedValues}`);
    return json({ jobId: job.id, validation: publicValidation(stored), result: outcome.result, excludedFiles });
  }

  // ── 1차 분석 ──
  const ids = Array.isArray(body.documentIds) ? body.documentIds.filter((x: unknown): x is string => typeof x === 'string' && UUID.test(x)) : [];
  if (ids.length === 0 || ids.length > MAX_FILES) return json({ error: 'bad_request' }, 400);
  const docs = await selectOwnDocuments(userId, ids);
  if (docs.length !== ids.length) return json({ error: 'not_found' }, 404);
  if (docs.reduce((n, d) => n + d.size_bytes, 0) > MAX_TOTAL_BYTES) return json({ error: 'too_large' }, 413);
  return await analyze(userId, docs, provider);
});
