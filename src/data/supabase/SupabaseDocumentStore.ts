import * as Crypto from 'expo-crypto';

import type { ContractDocument, DocumentProtection } from '@/domain/types';

import type { PickedFile } from '../ai/provider';
import { DocumentError, MAX_DOCUMENT_BYTES, type DocumentStore, type DocumentVariant, type ProtectionSummary, type UploadedDocument } from '../documents';
import type { PactoSupabase } from './client';
import type { PreparedFile } from './prepareFile';
import { CONTRACT_BUCKET, DOCUMENT_SELECT, toProtection, type DocumentRow } from './SupabaseContractRepository';

/** Signed URL 유효 시간 (초). 원본 열람 직후 만료되도록 짧게. */
export const SIGNED_URL_TTL_SECONDS = 120;

/**
 * private Storage 원본 보관소.
 * 경로: contract-files/{user_id}/{document_id}.{ext} — Storage RLS가 본인 폴더만 허용.
 * public URL은 사용하지 않는다.
 */
export class SupabaseDocumentStore implements DocumentStore {
  readonly mode = 'supabase' as const;

  constructor(
    private readonly sb: PactoSupabase,
    private readonly prepare: (file: PickedFile) => Promise<PreparedFile>,
    private readonly newId: () => string = () => Crypto.randomUUID(),
  ) {}

  async upload(file: PickedFile, options: { sortOrder?: number; contractId?: string } = {}): Promise<UploadedDocument> {
    const { data: auth } = await this.sb.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) throw new DocumentError('로그인이 필요해요.');

    let prepared: PreparedFile;
    try {
      prepared = await this.prepare(file);
    } catch {
      throw new DocumentError('이 파일은 보관할 수 없어요. PDF 또는 사진(JPG·PNG·HEIC)을 선택해주세요.');
    }
    if (prepared.bytes.byteLength > MAX_DOCUMENT_BYTES) throw new DocumentError('20MB 이하의 파일만 보관할 수 있어요.');

    const id = this.newId();
    const storagePath = `${userId}/${id}.${prepared.ext}`;
    const up = await this.sb.storage.from(CONTRACT_BUCKET).upload(storagePath, prepared.bytes, { contentType: prepared.mimeType, upsert: false });
    if (up.error) throw new DocumentError('계약서를 보관하지 못했어요. 네트워크를 확인하고 다시 시도해주세요.');

    const fileName = file.mimeType === prepared.mimeType ? file.name : file.name.replace(/\.[^.]+$/, '') + `.${prepared.ext}`;
    const { error } = await this.sb.from('contract_documents').insert({
      id,
      storage_path: storagePath,
      mime_type: prepared.mimeType,
      size_bytes: prepared.bytes.byteLength,
      original_filename: fileName.slice(0, 255),
      sort_order: options.sortOrder ?? 0,
      contract_id: options.contractId ?? null,
    });
    if (error) {
      await this.sb.storage.from(CONTRACT_BUCKET).remove([storagePath]);
      throw new DocumentError('계약서를 보관하지 못했어요. 다시 시도해주세요.');
    }
    return { id, fileName, mimeType: prepared.mimeType, sizeBytes: prepared.bytes.byteLength, storagePath, localUri: null };
  }

  /** 보호 표시본(기본) 또는 원본의 짧은 Signed URL. 보호본이 없는데 보호본을 요청하면 오류 (원본으로 대신 열지 않는다) */
  async openUrl(doc: Pick<ContractDocument, 'storagePath' | 'localUri' | 'protection'>, variant: DocumentVariant = 'original'): Promise<string> {
    const path = variant === 'protected_view' ? doc.protection?.protectedViewPath : doc.storagePath;
    if (!path) throw new DocumentError(variant === 'protected_view' ? '보호된 문서가 아직 없어요.' : '보관된 원본이 없어요.');
    const { data, error } = await this.sb.storage.from(CONTRACT_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) throw new DocumentError('원본을 열지 못했어요. 잠시 후 다시 시도해주세요.');
    return data.signedUrl;
  }

  async discard(documentIds: string[]): Promise<void> {
    if (documentIds.length === 0) return;
    const { data } = await this.sb.from('contract_documents').select('id, storage_path, document_derivatives(storage_path)').in('id', documentIds).is('contract_id', null);
    const rows = data ?? [];
    if (rows.length === 0) return;
    // 원본 + 보호 표시본 등 파생 파일 → 기록 (민감정보 영역·파생본 기록은 cascade)
    await this.sb.storage.from(CONTRACT_BUCKET).remove(rows.flatMap((r) => [r.storage_path, ...(r.document_derivatives ?? []).map((d) => d.storage_path)]));
    await this.sb.from('contract_documents').delete().in('id', rows.map((r) => r.id));
  }

  async protect(documentId: string, regions?: { id: string; state: 'masked' | 'unmasked' }[], opts?: { password?: string }): Promise<ProtectionSummary> {
    // 비밀번호는 POST body로만 (주소·저장 없음)
    const { data, error } = await this.sb.functions.invoke<ProtectionSummary>('protect-document', {
      method: 'POST',
      body: { documentId, ...(regions?.length ? { regions } : {}), ...(opts?.password ? { password: opts.password } : {}) },
    });
    // 보호 처리 없이 비밀번호만 요청한 응답 (status 없음) — 보호가 끝난 문서의 access(password_required)는 원본 상태라 아래로
    if (!error && data && !data.status && (data.access === 'password_required' || data.access === 'invalid_password')) return { status: 'pending', detail: null, access: data.access };
    if (error || !data?.status) return { status: 'failed', detail: 'request_failed' };
    return { status: data.status, detail: data.detail ?? null, ...(data.access ? { access: data.access } : {}) };
  }

  async getProtection(documentIds: string[]): Promise<Record<string, DocumentProtection>> {
    if (documentIds.length === 0) return {};
    const { data, error } = await this.sb.from('contract_documents').select(DOCUMENT_SELECT).in('id', documentIds);
    if (error) throw new DocumentError('보호 상태를 불러오지 못했어요.');
    return Object.fromEntries(((data ?? []) as unknown as DocumentRow[]).map((r) => [r.id, toProtection(r)]));
  }
}
