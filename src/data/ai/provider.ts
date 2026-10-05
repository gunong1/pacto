import type { AiCheck, Confidence } from '@/domain/types';

import type { ContractDraft } from '../repository';

/**
 * AI 서비스 추상화 (ARCHITECTURE.md §2.2).
 * 앱은 이 인터페이스만 안다. Step 1~4는 MockAIProvider,
 * Step 9부터 Edge Function(`analyze-contract`)을 호출하는 구현체로 교체한다.
 * API Key는 앱에 절대 포함하지 않는다.
 */

export interface PickedFile {
  name: string;
  uri: string;
  mimeType: string;
  size: number | null;
  /** 이미지 가로 픽셀 (큰 사진 축소 판단용) */
  width?: number | null;
}

export interface ExtractInput {
  files: PickedFile[];
  /** 비공개 저장소에 보관된 원본 id — 서버 분석은 이 문서를 읽는다 */
  documentIds: string[];
  today: string;
}

export interface Extracted<T> {
  value: T | null;
  confidence: Confidence;
  evidence?: { page: number; quote: string }[];
}

export type ExtractedFields = { [K in keyof ContractDraft]?: Extracted<ContractDraft[K]> };

export type ExtractedCheck = Omit<AiCheck, 'id' | 'contractId' | 'status'>;

export interface ExtractionResult {
  fields: ExtractedFields;
  checks: ExtractedCheck[];
  provider: string;
  promptVersion: string;
  /** 서버 분석 작업 id (analysis_jobs) */
  jobId?: string;
}

/** AI 처리(외부 전송) 동의가 필요함 */
export class AIConsentRequiredError extends Error {}

/** AI 분석 실패 — message는 사용자에게 보여줄 문구 */
export class AIExtractionError extends Error {}

export interface AIProvider {
  readonly name: string;
  extractContract(input: ExtractInput, signal?: AbortSignal): Promise<ExtractionResult>;
  // P2: answerQuestion(input: AskInput): Promise<GroundedAnswer>
}
