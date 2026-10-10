/**
 * 실제 푸시 알림 계획 — 앱(화면)과 서버(notifications Edge Function)가 같은 코드로 계산한다.
 *
 * 순서 (한 곳에서만):
 *  1 계약 일정·기한 계산(schedule/status) → 2 중요도·출처(notificationPriority)
 *  → 3 PACTO 기본 알림 시점 → 4 사용자 전체 설정 → 5 계약별 설정 (getEffectiveNotificationPreferences)
 *  → 6 시간대 + 알림 시간 (기본 알림 시간 또는 종류별 시간, 여러 개 가능 · resolveSendTime) → 7 같은 계약·같은 시각끼리 묶기 (groupReminders)
 *  → 8 발송 예정 알림 (planNotifications) → 9 중복 방지 키 (buildNotificationDedupeKey)
 *
 * 계약상 기한(예: 해지 통보기한 9/11) ≠ 알림 발송일(8/12, 9/4, 9/10, 9/11). 알림 시점은 PACTO·사용자 설정이다.
 * 법령 기준 알림은 V1에서 만들지 않는다 (LEGAL_RULES가 비어 있음).
 */
import { NOTIFICATION_SOURCE_LABEL, type ActionEventType, type NotificationPriority, type NotificationSource } from './notificationPriority';
import { groupReminders, type ReminderGroup } from './reminderGroups';
import { REMINDER_RULES, upcomingReminders, type Reminder, type ReminderRules } from './reminders';
import type { Contract, ContractRecord, ISODate } from './types';

// ===== 3·4·5) 알림 설정 =====

