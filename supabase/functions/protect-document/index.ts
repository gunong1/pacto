// 계약서 민감정보 보호: 본인 문서 확인 → 비공개 저장소에서 원본 읽기(수정하지 않음) → 탐지 → 실제 제거한 보호 표시본 저장
// - PDF: 외부 서비스로 보내지 않는다 (탐지·제거 모두 이 함수 안에서)
// - 사진(JPG·PNG): 글자를 읽기 위해 원본 이미지를 CLOVA OCR(네이버클라우드)로 보낸다 — OCR 결과는 메모리에서만 쓰고 저장·로그하지 않는다
//   사용자가 가림만 바꾸면 OCR을 다시 하지 않고 저장된 위치로 보호본을 다시 그린다
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
import { ClovaOcr } from '../_shared/protection/ocrProvider.ts';
import { protectPdf, safeErrorCode, type ProtectedRegion, type ProtectResult, type RegionState } from '../_shared/protection/protect.ts';
import { protectImage, redrawImage, type ImageProtectDiagnostics } from '../_shared/protection/protectImage.ts';
import type { SensitiveType } from '../_shared/protection/sensitive.ts';
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
  // 진단: 어느 단계에서 멈췄는지 (download → protect → storage_upload → db_save). 원문·좌표·글꼴 이름은 남기지 않는다
  let stage = 'db_read';
  let result: ProtectResult | null = null;
  let imageDiag: ImageProtectDiagnostics | null = null;
  let derivativeCreated = false;
  const logDiagnostics = (extra: Record<string, unknown>) =>
    console.log(
      `protect-document diagnostics: ${JSON.stringify({
        documentId,
        mimeType: doc.mime_type,
        sizeBytes: doc.size_bytes,
        stage,
        status: result?.status ?? null,
        detail: result?.detail ?? null,
        derivativeCreated,
        ms: Date.now() - started,
        ...(result?.diagnostics ?? {}),
        ...(imageDiag ?? {}),
        ...extra,
      })}`,
    );
  try {
    if (updates.length) await updateRegionStates(userId, documentId, updates);
    const prev = await selectRegions(userId, documentId);
    const prevStates = new Map<string, RegionState>(prev.map((r) => [r.region_key, r.state]));
    const confirmed = new Set(prev.filter((r) => r.user_confirmed).map((r) => r.region_key));

    const isImage = doc.mime_type === 'image/jpeg' || doc.mime_type === 'image/png';
    let viewBytes: Uint8Array | null = null;
    if (isImage) {
      stage = 'download';
      const bytes = await downloadObject(BUCKET, doc.storage_path);
      stage = 'protect';
      // 가림만 바꾼 경우: 이미 보호된 사진이면 저장된 위치로 다시 그린다 (OCR 다시 안 함)
      const stored: ProtectedRegion[] = prev.map((r) => ({
        key: r.region_key,
        page: r.page_number,
        type: r.sensitive_type as SensitiveType,
        level: r.mask_level,
        confidence: r.confidence,
        state: r.state,
        maskedPreview: r.masked_preview,
        contextLabel: r.context_label,
        bbox: r.bbox_json,
      }));
      const ocr = ClovaOcr.fromEnv(Deno.env);
      const img =
        updates.length > 0 && doc.protection_status === 'protected' && stored.length > 0
          ? await redrawImage(bytes, stored)
          : ocr
            ? await protectImage(bytes, { ocr, prevStates })
            : null;
      if (!img) {
        result = { status: 'failed', detail: 'ocr_not_configured', imagesUnchecked: false, regions: [], protectedPdf: null, pageCount: 1, diagnostics: undefined as never };
      } else {
        imageDiag = img.diagnostics;
        result = { status: img.status, detail: img.detail, imagesUnchecked: false, regions: img.regions, protectedPdf: null, pageCount: 1, diagnostics: undefined as never };
        viewBytes = img.protectedImage;
      }
    } else if (doc.mime_type !== 'application/pdf') {
      result = { status: 'unsupported_scan', detail: 'image_file', imagesUnchecked: false, regions: [], protectedPdf: null, pageCount: 1, diagnostics: undefined as never };
    } else {
      stage = 'download';
      const bytes = await downloadObject(BUCKET, doc.storage_path);
      stage = 'protect';
      try {
        result = await protectPdf(bytes, prevStates);
      } catch (e) {
        result = { status: 'failed', detail: 'error', imagesUnchecked: false, regions: [], protectedPdf: null, pageCount: 0, diagnostics: undefined as never };
        logDiagnostics({ errorCode: safeErrorCode(e), downloadedBytes: bytes.byteLength });
      }
    }

    // 보호 표시본 (원본과 별도 경로) — 보호됨일 때만 두고, 아니면 지운다
    const view = isImage ? viewBytes : result.protectedPdf;
    const viewPath = `${userId}/${documentId}.protected_view.${isImage ? 'jpg' : 'pdf'}`;
    const existing = (await selectDerivatives(userId, documentId)).filter((d) => d.kind === 'protected_view');
    stage = 'storage_upload';
    if (result.status === 'protected' && view) {
      await uploadObject(BUCKET, viewPath, view, isImage ? 'image/jpeg' : 'application/pdf');
      await upsertDerivative({ user_id: userId, document_id: documentId, kind: 'protected_view', storage_path: viewPath, size_bytes: view.byteLength });
      derivativeCreated = true;
    } else {
      for (const d of existing) {
        await removeObjects(BUCKET, [d.storage_path]);
        await deleteDerivative(d.id);
      }
    }

    stage = 'db_save';
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
        source: isImage ? 'ocr' : 'pattern',
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
    stage = 'done';
    console.log(`protect-document: doc=${documentId} status=${result.status} detail=${result.detail ?? '-'} pages=${result.pageCount} regions=${detectionCounts(result.regions)} ms=${Date.now() - started}`);
    logDiagnostics({});
    // 사진은 단계별 시간·개수도 돌려준다 (성능 측정용 — 원문·좌표 없음)
    return json({
      status: result.status,
      detail: result.detail,
      imagesUnchecked: result.imagesUnchecked,
      regionCount: result.regions.length,
      ...(imageDiag ? { metrics: { ...imageDiag.timings, ocrCalls: imageDiag.ocrCalls, width: imageDiag.width, height: imageDiag.height, viewWidth: imageDiag.viewWidth, viewHeight: imageDiag.viewHeight, ocrFieldCount: imageDiag.ocrFieldCount, detectedSensitiveCount: imageDiag.detectedSensitiveCount, redactedRegionCount: imageDiag.redactedRegionCount, verification: imageDiag.verification, stage: imageDiag.stage, errorCode: imageDiag.errorCode } } : {}),
    });
  } catch (e) {
    const code = e instanceof Error && /^[a-z_0-9]+$/.test(e.message) ? e.message : 'protect_failed';
    console.error(`protect-document: doc=${documentId} failed stage=${stage} code=${code} ms=${Date.now() - started}`);
    logDiagnostics({ errorCode: e instanceof Error && /^[a-z_0-9]+$/.test(e.message) ? e.message : safeErrorCode(e) });
    await updateDocumentProtection(userId, documentId, { protection_status: 'failed', protection_detail: 'error', protected_at: new Date().toISOString() }).catch(() => undefined);
    return json({ error: code }, 500);
  }
});
