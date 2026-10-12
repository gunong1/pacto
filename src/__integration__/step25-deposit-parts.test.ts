/*
 * 보증금의 계약금·잔금 = 보증금 자금 이동 — 저장된 계약 정리 (migration 20261023000002, 분석 규칙 R7과 같은 규칙). 모든 값은 가짜
 * - 의미 관계(필수): 결제 이름이나 연결된 분석 결과의 근거 문장이 "보증금"을 말할 때만 / 합계 일치는 보조 조건
 * - 방향만 neutral — 일정·금액·행은 그대로 · 반복 실행해도 결과 같음
 * - 회귀: 합만 맞는 일반 계약금(보증금 근거 없음)·합이 다른 경우는 그대로
 */
import { EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { monthSpending } from '@/domain/spending';

import { adminClient, newUser } from './helpers';

jest.setTimeout(120_000);

const once = (label: string, amount: number, startsOn: string): PaymentDraft => ({
  kind: label.includes('계약금') ? 'down_payment' : 'balance_payment', direction: 'expense', label, amount, frequency: 'one_time', dayOfMonth: null, monthOfYear: null, startsOn, endsOn: null,
  installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null,
});
const monthly = (label: string, amount: number): PaymentDraft => ({ ...once(label, amount, '2026-10-20'), kind: label === '월세' ? 'rent' : 'maintenance_fee', frequency: 'monthly', dayOfMonth: 20 });
const lease = (down: string, balance: number, balanceLabel = '잔금'): ContractDraft => ({
  ...EMPTY_DRAFT, title: '주택 월세 임대차', category: 'real_estate', contractType: 'lease', startDate: '2026-10-20', endDate: '2028-10-19', depositAmount: 20_000_000,
  payments: [once(down, 2_000_000, '2026-10-08'), once(balanceLabel, balance, '2026-10-20'), monthly('월세', 850_000), monthly('관리비', 100_000)],
});
/** 이전 버전 분석 결과 (근거 문장만 — 원문 아님) */
const job = async (userId: string, quote: string) => {
  const ev = [{ quote, page: 1, file: 1 }];
  const { data } = await adminClient().from('analysis_jobs').insert({
    user_id: userId, status: 'succeeded', provider: 'mock',
    result: { payments: [{ label: '계약금', amount: 2_000_000, evidence: ev }, { label: '잔금', amount: 18_000_000, evidence: ev }] },
  } as never).select('id').single();
  return (data as { id: string }).id;
};
const directions = async (repo: SupabaseContractRepository, id: string) => (await repo.get(id))!.payments.filter((p) => p.frequency === 'one_time').map((p) => p.direction);

test('보증금 근거가 있는 계약금·잔금만 neutral (월 지출은 월세·관리비만) · 근거 없음·합 불일치는 그대로 · 반복 실행해도 같음', async () => {
  const a = await newUser('deposit-parts');
  const repo = new SupabaseContractRepository(a.client, () => '2026-10-08');
  const make = async (draft: ContractDraft, quote?: string) =>
    (await repo.create({ draft, source: 'upload', documents: [], aiChecks: [], ...(quote ? { analysisJobId: await job(a.user.id, quote) } : {}) })).contract.id;
  const withEvidence = await make(lease('계약금', 18_000_000), '보증금 20,000,000원 중 계약금 2,000,000원은 계약 당일, 잔금 18,000,000원은 10월 20일 지불한다.');
  const byLabel = await make(lease('보증금 계약금', 18_000_000, '보증금 잔금'));
  // 한쪽 몫에만 보증금 근거 → 바꾸지 않음 (몫 모두에 근거가 있어야 한다)
  const halfLabel = await make(lease('보증금 계약금', 18_000_000));
  const plain = await make(lease('계약금', 18_000_000), '계약금 2,000,000원은 계약 시, 잔금 18,000,000원은 10월 20일 지급한다.');
  const noJob = await make(lease('계약금', 18_000_000));
  const mismatch = await make(lease('계약금', 17_000_000), '보증금 중 계약금 2,000,000원, 잔금 17,000,000원');
  expect(monthSpending([(await repo.get(withEvidence))!], { year: 2026, month: 10 }).total).toBe(20_950_000);

  const first = await adminClient().rpc('mark_deposit_installment_parts' as never);
  expect(first.error).toBeNull();

  const fixed = (await repo.get(withEvidence))!;
  expect(fixed.payments.map((p) => [p.label, p.direction, p.startsOn, p.amount])).toEqual([
    ['계약금', 'neutral', '2026-10-08', 2_000_000],
    ['잔금', 'neutral', '2026-10-20', 18_000_000],
    ['월세', 'expense', '2026-10-20', 850_000],
    ['관리비', 'expense', '2026-10-20', 100_000],
  ]);
  const oct = monthSpending([fixed], { year: 2026, month: 10 });
  expect([oct.total, oct.depositTotal, fixed.contract.depositAmount]).toEqual([950_000, 20_000_000, 20_000_000]);
  expect(await directions(repo, byLabel)).toEqual(['neutral', 'neutral']);
  // 회귀: 보증금 근거가 없는 일반 계약금(합은 같음) · 분석 결과 없는 직접 입력 · 합 불일치 → 그대로
  expect(await directions(repo, plain)).toEqual(['expense', 'expense']);
  expect(await directions(repo, noJob)).toEqual(['expense', 'expense']);
  expect(await directions(repo, halfLabel)).toEqual(['expense', 'expense']);
  expect(await directions(repo, mismatch)).toEqual(['expense', 'expense']);

  // 반복 실행: 바뀌는 행 없음, 결과 동일
  const second = await adminClient().rpc('mark_deposit_installment_parts' as never);
  expect([second.error, second.data]).toEqual([null, 0]);
  expect(await directions(repo, withEvidence)).toEqual(['neutral', 'neutral']);
  expect(await directions(repo, plain)).toEqual(['expense', 'expense']);
});
