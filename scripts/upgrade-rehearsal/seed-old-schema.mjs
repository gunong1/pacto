/**
 * 운영 업그레이드 리허설 1단계 — "마이그레이션 4개 적용 전" 스키마(로컬)에 예전 앱이 저장하던 모양의 데이터를 만든다.
 * 모든 값은 가짜. 로컬 Supabase 전용 (운영에 쓰지 않음).
 * 사용: README.md 참고
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const URL = 'http://127.0.0.1:54321';
const { SERVICE_ROLE_KEY: SRK, ANON_KEY: ANON } = process.env;
if (!SRK || !ANON) throw new Error('SERVICE_ROLE_KEY / ANON_KEY 환경변수 필요');
const admin = createClient(URL, SRK, { auth: { persistSession: false } });

async function user(prefix) {
  const email = `${prefix}-${Date.now()}@rehearsal.test`;
  const password = 'rehearsal-password-1';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await client.auth.signInWithPassword({ email, password });
  if (s.error) throw s.error;
  return { id: data.user.id, client };
}
const rpc = async (c, args) => {
  const r = await c.rpc('save_contract', args);
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const pay = (o) => ({ kind: 'other', direction: 'expense', frequency: 'one_time', starts_on: '2026-10-20', amount: 1, is_variable: false, business_day_rule: 'none', obligation: 'confirmed', ...o });

const a = await user('old-a');
const b = await user('old-b');

// C1 임대차 (계약서로 등록 · 예전 분석: 월세 출금, 보증금 몫 neutral) → 결제 id로 다시 저장 + 금액 변경 이력
const c1 = await rpc(a.client, {
  p_contract: { title: '주택 임대차 (예전 앱)', category: 'real_estate', contract_type: 'lease', contract_kind: 'lease', source: 'upload', start_date: '2026-10-20', end_date: '2028-10-19', deposit_amount: 20_000_000, parties: [{ role: 'lessor', name: '김가상' }, { role: 'lessee', name: '이가상' }] },
  p_payments: [
    pay({ kind: 'down_payment', label: '계약금', amount: 2_000_000, direction: 'neutral', starts_on: '2026-10-08' }),
    pay({ kind: 'balance_payment', label: '잔금', amount: 18_000_000, direction: 'neutral' }),
    pay({ kind: 'rent', label: '월세', amount: 850_000, frequency: 'monthly', day_of_month: 20 }),
  ],
});
const p1 = (await a.client.from('contract_payments').select('id, label').eq('contract_id', c1).order('sort_order')).data;
const rentId = p1.find((p) => p.label === '월세').id;
await rpc(a.client, {
  p_contract_id: c1,
  p_contract: { title: '주택 임대차 (예전 앱)', category: 'real_estate', contract_type: 'lease', contract_kind: 'lease', start_date: '2026-10-20', end_date: '2028-10-19', deposit_amount: 20_000_000 },
  p_payments: [
    pay({ id: p1[0].id, kind: 'down_payment', label: '계약금', amount: 2_000_000, direction: 'neutral', starts_on: '2026-10-08' }),
    pay({ id: p1[1].id, kind: 'balance_payment', label: '잔금', amount: 18_000_000, direction: 'neutral' }),
    pay({ id: rentId, kind: 'rent', label: '월세', amount: 850_000, frequency: 'monthly', day_of_month: 20 }),
  ],
  p_amount_changes: [{ op: 'add', payment_id: rentId, effective_from: '2027-10-20', amount: 900_000, change_reason: '갱신 인상' }],
});

// C2 정수기 렌탈 (계약서로 등록 · 예전 분석이 정한 출금) · C3 직접 입력 구독
const c2 = await rpc(a.client, { p_contract: { title: '정수기 렌탈 (예전 앱)', category: 'rental', contract_type: 'recurring', contract_kind: 'rental', source: 'upload', start_date: '2026-10-10', end_date: '2029-10-09' }, p_payments: [pay({ kind: 'recurring_fee', label: '월 렌탈료', amount: 29_900, frequency: 'monthly', day_of_month: 10, starts_on: '2026-10-10' })] });
const c3 = await rpc(a.client, { p_contract: { title: '음악 구독 (직접 입력)', category: 'subscription', contract_type: 'recurring', contract_kind: 'subscription_membership', start_date: '2026-10-05' }, p_payments: [pay({ kind: 'recurring_fee', label: '월 이용료', amount: 10_900, frequency: 'monthly', day_of_month: 5, starts_on: '2026-10-05' })] });
// 다른 사용자 계약 (권한 확인용)
const cb = await rpc(b.client, { p_contract: { title: '다른 사용자 계약', category: 'other', contract_type: 'other' }, p_payments: [pay({ label: '납부금', amount: 1000 })] });

// 알림 설정 (예전 앱)
await a.client.from('notification_preferences').upsert({ user_id: a.id, categories: { payment: { enabled: true, offsets: [3] } } });

const snap = async (ids) => ({
  contracts: (await admin.from('contracts').select('id, title, user_id, source, deposit_amount, parties, user_party_role').in('id', ids).order('title')).data,
  payments: (await admin.from('contract_payments').select('id, contract_id, label, amount, direction, frequency, day_of_month, starts_on').in('contract_id', ids).order('id')).data,
  changes: (await admin.from('contract_payment_changes').select('id, payment_id, effective_from, amount, change_reason').order('id')).data,
});
const out = { userA: a.id, userB: b.id, c1, c2, c3, cb, before: await snap([c1, c2, c3, cb]), prefs: (await admin.from('notification_preferences').select('categories').eq('user_id', a.id).single()).data };
fs.writeFileSync(process.argv[2] ?? 'rehearsal-seed.json', JSON.stringify(out, null, 2));
console.log('seeded', { contracts: out.before.contracts.length, payments: out.before.payments.length, changes: out.before.changes.length });
