import type { AiCheck } from '@/domain/types';

import type { DocumentValidation } from '../../../supabase/functions/_shared/documentGate';
import type { AppExtractionResult } from '../../../supabase/functions/_shared/extraction';

export type { DocumentRole, DocumentValidation, GateDecision } from '../../../supabase/functions/_shared/documentGate';

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
  /** 이미지 가로·세로 픽셀 (큰 사진 축소 · 해상도 점검용) */
  width?: number | null;
  height?: number | null;
  /** 앱에서 직접 촬영한 사진 (임시 파일 — 등록이 끝나면 지운다) */
  captured?: boolean;
}

export interface ExtractInput {
  files: PickedFile[];
  /** 비공개 저장소에 보관된 원본 id — 서버 분석은 이 문서를 읽는다 */
  documentIds: string[];
  today: string;
  /** 암호 PDF 비밀번호 (문서 id → 비밀번호) — 등록 화면 메모리에만 있고, 분석 요청 POST body로만 보낸다 */
  passwords?: Readonly<Record<string, string>>;
}

/**
 * AI 추출 결과 (초안). 형식은 서버 Edge Function과 같은 정의를 쓴다 (supabase/functions/_shared/extraction.ts).
 * 계약 유형 분류(신뢰도·대안) → 날짜·금액을 의미와 함께 나열 → 유형별 속성 → 확인할 조항.
 * 계약 정보로 바꾸는 일은 features/registration/extraction.ts(toReviewModel)가 하고, 사용자가 확인한 뒤 저장한다.
 */
export type ExtractionResult = AppExtractionResult & {
  /** 서버 분석 작업 id (analysis_jobs) */
  jobId?: string;
};

export type { ExtractedDate, ExtractedPayment } from '../../../supabase/functions/_shared/extraction';

export type ExtractedCheck = Omit<AiCheck, 'id' | 'contractId' | 'status'>;

/**
 * 분석 결과 — 문서 확인 판정 + (통과했을 때만) 추출 결과.
 * 계약이 아니거나 읽을 수 없거나 정보가 부족하면 result는 null (확인 화면으로 가지 않는다).
 */
export interface AnalysisOutcome {
  jobId?: string;
  validation: DocumentValidation;
  result: ExtractionResult | null;
  /** 마무리에서 제외된 사진 (첨부 순서 1부터) — 앱이 보관본을 지운다 */
  excludedFiles?: number[];
}

/** 사용자 선택: "계약 관련 문서가 맞아요" · 의심 사진 포함/제외 (첨부 순서 1부터) */
export interface AnalysisChoice {
  confirmRole: boolean;
  includeFiles: number[];
  excludeFiles: number[];
}

/** AI 처리(외부 전송) 동의가 필요함 */
export class AIConsentRequiredError extends Error {}

/** AI 분석 실패 — message는 사용자에게 보여줄 문구 */
export class AIExtractionError extends Error {}

export interface AIProvider {
  readonly name: string;
  /** 문서 확인 + 계약 추출 (AI 1회) */
  analyze(input: ExtractInput, signal?: AbortSignal): Promise<AnalysisOutcome>;
  /** 사용자 확인·쪽 선택 반영 (제외한 쪽의 값은 결과에서 빠진다) */
  finalize(jobId: string | undefined, choice: AnalysisChoice, input: ExtractInput, signal?: AbortSignal): Promise<AnalysisOutcome>;
  // P2: answerQuestion(input: AskInput): Promise<GroundedAnswer>
}
