import { addDays, addMonths, parseISODate } from './dates';
import { daysUntil } from './dday';
import { formatWon } from './money';
import { contractSchedule, nextPayment } from './schedule';
import { isLive } from './status';
import type { ContractCategory, ContractRecord, ISODate } from './types';

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
  /** 종료 전 미리 확인할 시점 (일) */
  prepareDaysBefore?: number;
  prepareLabel?: string;
  prepareGuidance?: string;
}

/** 계약 종류별 "다음 행동" 문구. 법적 판단이 아니라 확인을 돕는 안내만 한다. */
export const CATEGORY_PROFILES: Record<ContractCategory, CategoryProfile> = {
  insurance: { endLabel: '보험 만료', endGuidance: '만료 전에 갱신 여부와 보험료를 확인해주세요.' },
  rental: { endLabel: '렌탈 계약 종료', endGuidance: '계약이 끝난 뒤 반납 또는 소유권 이전 조건을 계약서에서 확인해주세요.' },
  real_estate: {
    endLabel: '계약 만기',
    endGuidance: '만기일의 보증금 반환·이사 일정을 확인해주세요.',
    prepareDaysBefore: 60,
    prepareLabel: '갱신 여부 확인',
    prepareGuidance: '만기 전에 재계약 또는 이사 여부를 정하고 상대방과 미리 확인해두세요.',
  },
  telecom: { endLabel: '약정 종료', endGuidance: '약정이 끝나면 요금제와 재약정 조건을 확인해주세요.' },
  membership: { endLabel: '회원권 만료', endGuidance: '계속 이용할지 미리 정해두세요.' },
  subscription: { endLabel: '구독 종료', endGuidance: '계속 이용할지 확인해주세요.' },
  vehicle: { endLabel: '계약 종료', endGuidance: '종료 후 처리 조건(반납·인수 등)을 계약서에서 확인해주세요.' },
  finance: { endLabel: '만기', endGuidance: '만기일의 상환·연장 조건을 확인해주세요.' },
  employment: { endLabel: '계약 종료', endGuidance: '계약 연장 여부를 미리 확인해주세요.' },
  business: { endLabel: '계약 종료', endGuidance: '연장 또는 종료 조건을 계약서에서 확인해주세요.' },
  other: { endLabel: '계약 종료', endGuidance: '종료 후 처리할 일이 있는지 확인해주세요.' },
};

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
  const profile = CATEGORY_PROFILES[contract.category];
  const base = { contractId: contract.id, contractTitle: contract.title, category: contract.category };
  const out: NextAction[] = [];

  const items = contractSchedule(record, { start: today, end: addMonths(today, 60) }, today);
  for (const i of items) {
    const days = daysUntil(i.date, today);
    if (i.type === 'termination_notice') {
      out.push({
        ...base, key: `notice:${i.date}`, kind: 'termination_notice', date: i.date, days,
        label: '해지 통보기한',
        headline: remaining('해지 통보기한', days, '이'),
        guidance: `계약서 기준 ${monthDay(i.date)}까지 해지 의사를 전달해야 자동갱신을 피할 수 있습니다.`,
      });
    } else if (i.type === 'contract_end' && contract.autoRenewal) {
      out.push({
        ...base, key: `renew:${i.date}`, kind: 'renewal', date: i.date, days,
        label: '자동갱신 예정',
        headline: remaining('자동갱신 예정일', days, '까지'),
        guidance: `${monthDay(addDays(i.date, 1))}부터 같은 조건으로 연장될 예정이에요. 계속 이용할지 확인해주세요.`,
      });
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

  if (profile.prepareDaysBefore && contract.endDate && !contract.autoRenewal) {
    const date = addDays(contract.endDate, -profile.prepareDaysBefore);
    const days = daysUntil(date, today);
    if (days >= 0) {
      out.push({
        ...base, key: `prepare:${date}`, kind: 'prepare', date, days,
        label: profile.prepareLabel!,
        headline: remaining(`${profile.prepareLabel} 시점`, days, '까지'),
        guidance: profile.prepareGuidance!,
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
    label: '다음 결제',
    headline: days === 0 ? '오늘 결제일입니다.' : `다음 결제일까지 ${days}일 남았습니다.`,
    guidance: `${monthDay(pay.date)}에 ${pay.label} ${formatWon(pay.amount)}이 결제될 예정이에요.`,
  };
}

/** 홈 "지금 확인이 필요한 계약"으로 보는 기간 (일). */
export const ATTENTION_WINDOW_DAYS = 60;

/** 홈: 계약별 다음 행동 중 기간 안에 있는 것 (계약당 1건, 결제 제외, 가까운 순). */
export function attentionItems(records: ContractRecord[], today: ISODate, windowDays = ATTENTION_WINDOW_DAYS): NextAction[] {
  return records
    .map((r) => actionCandidates(r, today)[0])
    .filter((a): a is NextAction => !!a && a.days <= windowDays)
    .sort((a, b) => a.days - b.days || KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
}