export const NOTIFICATION_CATEGORIES = ['payment', 'termination_notice', 'renewal_notice', 'renewal_decision', 'contract_end', 'renewal'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CATEGORY_DEFS: Record<NotificationCategory, { label: string; description: string; rule: keyof ReminderRules; critical: boolean }> = {
  payment: { label: '결제·입금', description: '결제일·입금일 전에 알려드려요', rule: 'payment', critical: false },
  termination_notice: { label: '해지·종료 통보기한', description: '계약을 끝내려면 상대방에게 알려야 하는 기한', rule: 'terminationNotice', critical: true },
  renewal_notice: { label: '갱신 통보기한', description: '갱신 또는 갱신 거절 의사를 알려야 하는 기한', rule: 'renewalNotice', critical: true },
  renewal_decision: { label: '갱신 여부 확인', description: '갱신 여부를 상대방과 확인·협의하는 시점', rule: 'renewalDecision', critical: false },
  contract_end: { label: '계약 만료', description: '계약·만기가 끝나는 날', rule: 'contractEnd', critical: false },
  renewal: { label: '자동갱신 예정일', description: '자동으로 연장되는 날', rule: 'renewal', critical: false },
};

/**
 * 설정 화면에서 함께 보여주는 종류 — 저장은 종류별 키로 따로 한다.
 * 해지·종료 통보기한과 갱신 통보기한은 "통보기한" 한 줄로 바꾸면 두 키에 같이 저장된다.
 */
export const NOTIFICATION_CATEGORY_GROUPS: readonly { key: NotificationCategory; members: readonly NotificationCategory[]; label: string; description: string }[] = [
  { key: 'payment', members: ['payment'], label: '결제·입금', description: '결제일·입금일 전에 알려드려요' },
  { key: 'termination_notice', members: ['termination_notice', 'renewal_notice'], label: '해지·갱신 통보기한', description: '상대방에게 해지·갱신 의사를 알려야 하는 기한' },
  { key: 'renewal_decision', members: ['renewal_decision'], label: '갱신 여부 확인', description: '갱신 여부를 상대방과 확인·협의하는 시점' },
  { key: 'contract_end', members: ['contract_end'], label: '계약 만료', description: '계약·만기가 끝나는 날' },
  { key: 'renewal', members: ['renewal'], label: '자동갱신 예정일', description: '자동으로 연장되는 날' },
];

/**
 * 저장된 값이 없을 때 이어받을 종류 — 갱신 통보기한이 생기기 전의 해지·종료 통보기한 설정은 갱신 통보기한에도 그대로 적용한다.
 * (갱신 여부 확인은 이어받지 않고 PACTO 기본값에서 시작)
 */
const INHERITS_FROM: Partial<Record<NotificationCategory, NotificationCategory>> = { renewal_notice: 'termination_notice' };

/** 고를 수 있는 알림 시점 (V1은 자유 입력 대신 선택지) — 계약별 설정은 180일 전까지 */
export const OFFSET_PRESETS = [90, 60, 30, 14, 7, 3, 1, 0] as const;
export const CONTRACT_OFFSET_PRESETS = [180, ...OFFSET_PRESETS] as const;
const ALLOWED_OFFSETS = new Set<number>(CONTRACT_OFFSET_PRESETS);

export function offsetLabel(d: number): string {
  return d === 0 ? '당일' : `${d}일 전`;
}

export interface CategoryPrefs {
  enabled: boolean;
  /** 기한 며칠 전 (0 = 당일), 큰 수부터 */
  offsets: number[];
  /** 이 종류만 다른 알림 시간 ('HH:MM', 1~4개). 없으면 기본 알림 시간 사용 */
  times?: string[];
}
export type CategoryPrefsMap = Record<NotificationCategory, CategoryPrefs>;

/** 사용자 전체 설정 (DB notification_preferences + profiles.timezone·push_preview_enabled) */
export interface NotificationPreferences {
  /** PACTO 알림 전체 */
  enabled: boolean;
  /** 기본 알림 시간 'HH:MM' 1~4개 (알림 기준 시간대) — 종류별 시간이 없으면 이 시간에 보낸다 */
  defaultTimes: string[];
  /** 알림 기준 시간대 (IANA). 기기 시간대가 바뀌어도 자동으로 바꾸지 않는다 */
  timezone: string;
  /** 잠금화면 알림에 계약명·금액 표시 (기본 꺼짐) */
  showDetails: boolean;
  /** 종류별 설정 — 저장된 값이 없는 종류는 PACTO 기본값 */
  categories: Partial<CategoryPrefsMap>;
}

/** 계약별 직접 설정 (값이 있는 종류만 덮어쓴다) */
export type ContractNotificationOverride = Partial<CategoryPrefsMap>;

export const DEFAULT_TIME_OF_DAY = '09:00';
export const DEFAULT_TIMES: readonly string[] = [DEFAULT_TIME_OF_DAY];
/** 기본 알림 시간·종류별 시간 최대 개수 */
export const MAX_NOTIFICATION_TIMES = 4;
export const DEFAULT_TIMEZONE = 'Asia/Seoul';

const sortOffsets = (xs: readonly number[]) => [...new Set(xs.filter((x) => ALLOWED_OFFSETS.has(x)))].sort((a, b) => b - a);

/** PACTO 기본값 */
export const PACTO_DEFAULT_CATEGORIES: CategoryPrefsMap = Object.fromEntries(
  NOTIFICATION_CATEGORIES.map((c) => [c, { enabled: true, offsets: sortOffsets(REMINDER_RULES[NOTIFICATION_CATEGORY_DEFS[c].rule]) }]),
) as CategoryPrefsMap;

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  defaultTimes: [...DEFAULT_TIMES],
  timezone: DEFAULT_TIMEZONE,
  showDetails: false,
  categories: {},
};

/** 알림 시간 목록 정리 — 'HH:MM'만, 중복 제거, 이른 시간부터, 최대 4개. 비면 null */
export function normalizeTimes(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const xs = [...new Set(raw.filter(isValidTimeOfDay))].sort().slice(0, MAX_NOTIFICATION_TIMES);
  return xs.length ? xs : null;
}

