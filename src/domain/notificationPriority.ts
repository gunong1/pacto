/**
 * 일정·알림의 중요도와 출처 (알림·캘린더 공통) — 순수 함수만, 화면 컴포넌트에는 판단 로직을 두지 않는다.
 *
 * 중요도(priority)는 "놓치면 권리·비용·선택에 영향이 있는가"이고, AI 신뢰도(confidence)와는 별개다.
 * 출처(source)는 그 날짜가 어디에서 왔는가:
 *   contract     계약서 기준          — 업로드한 계약서에서 읽어 사용자가 저장한 값
 *   manual_entry 입력한 계약 정보 기준 — 계약서 없이 사용자가 직접 입력한 계약 조건
 *   legal        법령 기준            — V1에서는 만들지 않는다 (아래 LegalRule은 확장용 구조만)
 *   pacto        PACTO 안내           — 계약서·법령이 아닌 PACTO 기본 사전 안내 (예: 임대차 만기 60일 전 갱신 여부 확인)
 *   user_custom  직접 설정            — 사용자가 따로 만든 일정·알림
 */
import type { AiCheck, Contract, ContractRecord, ISODate } from './types';

export type NotificationPriority = 'critical' | 'important' | 'normal';

export type NotificationSource = 'contract' | 'manual_entry' | 'legal' | 'pacto' | 'user_custom';

export const NOTIFICATION_SOURCE_LABEL: Record<NotificationSource, string> = {
  contract: '계약서 기준',
  manual_entry: '입력한 계약 정보 기준',
  legal: '법령 기준',
  pacto: 'PACTO 안내',
  user_custom: '직접 설정',
};

export const NOTIFICATION_PRIORITY_LABEL: Record<NotificationPriority, string> = {
  critical: '중요',
  important: '확인',
  normal: '',
};

/**
 * 행동 중심 일정 종류 (확장용). 지금 실제로 만드는 것: termination_notice, renewal, prepare, contract_end, payment, income,
 * contract_start, key_date, custom. 나머지는 계약 체크 → 구조화된 일정으로 연결할 때 쓰도록 열어 둔다.
 */
export type ActionEventType =
  | 'termination_notice'
  | 'renewal_notice'
  | 'renewal_decision'
  | 'notice_unknown'
  | 'renewal_window_start'
  | 'renewal_window_end'
  | 'option_exercise_deadline'
  | 'claim_deadline'
  | 'contract_end'
  | 'maturity'
  | 'deposit_return'
  | 'renewal'
  | 'prepare'
  | 'payment'
  | 'income'
  | 'contract_start'
  | 'key_date'
  | 'custom';

/** 종류별 기본 중요도 — 의사표시·행사 기한은 critical, 만기·종료·반환은 important, 반복 결제·일반 날짜는 normal */
const BASE_PRIORITY: Record<ActionEventType, NotificationPriority> = {
  termination_notice: 'critical',
  renewal_notice: 'critical',
  renewal_window_end: 'critical',
  option_exercise_deadline: 'critical',
  claim_deadline: 'critical',
  // 갱신 여부를 확인·협의하는 시점 — 의사표시 기한이 아니라 critical로 올리지 않는다
  renewal_decision: 'important',
  // 통보기한 숫자는 있으나 의미가 불확실 — 확인 필요 (critical로 단정하지 않음)
  notice_unknown: 'important',
  renewal_window_start: 'important',
  contract_end: 'important',
  maturity: 'important',
  deposit_return: 'important',
  renewal: 'important',
  prepare: 'important',
  payment: 'normal',
  income: 'normal',
  contract_start: 'normal',
  key_date: 'normal',
  custom: 'normal',
};

/**
 * 중요도. critical은 출처가 확인된 값(계약서·입력한 계약 정보)에서 나온 경우에만:
 * - PACTO 기본 안내는 critical로 올리지 않는다 (법적·계약상 기한이 아님)
 * - AI 추정값 등 확인되지 않은 값에서 나온 기한은 important + 확인 필요로 낮춘다
 */
export function getNotificationPriority(type: ActionEventType, opts: { source: NotificationSource; needsReview?: boolean }): NotificationPriority {
  const base = BASE_PRIORITY[type];
  if (base !== 'critical') return base;
  if (opts.source === 'pacto' || opts.needsReview) return 'important';
  return base;
}

/** 계약 조건(종료일·통보일수 등)에서 계산한 날짜의 출처: 계약서 업로드 → 계약서 기준, 직접 등록 → 입력한 계약 정보 기준 */
export function contractTermSource(contract: Pick<Contract, 'source'>): NotificationSource {
  return contract.source === 'upload' ? 'contract' : 'manual_entry';
}

/** 날짜를 만든 계약 값 중 AI가 추정한 값이 있으면 사용자 확인 전까지 확정 기한으로 보지 않는다 */
export function termNeedsReview(contract: Pick<Contract, 'valueSources'>, fields: readonly string[]): boolean {
  return fields.some((f) => contract.valueSources[f] === 'inferred');
}

/** 근거: 계약서 원문 위치 (민감정보는 표시할 때 기존 가림 규칙 적용) */
export interface NotificationEvidence {
  documentId: string | null;
  page: number | null;
  quote: string;
  checkId: string;
}

/** 일정 종류별로 근거를 찾을 계약 체크 주제 */
const EVIDENCE_TOPICS: Partial<Record<ActionEventType, readonly string[]>> = {
  termination_notice: ['notice_deadline', 'auto_renewal', 'renewal_terms'],
  renewal: ['auto_renewal', 'renewal_terms'],
  renewal_notice: ['notice_deadline', 'renewal_terms', 'auto_renewal'],
  renewal_decision: ['renewal_terms', 'notice_deadline', 'auto_renewal'],
  notice_unknown: ['notice_deadline', 'renewal_terms', 'auto_renewal'],
  contract_end: ['renewal_terms', 'deposit_return'],
  maturity: ['maturity_extension', 'renewal_terms'],
  deposit_return: ['deposit_return'],
};

/** 계약서 기준 일정이면 관련 계약 체크의 근거 문장을 연결 (없으면 null — 근거를 지어내지 않는다) */
export function findEvidence(record: Pick<ContractRecord, 'aiChecks'>, type: ActionEventType, source: NotificationSource): NotificationEvidence | null {
  if (source !== 'contract') return null;
  const topics = EVIDENCE_TOPICS[type];
  if (!topics) return null;
  for (const t of topics) {
    const c: AiCheck | undefined = record.aiChecks.find((x) => x.topic === t && x.evidenceQuote && x.status !== 'dismissed');
    if (c?.evidenceQuote) return { documentId: c.evidenceDocumentId ?? null, page: c.evidencePage, quote: c.evidenceQuote, checkId: c.id };
  }
  return null;
}

/**
 * 법령 기반 일정 (확장용 구조만 — V1에서는 데이터·계산 없음).
 * 법정 기간은 계약 종류·당사자·계약 시점·개정·예외에 따라 달라지므로 코드에 숫자로 두지 않고 버전이 있는 규칙으로 관리한다.
 */
export interface LegalRuleVersion {
  version: string;
  effectiveFrom: ISODate;
  effectiveTo: ISODate | null;
  /** 법령명·조항 (예: 법령명 제n조) */
  sourceReference: string;
}

export interface LegalRule {
  code: string;
  jurisdiction: string;
  eventType: ActionEventType;
  appliesTo: { contractTypes: readonly string[] };
  versions: readonly LegalRuleVersion[];
}

/** V1: 법령 규칙 없음 — 법령 기준 알림을 만들지 않는다 */
export const LEGAL_RULES: readonly LegalRule[] = [];
