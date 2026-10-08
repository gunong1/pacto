// 타입 선언 — 원본: src/domain/notifications.ts, src/data/supabase/rowMapping.ts (scripts/vendor-domain.mjs)
// 서버는 결과를 DB에 저장할 뿐이라 필요한 모양만 적는다.
export type NotificationCategory = 'payment' | 'termination_notice' | 'contract_end' | 'renewal';
export interface CategoryPrefs { enabled: boolean; offsets: number[] }
export interface NotificationPreferences {
  enabled: boolean;
  timeOfDay: string;
  timezone: string;
  showDetails: boolean;
  categories: Partial<Record<NotificationCategory, CategoryPrefs>>;
}
export type ContractNotificationOverride = Partial<Record<NotificationCategory, CategoryPrefs>>;
export interface PlannedNotification {
  contractId: string;
  eventKey: string;
  eventType: string;
  priority: 'critical' | 'important' | 'normal';
  source: 'contract' | 'manual_entry' | 'legal' | 'pacto' | 'user_custom';
  eventDate: string;
  fireOn: string;
  scheduledAt: string;
  offsetDays: number;
  groupKey: string;
  dedupeKey: string;
  push: { title: string; body: string };
  data: { url: string; contractId: string; eventType: string; eventKey: string; checkId: string | null };
  display: { contractTitle: string; message: string; detail: string | null; eventLines: string[]; sourceLabel: string | null };
}
// deno-lint-ignore no-explicit-any
export type ContractRecord = any;
export function planNotifications(input: {
  userId: string;
  records: ContractRecord[];
  preferences: Partial<NotificationPreferences> | null;
  overrides: ReadonlyMap<string, ContractNotificationOverride>;
  now: Date;
  windowDays?: number;
}): PlannedNotification[];
export function normalizeCategoryPrefs(raw: unknown): Partial<Record<NotificationCategory, CategoryPrefs>>;
export function isValidTimeOfDay(v: unknown): v is string;
export function isValidTimeZone(tz: string): boolean;
export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[];
export const PLAN_WINDOW_DAYS: number;
// deno-lint-ignore no-explicit-any
export function toRecord(row: any): ContractRecord;
export const CONTRACT_SELECT: string;
