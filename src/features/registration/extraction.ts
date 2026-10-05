import type { ExtractionResult } from '@/data/ai/provider';
import { EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft } from '@/data/repository';

/** 값이 없으면 "확인 필요"로 표시할 주요 필드 */
const KEY_FIELDS: (keyof ContractDraft)[] = ['title', 'counterparty', 'startDate', 'endDate', 'paymentAmount', 'paymentDay', 'contractDate'];

export interface ReviewModel {
  draft: ContractDraft;
  /** 신뢰도 낮음 또는 주요 필드 값 없음 */
  flagged: Set<string>;
  /** 필드별 원문 근거(첫 번째) */
  evidence: Partial<Record<string, string>>;
}

/** AI 추출 결과(초안) → 확인 화면 모델. 추출값은 사실이 아니라 사용자가 확인할 초안이다. */
export function toReviewModel(result: ExtractionResult): ReviewModel {
  const draft: Record<string, unknown> = { ...EMPTY_DRAFT };
  const flagged = new Set<string>();
  const evidence: Partial<Record<string, string>> = {};

  for (const [key, f] of Object.entries(result.fields)) {
    if (!f) continue;
    if (f.value != null) draft[key] = f.value;
    if (f.confidence === 'low') flagged.add(key);
    const quote = f.evidence?.[0]?.quote;
    if (quote) evidence[key] = quote;
  }
  for (const key of KEY_FIELDS) {
    if (draft[key] == null || draft[key] === '') flagged.add(key);
  }
  return { draft: draft as unknown as ContractDraft, flagged, evidence };
}
