// 스캔 페이지 1장 보호 worker — protect-document만 호출한다 (서버 내부 인증: service_role 키, 앱에는 이 키가 없다)
// 받은 이미지 스트림 → 바로 세움 → CLOVA OCR → 민감정보 탐지 → 실제 픽셀 덮기 → 덮임 확인 → (가린 것이 있으면) 재-OCR 검증
// DB·저장소에 접근하지 않는다. 페이지마다 따로 호출되므로 CPU·메모리 한도가 페이지 단위로 적용된다.
// 로그: 페이지 번호·상태·사유 코드·개수·시간만 (OCR 텍스트·값·좌표 없음)
import { ClovaOcr } from '../_shared/protection/ocrProvider.ts';
import { decodeScanRequest, encodeScanResponse, protectScanPage } from '../_shared/protection/scanWorker.ts';

const MAX_BODY_BYTES = 40 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sameSecret(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const reply = (body: unknown, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!sameSecret(token, key)) return reply({ error: 'unauthorized' }, 401);
  const doc = req.headers.get('x-pacto-doc') ?? '';
  const docId = UUID.test(doc) ? doc : '-';

  const started = Date.now();
  let parsed;
  try {
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > MAX_BODY_BYTES) return reply({ error: 'too_large' }, 413);
    const body = new Uint8Array(await req.arrayBuffer());
    if (body.byteLength > MAX_BODY_BYTES) return reply({ error: 'too_large' }, 413);
    parsed = decodeScanRequest(body);
  } catch {
    return reply({ error: 'bad_request' }, 400);
  }
  const { job, raw } = parsed;
  try {
    const out = await protectScanPage(raw, job, ClovaOcr.fromEnv(Deno.env));
    const d = out.diagnostics;
    console.log(
      `protect-scan-page: ${JSON.stringify({
        documentId: docId,
        page: job.page,
        mode: job.redraw ? 'redraw' : 'ocr',
        status: out.status,
        detail: out.detail,
        filter: job.meta.filter,
        channels: job.meta.channels,
        width: job.meta.width,
        height: job.meta.height,
        rotated: job.orientation.swap || job.orientation.flipX || job.orientation.flipY,
        directOcrInput: d.directOcrInput,
        sourceBytes: d.sourceBytes,
        imageBytes: out.image?.byteLength ?? 0,
        ocrCalls: d.ocrCalls,
        ocrFieldCount: d.ocrFieldCount,
        detectedSensitiveCount: d.detectedSensitiveCount,
        maskedCount: d.maskedCount,
        verification: d.verification,
        stage: d.stage,
        errorCode: d.errorCode,
        prepareMs: d.prepareMs,
        ...d.timings,
        ms: Date.now() - started,
      })}`,
    );
    return reply(encodeScanResponse(out));
  } catch (e) {
    console.error(`protect-scan-page: doc=${docId} page=${job.page} failed name=${e instanceof Error ? e.name : 'unknown'} ms=${Date.now() - started}`);
    return reply({ error: 'scan_page_failed' }, 500);
  }
});
