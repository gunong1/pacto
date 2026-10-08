/**
 * 통보기한의 의미 (contracts.notice_kind) — "종료 N일 전"이라는 숫자만으로 해지 통보·갱신 통지·갱신 협의를 같은 것으로 다루지 않는다.
 *
 *   termination_notice  해지·종료 의사를 상대방에게 통지해야 하는 기한          → critical
 *   renewal_notice      갱신 또는 갱신 거절 의사를 통지해야 하는 기한          → critical
 *   renewal_decision    갱신 여부를 확인·협의·결정하는 시점                    → important
 *   unknown             숫자는 있으나 의미를 확정할 수 없음 (기존 데이터 등)    → important + 확인 필요
 *
 * 문구는 계약서의 의미를 더 강하게 바꾸지 않는다 (협의 → "통보해야 한다"로 쓰지 않음).
 */
import { profileOf } from './contractTypes';
import type { ActionEventType } from './notificationPriority';
import type { ContractType } from './types';

export const NOTICE_KINDS = ['termination_notice', 'renewal_notice', 'renewal_decision', 'unknown'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export function isNoticeKind(v: unknown): v is NoticeKind {
  return typeof v === 'string' && (NOTICE_KINDS as readonly string[]).includes(v);
}

/** 계약 수정 화면 선택지 */
export const NOTICE_KIND_OPTIONS: readonly { value: NoticeKind; label: string; description: string }[] = [
  { value: 'termination_notice', label: '해지·종료 통보기한', description: '계약을 끝내려면 이 날까지 상대방에게 알려야 해요' },
  { value: 'renewal_notice', label: '갱신 통보기한', description: '갱신하거나 갱신하지 않겠다는 뜻을 이 날까지 알려야 해요' },
  { value: 'renewal_decision', label: '갱신 여부 확인·협의', description: '이 때까지 갱신할지 상대방과 확인·협의해요' },
  { value: 'unknown', label: '잘 모르겠어요', description: '계약서를 다시 확인해볼 수 있도록 "확인 필요"로 표시해요' },
];

/** 일정·알림 종류 (중요도 규칙은 notificationPriority.ts) */
export function noticeActionType(kind: NoticeKind): ActionEventType {
  return kind === 'unknown' ? 'notice_unknown' : kind;
}

/** 일정 이름 — 해지·종료 통보기한은 유형별 이름(임대차: 종료 통보기한)을 쓴다 */
export function noticeLabelOf(kind: NoticeKind, contractType: ContractType): string {
  switch (kind) {
    case 'termination_notice': {
      const l = profileOf(contractType).noticeLabel;
      return l === '통보기한' ? '해지 통보기한' : l;
    }
    case 'renewal_notice':
      return '갱신 통보기한';
    case 'renewal_decision':
      return '갱신 여부 확인';
    case 'unknown':
      return '통보·갱신 관련 기한';
  }
}

/** 한 줄 요약 — "갱신 여부 확인까지 682일 남았습니다." / unknown은 남은 날 대신 확인을 먼저 */
export function noticeHeadline(kind: NoticeKind, label: string, days: number): string {
  if (kind === 'unknown') return '통보·갱신 관련 기한이 있어요.';
  if (days === 0) return `오늘이 ${label}입니다.`;
  return `${label}까지 ${days}일 남았습니다.`;
}

/**
 * 해야 할 일 — 출처 문구("계약서에 따라" / "입력한 계약 정보에 따라")와 날짜(연도 포함)를 받는다.
 * unknown은 의미를 추측하지 않고 확인만 권한다.
 */
export function noticeGuidance(kind: NoticeKind, opts: { by: string; date: string; autoRenewal: boolean }): string {
  switch (kind) {
    case 'termination_notice':
      return opts.autoRenewal
        ? `${opts.by} ${opts.date}까지 해지 의사를 알려야 자동갱신을 피할 수 있어요.`
        : `${opts.by} 계약을 끝내려면 ${opts.date}까지 상대방에게 알려주세요.`;
    case 'renewal_notice':
      return `${opts.by} ${opts.date}까지 갱신 또는 갱신 거절 의사를 상대방에게 알려주세요.`;
    case 'renewal_decision':
      return `${opts.by} ${opts.date}까지 갱신 여부를 상대방과 협의해주세요.`;
    case 'unknown':
      return '이 일정의 의미를 확인해주세요.';
  }
}

/** 출처 → 문장 앞머리 ("계약서에 따라") */
export function noticeBy(source: 'contract' | 'manual_entry' | string): string {
  return source === 'contract' ? '계약서에 따라' : '입력한 계약 정보에 따라';
}
