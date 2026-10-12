/**
 * 지급자·수령자 평가 채점 — 실제 AI 결과(서버 정리 후)를 기대값과 비교한다. 계약서 원문은 다루지 않는다.
 * 위험 지표: (1) 근거가 없는데 지급자·수령자를 채움(추측) (2) 방향을 모르는 단계에서 서버가 방향을 정함
 */
import type { MoneyFlowCase } from './moneyFlowCases';

export interface ActualPayment {
  amount: number | null;
  label: string;
  payerRole?: string | null;
  payeeRole?: string | null;
  moneyNature?: string | null;
  direction: string;
}
export interface PaymentScore {
  caseId: string;
  label: string;
  amount: number;
  found: boolean;
  expected: { payer: string | null; payee: string | null; nature: string; direction: string };
  actual: { label: string; payer: string | null; payee: string | null; nature: string | null; direction: string } | null;
  payerOk: boolean;
  payeeOk: boolean;
  /** 계약서에 근거가 없는데 역할을 채움 */
  guessed: boolean;
  natureOk: boolean;
  directionOk: boolean;
  /** neutral이어야 하는데 방향을 정함 (가장 위험) */
  unsafeDirection: boolean;
}

export function scoreCase(c: MoneyFlowCase, actualKind: string, payments: readonly ActualPayment[]): PaymentScore[] {
  return c.payments.map((e) => {
    const a = payments.find((p) => p.amount === e.amount) ?? null;
    const payer = a?.payerRole ?? null;
    const payee = a?.payeeRole ?? null;
    return {
      caseId: c.id,
      label: e.label,
      amount: e.amount,
      found: !!a,
      expected: { payer: e.payer, payee: e.payee, nature: e.nature, direction: e.direction },
      actual: a ? { label: a.label, payer, payee, nature: a.moneyNature ?? null, direction: a.direction } : null,
      payerOk: !!a && payer === e.payer,
      payeeOk: !!a && payee === e.payee,
      guessed: !!a && ((e.payer === null && payer !== null) || (e.payee === null && payee !== null)),
      natureOk: !!a && (a.moneyNature ?? 'ordinary') === e.nature,
      directionOk: !!a && a.direction === e.direction,
      unsafeDirection: !!a && e.direction === 'neutral' && a.direction !== 'neutral',
    };
  });
}

export interface Summary {
  payments: number;
  found: number;
  explicitRoles: { ok: number; total: number };
  silentRoles: { blank: number; total: number };
  guessed: number;
  nature: { ok: number; total: number };
  direction: { ok: number; total: number };
  unsafeDirection: number;
}

export function summarize(rows: readonly PaymentScore[]): Summary {
  const found = rows.filter((r) => r.found);
  const explicit = found.filter((r) => r.expected.payer !== null || r.expected.payee !== null);
  const silent = found.filter((r) => r.expected.payer === null && r.expected.payee === null);
  return {
    payments: rows.length,
    found: found.length,
    explicitRoles: { ok: explicit.filter((r) => r.payerOk && r.payeeOk).length, total: explicit.length },
    silentRoles: { blank: silent.filter((r) => !r.guessed).length, total: silent.length },
    guessed: found.filter((r) => r.guessed).length,
    nature: { ok: found.filter((r) => r.natureOk).length, total: found.length },
    direction: { ok: found.filter((r) => r.directionOk).length, total: found.length },
    unsafeDirection: found.filter((r) => r.unsafeDirection).length,
  };
}
