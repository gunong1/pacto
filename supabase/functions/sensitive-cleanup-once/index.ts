// ⚠ 임시 함수 — 기존 데이터의 민감정보 정리가 끝나면 코드·배포·config 항목을 모두 지운다 (운영에 남겨두지 않음).
// 목적: 2026-10 단일 가림 정책 이전에 저장된 AI 파생 텍스트(근거 문장·설명)에 남은 민감정보를 같은 정책으로 가린다.
//
// 1단계 dry_run: 표·필드·행 id·유형별 개수만 반환 (원문 문자열 없음) + 계획 해시(planHash)
// 2단계 apply: 사용자가 dry_run 결과를 확인한 뒤, 같은 planHash를 보내야만 실행 (그 사이 데이터가 바뀌면 거절)
//   - 가리는 대상: AI가 만든 파생 텍스트만 — contracts.ai_checks·classification, analysis_jobs.result·raw_output
//   - 원본 계약서 파일·보호본·사용자가 직접 입력한 칸은 바꾸지 않는다 (reportOnly로 개수만 보여줌)
//   - 가리기 전 원문을 백업 표·로그에 복사하지 않는다. 로그·응답은 실행 id·행 id·개수·해시만
//   - 가림은 멱등(이미 가린 값은 그대로)이라 중간에 실패해도 다시 실행하면 된다
// 호출: service_role 키만 (Authorization: Bearer <service_role>)
import { restJson, safeEqual } from '../_shared/admin.ts';
import { json } from '../_shared/cors.ts';
import { detectSensitive, maskSensitiveDeep, shouldMaskSensitive } from '../_shared/protection/sensitive.ts';

const PAGE = 500;
/** 가리는 대상 (AI 파생 텍스트) */
const TARGETS = [
  { table: 'contracts', field: 'ai_checks' },
  { table: 'contracts', field: 'classification' },
  { table: 'analysis_jobs', field: 'result' },
  { table: 'analysis_jobs', field: 'raw_output' },
] as const;
/** 개수만 보고 (사용자가 확인·수정한 칸 — 이 함수는 바꾸지 않음) */
const REPORT_ONLY = [
  { table: 'contracts', field: 'counterparty' },
  { table: 'contracts', field: 'early_termination_terms' },
  { table: 'contracts', field: 'penalty_terms' },
] as const;

type Hit = { table: string; field: string; id: string; types: Record<string, number>; count: number };

/** 값 안의 모든 문자열에서 가려야 할 민감정보 유형별 개수 (문자열 자체는 반환하지 않음) */
function countTypes(value: unknown, out: Record<string, number> = {}): Record<string, number> {
  if (typeof value === 'string') {
    for (const d of detectSensitive(value)) if (shouldMaskSensitive(d)) out[d.type] = (out[d.type] ?? 0) + 1;
  } else if (Array.isArray(value)) {
    for (const v of value) countTypes(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) countTypes(v, out);
  }
  return out;
}

async function scan(table: string, field: string, onRow: (id: string, value: unknown) => Promise<void> | void) {
  for (let offset = 0; ; offset += PAGE) {
    const rows = await restJson<Record<string, unknown>[]>(`${table}?select=id,${field}&${field}=not.is.null&order=id&limit=${PAGE}&offset=${offset}`, {}, `select_${table}`);
    for (const r of rows) await onRow(r.id as string, r[field]);
    if (rows.length < PAGE) break;
  }
}

async function findHits(targets: readonly { table: string; field: string }[]): Promise<Hit[]> {
  const hits: Hit[] = [];
  for (const { table, field } of targets) {
    await scan(table, field, (id, value) => {
      const types = countTypes(value);
      const count = Object.values(types).reduce((a, b) => a + b, 0);
      if (count > 0) hits.push({ table, field, id, types, count });
    });
  }
  return hits;
}

async function planHash(hits: Hit[]): Promise<string> {
  const lines = hits.map((h) => `${h.table}.${h.field}:${h.id}:${h.count}`).sort().join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lines));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function totals(hits: Hit[]) {
  const byType: Record<string, number> = {};
  for (const h of hits) for (const [t, n] of Object.entries(h.types)) byType[t] = (byType[t] ?? 0) + n;
  return { rows: hits.length, values: hits.reduce((a, h) => a + h.count, 0), byType };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!key || !safeEqual(auth, key)) return json({ error: 'unauthorized' }, 401);

  let body: { mode?: string; planHash?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const runId = crypto.randomUUID();
  const hits = await findHits(TARGETS);
  const hash = await planHash(hits);

  if (body.mode === 'dry_run') {
    const reportOnly = await findHits(REPORT_ONLY);
    console.log(`sensitive-cleanup: run=${runId} mode=dry_run rows=${hits.length} report_only_rows=${reportOnly.length} hash=${hash}`);
    return json({ runId, mode: 'dry_run', planHash: hash, totals: totals(hits), rows: hits, reportOnly: { totals: totals(reportOnly), rows: reportOnly } });
  }

  if (body.mode === 'apply') {
    // dry_run 이후 데이터가 바뀌었으면 거절 (확인한 범위만 바꾼다)
    if (!body.planHash || body.planHash !== hash) {
      console.log(`sensitive-cleanup: run=${runId} mode=apply result=plan_mismatch`);
      return json({ error: 'plan_mismatch', planHash: hash }, 409);
    }
    let updated = 0;
    const failed: string[] = [];
    for (const h of hits) {
      try {
        const [row] = await restJson<Record<string, unknown>[]>(`${h.table}?select=${h.field}&id=eq.${h.id}`, {}, `select_${h.table}`);
        if (!row) continue;
        // 같은 공통 정책으로 가린 값으로 덮어쓴다 (원문은 어디에도 복사하지 않음)
        await restJson(`${h.table}?id=eq.${h.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ [h.field]: maskSensitiveDeep(row[h.field]) }) }, `update_${h.table}`);
        updated++;
        console.log(`sensitive-cleanup: run=${runId} ${h.table}.${h.field} id=${h.id} values=${h.count} result=masked`);
      } catch {
        failed.push(`${h.table}.${h.field}:${h.id}`);
        console.error(`sensitive-cleanup: run=${runId} ${h.table}.${h.field} id=${h.id} result=failed`);
      }
    }
    const remaining = await findHits(TARGETS);
    console.log(`sensitive-cleanup: run=${runId} mode=apply updated=${updated} failed=${failed.length} remaining=${remaining.length} hash=${hash}`);
    return json({ runId, mode: 'apply', planHash: hash, updated, failed, remaining: totals(remaining) });
  }

  return json({ error: 'invalid_mode' }, 400);
});
