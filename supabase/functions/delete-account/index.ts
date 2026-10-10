// 회원 탈퇴: ① Storage의 원본 계약서·프로필 사진 전부 삭제 ② auth 사용자 삭제 → public 테이블은 FK cascade로 전부 삭제
// - 요청자의 JWT로 본인 확인 후에만 service_role 사용
// - 로그에는 사용자 식별 정보/계약 내용을 남기지 않는다 (단계와 결과 코드만)
// - 중간에 실패해도 다시 호출하면 이어서 삭제된다 (idempotent)
import { deleteAuthUser, getUserId, listObjects, removeObjects } from '../_shared/admin.ts';
import { corsHeaders, json } from '../_shared/cors.ts';

/** 사용자 폴더({user_id}/...)를 통째로 지우는 버킷 */
const BUCKETS = ['contract-files', 'profile-images'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  const userId = token ? await getUserId(token) : null;
  if (!userId) return json({ error: 'unauthorized' }, 401);

  try {
    for (const bucket of BUCKETS) {
      for (let round = 0; round < 100; round++) {
        const paths = await listObjects(bucket, userId);
        if (paths.length === 0) break;
        await removeObjects(bucket, paths);
      }
    }
    await deleteAuthUser(userId);
  } catch (e) {
    console.error('delete-account failed:', e instanceof Error ? e.message : 'unknown');
    return json({ error: 'delete_failed' }, 500);
  }

  console.log('delete-account: ok');
  return json({ deleted: true });
});
