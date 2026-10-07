import { addDays, addMonths, parseISODate } from './dates';
import { daysUntil } from './dday';
import { formatWon } from './money';
import { NOTIFICATION_SOURCE_LABEL } from './notificationPriority';
import { profileOf } from './contractTypes';
import { contractSchedule, nextPayment, prepareDate } from './schedule';
import { isLive } from './status';
import type { Contract, ContractCategory, ContractRecord, ISODate } from './types';

/**
 * "다음 행동" — 사용자가 계약을 열었을 때 가장 먼저 알아야 할 일.
 *
 * 후보는 계약 일정(contractSchedule: 해지 통보기한·종료·갱신·사용자 일정)과
 * 계약 종류별 준비 시점에서 모으고, 가장 가까운 것을 고른다.
 * DB 단계에서는 contract_events + 계산 일정이 같은 후보 목록으로 들어온다.
 */

export type NextActionKind = 'termination_notice' | 'renewal' | 'contract_end' | 'prepare' | 'custom' | 'payment';

export interface NextAction {
  key: string;
  kind: NextActionKind;
  contractId: string;
  contractTitle: string;
  category: ContractCategory;
  date: ISODate;
  days: number;
  /** 짧은 이름 (목록용): '해지 통보기한', '보험 만료' */
  label: string;
  /** 한 줄 요약: '해지 통보기한이 57일 남았습니다.' */
  headline: string;
  /** 무엇을 해야 하는지: '12월 1일까지 해지 의사를 전달해야 …' */
  guidance: string;
}

interface CategoryProfile {
  /** 종료일의 이름 */
  endLabel: string;
  endGuidance: string;
}

/** 계약 종류별 "다음 행동" 문구. 법적 판단이 아니라 확인을 돕는 안내만 한다. */
export const CATEGORY_PROFILES: Record<ContractCategory, CategoryProfile> = {
  insurance: { endLabel: '보험 만료', endGuidance: '만료 전에 갱신 여부와 보험료를 확인해주세요.' },
  rental: { endLabel: '렌탈 계약 종료', endGuidance: '계약이 끝난 뒤 반납 또는 소유권 이전 조건을 계약서에서 확인해주세요.' },
  real_estate: { endLabel: '계약 만기', endGuidance: '만기일의 보증금 반환·이사 일정을 확인해주세요.' },
  telecom: { endLabel: '약정 종료', endGuidance: '약정이 끝나면 요금제와 재약정 조건을 확인해주세요.' },
  membership: { endLabel: '회원권 만료', endGuidance: '계속 이용할지 미리 정해두세요.' },
  subscription: { endLabel: '구독 종료', endGuidance: '계속 이용할지 확인해주세요.' },
  vehicle: { endLabel: '계약 종료', endGuidance: '종료 후 처리 조건(반납·인수 등)을 계약서에서 확인해주세요.' },
  finance: { endLabel: '만기', endGuidance: '만기일의 상환·연장 조건을 확인해주세요.' },
  employment: { endLabel: '계약 종료', endGuidance: '계약 연장 여부를 미리 확인해주세요.' },
  business: { endLabel: '계약 종료', endGuidance: '연장 또는 종료 조건을 계약서에서 확인해주세요.' },
  education: { endLabel: '수강 종료', endGuidance: '수강 연장이나 환불 조건을 확인해주세요.' },
  service: { endLabel: '업무 종료', endGuidance: '납기·검수와 남은 대금 지급 일정을 확인해주세요.' },
  sale: { endLabel: '매매 완료', endGuidance: '잔금과 인도·소유권 이전 일정을 확인해주세요.' },
  other: { endLabel: '계약 종료', endGuidance: '종료 후 처리할 일이 있는지 확인해주세요.' },
};

/** 종료 문구: 월 납입형·기타는 분야별 표현(렌탈 계약 종료·회원권 만료 …), 그 외는 유형별 표현(대출 만기·보험 만기 …) */
export function endProfile(contract: Contract): CategoryProfile {
  if (contract.contractType === 'recurring' || contract.contractType === 'other') return CATEGORY_PROFILES[contract.category];
  const p = profileOf(contract.contractType);
  return { endLabel: p.endEvent, endGuidance: p.endGuidance };
}

/** 종료·만기를 "다음 행동"으로 올리기 시작하는 시점 (일). 유형별로 더 짧게 정할 수 있다 (할부·대출 90일) */
export const END_ACTION_WINDOW_DAYS = 180;

const KIND_PRIORITY: Record<NextActionKind, number> = {
  termination_notice: 0,
  custom: 1,
  prepare: 2,
  renewal: 3,
  contract_end: 4,
  payment: 5,
};

function monthDay(date: ISODate): string {
  const { month, day } = parseISODate(date);
  return `${month}월 ${day}일`;
}

function remaining(label: string, days: number, particle: '이' | '가' | '까지') {
  if (days === 0) return `오늘이 ${label}입니다.`;
  return particle === '까지' ? `${label}까지 ${days}일 남았습니다.` : `${label}${particle} ${days}일 남았습니다.`;
}

