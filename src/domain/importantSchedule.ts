/**
 * 알림 화면 "중요한 계약 일정" — critical / important 일정을 일반 결제 알림과 따로 보여준다.
 *
 * - 일정 자체는 캘린더와 같은 계산(contractSchedule)에서 오고, 여기서는 고르고 문구만 만든다 (생성·삭제하지 않음).
 * - IMPORTANT_DISPLAY_WINDOW(12개월·5개)는 화면 표시 범위일 뿐 법적·계약상 기준이 아니다.
 *   범위 밖 일정도 계산·캘린더에는 그대로 있고, 여기서는 total로 남은 개수를 알려 "더 보기"로 확장할 수 있게 한다.
 * - 날짜의 출처(계약서 기준 등)와 PACTO가 언제 미리 알려주는지(알림 정책)를 따로 표시한다.
 */
import { profileOf } from './contractTypes';
import { addMonths } from './dates';
import { daysUntil } from './dday';
import { findEvidence, NOTIFICATION_SOURCE_LABEL, type NotificationEvidence, type NotificationPriority } from './notificationPriority';
import { REMINDER_RULES } from './reminders';
import { scheduleForRange, type ScheduleItem } from './schedule';
import { isLive } from './status';
import type { ContractRecord, ISODate } from './types';

/** 화면 표시 범위 (도메인 의미 없음) */
export const IMPORTANT_DISPLAY_WINDOW = { months: 12, limit: 5 } as const;

export type ImportantBadge = '중요' | '기한 임박' | '확인 필요' | '확인';

export interface ImportantScheduleItem {
  key: string;
  item: ScheduleItem;
  priority: Exclude<NotificationPriority, 'normal'>;
  daysLeft: number;
  badge: ImportantBadge;
  /** "해지 통보기한이 다가와요" */
  title: string;
  /** 해야 할 일 */
  body: string;
  /** "계약서 기준" / "입력한 계약 정보 기준" / "PACTO 안내" / "직접 설정" */
  sourceLabel: string;
  /** PACTO가 미리 알려주는 시점 (기한과 별개) 또는 PACTO 안내임을 밝히는 문구 */
  policyNote: string | null;
  evidence: NotificationEvidence | null;
}

const hasBatchim = (word: string) => {
  const c = word.charCodeAt(word.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
};
const subj = (word: string) => `${word}${hasBatchim(word) ? '이' : '가'}`;

function copyFor(item: ScheduleItem, record: ContractRecord): Pick<ImportantScheduleItem, 'title' | 'body' | 'policyNote'> {
  const profile = profileOf(record.contract.contractType);
  switch (item.actionType) {
    case 'termination_notice':
      return {
        title: `${subj(profile.noticeLabel)} 다가와요`,
        body: record.contract.autoRenewal
          ? '자동갱신을 원하지 않는다면 이 날짜 전까지 해지 의사를 알려야 해요.'
          : '계약을 끝내거나 갱신하지 않으려면 이 날짜 전까지 상대방에게 알려야 해요.',
        policyNote: `PACTO가 ${REMINDER_RULES.terminationNotice.filter((d) => d > 0).join('·')}일 전과 당일에 미리 알려드려요.`,
      };
    case 'prepare': {
      const days = profile.prepare?.daysBefore;
      return {
        title: '갱신 여부를 미리 확인해보세요',
        body: profile.prepare?.guidance ?? '만기 전에 다음 계획을 확인해두세요.',
        policyNote: `계약서나 법령에 정해진 기한이 아니라, 만기${days ? ` ${days}일` : ''} 전에 PACTO가 미리 알려드리는 안내예요.`,
      };
    }
    case 'renewal':
      return { title: '자동갱신 예정일이에요', body: '이 날짜부터 같은 조건으로 계약이 연장될 예정이에요. 계속 이용할지 확인해주세요.', policyNote: null };
    default:
      return { title: `${subj(item.title.replace(/\s*\(.*\)$/, ''))} 다가와요`, body: profile.endGuidance, policyNote: null };
  }
}

/**
 * 앞으로 window.months 안의 critical / important 일정 — 계약별·중요도별 가장 가까운 것, critical 먼저, 최대 window.limit개.
 * total = 고르기 전 개수 ("더 보기" 확장용)
 */
export function importantSchedule(
  records: ContractRecord[],
  today: ISODate,
  window: { months: number; limit: number } = IMPORTANT_DISPLAY_WINDOW,
): { items: ImportantScheduleItem[]; total: number } {
  const live = records.filter((r) => r.contract.notificationsEnabled && isLive(r.contract, today));
  const all = scheduleForRange(live, { start: today, end: addMonths(today, window.months) }, today).filter((i) => i.priority !== 'normal');
  const nearest = new Map<string, ScheduleItem>();
  for (const i of all) {
    const k = `${i.contractId}|${i.priority}`;
    const cur = nearest.get(k);
    if (!cur || i.date < cur.date) nearest.set(k, i);
  }
  const rank = (p: NotificationPriority) => (p === 'critical' ? 0 : 1);
  const picked = [...nearest.values()].sort((a, b) => rank(a.priority) - rank(b.priority) || a.date.localeCompare(b.date));
  const items = picked.slice(0, window.limit).map((item): ImportantScheduleItem => {
    const record = live.find((r) => r.contract.id === item.contractId)!;
    const daysLeft = daysUntil(item.date, today);
    const priority = item.priority as Exclude<NotificationPriority, 'normal'>;
    const badge: ImportantBadge = item.needsReview ? '확인 필요' : priority === 'critical' ? (daysLeft <= 7 ? '기한 임박' : '중요') : '확인';
    return {
      key: item.key,
      item,
      priority,
      daysLeft,
      badge,
      sourceLabel: NOTIFICATION_SOURCE_LABEL[item.source],
      evidence: findEvidence(record, item.actionType, item.source),
      ...copyFor(item, record),
    };
  });
  return { items, total: all.length };
}
