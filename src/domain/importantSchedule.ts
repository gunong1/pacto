/**
 * 알림 화면 "중요한 계약 일정" — critical / important 일정을 일반 결제 알림과 따로 보여준다.
 *
 * - 일정 자체는 캘린더와 같은 계산(contractSchedule)에서 오고, 여기서는 고르고 문구만 만든다 (생성·삭제하지 않음).
 * - 알림 구간에 들어온 일정만 — Push와 같은 규칙(alertWindowStart: 내 알림 설정·계약별 설정의 가장 이른 알림 시점).
 *   예: 계약 만료 알림 90·30·7일 전 → 만료 D-90부터 표시, D-254면 표시 안 함 (먼 미래 일정은 캘린더에서만).
 *   알림이 꺼진 종류·알림이 없는 일정(PACTO 안내 등)은 여기에 나오지 않는다.
 * - limit(5개)는 화면 표시 개수일 뿐이고, total로 남은 개수를 알려 "더 보기"로 확장할 수 있게 한다.
 * - 날짜의 출처(계약서 기준 등)와 PACTO가 언제 미리 알려주는지(알림 정책)를 따로 표시한다.
 */
import { profileOf } from './contractTypes';
import { addDays } from './dates';
import { daysUntil } from './dday';
import { noticeBy } from './noticeKind';
import { findEvidence, NOTIFICATION_SOURCE_LABEL, type NotificationEvidence, type NotificationPriority } from './notificationPriority';
import { alertWindowStart, CONTRACT_OFFSET_PRESETS, getEffectiveNotificationPreferences, type ContractNotificationOverride, type NotificationPreferences } from './notifications';
import { scheduleForRange, type ScheduleItem } from './schedule';
import { isLive } from './status';
import type { ContractRecord, ISODate } from './types';

/** 화면 표시 개수 (도메인 의미 없음) */
export const IMPORTANT_DISPLAY_LIMIT = 5;
/** 설정할 수 있는 가장 이른 알림 시점 — 이보다 먼 일정은 알림 구간에 들어올 수 없다 */
const MAX_OFFSET_DAYS = Math.max(...CONTRACT_OFFSET_PRESETS);

export interface AlertRuleInput {
  /** 내 알림 설정 (null = PACTO 기본) */
  preferences: Partial<NotificationPreferences> | null;
  /** 계약별 알림 설정 */
  overrides?: ReadonlyMap<string, ContractNotificationOverride>;
}

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
    // 언제 알려줄지는 사용자 설정이라 카드에 적지 않는다 (알림 설정 요약에서 보여줌)
    case 'termination_notice':
      return {
        title: `${subj(item.title)} 다가와요`,
        body: record.contract.autoRenewal
          ? '자동갱신을 원하지 않는다면 이 날짜 전까지 해지 의사를 알려야 해요.'
          : '계약을 끝내려면 이 날짜 전까지 상대방에게 알려야 해요.',
        policyNote: null,
      };
    case 'renewal_notice':
      return { title: `${subj(item.title)} 다가와요`, body: '이 날짜 전까지 갱신 또는 갱신 거절 의사를 상대방에게 알려야 해요.', policyNote: null };
    case 'renewal_decision':
      return { title: '갱신 여부를 확인할 시점이에요', body: `${noticeBy(item.source)} 이 날짜까지 갱신 여부를 상대방과 협의해주세요.`, policyNote: null };
    case 'notice_unknown':
      return { title: '통보·갱신 관련 기한이 있어요', body: '이 일정의 의미를 확인해주세요.', policyNote: null };
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
 * 알림 구간에 들어온 critical / important 일정 — 계약별·중요도별 가장 가까운 것, critical 먼저, 최대 limit개.
 * total = 고르기 전 개수 ("더 보기" 확장용)
 */
export function importantSchedule(
  records: ContractRecord[],
  today: ISODate,
  rules: AlertRuleInput = { preferences: null },
  limit: number = IMPORTANT_DISPLAY_LIMIT,
): { items: ImportantScheduleItem[]; total: number } {
  const live = records.filter((r) => r.contract.notificationsEnabled && isLive(r.contract, today));
  const autoRenewal = new Map(live.map((r) => [r.contract.id, r.contract.autoRenewal]));
  const effCache = new Map<string, ReturnType<typeof getEffectiveNotificationPreferences>>();
  const effFor = (id: string) => {
    let e = effCache.get(id);
    if (!e) effCache.set(id, (e = getEffectiveNotificationPreferences(rules.preferences, rules.overrides?.get(id))));
    return e;
  };
  const all = scheduleForRange(live, { start: today, end: addDays(today, MAX_OFFSET_DAYS + 1) }, today).filter((i) => {
    if (i.priority === 'normal') return false;
    const start = alertWindowStart(i, autoRenewal.get(i.contractId) ?? false, effFor(i.contractId));
    return start !== null && start <= today;
  });
  const nearest = new Map<string, ScheduleItem>();
  for (const i of all) {
    const k = `${i.contractId}|${i.priority}`;
    const cur = nearest.get(k);
    if (!cur || i.date < cur.date) nearest.set(k, i);
  }
  const rank = (p: NotificationPriority) => (p === 'critical' ? 0 : 1);
  const picked = [...nearest.values()].sort((a, b) => rank(a.priority) - rank(b.priority) || a.date.localeCompare(b.date));
  const items = picked.slice(0, limit).map((item): ImportantScheduleItem => {
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
