// 문서 확인 + 계약 추출 결과를 진행 여부와 함께 정리 (순수 — Edge Function과 앱 테스트 공용)
//
// 1차(firstPass): 모델 출력 → 문서 판정 → (진행일 때만) 추출 결과. 계약이 아니거나 읽을 수 없으면 추출 결과를 만들지 않는다.
// 마무리(finalize): 사용자 확인("계약 관련 문서가 맞아요")·사진 쪽 선택을 반영해 제외한 쪽의 값을 지운 결과를 만든다.
//   근거 위치를 모르는 값이 남아 안전을 보장할 수 없으면 needsReanalysis(남길 파일)로 알려 다시 분석하게 한다.
import {
  decide,
  downgradeUnknownOrigin,
  excludedPages,
  filterOutputByPages,
  parseDocumentCheck,
  verifiedSignals,
  type DocumentValidation,
  type FileKind,
  type PageRef,
} from './documentGate.ts';
import { normalizeModelOutput, toAppResult, type AppExtractionResult } from './extraction.ts';

export interface FirstPass {
  validation: DocumentValidation;
  /** decision = proceed 일 때만 */
  result: AppExtractionResult | null;
}

/** 추출 결과가 없는 상태의 신호 계산용 빈 값 */
const EMPTY = { category: { value: 'other' }, fields: {}, dates: [], payments: [], details: {}, checks: [] };

export function firstPass(raw: unknown, files: readonly FileKind[], provider: string): FirstPass {
  const output = normalizeModelOutput(raw);
  const check = parseDocumentCheck(output, files);
  // 계약이 아니거나 읽을 수 없으면 추출 값을 보지도 않는다 (가짜 날짜·금액이 결과로 나가지 않도록)
  if (check.role === 'non_contract' || check.role === 'unreadable') {
    return { validation: decide(check, verifiedSignals(check, EMPTY), files), result: null };
  }
  // PDF의 계약과 무관한·읽기 어려운 쪽 값은 처음부터 뺀다 (PDF는 쪽을 지울 수 없어 안내만)
  const pre = decide(check, verifiedSignals(check, EMPTY), files);
  const pdfExclusions = excludedPages(pre, [], []).filter((e) => e.page !== null);
  const filtered = filterOutputByPages(output, pdfExclusions);
  const app = toAppResult(filtered.unknownOrigin > 0 ? downgradeUnknownOrigin(filtered.output) : filtered.output, provider);
  const validation = decide(check, verifiedSignals(check, app), files);
  return { validation, result: validation.decision === 'proceed' ? app : null };
}

export interface FinalizeInput {
  /** 사용자가 "계약 관련 문서가 맞아요"를 눌렀는지 */
  confirmRole: boolean;
  /** 의심 사진 중 그대로 포함할 / 제외할 파일 번호 (1부터) */
  includeFiles: readonly number[];
  excludeFiles: readonly number[];
}

export type FinalizeOutcome =
  | { kind: 'done'; validation: DocumentValidation; result: AppExtractionResult | null; excluded: PageRef[]; removedValues: number }
  | { kind: 'reanalyze'; keepFiles: number[]; excluded: PageRef[] };

export class FinalizeError extends Error {}

/** 1차 결과에 사용자 선택을 반영 */
export function finalize(stored: unknown, prev: DocumentValidation, files: readonly FileKind[], input: FinalizeInput, provider: string): FinalizeOutcome {
  const rawOutput = normalizeModelOutput(stored);
  if (prev.decision.startsWith('stop_')) throw new FinalizeError('not_allowed');
  if (prev.decision === 'confirm_role' && !input.confirmRole && !prev.userConfirmedRole) throw new FinalizeError('confirmation_required');
  const excluded = excludedPages(prev, input.includeFiles, input.excludeFiles);
  const { output, removed, unknownOrigin } = filterOutputByPages(rawOutput, excluded);
  const imageExcluded = excluded.filter((e) => e.page === null).map((e) => e.file);
  // 모든 파일을 제외하면 남는 계약 정보가 없다
  if (imageExcluded.length >= files.length) {
    return { kind: 'done', validation: { ...prev, decision: 'stop_insufficient', userConfirmedRole: prev.userConfirmedRole || input.confirmRole }, result: null, excluded, removedValues: 0 };
  }
  // 제외한 사진이 있는데 근거 위치를 모르는 값이 있으면 그 값이 제외한 사진에서 왔는지 알 수 없다 → 그 사진을 빼고 다시 분석
  if (unknownOrigin > 0 && imageExcluded.length > 0) {
    return { kind: 'reanalyze', keepFiles: files.map((f) => f.file).filter((f) => !imageExcluded.includes(f)), excluded };
  }
  const app = toAppResult(unknownOrigin > 0 ? downgradeUnknownOrigin(output) : output, provider);
  const check = parseDocumentCheck(rawOutput, files);
  const signals = verifiedSignals(check, app);
  const signalCount = Object.values(signals).filter(Boolean).length;
  const userConfirmedRole = prev.userConfirmedRole || input.confirmRole;
  // 쪽을 뺀 뒤 계약 정보가 거의 남지 않으면 진행하지 않는다
  const decision = signalCount <= 1 ? 'stop_insufficient' : 'proceed';
  const validation: DocumentValidation = { ...prev, signals, signalCount, decision, userConfirmedRole };
  return { kind: 'done', validation, result: decision === 'proceed' ? app : null, excluded, removedValues: removed };
}