/** 다음 행동 후보 전부 (가까운 순). */
export function actionCandidates(record: ContractRecord, today: ISODate): NextAction[] {
  const { contract } = record;
  if (!isLive(contract, today)) return [];
  const typeProfile = profileOf(contract.contractType);
  const profile = endProfile(contract);
  const base = { contractId: contract.id, contractTitle: contract.title, category: contract.category };
  const out: NextAction[] = [];

  const items = contractSchedule(record, { start: today, end: addMonths(today, 60) }, today);
  for (const i of items) {
    const days = daysUntil(i.date, today);
    if (i.type === 'termination_notice') {
      out.push({
        ...base, key: `notice:${i.date}`, kind: 'termination_notice', date: i.date, days,
        label: typeProfile.noticeLabel,
        headline: remaining(typeProfile.noticeLabel, days, '이'),
        guidance: `${NOTIFICATION_SOURCE_LABEL[i.source]} ${typeProfile.noticeGuidance(monthDay(i.date))}`,
      });
    } else if (i.type === 'contract_end' && contract.autoRenewal) {
      out.push({
        ...base, key: `renew:${i.date}`, kind: 'renewal', date: i.date, days,
        label: '자동갱신 예정',
        headline: remaining('자동갱신 예정일', days, '까지'),
        guidance: `${monthDay(addDays(i.date, 1))}부터 같은 조건으로 연장될 예정이에요. 계속 이용할지 확인해주세요.`,
      });
    } else if (i.type === 'contract_end' && days > (typeProfile.deferEndUntilDays ?? END_ACTION_WINDOW_DAYS)) {
      // 종료·만기가 멀면 아직 행동할 일이 아니다 — 다음 결제·지급을 보여준다
      // 할부·대출은 만기가 멀면 매달 납입이 더 중요한 일이라 "다음 결제"를 보여준다
      continue;
    } else if (i.type === 'contract_end') {
      out.push({
        ...base, key: `end:${i.date}`, kind: 'contract_end', date: i.date, days,
        label: profile.endLabel,
        headline: remaining(profile.endLabel, days, '까지'),
        guidance: profile.endGuidance,
      });
    } else if (i.type === 'custom' && i.eventId) {
      const event = record.events.find((e) => e.id === i.eventId);
      if (event?.completedAt) continue;
      out.push({
        ...base, key: `event:${i.eventId}`, kind: 'custom', date: i.date, days,
        label: i.title,
        headline: days === 0 ? `오늘: ${i.title}` : `${i.title} — ${days}일 남았습니다.`,
        guidance: '직접 추가한 일정이에요. 처리하면 완료로 표시해주세요.',
      });
    }
  }

  const prep = prepareDate(contract);
  if (prep) {
    const days = daysUntil(prep.date, today);
    if (days >= 0) {
      out.push({
        ...base, key: `prepare:${prep.date}`, kind: 'prepare', date: prep.date, days,
        label: prep.label,
        headline: remaining(`${prep.label} 시점`, days, '까지'),
        // 계약서·법령이 아닌 PACTO 기본 안내임을 함께 밝힌다
        guidance: `${prep.guidance} (${NOTIFICATION_SOURCE_LABEL.pacto} — 계약서나 법령에 정해진 기한은 아니에요)`,
      });
    }
  }

  return out.sort((a, b) => a.days - b.days || KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
}

/** 계약의 다음 행동. 챙길 일정이 없으면 다음 결제, 그것도 없으면 null. */
export function nextAction(record: ContractRecord, today: ISODate): NextAction | null {
  const first = actionCandidates(record, today)[0];
  if (first) return first;
  const pay = nextPayment(record, today);
  if (!pay || !isLive(record.contract, today)) return null;
  const days = daysUntil(pay.date, today);
  return {
    contractId: record.contract.id,
    contractTitle: record.contract.title,
    category: record.contract.category,
    key: `pay:${pay.date}`,
    kind: 'payment',
    date: pay.date,
    days,
    label: pay.direction === 'income' ? '다음 지급' : '다음 결제',
    headline: pay.direction === 'income' ? (days === 0 ? '오늘 지급 예정일입니다.' : `다음 지급일까지 ${days}일 남았습니다.`) : days === 0 ? '오늘 결제일입니다.' : `다음 결제일까지 ${days}일 남았습니다.`,
    guidance: `${monthDay(pay.date)}에 ${pay.label} ${formatWon(pay.amount)}${pay.amountNote ? `(${pay.amountNote})` : ''}이 ${pay.direction === 'income' ? '지급' : '결제'}될 예정이에요.`,
  };
}

/**
 * 홈 "지금 확인이 필요한 계약"으로 보는 기간 (일) — 행동 종류별.
 * 기본은 모두 30일. 해지 통보기한처럼 미리 준비가 필요한 일정은 추후 설정에서 늘릴 수 있도록 종류별로 둔다.
 * 31일 이후 일정은 홈의 "곧 종료·갱신되는 계약"과 캘린더에서 보여준다.
 */
export const ATTENTION_WINDOW_DAYS: Record<Exclude<NextActionKind, 'payment'>, number> = {
  termination_notice: 30,
  custom: 30,
  prepare: 30,
  renewal: 30,
  contract_end: 30,
};

/** 결제가 아닌 "행동해야 할 일"인지 (UI 제목 구분: 다음 행동 vs 다음 결제) */
export function isActionable(action: NextAction): boolean {
  return action.kind !== 'payment';
}

/** 홈: 계약별 가장 가까운 행동 중 종류별 기간 안에 있는 것 (계약당 1건, 결제 제외, 가까운 순). */
export function attentionItems(
  records: ContractRecord[],
  today: ISODate,
  windows: Record<Exclude<NextActionKind, 'payment'>, number> = ATTENTION_WINDOW_DAYS,
): NextAction[] {
  return records
    .map((r) => actionCandidates(r, today).find((a) => a.kind !== 'payment' && a.days <= windows[a.kind]))
    .filter((a): a is NextAction => !!a)
    .sort((a, b) => a.days - b.days || KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
}
