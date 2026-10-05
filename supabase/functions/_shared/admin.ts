// 외부 패키지 없이 Supabase Auth/Storage 관리 API를 호출하는 최소 헬퍼 (service_role 전용, 서버에서만 사용)
const URL_BASE = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const serviceHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

/** 요청자 JWT 검증 → 사용자 id (실패 시 null) */
export async function getUserId(accessToken: string): Promise<string | null> {
  const res = await fetch(`${URL_BASE}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return typeof user?.id === 'string' ? user.id : null;
}

export async function listObjects(bucket: string, prefix: string): Promise<string[]> {
  const res = await fetch(`${URL_BASE}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  if (!res.ok) throw new Error(`storage_list_${res.status}`);
  const items: { name: string; id: string | null }[] = await res.json();
  // id가 null이면 하위 폴더
  return items.filter((i) => i.id !== null).map((i) => `${prefix}/${i.name}`);
}

export async function removeObjects(bucket: string, paths: string[]): Promise<void> {
  const res = await fetch(`${URL_BASE}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: serviceHeaders,
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) throw new Error(`storage_remove_${res.status}`);
}

export async function deleteAuthUser(userId: string): Promise<void> {
  const res = await fetch(`${URL_BASE}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: serviceHeaders });
  if (!res.ok) throw new Error(`auth_delete_${res.status}`);
}

// ===== PostgREST (service_role) =====
async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { ...serviceHeaders, ...(init.headers ?? {}) } });
}

export interface DocumentRow {
  id: string;
  user_id: string;
  storage_path: string;
  mime_type: 'application/pdf' | 'image/jpeg' | 'image/png';
  original_filename: string | null;
  size_bytes: number;
  sort_order: number;
}

/** 본인 소유 문서만 조회 (user_id 조건 필수) */
export async function selectOwnDocuments(userId: string, ids: string[]): Promise<DocumentRow[]> {
  const res = await rest(`contract_documents?select=id,user_id,storage_path,mime_type,original_filename,size_bytes,sort_order&user_id=eq.${userId}&id=in.(${ids.join(',')})&order=sort_order.asc`);
  if (!res.ok) throw new Error(`documents_${res.status}`);
  return await res.json();
}

export async function hasAiConsent(userId: string): Promise<boolean> {
  const res = await rest(`profiles?select=ai_processing_agreed_at&id=eq.${userId}`);
  if (!res.ok) throw new Error(`profile_${res.status}`);
  const rows: { ai_processing_agreed_at: string | null }[] = await res.json();
  return !!rows[0]?.ai_processing_agreed_at;
}

export async function downloadObject(bucket: string, path: string): Promise<Uint8Array> {
  const res = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!res.ok) throw new Error(`storage_download_${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function insertJob(row: Record<string, unknown>): Promise<string> {
  const res = await rest('analysis_jobs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (!res.ok) throw new Error(`job_insert_${res.status}`);
  const [job] = await res.json();
  return job.id;
}

export async function updateJob(id: string, patch: Record<string, unknown>): Promise<void> {
  await rest(`analysis_jobs?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function linkDocumentsToJob(ids: string[], jobId: string): Promise<void> {
  await rest(`contract_documents?id=in.(${ids.join(',')})`, { method: 'PATCH', body: JSON.stringify({ analysis_job_id: jobId }) });
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
