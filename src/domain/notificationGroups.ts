/**
 * 알림 설정 화면의 3묶음 — 보여주는 구조만 묶고, 저장은 기존 종류별 키 그대로 (알림 계산·발송은 종류별 enabled·offsets·times만 본다).
 *   입출금 알림          = 결제·입금
 *   계약 만료·갱신 알림  = 해지·갱신 통보기한(해지·종료 + 갱신 통보 2개 키) · 계약 만료 · 자동갱신 예정일
 *   중요 확인 알림       = 갱신 여부 확인 · 보증금 반환 확인
 * 그룹 끄기: 켜져 있던 종류만 끄고 groupOff 표시 (시점·시간은 그대로) → 다시 켜기: 표시된 종류만 되살림 (따로 꺼 둔 종류는 그대로)
 */
import { categorySummary, NOTIFICATION_CATEGORY_DEFS, NOTIFICATION_CATEGORY_GROUPS, PACTO_DEFAULT_CATEGORIES, type CategoryPrefs, type CategoryPrefsMap, type NotificationCategory } from './notifications';

export type SettingGroupKey = 'money' | 'term' | 'check';
export interface SettingGroup {
  key: SettingGroupKey;
  label: string;
  description: string;
  /** 설정 화면 한 줄 단위 (NOTIFICATION_CATEGORY_GROUPS의 key) */
  rows: readonly NotificationCategory[];
}
export const NOTIFICATION_SETTING_GROUPS: readonly SettingGroup[] = [
  { key: 'money', label: '입출금 알림', description: '보험료, 급여, 월 납입금 등', rows: ['payment'] },
  { key: 'term', label: '계약 만료·갱신 알림', description: '계약 만료, 자동갱신, 해지 통보기한', rows: ['termination_notice', 'contract_end', 'renewal'] },
  { key: 'check', label: '중요 확인 알림', description: '보증금 반환, 갱신 여부 확인 등', rows: ['renewal_decision', 'deposit_return'] },
];

export const settingGroup = (key: string | undefined): SettingGroup | undefined => NOTIFICATION_SETTING_GROUPS.find((g) => g.key === key);
/** 그룹의 설정 줄 (기존 종류별 설정 화면 하나 = 한 줄) */
export const groupRows = (g: SettingGroup) => g.rows.map((k) => NOTIFICATION_CATEGORY_GROUPS.find((r) => r.key === k)!);
/** 그룹에 속한 저장 키 전체 (해지·갱신 통보기한은 2개 키) */
export const groupMembers = (g: SettingGroup): NotificationCategory[] => groupRows(g).flatMap((r) => [...r.members]);
export const groupHasCritical = (g: SettingGroup) => groupMembers(g).some((c) => NOTIFICATION_CATEGORY_DEFS[c].critical);

/** 실제로 알림이 오는 상태 (켜짐 + 시점 1개 이상) — 알림 계산과 같은 기준 */
export const isOn = (p: CategoryPrefs) => p.enabled && p.offsets.length > 0;

export type GroupState = 'on' | 'off' | 'partial';
export function groupState(cats: CategoryPrefsMap, g: SettingGroup): GroupState {
  const on = g.rows.filter((r) => isOn(cats[r])).length;
  return on === 0 ? 'off' : on === g.rows.length ? 'on' : 'partial';
}
export const GROUP_STATE_LABEL: Record<GroupState, string> = { on: '켜짐', off: '꺼짐', partial: '일부 켜짐' };

/**
 * 그룹 한 줄 요약 — 시점이 서로 다르면 하나로 뭉뚱그리지 않는다.
 * 모두 같은 시점·시간일 때만 그 값 ("30·7일 전 · 기본 시간 (오전 9:00)"), 아니면 "3종 알림 설정됨 · 알림 시점 개별 설정"
 */
export function groupSummary(cats: CategoryPrefsMap, defaultTimes: readonly string[], g: SettingGroup): string {
  const state = groupState(cats, g);
  if (state === 'off') return '꺼짐';
  const on = g.rows.filter((r) => isOn(cats[r]));
  if (state === 'partial') return `${g.rows.length}종 중 ${on.length}종 켜짐 · 알림 시점 개별 설정`;
  const sums = new Set(on.map((r) => categorySummary(cats[r], defaultTimes)));
  if (sums.size === 1) return [...sums][0];
  return `${g.rows.length}종 알림 설정됨 · 알림 시점 개별 설정`;
}

export type GroupAction = 'off' | 'on' | 'all_on';
/** 상태별로 고를 수 있는 동작: 켜짐 → 끄기 · 꺼짐 → 켜기 · 일부 → 모두 켜기 / 모두 끄기 */
export function groupActions(state: GroupState): { action: GroupAction; label: string }[] {
  if (state === 'on') return [{ action: 'off', label: '끄기' }];
  if (state === 'off') return [{ action: 'on', label: '켜기' }];
  return [
    { action: 'all_on', label: '모두 켜기' },
    { action: 'off', label: '모두 끄기' },
  ];
}

/**
 * 그룹 동작 → 바뀌는 종류의 새 값 (기존 저장 구조 그대로 · 시점·시간은 보존)
 * - off: 켜져 있던 종류만 끄고 groupOff 표시 (이미 꺼진 종류는 그대로)
 * - on: groupOff 표시된 종류만 되살림 — 표시가 하나도 없으면(따로 꺼 둔 경우) 모두 켬
 * - all_on: 모두 켬
 * 켤 때 시점이 비어 있던 종류는 PACTO 기본 시점으로 (시점 없이 켜면 알림이 오지 않으므로)
 */
export function applyGroupAction(cats: CategoryPrefsMap, g: SettingGroup, action: GroupAction): Partial<CategoryPrefsMap> {
  const members = groupMembers(g);
  const plain = (p: CategoryPrefs, enabled: boolean): CategoryPrefs => {
    const offsets = [...p.offsets];
    return p.times?.length ? { enabled, offsets, times: [...p.times] } : { enabled, offsets };
  };
  const out: Partial<CategoryPrefsMap> = {};
  if (action === 'off') {
    for (const c of members) if (isOn(cats[c])) out[c] = { ...plain(cats[c], false), groupOff: true };
    return out;
  }
  const marked = members.filter((c) => cats[c].groupOff);
  const targets = action === 'on' && marked.length > 0 ? marked : members;
  for (const c of members) {
    if (targets.includes(c)) out[c] = { ...plain(cats[c], true), offsets: cats[c].offsets.length ? [...cats[c].offsets] : [...PACTO_DEFAULT_CATEGORIES[c].offsets] };
    else if (cats[c].groupOff) out[c] = plain(cats[c], false);
  }
  return out;
}
