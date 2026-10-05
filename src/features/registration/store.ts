import { create } from 'zustand';

import type { ExtractionResult, PickedFile } from '@/data/ai/provider';
import type { UploadedDocument } from '@/data/documents';

/** 등록 위저드(방식 선택 → 분석 → 확인) 단계 간 공유하는 초안. 저장 전까지 메모리에만 존재. */
interface RegistrationState {
  method: 'pdf' | 'photo' | 'manual' | null;
  files: PickedFile[];
  extraction: ExtractionResult | null;
  /** 보관(업로드) 완료된 원본 — 저장 시 계약에 연결, 취소 시 정리 */
  uploaded: UploadedDocument[];
  setUploaded: (docs: UploadedDocument[]) => void;
  start: (method: 'pdf' | 'photo', files: PickedFile[]) => void;
  setExtraction: (r: ExtractionResult) => void;
  reset: () => void;
}

export const useRegistration = create<RegistrationState>((set) => ({
  method: null,
  files: [],
  extraction: null,
  uploaded: [],
  setUploaded: (uploaded) => set({ uploaded }),
  start: (method, files) => set({ method, files, extraction: null, uploaded: [] }),
  setExtraction: (extraction) => set({ extraction }),
  reset: () => set({ method: null, files: [], extraction: null, uploaded: [] }),
}));