/** 저장값 정리 (형식이 틀린 값은 버리고 기본값) — 앱·서버·DB 어디서 왔든 같은 규칙 */
export function normalizeCategoryPrefs(raw: unknown): Partial<CategoryPrefsMap> {
  const out: Partial<CategoryPrefsMap> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const c of NOTIFICATION_CATEGORIES) {
    const v = (raw as Record<string, unknown>)[c];
    if (!v || typeof v !== 'object') continue;
    const o = v as { enabled?: unknown; offsets?: unknown; times?: unknown };
    const offsets = Array.isArray(o.offsets) ? sortOffsets(o.offsets.filter((x): x is number => Number.isInteger(x))) : null;
    if (typeof o.enabled !== 'boolean' || !offsets) continue;
    const times = normalizeTimes(o.times);
    out[c] = times ? { enabled: o.enabled, offsets, times } : { enabled: o.enabled, offsets };
  }
  return out;
}

export function isValidTimeOfDay(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export type PreferenceOrigin = 'pacto' | 'user' | 'contract';

export interface EffectivePreferences {
  enabled: boolean;
  /** 기본 알림 시간 (1개 이상) */
  defaultTimes: string[];
  timezone: string;
  showDetails: boolean;
  categories: CategoryPrefsMap;
  /** 종류별로 어느 단계의 설정이 적용됐는지 */
  origin: Record<NotificationCategory, PreferenceOrigin>;
}

/** PACTO 기본값 → 사용자 전체 설정 → 계약별 설정 (뒤가 앞을 덮는다) */
export function getEffectiveNotificationPreferences(user: Partial<NotificationPreferences> | null | undefined, override?: ContractNotificationOverride | null): EffectivePreferences {
  const userCats = normalizeCategoryPrefs(user?.categories);
  const contractCats = normalizeCategoryPrefs(override);
  const categories = {} as CategoryPrefsMap;
  const origin = {} as Record<NotificationCategory, PreferenceOrigin>;
  for (const c of NOTIFICATION_CATEGORIES) {
    const from = INHERITS_FROM[c];
    const contractPick = contractCats[c] ?? (from ? contractCats[from] : undefined);
    const userPick = userCats[c] ?? (from ? userCats[from] : undefined);
    const pick = contractPick ?? userPick ?? PACTO_DEFAULT_CATEGORIES[c];
    // 종류별 시간: 계약별 설정에 없으면 사용자 설정의 그 종류 시간 (없으면 기본 알림 시간)
    const times = contractPick?.times ?? userPick?.times;
    categories[c] = times ? { enabled: pick.enabled, offsets: [...pick.offsets], times: [...times] } : { enabled: pick.enabled, offsets: [...pick.offsets] };
    origin[c] = contractPick ? 'contract' : userPick ? 'user' : 'pacto';
  }
  return {
    enabled: user?.enabled ?? true,
    defaultTimes: normalizeTimes(user?.defaultTimes) ?? [...DEFAULT_TIMES],
    timezone: user?.timezone && isValidTimeZone(user.timezone) ? user.timezone : DEFAULT_TIMEZONE,
    showDetails: user?.showDetails === true,
    categories,
    origin,
  };
}

/** 이 종류의 실제 알림 시간 — 종류별 시간이 있으면 그것, 없으면 기본 알림 시간 */
export function timesFor(p: Pick<EffectivePreferences, 'defaultTimes' | 'categories'>, c: NotificationCategory): string[] {
  return p.categories[c].times?.length ? p.categories[c].times! : p.defaultTimes;
}

/** 일정(알림 대상) → 알림 종류 — 통보기한은 의미(해지·갱신 통보 / 갱신 여부 확인)에 따라 */
export function reminderCategory(r: Pick<Reminder, 'kind' | 'actionType'>): NotificationCategory {
  if (r.kind === 'payment') return 'payment';
  if (r.kind === 'contract_end') return 'contract_end';
  if (r.kind === 'renewal') return 'renewal';
  if (r.actionType === 'renewal_notice') return 'renewal_notice';
  if (r.actionType === 'renewal_decision') return 'renewal_decision';
  return 'termination_notice';
}

/** 설정 → 일정 계산용 알림 시점 (꺼진 종류는 빈 목록) */
export function toReminderRules(p: Pick<EffectivePreferences, 'categories'>): ReminderRules {
  const on = (c: NotificationCategory) => (p.categories[c].enabled ? p.categories[c].offsets : []);
  return {
    payment: on('payment'),
    terminationNotice: on('termination_notice'),
    renewalNotice: on('renewal_notice'),
    renewalDecision: on('renewal_decision'),
    contractEnd: on('contract_end'),
    renewal: on('renewal'),
  };
}

/** 사용자 설정이 PACTO 기본값과 같은지 (되돌리기 버튼 표시용) */
export function isPactoDefault(categories: Partial<CategoryPrefsMap>): boolean {
  const n = normalizeCategoryPrefs(categories);
  return NOTIFICATION_CATEGORIES.every((c) => {
    const v = n[c];
    if (!v) return true;
    const d = PACTO_DEFAULT_CATEGORIES[c];
    return v.enabled === d.enabled && v.offsets.join(',') === d.offsets.join(',') && !v.times;
  });
}

/** 꺼도 되는지 확인이 필요한 변경 — 중요한 기한(critical) 종류를 완전히 끄거나 PACTO 알림 전체를 끌 때 */
export function needsCriticalOffConfirm(category: NotificationCategory, next: CategoryPrefs): boolean {
  return NOTIFICATION_CATEGORY_DEFS[category].critical && (!next.enabled || next.offsets.length === 0);
}

// ===== 6) 시간대 + 알림 받는 시간 =====

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function zoneParts(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 그 시간대의 오늘 날짜 */
export function localDateIn(now: Date, tz: string): ISODate {
  const p = zoneParts(now.getTime(), tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** 그 시간대의 날짜·시각 → UTC 시각 (서머타임 포함) */
export function zonedTimeToUtc(date: ISODate, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (ms: number) => {
    const p = zoneParts(ms, tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - ms;
  };
  const o1 = offset(guess);
  let t = guess - o1;
  const o2 = offset(t);
  if (o2 !== o1) t = guess - o2;
  return new Date(t);
}

/**
 * 알림 날짜 → 실제 발송 시각. 방해 금지 시간(quiet hours) 같은 규칙은 여기에만 붙인다.
 * critical도 사용자가 정한 시간 외에 임의로 보내지 않는다.
 */
export function resolveSendTime(fireOn: ISODate, time: string, timezone: string): Date {
  return zonedTimeToUtc(fireOn, time, timezone);
}

/** 화면 표시: "10월 19일 오전 9:00" (알림 기준 시간대) */
export function formatSendTime(at: Date | string, tz: string): string {
  const p = zoneParts(new Date(at).getTime(), tz);
  const ampm = p.h < 12 ? '오전' : '오후';
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${p.m}월 ${p.d}일 ${ampm} ${h12}:${pad(p.mi)}`;
}

/** "오전 9:00" */
export function formatTimeOfDay(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${pad(m)}`;
}

/** "오전 9:00, 오후 6:30" */
export function formatTimes(times: readonly string[]): string {
  return times.map(formatTimeOfDay).join(', ');
}

/** "30·7·1일 전" · "1일 전·당일" · "당일" */
export function formatOffsets(offsets: readonly number[]): string {
  const days = offsets.filter((d) => d > 0);
  const parts = days.length ? [`${days.join('·')}일 전`] : [];
  if (offsets.includes(0)) parts.push('당일');
  return parts.join('·');
}

/**
 * 알림 종류 한 줄 요약 (설정 첫 화면) — "30·7·1일 전 · 기본 시간 (오전 9:00)" / "1일 전 · 오전 9:00, 오후 6:00" / "꺼짐"
 */
export function categorySummary(prefs: CategoryPrefs, defaultTimes: readonly string[]): string {
  if (!prefs.enabled || prefs.offsets.length === 0) return '꺼짐';
  const when = prefs.times?.length ? formatTimes(prefs.times) : `기본 시간 (${formatTimes(defaultTimes)})`;
  return `${formatOffsets(prefs.offsets)} · ${when}`;
}

// ===== 7·8·9) 발송 예정 알림 =====

/** 미리 만들어 두는 기간 — 반복 결제 알림을 몇 년치 만들지 않는다 (매일 하루씩 늘린다) */
export const PLAN_WINDOW_DAYS = 35;

export interface NotificationMessage {
  title: string;
  body: string;
}

export interface NotificationData {
  /** 눌렀을 때 이동할 앱 경로 */
  url: string;
  contractId: string;
  eventType: ActionEventType;
  eventKey: string;
  /** 관련 계약 체크 (원문 보기 연결용, 계약서 기준 일정만) */
  checkId: string | null;
}

export interface PlannedNotification {
  contractId: string;
  /** 대표 일정 (가장 중요한 것) */
  eventKey: string;
  eventType: ActionEventType;
  priority: NotificationPriority;
  source: NotificationSource;
  /** 대표 일정의 실제 날짜 (기한·결제일) */
  eventDate: ISODate;
  /** 알림 날짜 (알림 기준 시간대) */
  fireOn: ISODate;
  /** 발송 시각 (UTC ISO) */
  scheduledAt: string;
  offsetDays: number;
  /** 같은 계약·같은 발송 시각 = 푸시 1개 */
  groupKey: string;
  /** 같은 알림을 두 번 보내지 않기 위한 키 (DB UNIQUE) */
  dedupeKey: string;
  /** 잠금화면에 보낼 문구 (미리보기 설정 반영) */
  push: NotificationMessage;
  data: NotificationData;
  /** 앱 안 "다음 알림" 표시용 (앱 안에서만 보임) */
  display: { contractTitle: string; message: string; detail: string | null; eventLines: string[]; sourceLabel: string | null };
}

const PRIORITY_RANK: Record<NotificationPriority, number> = { critical: 0, important: 1, normal: 2 };

/** 대표 일정 종류 → 알림 종류 */
function eventTypeOf(group: ReminderGroup): ActionEventType {
  const head = [...group.reminders].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])[0];
  return group.reminders.find((r) => r.kind === group.kind)?.actionType ?? head.actionType;
}

/** 해야 할 일 안내 (판단하지 않고 확인을 권하는 문장만) */
function actionHint(kind: ReminderGroup['kind'], type: ActionEventType): string | null {
  if (type === 'renewal_notice') return '갱신 여부를 정해 상대방에게 알려야 하는지 계약 내용을 확인해보세요.';
  if (type === 'renewal_decision') return '갱신 여부를 상대방과 협의해보세요.';
  if (type === 'notice_unknown') return '이 일정의 의미를 확인해주세요.';
  if (kind === 'termination_notice') return '계약을 끝내려면 계약 내용을 확인해보세요.';
  if (kind === 'contract_end') return '계약을 계속할지 확인해보세요.';
  if (kind === 'renewal') return '갱신을 원하지 않는다면 해지 통보기한을 확인해보세요.';
  return null;
}

function headline(group: ReminderGroup): string {
  const head = group.reminders.find((r) => r.kind === group.kind)!;
  const d = head.daysBefore;
  const left = d === 0 ? '오늘이에요' : d === 1 ? '내일이에요' : `${d}일 남았어요`;
  if (group.kind === 'termination_notice') {
    if (head.actionType === 'notice_unknown') return '통보·갱신 관련 기한이 있어요.';
    return d === 0 ? `오늘이 ${head.label}이에요.` : d === 1 ? `내일이 ${head.label}이에요.` : `${head.label}까지 ${d}일 남았어요.`;
  }
  if (group.kind === 'contract_end') return head.actionType === 'maturity' ? `만기가 ${left}.` : `계약 만료가 ${left}.`;
  if (group.kind === 'renewal') return `자동갱신 예정일이 ${left}.`;
  return group.message;
}

/**
 * 푸시 문구 — 생성 로직은 여기 한 곳. 미리보기를 끈 사용자(기본)에게는 계약명·금액을 보내지 않는다 (잠금화면 노출).
 * 상세: critical·important는 대표 일정이 제목, 같은 날 결제는 본문에 함께. 결제만 있으면 "내일 950,000원 결제 예정이에요."
 */
export function buildNotificationMessage(group: ReminderGroup, opts: { showDetails: boolean }): NotificationMessage {
  if (!opts.showDetails) {
    return { title: 'PACTO', body: group.priority === 'normal' ? '확인할 계약 일정이 있어요.' : '확인할 계약 기한이 있어요.' };
  }
  if (group.kind === 'payment') {
    return { title: group.contractTitle, body: [group.message, group.detail].filter(Boolean).join('\n') };
  }
  const pays = group.reminders.filter((r) => r.kind === 'payment');
  const payLine = pays.length ? `${pays.map((p) => `${p.label} ${p.amount != null ? `${p.amount.toLocaleString('ko-KR')}원` : ''}`.trim()).join(' · ')} ${pays.some((p) => p.direction === 'income') ? '입금' : '결제'}도 예정되어 있어요.` : null;
  return { title: `${group.contractTitle} · ${headline(group)}`, body: [payLine ?? actionHint(group.kind, eventTypeOf(group))].filter(Boolean).join('\n') };
}

/** 같은 알림이면 항상 같은 키 — 사용자·계약·발송 시각·담긴 일정(종류·날짜·며칠 전) */
export function buildNotificationDedupeKey(userId: string, scheduledAt: string, reminderKeys: readonly string[]): string {
  return `${userId}|${scheduledAt}|${[...reminderKeys].sort().join(',')}`;
}

export function buildGroupKey(userId: string, contractId: string, scheduledAt: string): string {
  return `${userId}|${contractId}|${scheduledAt}`;
}

export interface PlanInput {
  userId: string;
  records: ContractRecord[];
  preferences: Partial<NotificationPreferences> | null;
  overrides: ReadonlyMap<string, ContractNotificationOverride>;
  now: Date;
  windowDays?: number;
}

/** 계약 상세로 이동 (관련 계약 체크가 있으면 함께) */
export function notificationUrl(contractId: string, eventType: ActionEventType, checkId: string | null): string {
  return `/contract/${contractId}?from=push&event=${eventType}${checkId ? `&check=${checkId}` : ''}`;
}

/** 앞으로 windowDays 안에 보낼 알림 (이미 지난 발송 시각은 제외) */
export function planNotifications(input: PlanInput): PlannedNotification[] {
  const base = getEffectiveNotificationPreferences(input.preferences);
  if (!base.enabled) return [];
  const today = localDateIn(input.now, base.timezone);
  const effCache = new Map<string, EffectivePreferences>();
  const effFor = (contractId: string) => {
    let e = effCache.get(contractId);
    if (!e) effCache.set(contractId, (e = getEffectiveNotificationPreferences(input.preferences, input.overrides.get(contractId))));
    return e;
  };
  const rulesFor = (c: Contract) => toReminderRules(effFor(c.id));
  const reminders = upcomingReminders(input.records, today, input.windowDays ?? PLAN_WINDOW_DAYS, { rulesFor });
  // 알림 시간별로 나눈 뒤 묶는다 — 종류마다 시간이 다를 수 있고, 시간이 여러 개면 그 시간마다 한 번씩
  const byTime = new Map<string, Reminder[]>();
  for (const r of reminders) {
    for (const t of timesFor(effFor(r.contractId), reminderCategory(r))) {
      const list = byTime.get(t);
      if (list) list.push(r);
      else byTime.set(t, [r]);
    }
  }
  const out: PlannedNotification[] = [];
  for (const [time, list] of byTime) {
    for (const group of groupReminders(list)) {
      const at = resolveSendTime(group.fireOn, time, base.timezone);
      if (at.getTime() <= input.now.getTime()) continue;
      const scheduledAt = at.toISOString();
      const head = group.reminders.find((r) => r.kind === group.kind)!;
      const eventType = eventTypeOf(group);
      const checkId = group.reminders.find((r) => r.evidence)?.evidence?.checkId ?? null;
      out.push({
        contractId: group.contractId,
        eventKey: head.key,
        eventType,
        priority: group.priority,
        source: head.source,
        eventDate: head.targetDate,
        fireOn: group.fireOn,
        scheduledAt,
        offsetDays: head.daysBefore,
        groupKey: buildGroupKey(input.userId, group.contractId, scheduledAt),
        dedupeKey: buildNotificationDedupeKey(input.userId, scheduledAt, group.reminders.map((r) => r.key)),
        push: buildNotificationMessage(group, { showDetails: base.showDetails }),
        data: { url: notificationUrl(group.contractId, eventType, checkId), contractId: group.contractId, eventType, eventKey: head.key, checkId },
        display: {
          contractTitle: group.contractTitle,
          message: group.kind === 'payment' ? group.message : headline(group),
          detail: group.detail,
          eventLines: group.eventLines,
          sourceLabel: group.kind === 'payment' ? null : NOTIFICATION_SOURCE_LABEL[head.source],
        },
      });
    }
  }
  return out.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

/** 알림 규칙 요약 (설정 반영) — 알림 화면 */
export function effectiveRulesSummary(prefs: Partial<NotificationPreferences> | null): ReminderRules {
  return toReminderRules(getEffectiveNotificationPreferences(prefs));
}

/**
 * 알림 화면용 한두 줄 요약 — 종류별 시점은 설정 화면에서만 자세히 보여준다.
 * 계약별 설정(override)은 요약에 넣지 않는다.
 *   모두 켜짐           → "오전 9:00 · 주요 계약 알림 사용 중"
 *   결제만 꺼짐         → "오전 9:00 · 중요 일정 중심" / "결제 알림 꺼짐"
 *   계약 알림 일부 꺼짐 → "오전 9:00 · 일부 계약 알림 꺼짐" (+ 결제 꺼짐이면 둘째 줄)
 *   전체 끔             → "알림이 꺼져 있어요"
 */
export function notificationSettingsSummary(prefs: Partial<NotificationPreferences> | null): { title: string; detail: string | null } {
  const eff = getEffectiveNotificationPreferences(prefs);
  if (!eff.enabled) return { title: '알림이 꺼져 있어요', detail: null };
  const on = (c: NotificationCategory) => eff.categories[c].enabled && eff.categories[c].offsets.length > 0;
  const time = formatTimes(eff.defaultTimes);
  const payOn = on('payment');
  const contractCats = NOTIFICATION_CATEGORIES.filter((c) => c !== 'payment');
  const contractOn = contractCats.filter(on).length;
  if (contractOn === 0) return { title: payOn ? `${time} · 결제 알림만 사용 중` : '켜진 알림 종류가 없어요', detail: payOn ? '계약 기한 알림 꺼짐' : null };
  if (contractOn < contractCats.length) return { title: `${time} · 일부 계약 알림 꺼짐`, detail: payOn ? null : '결제 알림 꺼짐' };
  return payOn ? { title: `${time} · 주요 계약 알림 사용 중`, detail: null } : { title: `${time} · 중요 일정 중심`, detail: '결제 알림 꺼짐' };
}
