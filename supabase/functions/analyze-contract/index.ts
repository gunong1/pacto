// 계약서 자동 정리: 본인 문서 확인 → 비공개 저장소에서 원본 읽기 → AI 추출 → 검증 → 초안 반환
// - AI 처리 동의(profiles.ai_processing_agreed_at)가 없으면 거부 (앱이 동의를 받은 뒤 재시도)
// - API 키는 Edge Function secret에만 존재. 계약서 내용·추출 결과는 로그에 남기지 않는다.
// - 결과는 초안이다. 사용자가 확인·수정 후 저장한다.
import { selectProvider } from '../_shared/ai/index.ts';
import { ProviderError } from '../_shared/ai/types.ts';
import { downloadObject, getUserId, hasAiConsent, insertJob, linkDocumentsToJob, selectOwnDocuments, toBase64, updateJob } from '../_shared/admin.ts';
import { corsHeaders, json } from '../_shared/cors.ts';
import { PROMPT_VERSION, toAppResult } from '../_shared/extraction.ts';

const BUCKET = 'contract-files';
const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function todayInSeoul(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  const userId = token ? await getUserId(token) : null;
  if (!userId) return json({ error: 'unauthorized' }, 401);

  let ids: string[] = [];
  try {
    const body = await req.json();
    ids = Array.isArray(body?.documentIds) ? body.documentIds.filter((x: unknown) => typeof x === 'string' && UUID.test(x)) : [];
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (ids.length === 0 || ids.length > MAX_FILES) return json({ error: 'bad_request' }, 400);

  if (!(await hasAiConsent(userId))) return json({ error: 'ai_consent_required' }, 403);

  const docs = await selectOwnDocuments(userId, ids);
  if (docs.length !== ids.length) return json({ error: 'not_found' }, 404);
  if (docs.reduce((n, d) => n + d.size_bytes, 0) > MAX_TOTAL_BYTES) return json({ error: 'too_large' }, 413);

  let provider;
  try {
    provider = selectProvider();
  } catch (e) {
    return json({ error: e instanceof ProviderError ? e.code : 'ai_not_configured' }, 503);
  }

  const started = Date.now();
  const jobId = await insertJob({ user_id: userId, status: 'processing', provider: provider.name, prompt_version: PROMPT_VERSION, started_at: new Date().toISOString() });
  try {
    const files = [];
    for (const d of docs) {
      files.push({ mimeType: d.mime_type, fileName: d.original_filename ?? `contract.${d.mime_type === 'application/pdf' ? 'pdf' : 'jpg'}`, base64: toBase64(await downloadObject(BUCKET, d.storage_path)) });
    }
    const out = await provider.extract(files, todayInSeoul());
    const result = toAppResult(out.json, provider.name);
    await updateJob(jobId, { status: 'succeeded', model: out.model, result, completed_at: new Date().toISOString() });
    await linkDocumentsToJob(ids, jobId);
    console.log(`analyze-contract: ok provider=${provider.name} files=${files.length} ms=${Date.now() - started}`);
    return json({ jobId, result });
  } catch (e) {
    const code = e instanceof ProviderError ? e.code : e instanceof Error && /^[a-z_0-9]+$/.test(e.message) ? e.message : 'extract_failed';
    await updateJob(jobId, { status: 'failed', error_code: code, completed_at: new Date().toISOString() });
    console.error(`analyze-contract: failed code=${code} ms=${Date.now() - started}`);
    return json({ error: code, jobId }, 502);
  }
});
