/**
 * 알림 설정·예정 알림 저장소 — 화면은 이 인터페이스만 쓴다.
 * - Supabase: 설정은 DB, 예정 알림은 서버 planner가 만든 scheduled_notifications (실제 푸시와 같은 데이터)
 * - Mock(미리보기): 메모리 설정 + 같은 도메인 함수(planNotifications)로 계산
 */
import {
  DEFAULT_PREFERENCES,
  getEffectiveNotificationPreferences,
  normalizeCategoryPrefs,
  planNotifications,
  type ContractNotificationOverride,
  type NotificationPreferences,
  type PlannedNotification,
} from '@/domain/notifications';
import type { ContractRecord } from '@/domain/types';

import type { Json } from '@/types/database';

import type { PactoSupabase } from './supabase/client';

export interface UpcomingNotification {
  id: string;
  contractId: string;
  scheduledAt: string;
  /** 알림 날짜 (알림 기준 시간대) */
  fireOn: string;
  priority: PlannedNotification['priority'];
  eventType: string;
  display: PlannedNotification['display'];
}

export interface PushTokenInfo {
  deviceId: string;
  platform: 'ios' | 'android';
  enabled: boolean;
}

export interface NotificationStore {
  getPreferences(): Promise<NotificationPreferences>;
  /** 설정 저장 — 서버가 예정 알림을 다시 계산한다 */
  savePreferences(patch: Partial<NotificationPreferences>): Promise<NotificationPreferences>;
  getOverride(contractId: string): Promise<ContractNotificationOverride | null>;
  /** null = 내 기본 설정 사용 */
  saveOverride(contractId: string, override: ContractNotificationOverride | null): Promise<void>;
  /** 실제로 앞으로 보낼 알림 (가까운 순) */
  upcoming(limit?: number): Promise<UpcomingNotification[]>;
  registerToken(token: string, deviceId: string, platform: 'ios' | 'android'): Promise<void>;
  unregisterToken(deviceId: string): Promise<void>;
  devices(): Promise<PushTokenInfo[]>;
  /** 계약 저장·설정 변경 직후 바로 다시 계산 (실패해도 5분 안에 서버가 다시 계산) */
  requestPlan(): Promise<void>;
  /** 개발·테스트 환경 전용 */
  sendTest(opts?: { contractId?: string; delaySeconds?: number }): Promise<{ devices: number; ok: number; errors: string[] } | { scheduledInSeconds: number } | { error: string }>;
}

// ===== Supabase =====

export class SupabaseNotificationStore implements NotificationStore {
  constructor(private readonly sb: PactoSupabase) {}

  /** 로그인 사용자 id — 기기에 저장된 세션에서 (서버에 묻지 않는다: 누를 때마다 왕복이 생기지 않도록. 권한은 DB RLS가 확인) */
  private async uid(): Promise<string> {
    const { data } = await this.sb.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new Error('not_authenticated');
    return id;
  }

  async getPreferences(): Promise<NotificationPreferences> {
    const uid = await this.uid();
    const [{ data: p }, { data: profile }] = await Promise.all([
      this.sb.from('notification_preferences').select('enabled, time_of_day, categories').eq('user_id', uid).maybeSingle(),
      this.sb.from('profiles').select('timezone, push_preview_enabled').eq('id', uid).maybeSingle(),
    ]);
    const eff = getEffectiveNotificationPreferences({
      enabled: p?.enabled ?? true,
      timeOfDay: p?.time_of_day?.slice(0, 5),
      timezone: profile?.timezone,
      showDetails: profile?.push_preview_enabled ?? false,
      categories: normalizeCategoryPrefs(p?.categories),
    });
    return { enabled: eff.enabled, timeOfDay: eff.timeOfDay, timezone: eff.timezone, showDetails: eff.showDetails, categories: normalizeCategoryPrefs(p?.categories) };
  }

