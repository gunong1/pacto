/**
 * 보증금 반환 확인 알림 (migration 20261027000001 + notifications 함수) — 모든 값은 가짜
 * A 예전 앱이 설정을 저장해도(_v 없음) 새 종류(deposit_return) 설정은 그대로 · 새 앱의 "기본값으로 되돌리기"는 그대로 지움
 * B 계약별 설정도 같은 규칙
 * C 설정 값 검증 (모르는 키·잘못된 표시 거부)
 * D 보증금 묶음·반환 기록이 바뀌면 다시 계산 요청 (queue)
 * E 계약이 끝난 뒤에도 반환 확인 알림 예정(기준일 뒤 → offset_days 음수) → 전액 반환 기록하면 취소
 */
import { EMPTY_DRAFT } from '@/data/draft';
import { SupabaseNotificationStore } from '@/data/notifications';
import type { ContractDraft, PaymentDraft } from '@/data/repository';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { addDays, todayInSeoul } from '@/domain/dates';

import { adminClient, newUser } from './helpers';

jest.setTimeout(60_000);

const OFF = { enabled: false, offsets: [30, 7, 0] };
const ON3 = { enabled: true, offsets: [3] };
const prefsRow = async (uid: string) => (await adminClient().from('notification_preferences').select('categories').eq('user_id', uid).single()).data!.categories as Record<string, unknown>;

describe('A·B 예전 앱 저장 호환', () => {
  test('A. 사용자 전체 설정', async () => {
    const a = await newUser('dep-pref');
    const store = new SupabaseNotificationStore(a.client);
    // 새 앱: 보증금 반환 확인 끔
    await store.savePreferences({ categories: { deposit_return: OFF } });
    expect(await prefsRow(a.user.id)).toEqual({ _v: 2, deposit_return: OFF });
    // 예전 앱: 자기가 아는 종류만 전체 저장 (deposit_return·_v 없음) → 결제 시점은 바뀌고 보증금 설정은 유지
    expect((await a.client.from('notification_preferences').upsert({ user_id: a.user.id, categories: { payment: ON3 } })).error).toBeNull();
    expect(await prefsRow(a.user.id)).toEqual({ payment: ON3, deposit_return: OFF });
    expect((await store.getPreferences()).categories).toEqual({ payment: ON3, deposit_return: OFF });
    // 예전 앱의 되돌리기({}) — 예전 앱이 보여준 종류만 기본값, 보증금 설정은 유지
    await a.client.from('notification_preferences').upsert({ user_id: a.user.id, categories: {} });
    expect(await prefsRow(a.user.id)).toEqual({ deposit_return: OFF });
    // 새 앱의 되돌리기 → 모두 기본값
    await store.savePreferences({ categories: {} });
    expect(await prefsRow(a.user.id)).toEqual({ _v: 2 });
  });

  test('B. 계약별 설정', async () => {
    const a = await newUser('dep-ovr');
    const repo = new SupabaseContractRepository(a.client, todayInSeoul);
    const store = new SupabaseNotificationStore(a.client);
    const rec = await repo.create({ draft: { ...EMPTY_DRAFT, title: '임대차', category: 'real_estate', contractType: 'lease', startDate: '2026-01-01', endDate: '2028-01-01' }, source: 'manual', documents: [], aiChecks: [] });
    const id = rec.contract.id;
    await store.saveOverride(id, { deposit_return: OFF, contract_end: { enabled: true, offsets: [90] } });
    await a.client.from('contract_notification_overrides').upsert({ contract_id: id, categories: { contract_end: { enabled: true, offsets: [30] } } });
    expect(await store.getOverride(id)).toEqual({ deposit_return: OFF, contract_end: { enabled: true, offsets: [30] } });
    // 새 앱이 계약별 설정에서 보증금 항목을 기본값으로 저장하면 그 값으로
    await store.saveOverride(id, { contract_end: { enabled: true, offsets: [30] }, deposit_return: { enabled: true, offsets: [7] } });
    expect(await store.getOverride(id)).toEqual({ contract_end: { enabled: true, offsets: [30] }, deposit_return: { enabled: true, offsets: [7] } });
  });

  test('C. 검증: 모르는 키·잘못된 표시·허용되지 않은 시점 거부', async () => {
    const a = await newUser('dep-valid');
    const up = (categories: unknown) => a.client.from('notification_preferences').upsert({ user_id: a.user.id, categories: categories as never });
    expect((await up({ _v: 2, deposit_return: { enabled: true, offsets: [30, 7, 0] } })).error).toBeNull();
    expect((await up({ _v: 3 })).error).not.toBeNull();
    expect((await up({ _v: '2' })).error).not.toBeNull();
    expect((await up({ unknown_kind: { enabled: true, offsets: [1] } })).error).not.toBeNull();
    expect((await up({ deposit_return: { enabled: true, offsets: [45] } })).error).not.toBeNull();
  });
});

