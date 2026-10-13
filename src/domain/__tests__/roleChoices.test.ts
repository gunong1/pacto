/**
 * "이 계약에서 누구세요?" 선택지 공통 규칙 (roleChoices) — 모든 계약 종류 공통. 모든 값은 가짜
 * - 기본(primary): 돈을 내거나 받는 주요 당사자 · 그 밖의 당사자(중개업자·보증인·대리인 등)는 secondary
 * - 역할을 모르면(잘 모르겠어요) 역할로 정해지는 금액은 합계에 넣지 않음 · 다시 고르면 들어감
 */
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';

import { roleChoices, withConfirmedRole } from '../cashflow';
import { monthSpending } from '../spending';

const roles = (r: ReturnType<typeof roleChoices>) => ({ primary: r.primary.map((o) => o.role), secondary: r.secondary.map((o) => o.role) });

describe('roleChoices: 주요 당사자 / 다른 경우', () => {
  test('주택 임대차: 임대인·임차인이 기본, 중개업자는 다른 경우 (당사자 순서 유지)', () => {
    const r = roleChoices('lease', [{ role: 'lessor' }, { role: 'lessee' }, { role: 'broker' }]);
    expect(roles(r)).toEqual({ primary: ['lessor', 'lessee'], secondary: ['broker'] });
    expect(r.secondary[0]).toEqual({ key: 'p2', role: 'broker', partyIndex: 2 });
  });

  test('계약서에 이름이 없는 주요 역할은 기본 선택지에 (중개업자처럼 주요가 아닌 역할은 만들지 않음)', () => {
    const r = roleChoices('lease', [{ role: 'lessor' }]);
    expect(r.primary).toEqual([
      { key: 'p0', role: 'lessor', partyIndex: 0 },
      { key: 'lessee', role: 'lessee', partyIndex: null },
    ]);
    expect(r.secondary).toEqual([]);
  });

  test('다른 종류도 같은 규칙: 대출 보증인 · 보험 피보험자/수익자 · 렌탈 대리인은 다른 경우', () => {
    expect(roles(roleChoices('loan', [{ role: 'lender' }, { role: 'borrower' }, { role: 'guarantor' }]))).toEqual({ primary: ['lender', 'borrower'], secondary: ['guarantor'] });
    expect(roles(roleChoices('insurance', [{ role: 'insurer' }, { role: 'policyholder' }, { role: 'insured' }, { role: 'beneficiary' }]))).toEqual({ primary: ['insurer', 'policyholder'], secondary: ['insured', 'beneficiary'] });
    expect(roles(roleChoices('rental', [{ role: 'provider' }, { role: 'customer' }, { role: 'agent' }]))).toEqual({ primary: ['provider', 'customer'], secondary: ['agent'] });
  });

  test('계약서가 지급자로 밝힌 역할은 기본 선택지 (예: 보증인이 직접 내는 결제)', () => {
    expect(roles(roleChoices('loan', [{ role: 'lender' }, { role: 'borrower' }, { role: 'guarantor' }], [{ payerRole: 'guarantor', payeeRole: 'lender' }]))).toEqual({ primary: ['lender', 'borrower', 'guarantor'], secondary: [] });
  });

  test('돈 흐름이 정해지지 않은 종류(갑·을): 주요 역할과 역할을 모르는 당사자가 기본, 대표자는 다른 경우', () => {
    expect(roles(roleChoices('business', [{ role: 'party_a' }, { role: 'party_b' }, { role: 'party' }, { role: 'representative' }]))).toEqual({ primary: ['party_a', 'party_b', 'party'], secondary: ['representative'] });
  });
});

describe('역할 선택 → 잘 모르겠어요 → 다시 선택: 방향과 합계', () => {
  const TODAY = '2026-10-08';
  const pay = (o: Partial<PaymentDraft>): PaymentDraft => ({ kind: 'rent', direction: 'neutral', label: '월세', amount: 850_000, frequency: 'monthly', dayOfMonth: 20, monthOfYear: null, startsOn: '2026-10-20', endsOn: null, installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null, moneyNature: 'ordinary', ...o });
  const base: ContractDraft = {
    ...EMPTY_DRAFT,
    title: '주택 임대차',
    category: 'real_estate',
    contractType: 'lease',
    contractKind: 'lease',
    startDate: '2026-10-20',
    endDate: '2028-10-19',
    parties: [
      { role: 'lessor', name: '김민수' },
      { role: 'lessee', name: '박지훈' },
      { role: 'broker', name: '이현정' },
    ],
    payments: [
      pay({}),
      pay({ label: '계약금', kind: 'down_payment', amount: 2_000_000, frequency: 'one_time', dayOfMonth: null, startsOn: '2026-10-08', moneyNature: 'refundable_deposit' }),
      pay({ label: '전에 직접 고른 관리비', kind: 'maintenance_fee', amount: 100_000, direction: 'expense', directionBasis: 'user' }),
    ],
  };
  const oct = (d: ContractDraft) => monthSpending([draftToRecord(d, 'c1', TODAY)], { year: 2026, month: 10 }, TODAY);

  test('임차인 → 잘 모르겠어요 → 임차인: 모름이면 역할로 정한 금액은 합계 제외, 다시 고르면 같은 값 · 직접 고른 방향은 그대로', () => {
    const lessee = withConfirmedRole(base, 'lessee');
    expect(lessee.payments.map((p) => [p.direction, p.directionBasis])).toEqual([
      ['expense', 'role'],
      ['expense', 'role'],
      ['expense', 'user'],
    ]);
    expect([oct(lessee).ordinaryExpense, oct(lessee).depositOut]).toEqual([950_000, 2_000_000]);

    const unknown = withConfirmedRole(lessee, null, 'unknown');
    expect(unknown.userPartyRole).toBeNull();
    expect(unknown.payments.map((p) => p.direction)).toEqual(['neutral', 'neutral', 'expense']);
    expect([oct(unknown).ordinaryExpense, oct(unknown).depositOut]).toEqual([100_000, 0]);

    const again = withConfirmedRole(unknown, 'lessee');
    expect(again.payments.map((p) => [p.direction, p.directionBasis])).toEqual(lessee.payments.map((p) => [p.direction, p.directionBasis]));
    expect(oct(again)).toEqual(oct(lessee));
  });

  test('중개업자를 고른 기존 계약: 역할은 그대로, 방향을 정할 수 없는 금액은 합계 제외 (임의로 바꾸지 않음)', () => {
    const broker = withConfirmedRole(base, 'broker');
    expect(broker.userPartyRole).toBe('broker');
    expect(broker.payments.map((p) => p.direction)).toEqual(['neutral', 'neutral', 'expense']);
    expect(roleChoices('lease', broker.parties).secondary.map((o) => o.role)).toEqual(['broker']);
  });
});