  async savePreferences(patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    const uid = await this.uid();
    // 바뀐 값만 저장 (프로필·알림 설정을 동시에). 화면은 누르는 즉시 바뀌고(useSaveNotificationPreferences), 저장·재계산은 뒤에서 끝난다
    const writes: PromiseLike<{ error: { message: string } | null }>[] = [];
    if (patch.timezone !== undefined || patch.showDetails !== undefined) {
      writes.push(
        this.sb
          .from('profiles')
          .update({ ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}), ...(patch.showDetails !== undefined ? { push_preview_enabled: patch.showDetails } : {}) })
          .eq('id', uid),
      );
    }
    if (patch.enabled !== undefined || patch.timeOfDay !== undefined || patch.categories !== undefined) {
      // upsert는 보낸 칸만 덮어쓴다 (처음이면 나머지는 DB 기본값)
      writes.push(
        this.sb.from('notification_preferences').upsert({
          user_id: uid,
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.timeOfDay !== undefined ? { time_of_day: patch.timeOfDay } : {}),
          ...(patch.categories !== undefined ? { categories: normalizeCategoryPrefs(patch.categories) as unknown as { [key: string]: Json } } : {}),
        }),
      );
    }
    for (const { error } of await Promise.all(writes)) {
      if (error) throw new Error(error.message.includes('invalid_timezone') ? 'invalid_timezone' : 'save_failed');
    }
    await this.requestPlan();
    return this.getPreferences();
  }

  async getOverride(contractId: string) {
    const { data } = await this.sb.from('contract_notification_overrides').select('categories').eq('contract_id', contractId).maybeSingle();
    return data ? normalizeCategoryPrefs(data.categories) : null;
  }

  async saveOverride(contractId: string, override: ContractNotificationOverride | null) {
    if (override === null) {
      const { error } = await this.sb.from('contract_notification_overrides').delete().eq('contract_id', contractId);
      if (error) throw new Error('save_failed');
    } else {
      const { error } = await this.sb.from('contract_notification_overrides').upsert({ contract_id: contractId, categories: normalizeCategoryPrefs(override) as unknown as { [key: string]: Json } });
      if (error) throw new Error('save_failed');
    }
    await this.requestPlan();
  }

  async upcoming(limit = 20): Promise<UpcomingNotification[]> {
    const { data, error } = await this.sb
      .from('scheduled_notifications')
      .select('id, contract_id, scheduled_at, fire_on, priority, event_type, display_json')
      .eq('status', 'scheduled')
      .gt('scheduled_at', new Date().toISOString())
      .order('scheduled_at')
      .limit(limit);
    if (error) return [];
    return (data ?? []).map((r) => ({
      id: r.id,
      contractId: r.contract_id,
      scheduledAt: r.scheduled_at,
      fireOn: r.fire_on,
      priority: r.priority as UpcomingNotification['priority'],
      eventType: r.event_type,
      display: r.display_json as unknown as UpcomingNotification['display'],
    }));
  }

  async registerToken(token: string, deviceId: string, platform: 'ios' | 'android') {
    const { error } = await this.sb.rpc('register_push_token', { p_token: token, p_device_id: deviceId, p_platform: platform });
    if (error) throw new Error('register_failed');
  }

  async unregisterToken(deviceId: string) {
    await this.sb.rpc('unregister_push_token', { p_device_id: deviceId });
  }

  async devices(): Promise<PushTokenInfo[]> {
    const { data } = await this.sb.from('push_tokens').select('device_id, platform, enabled');
    return (data ?? []).map((d) => ({ deviceId: d.device_id, platform: d.platform as 'ios' | 'android', enabled: d.enabled }));
  }

  async requestPlan() {
    await this.sb.functions.invoke('notifications', { body: { action: 'plan' } }).catch(() => undefined);
  }

  async sendTest(opts: { contractId?: string; delaySeconds?: number } = {}) {
    const { data, error } = await this.sb.functions.invoke('notifications', { body: { action: 'test', ...opts } });
    if (error) {
      let code = 'test_failed';
      try {
        const b = await (error as { context?: Response }).context?.json();
        if (typeof b?.error === 'string') code = b.error;
      } catch {
        // 본문 없음
      }
      return { error: code };
    }
    return data;
  }
}

// ===== 미리보기 (메모리) =====
export class MockNotificationStore implements NotificationStore {
  private prefs: NotificationPreferences = { ...DEFAULT_PREFERENCES };
  private overrides = new Map<string, ContractNotificationOverride>();

  constructor(
    private readonly records: () => Promise<ContractRecord[]>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getPreferences() {
    return { ...this.prefs, categories: { ...this.prefs.categories } };
  }
  async savePreferences(patch: Partial<NotificationPreferences>) {
    this.prefs = { ...this.prefs, ...patch, categories: normalizeCategoryPrefs(patch.categories ?? this.prefs.categories) };
    return this.getPreferences();
  }
  async getOverride(contractId: string) {
    return this.overrides.get(contractId) ?? null;
  }
  async saveOverride(contractId: string, override: ContractNotificationOverride | null) {
    if (override) this.overrides.set(contractId, normalizeCategoryPrefs(override));
    else this.overrides.delete(contractId);
  }
  async upcoming(limit = 20) {
    const planned = planNotifications({ userId: 'preview', records: await this.records(), preferences: this.prefs, overrides: this.overrides, now: this.now() });
    return planned.slice(0, limit).map((p) => ({ id: p.dedupeKey, contractId: p.contractId, scheduledAt: p.scheduledAt, fireOn: p.fireOn, priority: p.priority, eventType: p.eventType, display: p.display }));
  }
  async registerToken() {}
  async unregisterToken() {}
  async devices() {
    return [];
  }
  async requestPlan() {}
  async sendTest() {
    return { error: 'preview_mode' };
  }
}
