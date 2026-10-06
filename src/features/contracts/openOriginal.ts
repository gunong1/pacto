import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { documentStore } from '@/data';
import type { ContractDocument } from '@/domain/types';
import { notify } from '@/lib/dialog';

/**
 * 원본 계약서 열기 — 비공개 저장소의 짧은 Signed URL(2분)로만 연다. 공개 URL은 사용하지 않는다.
 * page가 있으면 PDF 뷰어가 그 쪽으로 이동하도록 #page=N을 붙인다 (지원하지 않는 뷰어는 첫 쪽).
 * 웹은 팝업 차단을 피하기 위해 탭을 먼저 연 뒤 주소를 넣는다.
 */
export async function openOriginal(doc: Pick<ContractDocument, 'storagePath' | 'localUri' | 'mimeType'>, page?: number | null) {
  const tab = Platform.OS === 'web' ? window.open('', '_blank') : null;
  try {
    let url = await documentStore.openUrl(doc);
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
    notify('계약서 원본', e instanceof Error ? e.message : '원본을 열지 못했어요.');
  }
}
