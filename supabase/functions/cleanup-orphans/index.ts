// 계약에 연결되지 않은 업로드 정리 (매시간 pg_cron → pg_net 호출)
// 대상: 계약에 연결되지 않음 + 생성 후 24시간 경과 + 진행 중인 분석 작업 없음 (DB 함수 claim_orphan_documents가 보수적으로 고르고 행을 지운다)
// → 원본·보호 파생본 파일을 Storage API로 삭제 (민감정보 영역·파생본 기록은 행 삭제 시 cascade)
// → 24시간 지난 임시 분석 작업 삭제, 사용자 선택 반영용 모델 출력 비우기
// 로그: 문서 id·삭제 결과·개수만 (파일 이름·계약 원문·개인정보 없음)
import { removeObjects, rpc } from '../_shared/admin.ts';
import { json } from '../_shared/cors.ts';

const BUCKET = 'contract-files';

/** 길이가 같을 때만 같은지 — 비밀값 비교 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const secret = Deno.env.get('CLEANUP_SECRET');
  if (!secret) return json({ error: 'not_configured' }, 503);
  if (!safeEqual(req.headers.get('x-cleanup-secret') ?? '', secret)) return json({ error: 'unauthorized' }, 401);

  const started = Date.now();
  let documents = 0;
  let storageFailures = 0;
  for (let round = 0; round < 5; round++) {
    const rows = await rpc<{ document_id: string; paths: string[] }[]>('claim_orphan_documents', { p_limit: 200 });
    for (const r of rows) {
      try {
        if (r.paths.length) await removeObjects(BUCKET, r.paths);
        console.log(`cleanup-orphans: document=${r.document_id} files=${r.paths.length} result=deleted`);
      } catch {
        storageFailures++;
        console.error(`cleanup-orphans: document=${r.document_id} files=${r.paths.length} result=storage_failed`);
      }
    }
    documents += rows.length;
    if (rows.length < 200) break;
  }
  const [jobs] = await rpc<{ deleted_jobs: number; cleared_outputs: number }[]>('purge_stale_analysis_jobs');
  console.log(`cleanup-orphans: documents=${documents} storage_failures=${storageFailures} jobs_deleted=${jobs?.deleted_jobs ?? 0} outputs_cleared=${jobs?.cleared_outputs ?? 0} ms=${Date.now() - started}`);
  return json({ documents, storageFailures, jobsDeleted: jobs?.deleted_jobs ?? 0, outputsCleared: jobs?.cleared_outputs ?? 0 });
});
