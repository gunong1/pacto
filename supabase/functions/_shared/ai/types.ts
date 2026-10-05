export interface ContractFile {
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  fileName: string;
  base64: string;
}

export interface ProviderOutput {
  /** 모델이 반환한 JSON (검증 전) */
  json: unknown;
  model: string;
}

/** 계약서 추출 공급자 (OpenAI / Gemini / Claude 교체 가능) */
export interface ExtractionProvider {
  readonly name: string;
  extract(files: ContractFile[], today: string): Promise<ProviderOutput>;
}

export class ProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
