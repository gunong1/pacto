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
  protection_status?: string;
}

/** 본인 소유 문서만 조회 (user_id 조건 필수) */
export async function selectOwnDocuments(userId: string, ids: string[]): Promise<DocumentRow[]> {
  const res = await rest(`contract_documents?select=id,user_id,storage_path,mime_type,original_filename,size_bytes,sort_order,protection_status&user_id=eq.${userId}&id=in.(${ids.join(',')})&order=sort_order.asc`);
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

// ===== 민감정보 보호 (서버 전용) =====
export interface RegionRow {
  id: string;
  region_key: string;
  state: 'masked' | 'unmasked' | 'candidate';
  user_confirmed: boolean;
  /** 사진 보호본을 OCR 없이 다시 그릴 때 쓰는 위치·종류 (원문 값 없음) */
  page_number: number;
  sensitive_type: string;
  mask_level: 1 | 2;
  confidence: 'high' | 'medium' | 'low';
  bbox_json: { x: number; y: number; w: number; h: number }[];
  masked_preview: string;
  context_label: string | null;
  /** pattern(PDF 글자) / ocr(사진·스캔 페이지) */
  source: string;
}

export async function selectRegions(userId: string, documentId: string): Promise<RegionRow[]> {
  const res = await rest(`document_sensitive_regions?select=id,region_key,state,user_confirmed,page_number,sensitive_type,mask_level,confidence,bbox_json,masked_preview,context_label,source&user_id=eq.${userId}&document_id=eq.${documentId}`);
  if (!res.ok) throw new Error(`regions_${res.status}`);
  return await res.json();
}

export async function updateRegionStates(userId: string, documentId: string, updates: { id: string; state: 'masked' | 'unmasked' }[]): Promise<void> {
  for (const u of updates) {
    const res = await rest(`document_sensitive_regions?id=eq.${u.id}&user_id=eq.${userId}&document_id=eq.${documentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: u.state, user_confirmed: true }),
    });
    if (!res.ok) throw new Error(`regions_update_${res.status}`);
  }
}

/** 문서의 영역을 새 결과로 바꾼다 (사용자 확인 여부는 같은 key면 유지) */
export async function replaceRegions(userId: string, documentId: string, rows: Record<string, unknown>[]): Promise<void> {
  const del = await rest(`document_sensitive_regions?user_id=eq.${userId}&document_id=eq.${documentId}`, { method: 'DELETE' });
  if (!del.ok) throw new Error(`regions_delete_${del.status}`);
  if (rows.length === 0) return;
  const ins = await rest('document_sensitive_regions', { method: 'POST', body: JSON.stringify(rows) });
  if (!ins.ok) throw new Error(`regions_insert_${ins.status}`);
}

export async function updateDocumentProtection(userId: string, documentId: string, patch: Record<string, unknown>): Promise<void> {
  const res = await rest(`contract_documents?id=eq.${documentId}&user_id=eq.${userId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  if (!res.ok) throw new Error(`document_update_${res.status}`);
}

export async function selectDerivatives(userId: string, documentId: string): Promise<{ id: string; kind: string; storage_path: string }[]> {
  const res = await rest(`document_derivatives?select=id,kind,storage_path&user_id=eq.${userId}&document_id=eq.${documentId}`);
  if (!res.ok) throw new Error(`derivatives_${res.status}`);
  return await res.json();
}

export async function upsertDerivative(row: { user_id: string; document_id: string; kind: string; storage_path: string; size_bytes: number }): Promise<void> {
  const res = await rest('document_derivatives?on_conflict=document_id,kind', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`derivative_upsert_${res.status}`);
}

export async function deleteDerivative(id: string): Promise<void> {
  const res = await rest(`document_derivatives?id=eq.${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`derivative_delete_${res.status}`);
}

export async function uploadObject(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const res = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes,
  });
  if (!res.ok) throw new Error(`storage_upload_${res.status}`);
}

// ===== 문서 확인 (분석 작업·문서 역할, 서버 전용) =====
export interface JobRow {
  id: string;
  user_id: string;
  status: string;
  provider: string | null;
  validation: Record<string, unknown> | null;
  raw_output: unknown;
}

export async function selectOwnJob(userId: string, jobId: string): Promise<JobRow | null> {
  const res = await rest(`analysis_jobs?select=id,user_id,status,provider,validation,raw_output&user_id=eq.${userId}&id=eq.${jobId}`);
  if (!res.ok) throw new Error(`job_${res.status}`);
  const rows: JobRow[] = await res.json();
  return rows[0] ?? null;
}

/** 문서 역할 기록 (사용자는 바꿀 수 없다 — 트리거) */
export async function updateDocumentRole(userId: string, documentId: string, patch: { document_role?: string; role_confirmed_by_user?: boolean }): Promise<void> {
  const res = await rest(`contract_documents?user_id=eq.${userId}&id=eq.${documentId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  if (!res.ok) throw new Error(`document_role_${res.status}`);
}

// ===== 고아 파일 정리 (서버 전용) =====
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`rpc_${fn}_${res.status}`);
  return await res.json();
}

/** PostgREST JSON 요청 (service_role) — 실패하면 상태 코드만 담은 오류 (응답 본문은 로그에 남기지 않는다) */
export async function restJson<T>(path: string, init: RequestInit = {}, label = 'rest'): Promise<T> {
  const res = await rest(path, init);
  if (!res.ok) throw new Error(`${label}_${res.status}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** 길이가 같을 때만 같은지 — 비밀값 비교 (예약 실행 호출 확인) */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
