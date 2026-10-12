/**
 * 저장된 계약의 계약서 근거 — 등록 때의 분석 결과(analysis_jobs.result)에서 등록 확인 화면과 같은 규칙(toReviewModel)으로 만든다.
 * 사용자가 값을 고쳐도 분석 결과(AI가 읽은 값·근거)는 그대로 남아 있어 비교해 보여줄 수 있다.
 * 결제·주요 날짜처럼 순서가 바뀔 수 있는 목록 경로는 붙이지 않는다 (stableEvidence).
 */
import { useQuery } from '@tanstack/react-query';

import { contractRepository } from '@/data';
import type { ExtractionResult } from '@/data/ai/provider';
import { stableEvidence, type EvidenceMap } from '@/domain/evidence';
import type { ContractRecord } from '@/domain/types';
import { draftToForm, type ContractFormValues } from '@/features/contracts/form';
import { toReviewModel } from '@/features/registration/extraction';

export function useContractEvidence(record: ContractRecord | null | undefined): { evidence: EvidenceMap; aiValues: ContractFormValues | null } {
  const q = useQuery({
    queryKey: ['contract-evidence', record?.contract.id ?? ''],
    enabled: !!record && record.contract.source !== 'manual',
    staleTime: Infinity,
    queryFn: async () => {
      const result = await contractRepository.analysisResult(record!.contract.id);
      if (!result || typeof result !== 'object') return { evidence: {}, aiValues: null };
      try {
        const model = toReviewModel(result as ExtractionResult, record!.documents.map((d) => d.id));
        return { evidence: stableEvidence(model.evidence), aiValues: draftToForm(model.draft) };
      } catch {
        // 예전 형식의 결과 — 근거 없이 (값은 그대로)
        return { evidence: {}, aiValues: null };
      }
    },
  });
  return q.data ?? { evidence: {}, aiValues: null };
}
