import { create } from 'zustand';

import type { ExtractionResult, PickedFile } from '@/data/ai/provider';

/** 등록 위저드(방식 선택 → 분석 → 확인) 단계 간 공유하는 초안. 저장 전까지 메모리에만 존재. */
interface RegistrationState {
  method: 'pdf' | 'photo' | 'manual' | null;
  files: PickedFile[];
  extraction: ExtractionResult | null;
  start: (method: 'pdf' | 'photo', files: PickedFile[]) => void;
  setExtraction: (r: ExtractionResult) => void;
  reset: () => void;
}

export const useRegistration = create<RegistrationState>((set) => ({
  method: null,
  files: [],
  extraction: null,
  start: (method, files) => set({ method, files, extraction: null }),
  setExtraction: (extraction) => set({ extraction }),
  reset: () => set({ method: null, files: [], extraction: null }),
}));