// ===== 계약이 끝난 임대차 (종료일 = 오늘 − 3일) · 보증금 2,000만 · 임차인 =====
const TODAY = todayInSeoul();
const END = addDays(TODAY, -3);
const pay = (o: Partial<PaymentDraft>): PaymentDraft => ({
  kind: 'other', direction: 'expense', label: '납부금', amount: 0, frequency: 'one_time', dayOfMonth: null, monthOfYear: null, startsOn: null, endsOn: null,
  installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null, ...o,
});
const ended = (): ContractDraft => ({
  ...EMPTY_DRAFT,
  title: '주택 임대차계약',
  category: 'real_estate',
  contractKind: 'lease',
  contractType: 'lease',
  startDate: addDays(END, -730),
  endDate: END,
  depositAmount: 20_000_000,
  userPartyRole: 'lessee',
  userPartyRelation: 'self',
  funds: [{ key: 'dep', kind: 'deposit', label: '보증금', totalAmount: null, returnDueOn: null, depositorRole: null, holderRole: null }],
  payments: [pay({ kind: 'deposit', label: '보증금', amount: 20_000_000, startsOn: addDays(END, -730), moneyNature: 'refundable_deposit', directionBasis: 'role', fundKey: 'dep' })],
});

describe('D·E 보증금 반환 확인 알림 계획', () => {
  test('D. 묶음·반환 기록 변경 → 다시 계산 요청', async () => {
    const a = await newUser('dep-queue');
    const repo = new SupabaseContractRepository(a.client, () => TODAY);
    const rec = await repo.create({ draft: ended(), source: 'manual', documents: [], aiChecks: [] });
    const queued = async () => (await adminClient().from('notification_plan_queue').select('user_id').eq('user_id', a.user.id)).data!.length;
    await adminClient().from('notification_plan_queue').delete().eq('user_id', a.user.id);
    expect(await queued()).toBe(0);
    const saved = await repo.addRefund(rec.contract.id, rec.funds![0].id, { amount: 1_000_000, refundedOn: TODAY });
    expect(await queued()).toBe(1);
    await adminClient().from('notification_plan_queue').delete().eq('user_id', a.user.id);
    await repo.removeRefund(rec.contract.id, saved.funds![0].refunds[0].id);
    expect(await queued()).toBe(1);
    await adminClient().from('notification_plan_queue').delete().eq('user_id', a.user.id);
    await a.client.from('contract_funds').update({ return_due_on: addDays(TODAY, 10) }).eq('id', rec.funds![0].id);
    expect(await queued()).toBe(1);
  });

  test('E. 계약 종료 뒤에도 예정 → 일부 반환이면 남은 금액 문구 → 전액 반환하면 취소', async () => {
    const a = await newUser('dep-plan');
    const repo = new SupabaseContractRepository(a.client, () => TODAY);
    const store = new SupabaseNotificationStore(a.client);
    const rec = await repo.create({ draft: ended(), source: 'manual', documents: [], aiChecks: [] });
    await store.savePreferences({ showDetails: true });
    await store.requestPlan();
    const rows = async () =>
      ((await adminClient().from('scheduled_notifications').select('event_type, offset_days, fire_on, status, display_json, payload_json').eq('user_id', a.user.id).order('scheduled_at')).data ?? []) as {
        event_type: string; offset_days: number; fire_on: string; status: string; display_json: { message: string }; payload_json: { push: { title: string; body: string } };
      }[];
    const r1 = (await rows()).filter((r) => r.status === 'scheduled');
    expect(r1.map((r) => [r.event_type, r.offset_days, r.fire_on])).toEqual([
      ['deposit_return', -7, addDays(END, 7)],
      ['deposit_return', -30, addDays(END, 30)],
    ]);
    expect(r1[0].display_json.message).toBe('보증금 반환 확인 기준일(계약 종료일)이 7일 지났는데 아직 반환 완료 기록이 없어요. 돌려받으면 반환 기록을 남겨주세요.');
    expect(r1[0].payload_json.push.body).toBe('돌려받으면 반환 기록을 남겨주세요.');

    const part = await repo.addRefund(rec.contract.id, rec.funds![0].id, { amount: 5_000_000, refundedOn: TODAY });
    await store.requestPlan();
    const r2 = (await rows()).filter((r) => r.status === 'scheduled');
    expect(r2.map((r) => r.offset_days)).toEqual([-7, -30]);
    expect(r2[0].payload_json.push.body).toBe('일부 반환 후 남은 금액 15,000,000원을 돌려받으면 반환 기록을 남겨주세요.');

    await repo.addRefund(rec.contract.id, part.funds![0].id, { amount: 15_000_000, refundedOn: TODAY });
    await store.requestPlan();
    const r3 = await rows();
    expect(r3.filter((r) => r.status === 'scheduled')).toHaveLength(0);
    expect(r3.filter((r) => r.event_type === 'deposit_return').every((r) => r.status === 'cancelled')).toBe(true);
  });
});
