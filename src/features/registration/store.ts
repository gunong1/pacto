import { create } from 'zustand';

import type { DocumentValidation, ExtractionResult, PickedFile } from '@/data/ai/provider';
import type { UploadedDocument } from '@/data/documents';

import { discardCaptured } from './camera';

export type PhotoSource = 'camera' | 'album';

/** 등록 위저드(방식 선택 → (촬영) → 분석 → 확인) 단계 간 공유하는 초안. 저장 전까지 메모리에만 존재. */
interface RegistrationState {
  method: 'pdf' | 'photo' | 'manual' | null;
  photoSource: PhotoSource | null;
  files: PickedFile[];
  extraction: ExtractionResult | null;
  /** 문서 확인 판정 (PDF 의심 쪽 안내 등 확인 화면에서 사용) */
  validation: DocumentValidation | null;
  /** 보관(업로드) 완료된 원본 — 저장 시 계약에 연결, 취소 시 정리 */
  uploaded: UploadedDocument[];
  /** 촬영 중인 페이지 (촬영 완료 전) */
  captured: PickedFile[];
  /**
   * 암호 PDF 비밀번호 (문서 id → 비밀번호) — 이 메모리에만 있다. 기기 저장소·로그에 남기지 않고,
   * 분석이 끝나거나 등록을 취소·종료하면 지운다 (clearPasswords / reset)
   */
  passwords: Record<string, string>;
  setPassword: (documentId: string, password: string) => void;
  clearPasswords: () => void;
  setUploaded: (docs: UploadedDocument[]) => void;
  setFiles: (files: PickedFile[]) => void;
  setCaptured: (files: PickedFile[]) => void;
  start: (method: 'pdf' | 'photo', files: PickedFile[], photoSource?: PhotoSource) => void;
  setExtraction: (r: ExtractionResult, validation?: DocumentValidation | null) => void;
  reset: () => void;
}

export const useRegistration = create<RegistrationState>((set, get) => ({
  method: null,
  photoSource: null,
  files: [],
  extraction: null,
  validation: null,
  uploaded: [],
  captured: [],
  passwords: {},
  setPassword: (documentId, password) => set((s) => ({ passwords: { ...s.passwords, [documentId]: password } })),
  clearPasswords: () => set({ passwords: {} }),
  setUploaded: (uploaded) => set({ uploaded }),
  setFiles: (files) => set({ files }),
  setCaptured: (captured) => set({ captured }),
  start: (method, files, photoSource) => set({ method, files, photoSource: photoSource ?? null, extraction: null, validation: null, uploaded: [], captured: [], passwords: {} }),
  setExtraction: (extraction, validation = null) => set({ extraction, validation }),
  reset: () => {
    // 촬영한 임시 사진은 등록이 끝나면(저장·취소 모두) 지운다
    const { files, captured } = get();
    discardCaptured([...files, ...captured]);
    set({ method: null, photoSource: null, files: [], extraction: null, validation: null, uploaded: [], captured: [], passwords: {} });
  },
}));
