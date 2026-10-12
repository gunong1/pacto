/**
 * 지급자·수령자 평가 스크립트(scripts/eval-money-flow.ts)의 세트·채점 점검 — AI를 부르지 않는다 (실제 정확도 검증이 아님).
 * - 평가 세트의 기대값이 서버 규칙(F1 resolveMoneyFlow)과 맞는지
 * - AI가 방향을 단정해도(근거 부족) 서버가 사용자 역할 의존 종류는 neutral로 두는지
 * - 채점이 추측·위험한 방향을 잡아내는지
 */
import { MONEY_FLOW_CASES } from '../../../../scripts/eval/moneyFlowCases';
import { scoreCase, summarize, type ActualPayment } from '../../../../scripts/eval/moneyFlowScore';
import { resolveMoneyFlow } from '../../../../supabase/functions/_shared/analysisRules/moneyFlow.ts';
import type { ExtractedPayment } from '../../../../supabase/functions/_shared/analysisRules/types.ts';
import { CONTRACT_KIND_CODES, PARTY_ROLE_CODES } from '../../../../supabase/functions/_shared/contractRegistry.ts';

const extracted = (o: Partial<ExtractedPayment>) => ({ kind: 'other', label: '금액', amount: 1, direction: 'neutral', ...o }) as ExtractedPayment;

describe('평가 세트 자체 점검', () => {
  test('역할 코드·계약 종류가 레지스트리에 있고, 계약 안에서 금액이 겹치지 않음', () => {
    const kinds = new Set<string>(CONTRACT_KIND_CODES);
    for (const c of MONEY_FLOW_CASES) {
      expect(kinds.has(c.kind)).toBe(true);
      const amounts = c.payments.map((p) => p.amount);
      expect(new Set(amounts).size).toBe(amounts.length);
      for (const p of c.payments) for (const r of [p.payer, p.payee]) if (r) expect(PARTY_ROLE_CODES).toContain(r);
    }
  });

  test('기대 방향 = 서버 규칙 결과 (계약서가 밝힌 역할 그대로 넣었을 때)', () => {
    for (const c of MONEY_FLOW_CASES) {
      const ps = c.payments.map((e) => extracted({ amount: e.amount, label: e.label, moneyNature: e.nature, payerRole: e.payer, payeeRole: e.payee }));
      resolveMoneyFlow(ps, c.kind);
      expect([c.id, ps.map((p) => [p.moneyNature, p.direction])]).toEqual([c.id, c.payments.map((e) => [e.nature, e.direction])]);
    }
  });

  test('AI가 방향을 "출금"으로 단정하거나 역할을 추측해도, 사용자 역할 의존 종류는 neutral 유지', () => {
    for (const c of MONEY_FLOW_CASES.filter((x) => x.payments.every((p) => p.direction === 'neutral'))) {
      const ps = c.payments.map((e) => extracted({ amount: e.amount, direction: 'expense', payerRole: e.payer ?? 'lessee', payeeRole: e.payee ?? 'lessor' }));
      resolveMoneyFlow(ps, c.kind);
      expect([c.id, ps.every((p) => p.direction === 'neutral' && p.directionBasis === null)]).toEqual([c.id, true]);
    }
  });
});

describe('채점', () => {
  const lease = MONEY_FLOW_CASES.find((c) => c.id === 'lease_silent')!;
  const perfect: ActualPayment[] = lease.payments.map((e) => ({ amount: e.amount, label: e.label, payerRole: e.payer, payeeRole: e.payee, moneyNature: e.nature, direction: e.direction }));

  test('기대값과 같으면 모두 통과', () => {
    const s = summarize(scoreCase(lease, 'lease', perfect));
    expect(s).toMatchObject({ payments: 2, found: 2, guessed: 0, unsafeDirection: 0, silentRoles: { blank: 2, total: 2 }, direction: { ok: 2, total: 2 } });
  });

  test('근거 없는데 역할을 채우면 "추측", neutral이어야 하는데 방향을 정하면 "위험"으로 셈', () => {
    const bad = perfect.map((p, i) => (i === 0 ? { ...p, payerRole: 'lessee', direction: 'expense' } : p));
    const rows = scoreCase(lease, 'lease', bad);
    expect(rows[0]).toMatchObject({ guessed: true, unsafeDirection: true, directionOk: false });
    expect(summarize(rows)).toMatchObject({ guessed: 1, unsafeDirection: 1 });
  });

  test('금액을 못 찾으면 found=false (통과로 세지 않음)', () => {
    const rows = scoreCase(lease, 'lease', perfect.slice(1));
    expect(rows[0]).toMatchObject({ found: false, payerOk: false, directionOk: false });
  });
});
