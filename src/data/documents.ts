import type { ContractDocument } from '@/domain/types';

import type { PickedFile } from './ai/provider';

/** 업로드되어 저장소에 보관된 원본 (아직 계약에 연결 전일 수 있음) */
export interface UploadedDocument {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string | null;
  localUri: string | null;
}

/**
 * 계약서 원본 보관소.
 * - Supabase: private bucket 'contract-files/{user_id}/{document_id}.{ext}', 열람은 짧은 Signed URL만
 * - mock: 기기 로컬 URI만 사용 (업로드 없음)
 */
export interface DocumentStore {
  readonly mode: 'supabase' | 'mock';
  /** 원본 업로드 (사진은 JPEG로 변환·축소). contractId가 있으면 바로 그 계약에 연결 */
  upload(file: PickedFile, options?: { sortOrder?: number; contractId?: string }): Promise<UploadedDocument>;
  /** 원본 열람용 URL (Supabase: 수 분 내 만료되는 Signed URL) */
  openUrl(doc: Pick<ContractDocument, 'storagePath' | 'localUri'>): Promise<string>;
  /** 저장하지 않고 취소한 업로드 정리 (계약에 연결된 문서는 지우지 않음) */
  discard(documentIds: string[]): Promise<void>;
}

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export class DocumentError extends Error {}

let seq = 0;
export class MockDocumentStore implements DocumentStore {
  readonly mode = 'mock' as const;
  async upload(file: PickedFile) {
    if (file.size != null && file.size > MAX_DOCUMENT_BYTES) throw new DocumentError('20MB 이하의 파일만 보관할 수 있어요.');
    seq += 1;
    return { id: `mock-doc-${seq}`, fileName: file.name, mimeType: file.mimeType, sizeBytes: file.size ?? 0, storagePath: null, localUri: file.uri };
  }
  async openUrl(doc: Pick<ContractDocument, 'storagePath' | 'localUri'>) {
    if (!doc.localUri) throw new DocumentError('미리보기 모드에서는 예시 계약서의 원본을 열 수 없어요.');
    return doc.localUri;
  }
  async discard() {}
}
