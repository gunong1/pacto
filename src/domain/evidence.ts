/**
 * 계약서 근거(AI가 값을 읽은 문장) 표시 규칙 — 등록 확인 · 계약 수정 · 계약 상세가 함께 쓴다 (화면마다 규칙을 따로 두지 않음).
 *
 * 1) 근거 문장은 입력칸 아래에 늘 펼쳐 두지 않는다 — 근거가 있으면 "계약서 근거 보기" 아이콘만, 누르면 문장·쪽을 본다
 * 2) 근거가 없는 값(직접 입력)에는 아이콘이 없다
 * 3) 신뢰도가 낮거나 AI가 추정한 값은 "확인 필요"로 강조 (근거와 별개)
 * 4) 사용자가 값을 고쳐도 AI가 읽은 값과 근거는 그대로 보여준다 (저장되는 값은 사용자가 고친 값)
 * 5) 근거 문장은 공통 민감정보 가림 정책으로 보여주고, 가림에 실패하면 원문 대신 "민감정보 보호 확인 필요"
 * AI 결과 원본(값·근거)은 서버의 분석 기록(analysis_jobs.result)에 그대로 남는다.
 */
import { maskSensitiveTextForDisplay, SENSITIVE_DISPLAY_FALLBACK } from './sensitive';

/** 값 하나의 근거 — 원문 문장(가리기 전일 수 있음)과 위치 */
export interface FieldEvidence {
  quote: string;
  /** 계약서 쪽 (1부터, 모르면 null) */
  page: number | null;
  /** 근거가 있는 보관 문서 id (모르면 null — 첫 문서로 연다) */
  documentId: string | null;
}
/** 폼 경로 → 근거 ('title' · 'startDate' · 'details.landlord' · 'payments.0.amount' …) */
export type EvidenceMap = Partial<Record<string, FieldEvidence>>;

export interface FieldEvidenceView {
  /** 아이콘을 보여줄지 (근거가 있을 때만) */
  hasEvidence: boolean;
  /** 확인 필요 강조 */
  needsReview: boolean;
  /** 화면에 보여줄 근거 문장 (가림 적용) */
  quote: string | null;
  page: number | null;
  documentId: string | null;
  /** AI가 처음 읽은 값 (화면 표시용 문자열) */
  aiValue: string | null;
  /** 사용자가 AI 값을 고침 */
  edited: boolean;
}

const show = (v: unknown): string | null => (v == null || String(v).trim() === '' ? null : String(v).trim());
const same = (a: string | null, b: string | null) => (a ?? '').replace(/[\s,]/g, '') === (b ?? '').replace(/[\s,]/g, '');

export function evidenceView(
  evidence: FieldEvidence | undefined,
  o: { flagged?: boolean; aiValue?: unknown; currentValue?: unknown } = {},
): FieldEvidenceView {
  const aiValue = evidence ? show(o.aiValue) : null;
  const current = show(o.currentValue);
  return {
    hasEvidence: !!evidence?.quote,
    needsReview: !!o.flagged,
    quote: evidence?.quote ? maskSensitiveTextForDisplay(evidence.quote) || SENSITIVE_DISPLAY_FALLBACK : null,
    page: evidence?.page ?? null,
    documentId: evidence?.documentId ?? null,
    aiValue: aiValue ? maskSensitiveTextForDisplay(aiValue) : null,
    edited: !!evidence && aiValue != null && !same(aiValue, current),
  };
}

/** 저장된 계약을 고칠 때 — 결제·주요 날짜처럼 순서가 바뀔 수 있는 목록 경로는 근거를 붙이지 않는다 (엉뚱한 칸에 붙지 않게) */
export function stableEvidence(map: EvidenceMap): EvidenceMap {
  return Object.fromEntries(Object.entries(map).filter(([path]) => !/^(payments|dates)\./.test(path)));
}

/** 계약 상세의 기본 정보 행 → 근거 경로 (coreInfo 행 키). 근거가 없는 행(계산값 등)은 null */
export function coreRowEvidencePath(rowKey: string): string | null {
  if (rowKey.startsWith('d:')) return `details.${rowKey.slice(2)}`;
  if (rowKey.startsWith('party:')) return `parties.${rowKey.slice(6)}`;
  const map: Record<string, string> = { deposit: 'depositAmount', company: 'counterparty', counterparty: 'counterparty', total: 'totalAmount', notice: 'terminationNoticeDays', renewal: 'autoRenewal', period: 'startDate' };
  return map[rowKey] ?? null;
}
