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
