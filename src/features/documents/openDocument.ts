import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { documentStore } from '@/data';
import type { DocumentVariant } from '@/data/documents';
import type { ContractDocument } from '@/domain/types';
import { confirm, notify } from '@/lib/dialog';

type Doc = Pick<ContractDocument, 'storagePath' | 'localUri' | 'mimeType' | 'protection'>;

/**
 * 원본(민감정보가 그대로인 문서)을 보여주기 전 확인 — 진입점을 이 함수 하나로 모은다.
 * V1: 확인 대화상자. 향후 생체인증·PIN·재인증을 여기에 연결한다.
 */
export async function requireReveal(): Promise<boolean> {
  return confirm('원본 보기', '원본 계약서를 표시합니다. 민감정보가 포함되어 있을 수 있습니다.\n확인 후 열어주세요.', '원본 보기');
}

/** 비공개 저장소의 짧은 Signed URL(2분)로만 연다. page가 있으면 PDF 뷰어가 그 쪽으로 이동하도록 #page=N */
async function openUrl(doc: Doc, variant: DocumentVariant, page?: number | null) {
  // 웹은 팝업 차단을 피하기 위해 탭을 먼저 연 뒤 주소를 넣는다
  const tab = Platform.OS === 'web' ? window.open('', '_blank') : null;
  try {
    let url = await documentStore.openUrl(doc, variant);
    if (page && doc.mimeType === 'application/pdf') url = `${url}#page=${page}`;
    if (Platform.OS === 'web') {
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.location.href = url;
    } else {
      await WebBrowser.openBrowserAsync(url);
    }
  } catch (e) {
    tab?.close();
    notify('계약서', e instanceof Error ? e.message : '계약서를 열지 못했어요.');
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
