import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { documentStore } from '@/data';
import type { DocumentVariant } from '@/data/documents';
import type { ContractDocument } from '@/domain/types';
import { putViewerSession } from '@/features/viewer/session';
import { isUsableDocumentUrl } from '@/features/viewer/viewerHtml';
import { confirm, notify } from '@/lib/dialog';

type Doc = Pick<ContractDocument, 'storagePath' | 'localUri' | 'mimeType' | 'protection'>;

/**
 * 원본(민감정보가 그대로인 문서)을 보여주기 전 확인 — 진입점을 이 함수 하나로 모은다.
 * V1: 확인 대화상자. 향후 생체인증·PIN·재인증을 여기에 연결한다.
 */
export async function requireReveal(): Promise<boolean> {
  return confirm('원본 보기', '원본 계약서를 표시합니다. 민감정보가 포함되어 있을 수 있습니다.\n확인 후 열어주세요.', '원본 보기');
}

/**
 * 문서마다 PDF / 사진을 정한다 (mime_type 우선, 없으면 파일 확장자) — 사진은 pdf.js를 거치지 않는다.
 * 보호본: PDF 원본 → 보호 PDF, 사진 원본 → 보호 JPEG
 */
export function documentKind(doc: Pick<ContractDocument, 'mimeType' | 'storagePath'>, variant: DocumentVariant): 'pdf' | 'image' {
  const ext = (doc.storagePath ?? '').split('.').pop()?.toLowerCase() ?? '';
  const mime = (doc.mimeType ?? '').toLowerCase();
  // 보호본은 원본 형식을 따른다 (PDF → 보호 PDF, 사진 → 보호 JPEG)
  void variant;
  return mime === 'application/pdf' || (!mime.startsWith('image/') && ext === 'pdf') ? 'pdf' : 'image';
}

const OPEN_FAILED = '계약서를 불러오지 못했어요. 잠시 후 다시 시도해주세요.';

const TITLE: Record<DocumentVariant, string> = { protected_view: '보호된 계약서', original: '원본 계약서' };

/**
 * 비공개 저장소의 짧은 Signed URL(2분)로만 연다.
 * 앱(Android·iOS): 앱 안 뷰어(pdf.js, 화면 폭 맞춤·확대) — 외부 브라우저로 넘기지 않는다. page가 있으면 그 쪽으로 이동
 * 웹: 새 탭 (#page=N)
 */
async function openUrl(doc: Doc, variant: DocumentVariant, page?: number | null) {
  // 웹은 팝업 차단을 피하기 위해 탭을 먼저 연 뒤 주소를 넣는다
  const tab = Platform.OS === 'web' ? window.open('', '_blank') : null;
  try {
    const signed: unknown = await documentStore.openUrl(doc, variant);
    if (typeof signed !== 'string' || !signed) throw new Error(OPEN_FAILED);
    let url = signed;
    if (Platform.OS !== 'web' && !url.startsWith('file:')) {
      // Signed URL을 만들지 못했거나 형식이 이상하면 뷰어를 열지 않는다
      if (!isUsableDocumentUrl(url)) throw new Error(OPEN_FAILED);
      const id = putViewerSession({ url, kind: documentKind(doc, variant), page: page ?? null, title: TITLE[variant] ?? '계약서' });
      router.push({ pathname: '/viewer', params: { id } });
      return;
    }
    if (page && doc.mimeType === 'application/pdf') url = `${url}#page=${page}`;
    if (Platform.OS === 'web') {
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.location.href = url;
    } else {
      // 미리보기(기기 안 파일)만 — 실제 저장소 문서는 위의 앱 안 뷰어
      await WebBrowser.openBrowserAsync(url);
    }
  } catch (e) {
    tab?.close();
    // 내부 오류 메시지(주소가 섞일 수 있음)는 보여주지 않는다 — 저장소 쪽 안내 문구(한글)만 그대로
    notify('계약서', e instanceof Error && /[가-힣]/.test(e.message) ? e.message : OPEN_FAILED);
  }
}

/**
 * 계약서 보기 (기본 동작) — 보호 표시본이 있으면 그것을, 없으면 원본을 연다.
 * 보호본이 없고 민감정보가 있을 수 있는 경우(처리 전·사진·스캔본·실패)에는 원본을 열기 전에 확인한다.
 */
export async function viewDocument(doc: Doc, page?: number | null) {
  const p = doc.protection;
  if (p?.protectedViewPath) return openUrl(doc, 'protected_view', page);
  // 민감정보를 찾지 못한 문서·미리보기(mock) 문서는 바로 연다
  if (p?.status === 'no_sensitive_data' || !doc.storagePath) return openUrl(doc, 'original', page);
  if (await requireReveal()) await openUrl(doc, 'original', page);
}

/** 원본 보기 (명시적으로 선택했을 때) */
export async function viewOriginal(doc: Doc, page?: number | null) {
  if (await requireReveal()) await openUrl(doc, 'original', page);
}
