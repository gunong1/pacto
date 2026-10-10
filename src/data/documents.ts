import type { ContractDocument, DocumentProtection, ProtectionStatus } from '@/domain/types';

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
  openUrl(doc: Pick<ContractDocument, 'storagePath' | 'localUri' | 'protection'>, variant?: DocumentVariant): Promise<string>;
  /** 저장하지 않고 취소한 업로드 정리 (계약에 연결된 문서는 지우지 않음) — 파생 파일·민감정보 기록 포함 */
  discard(documentIds: string[]): Promise<void>;
  /**
   * 민감정보 보호 처리 (서버). regions가 있으면 사용자의 가림 선택을 반영해 보호본을 다시 만든다.
   * 원본은 수정하지 않는다. mock 모드는 처리하지 않는다(pending).
   */
  /**
   * password: 암호 PDF의 비밀번호 (사용자 입력) — POST body로만 보내고 저장하지 않는다.
   * 결과 access: password_required(비밀번호 필요) · invalid_password(틀림, 저장되지 않는 한 번의 결과) · unsupported_encryption
   */
  protect(documentId: string, regions?: { id: string; state: 'masked' | 'unmasked' }[], opts?: { password?: string }): Promise<ProtectionSummary>;
  /** 문서별 보호 결과 (계약에 연결 전인 업로드 문서 포함) */
  getProtection(documentIds: string[]): Promise<Record<string, DocumentProtection>>;
}

export interface ProtectionSummary {
  status: ProtectionStatus;
  detail: string | null;
  /** 암호 PDF: 비밀번호가 필요하거나 틀렸으면 보호 처리를 하지 않고 이 값만 온다 */
  access?: 'accessible' | 'password_required' | 'invalid_password' | 'unsupported_encryption';
}

/** 원본 열기 대상: 보호 표시본(기본) 또는 원본 */
export type DocumentVariant = 'protected_view' | 'original';

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
  async protect(): Promise<ProtectionSummary> {
    return { status: 'pending', detail: 'preview_mode' };
  }
  async getProtection(): Promise<Record<string, DocumentProtection>> {
    return {};
  }
}
