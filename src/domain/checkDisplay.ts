/**
 * PACTO 계약 체크 카드 표시 — "할 일 + 짧은 이유". 원문 조항은 카드에 반복하지 않고 "계약서에서 보기"로만 연결한다.
 *
 * 계약 정보(사실)는 핵심 정보에, 그 사실 때문에 해야 할 일은 체크 카드에 — 같은 문장을 두 영역에서 반복하지 않는다.
 * 기한이 있는 의미(갱신 여부 확인·해지 통보)는 저장된 통보기한 일수와 종료일로 날짜를 계산해 제목을 만든다 (판단이 아니라 계산).
 * 의미 키가 없는 이전 버전 체크는 저장된 제목·설명 그대로 보여준다.
 */
import { addDays, formatDateKo } from './dates';
import type { NoticeKind } from './noticeKind';
import type { AiCheck, Contract, ISODate } from './types';

/** 기한이 있는 의미 키의 할 일 (통보기한의 의미에 따라) */
function deadlineAction(semanticKey: string, noticeKind: NoticeKind): string | null {
  if (semanticKey === 'renewal_decision') return '갱신 여부 확인';
  if (semanticKey !== 'termination_notice') return null;
  switch (noticeKind) {
    case 'renewal_notice':
      return '갱신 의사 통보';
    case 'renewal_decision':
      return '갱신 여부 확인';
    case 'unknown':
      return '통보 기한 확인';
    default:
      return '해지 여부 결정·통보';
  }
}

export interface CheckHeadline {
  title: string;
  /** 짧은 이유 (원문 조항이 아니라 왜 챙겨야 하는지 한 문장) */
  reason: string;
  /** 기한이 있는 체크의 날짜 (캘린더 추가 대상) */
  deadline: ISODate | null;
}

export function checkHeadline(check: Pick<AiCheck, 'semanticKey' | 'title' | 'description'>, contract: Pick<Contract, 'terminationNoticeDays' | 'endDate' | 'noticeKind'>, _today: ISODate): CheckHeadline {
  const action = check.semanticKey ? deadlineAction(check.semanticKey, contract.noticeKind) : null;
  if (action && contract.terminationNoticeDays != null && contract.endDate) {
    const deadline = addDays(contract.endDate, -contract.terminationNoticeDays);
    return { title: `${formatDateKo(deadline)}까지 ${action}`, reason: check.description, deadline };
  }
  return { title: check.title, reason: check.description, deadline: null };
}
