/**
 * 알림 설정 3묶음 (src/domain/notificationGroups.ts) — 저장은 기존 종류별 키 그대로, 알림 계산은 그대로
 * - 매핑: 입출금(결제·입금) · 만료·갱신(통보기한 2키·만료·자동갱신) · 중요 확인(갱신 여부·보증금 반환) = 기존 7개 키 모두, 겹침 없음
 * - 그룹 끄기 → 켜져 있던 종류만 끄고 시점 보존 · 다시 켜기 → 따로 꺼 둔 종류는 그대로
 * - 일부 켜짐 표시 · 시점이 다르면 하나로 요약하지 않음
 * - 저장값 그대로 다시 읽어도(정규화) 표시가 남음 · 알림 계획: 끈 그룹 종류만 빠지고, 다시 켜면 처음과 같은 계획
 */
import { createMockRecords } from '@/data/mock/mockContracts';

import { applyGroupAction, groupActions, groupMembers, groupState, groupSummary, NOTIFICATION_SETTING_GROUPS, settingGroup } from '../notificationGroups';
import { DEFAULT_TIMES, getEffectiveNotificationPreferences, NOTIFICATION_CATEGORIES, normalizeCategoryPrefs, planNotifications, type CategoryPrefsMap } from '../notifications';

const eff = (categories: unknown = {}) => getEffectiveNotificationPreferences({ categories: categories as CategoryPrefsMap });
const save = (cats: CategoryPrefsMap, patch: Partial<CategoryPrefsMap>) => eff(normalizeCategoryPrefs(JSON.parse(JSON.stringify({ ...cats, ...patch })))).categories;
const term = settingGroup('term')!;

test('매핑: 3묶음이 기존 7개 키를 모두 한 번씩 덮음', () => {
  const all = NOTIFICATION_SETTING_GROUPS.flatMap(groupMembers);
  expect([...all].sort()).toEqual([...NOTIFICATION_CATEGORIES].sort());
  expect(groupMembers(settingGroup('money')!)).toEqual(['payment']);
  expect(groupMembers(term)).toEqual(['termination_notice', 'renewal_notice', 'contract_end', 'renewal']);
  expect(groupMembers(settingGroup('check')!)).toEqual(['renewal_decision', 'deposit_return']);
});

test('기본값: 3묶음 모두 켜짐 · 시점이 다르면 "3종 알림 설정됨 · 알림 시점 개별 설정" · 한 종류면 그 시점', () => {
  const c = eff().categories;
  expect(NOTIFICATION_SETTING_GROUPS.map((g) => groupState(c, g))).toEqual(['on', 'on', 'on']);
  expect(groupSummary(c, DEFAULT_TIMES, term)).toBe('3종 알림 설정됨 · 알림 시점 개별 설정');
  expect(groupSummary(c, DEFAULT_TIMES, settingGroup('money')!)).toBe('1일 전 · 기본 시간 (오전 9:00)');
});

test('그룹 끄기 → 다시 켜기: 시점 보존 · 따로 꺼 둔 종류(자동갱신)는 계속 꺼짐 · 저장 후 다시 읽어도 같음', () => {
  let c = eff().categories;
  // 사용자가 계약 만료 시점을 바꾸고, 자동갱신은 따로 꺼 둠
  c = save(c, { contract_end: { enabled: true, offsets: [60, 14], times: ['20:00'] }, renewal: { ...c.renewal, enabled: false } });
  expect(groupState(c, term)).toBe('partial');
  expect(groupSummary(c, DEFAULT_TIMES, term)).toBe('3종 중 2종 켜짐 · 알림 시점 개별 설정');
  expect(groupActions('partial').map((a) => a.label)).toEqual(['모두 켜기', '모두 끄기']);

  const off = save(c, applyGroupAction(c, term, 'off'));
  expect(groupState(off, term)).toBe('off');
  expect(off.contract_end).toEqual({ enabled: false, offsets: [60, 14], times: ['20:00'], groupOff: true });
  expect(off.renewal.groupOff).toBeUndefined(); // 원래 꺼져 있던 종류는 표시 없음
  expect(off.payment).toEqual(c.payment); // 다른 그룹은 그대로

  const back = save(off, applyGroupAction(off, term, 'on'));
  expect(back.contract_end).toEqual({ enabled: true, offsets: [60, 14], times: ['20:00'] });
  expect(back.termination_notice).toEqual(c.termination_notice);
  expect(back.renewal.enabled).toBe(false);
  expect(groupState(back, term)).toBe('partial');

  const all = save(back, applyGroupAction(back, term, 'all_on'));
  expect(groupState(all, term)).toBe('on');
  expect(all.renewal.offsets).toEqual(c.renewal.offsets);
});

test('따로 모두 꺼 둔 그룹을 켜면 모두 켜짐 (시점이 비어 있던 종류는 PACTO 기본 시점)', () => {
  const base = eff().categories;
  const c = save(base, { renewal_decision: { enabled: false, offsets: [] }, deposit_return: { ...base.deposit_return, enabled: false } });
  const g = settingGroup('check')!;
  expect(groupState(c, g)).toBe('off');
  const on = save(c, applyGroupAction(c, g, 'on'));
  expect(groupState(on, g)).toBe('on');
  expect(on.renewal_decision.offsets).toEqual(base.renewal_decision.offsets);
});

test('알림 계획: 만료·갱신 그룹 끄면 그 종류 알림만 빠지고 결제 알림은 그대로 · 다시 켜면 처음과 같은 계획', () => {
  const records = createMockRecords();
  const now = new Date('2026-10-16T00:00:00Z');
  const plan = (categories: CategoryPrefsMap) => planNotifications({ userId: 'u', records, preferences: { categories }, overrides: new Map(), now });
  const c = eff().categories;
  const before = plan(c);
  const off = save(c, applyGroupAction(c, term, 'off'));
  const during = plan(off);
  const termTypes = new Set(['termination_notice', 'renewal_notice', 'contract_end', 'renewal']);
  expect(before.some((p) => termTypes.has(p.eventType))).toBe(true);
  expect(during.some((p) => termTypes.has(p.eventType))).toBe(false);
  expect(during.filter((p) => p.eventType === 'payment')).toEqual(before.filter((p) => p.eventType === 'payment'));
  const back = save(off, applyGroupAction(off, term, 'on'));
  expect(plan(back)).toEqual(before);
});
