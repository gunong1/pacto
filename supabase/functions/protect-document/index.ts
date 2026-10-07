// 계약서 민감정보 보호: 본인 문서 확인 → 비공개 저장소에서 원본 읽기(수정하지 않음) → 탐지 → 실제 제거한 보호 표시본 저장
// - 외부 서비스로 보내지 않는다 (탐지·제거 모두 이 함수 안에서)
// - 보호본에서 원문이 다시 추출되면 실패 처리 — "보호됨"으로 표시하지 않는다
// - 원문 값은 저장·로그에 남기지 않는다 (위치·종류·가린 표시값만). 로그에는 문서 id·상태·종류별 개수·시간만
// 요청: { documentId, regions?: [{ id, state: 'masked' | 'unmasked' }] } — regions가 있으면 사용자의 가림 선택을 반영해 보호본을 다시 만든다
import {
  deleteDerivative,
  downloadObject,
  getUserId,
  removeObjects,
  replaceRegions,
  selectDerivatives,
  selectOwnDocuments,
  selectRegions,
  updateDocumentProtection,
  updateRegionStates,
  uploadObject,
  upsertDerivative,
} from '../_shared/admin.ts';
import { corsHeaders, json } from '../_shared/cors.ts';
import { protectPdf, type ProtectResult, type RegionState } from '../_shared/protection/protect.ts';
import { detectionCounts } from '../_shared/protection/sensitive.ts';

const BUCKET = 'contract-files';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  const userId = token ? await getUserId(token) : null;
  if (!userId) return json({ error: 'unauthorized' }, 401);

  let documentId = '';
  let updates: { id: string; state: 'masked' | 'unmasked' }[] = [];
  try {
    const body = await req.json();
    documentId = typeof body?.documentId === 'string' && UUID.test(body.documentId) ? body.documentId : '';
    updates = (Array.isArray(body?.regions) ? body.regions : [])
      .filter((r: unknown): r is { id: string; state: 'masked' | 'unmasked' } => {
        const o = r as Record<string, unknown>;
        return typeof o?.id === 'string' && UUID.test(o.id) && (o.state === 'masked' || o.state === 'unmasked');
      })
      .slice(0, 200);
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!documentId) return json({ error: 'bad_request' }, 400);

  const [doc] = await selectOwnDocuments(userId, [documentId]);
  if (!doc) return json({ error: 'not_found' }, 404);

  const started = Date.now();
  try {
    if (updates.length) await updateRegionStates(userId, documentId, updates);
    const prev = await selectRegions(userId, documentId);
    const prevStates = new Map<string, RegionState>(prev.map((r) => [r.region_key, r.state]));
    const confirmed = new Set(prev.filter((r) => r.user_confirmed).map((r) => r.region_key));

    let result: ProtectResult;
    if (doc.mime_type !== 'application/pdf') {
      // 사진: 글자가 이미지 안에 있다 — V1 자동 가리기 미지원 (향후 OCR)
      result = { status: 'unsupported_scan', detail: 'image_file', imagesUnchecked: false, regions: [], protectedPdf: null, pageCount: 1 };
    } else {
      try {
        result = await protectPdf(await downloadObject(BUCKET, doc.storage_path), prevStates);
      } catch {
        result = { status: 'failed', detail: 'error', imagesUnchecked: false, regions: [], protectedPdf: null, pageCount: 0 };
      }
    }

    // 보호 표시본 (원본과 별도 경로) — 보호됨일 때만 두고, 아니면 지운다
    const viewPath = `${userId}/${documentId}.protected_view.pdf`;
    const existing = (await selectDerivatives(userId, documentId)).filter((d) => d.kind === 'protected_view');
    if (result.status === 'protected' && result.protectedPdf) {
      await uploadObject(BUCKET, viewPath, result.protectedPdf, 'application/pdf');
      await upsertDerivative({ user_id: userId, document_id: documentId, kind: 'protected_view', storage_path: viewPath, size_bytes: result.protectedPdf.byteLength });
    } else {
      for (const d of existing) {
        await removeObjects(BUCKET, [d.storage_path]);
        await deleteDerivative(d.id);
      }
    }

    await replaceRegions(
      userId,
      documentId,
      result.regions.map((r) => ({
        user_id: userId,
        document_id: documentId,
        page_number: r.page,
        sensitive_type: r.type,
        mask_level: r.level,
        bbox_json: r.bbox,
        confidence: r.confidence,
        source: 'pattern',
        state: r.state,
        user_confirmed: confirmed.has(r.key),
        masked_preview: r.maskedPreview,
        context_label: r.contextLabel,
        region_key: r.key,
      })),
    );
    await updateDocumentProtection(userId, documentId, {
      protection_status: result.status,
      protection_detail: result.detail,
      protection_images_unchecked: result.imagesUnchecked,
      protected_at: new Date().toISOString(),
    });
    console.log(`protect-document: doc=${documentId} status=${result.status} detail=${result.detail ?? '-'} pages=${result.pageCount} regions=${detectionCounts(result.regions)} ms=${Date.now() - started}`);
    return json({ status: result.status, detail: result.detail, imagesUnchecked: result.imagesUnchecked, regionCount: result.regions.length });
  } catch (e) {
    const code = e instanceof Error && /^[a-z_0-9]+$/.test(e.message) ? e.message : 'protect_failed';
    console.error(`protect-document: doc=${documentId} failed code=${code} ms=${Date.now() - started}`);
    await updateDocumentProtection(userId, documentId, { protection_status: 'failed', protection_detail: 'error', protected_at: new Date().toISOString() }).catch(() => undefined);
    return json({ error: code }, 500);
  }
});
