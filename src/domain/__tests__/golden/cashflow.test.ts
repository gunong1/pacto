/**
 * 계약 당사자 식별 + 보증금 현금흐름 Golden — 모든 이름·금액은 가짜다.
 * 공통 규칙: src/domain/partyMatch.ts(이름 대조 — 추천만) · src/domain/cashflow.ts(방향·성격·묶음·반환) · spending.ts(합계)
 *
 * 기준 예: 2026년 10월 임차인 — 보증금 계약금 200만(10/8) + 잔금 1,800만(10/20) + 월세 85만 + 관리비 10만(매월 20일)
 *   10월 총 출금 2,095만 = 일반 지출 95만 + 보증금 지급 2,000만 / 11월 총 출금 95만
 */
import { draftToRecord, EMPTY_DRAFT, recordToDraft, withSummaryFund } from '@/data/draft';
import type { ContractDraft, FundDraft, PaymentDraft } from '@/data/repository';
import { draftToForm, formToDraft } from '@/features/contracts/form';
import { contractFormSchema } from '@/features/contracts/form';

import { applyDirectionChanges, FUND_STATUS_LABEL, fundCashEntries, fundViews, natureOf, needsRoleQuestion, recommendedSide, roleDirectionChanges, userSideOf } from '../../cashflow';
import { summarizeCashflows } from '../../calendarGroups';
import { matchUserParty, normalizePersonName } from '../../partyMatch';
import { scheduleForRange } from '../../schedule';
import { monthSpending } from '../../spending';
import type { ContractRecord, FundRefund } from '../../types';

const TODAY = '2026-10-08';
const OCT = { year: 2026, month: 10 };
const NOV = { year: 2026, month: 11 };

const P = (o: Partial<PaymentDraft>): PaymentDraft => ({
  kind: 'other',
  direction: 'neutral',
  label: '납부금',
  amount: 0,
  frequency: 'one_time',
  dayOfMonth: null,
  monthOfYear: null,
  startsOn: null,
  endsOn: null,
  installmentCount: null,
  isVariable: false,
  components: [],
  businessDayRule: 'none',
  obligation: 'confirmed',
  conditionNote: null,
  ...o,
});
const FUND = (o: Partial<FundDraft> = {}): FundDraft => ({ key: 'dep', kind: 'deposit', label: '보증금', totalAmount: null, returnDueOn: null, depositorRole: null, holderRole: null, ...o });

/** 분석 직후(역할 모름): 보증금 몫·월세 모두 방향 확인 필요(neutral) · 성격과 계약서의 흐름만 있음 */
const LEASE_PARTIES = [
  { role: 'lessor', name: '김민수' },
  { role: 'lessee', name: '박지훈' },
];
const leaseDraft = (o: Partial<ContractDraft> = {}): ContractDraft => ({
  ...EMPTY_DRAFT,
  title: '주택 월세 임대차',
  contractKind: 'lease',
  contractType: 'lease',
  category: 'real_estate',
  startDate: '2026-10-20',
  endDate: '2028-10-19',
  depositAmount: 20_000_000,
  parties: LEASE_PARTIES,
  funds: [FUND()],
  payments: [
    P({ kind: 'down_payment', label: '보증금 계약금', amount: 2_000_000, startsOn: '2026-10-08', moneyNature: 'refundable_deposit', fundKey: 'dep' }),
    P({ kind: 'balance_payment', label: '보증금 잔금', amount: 18_000_000, startsOn: '2026-10-20', moneyNature: 'refundable_deposit', fundKey: 'dep' }),
    P({ kind: 'rent', label: '월세', amount: 850_000, frequency: 'monthly', dayOfMonth: 20, moneyNature: 'ordinary' }),
    P({ kind: 'maintenance_fee', label: '관리비', amount: 100_000, frequency: 'monthly', dayOfMonth: 20, moneyNature: 'ordinary' }),
  ],
  ...o,
});
/** 사용자가 역할을 확정 → 미리보기 → 적용 */
function confirmRole(d: ContractDraft, role: string | null, relation: ContractDraft['userPartyRelation'] = 'self'): ContractDraft {
  const next = { ...d, userPartyRole: role, userPartyRelation: relation };
  return { ...next, payments: applyDirectionChanges(next.payments, roleDirectionChanges({ ...next }, next.payments)) };
}
const rec = (d: ContractDraft, refunds: FundRefund[] = []): ContractRecord => {
  const r = draftToRecord(d, 'c1', TODAY);
  r.funds = (r.funds ?? []).map((f) => ({ ...f, refunds: refunds.filter((x) => x.fundId === f.id) }));
  return r;
};
const refund = (amount: number, refundedOn: string, id = `r-${refundedOn}`): FundRefund => ({ id, fundId: 'dep', amount, refundedOn, note: null });
const split = (r: ContractRecord, ym = OCT) => {
  const m = monthSpending([r], ym, TODAY);
  return { total: m.total, ordinary: m.ordinaryExpense, depositOut: m.depositOut, income: m.incomeTotal, depositIn: m.depositIn, undetermined: m.undeterminedTotal };
};

describe('이름 대조 — 추천만 (1·2·3·4·5·7·19·20)', () => {
  test('1. 프로필 이름 = 임차인 → 임차인 추천 (확정 아님 — 계약의 역할은 그대로 null)', () => {
    const m = matchUserParty('lease', LEASE_PARTIES, ['박지훈']);
    expect(m).toEqual({ status: 'match', role: 'lessee', roleLabel: '임차인', partyIndex: 1, moneySide: true });
    expect(leaseDraft().userPartyRole).toBeNull();
  });
  test('2. 프로필 이름 = 임대인 → 임대인 추천', () => {
    expect(matchUserParty('lease', LEASE_PARTIES, ['김민수'])).toMatchObject({ status: 'match', role: 'lessor', roleLabel: '임대인' });
  });
  test('3. 이름 불일치 → 역할을 고르지 않음 · 비슷한 이름도 다른 사람 (박지운 ≠ 박지훈)', () => {
    expect(matchUserParty('lease', LEASE_PARTIES, ['이수진'])).toEqual({ status: 'none' });
    expect(matchUserParty('lease', LEASE_PARTIES, ['박지운'])).toEqual({ status: 'none' });
    expect(matchUserParty('lease', LEASE_PARTIES, ['박지'])).toEqual({ status: 'none' });
  });
  test('4·20. 같은 이름이 여러 당사자에 (동명이인·중복) → 자동으로 고르지 않음', () => {
    const same = [
      { role: 'lessor', name: '김민수' },
      { role: 'lessee', name: '김민수' },
    ];
    expect(matchUserParty('lease', same, ['김민수'])).toEqual({ status: 'ambiguous', roles: ['lessor', 'lessee'] });
    // 공동 임차인 둘이 같은 이름이어도 고르지 않음
    expect(matchUserParty('lease', [...LEASE_PARTIES, { role: 'lessee', name: '박 지훈' }], ['박지훈']).status).toBe('ambiguous');
  });
  test('5. 영문·다른 표기: 사용자가 등록한 표기만 (띄어쓰기·대소문자·"(인)"만 맞춤)', () => {
    const en = [
      { role: 'lessor', name: 'KIM MIN SU' },
      { role: 'lessee', name: 'Park Ji-hoon (인)' },
    ];
    expect(matchUserParty('lease', en, ['박지훈'])).toEqual({ status: 'none' });
    expect(matchUserParty('lease', en, ['박지훈', 'park jihoon'])).toMatchObject({ status: 'match', role: 'lessee' });
    expect(normalizePersonName('박 지 훈 (인)')).toBe('박지훈');
  });
  test('7. 보증인·대리인으로 등장 → 그 역할 추천, 돈을 내거나 받는 쪽이 아님(moneySide false)', () => {
    const withGuarantor = [...LEASE_PARTIES, { role: 'guarantor', name: '최영희' }];
    expect(matchUserParty('lease', withGuarantor, ['최영희'])).toEqual({ status: 'match', role: 'guarantor', roleLabel: '보증인', partyIndex: 2, moneySide: false });
    expect(matchUserParty('loan', [{ role: 'agent', name: '최영희' }], ['최영희'])).toMatchObject({ roleLabel: '대리인', moneySide: false });
  });
  test('19. 이름 미등록 → no_names (계약 등록·관리는 그대로 가능)', () => {
    expect(matchUserParty('lease', LEASE_PARTIES, [])).toEqual({ status: 'no_names' });
    expect(matchUserParty('lease', LEASE_PARTIES, ['  '])).toEqual({ status: 'no_names' });
  });
});

describe('역할 미확정 · 확정 · 변경 (8·9·13·16)', () => {
  test('8. 역할 미확정 임시 저장: 방향을 정할 수 없는 금액은 확인 필요 · 합계 제외 · 역할 질문 필요', () => {
    const d = leaseDraft();
    expect(needsRoleQuestion(d, d.payments, true)).toBe(true);
    expect(split(rec(d))).toEqual({ total: 0, ordinary: 0, depositOut: 0, income: 0, depositIn: 0, undetermined: 20_000_000 + 950_000 });
    // "잘 모르겠어요"를 고르면 다시 묻지 않음 (금액은 여전히 확인 필요)
    expect(needsRoleQuestion({ ...d, userPartyRelation: 'unknown' }, d.payments, true)).toBe(false);
  });
  test('9·10. 임차인 확정 → 보증금 몫은 출금(보증금), 월세·관리비는 출금(일반) · 10월 2,095만 = 95만 + 2,000만 · 11월 95만', () => {
    const d = confirmRole(leaseDraft(), 'lessee');
    expect(d.payments.map((p) => [p.label, p.direction, p.directionBasis])).toEqual([
      ['보증금 계약금', 'expense', 'role'],
      ['보증금 잔금', 'expense', 'role'],
      ['월세', 'expense', 'role'],
      ['관리비', 'expense', 'role'],
    ]);
    expect(split(rec(d))).toEqual({ total: 20_950_000, ordinary: 950_000, depositOut: 20_000_000, income: 0, depositIn: 0, undetermined: 0 });
    expect(split(rec(d), NOV)).toEqual({ total: 950_000, ordinary: 950_000, depositOut: 0, income: 0, depositIn: 0, undetermined: 0 });
    expect(needsRoleQuestion(d, d.payments, true)).toBe(false);
  });
  test('11. 임대인 확정 → 보증금 몫·월세는 입금 · 반환은 출금', () => {
    const d = confirmRole(leaseDraft(), 'lessor');
    expect(split(rec(d))).toEqual({ total: 0, ordinary: 0, depositOut: 0, income: 20_950_000, depositIn: 20_000_000, undetermined: 0 });
    const r = rec(d, [refund(20_000_000, '2028-10-19')]);
    const v = fundViews(r, '2028-10-20')[0];
    expect([v.userSide, v.refundDirection, v.status, v.remaining]).toEqual(['holder', 'expense', 'returned', 0]);
    // 그달: 보증금 반환 2,000만은 출금(보증금) · 마지막 월세는 9월 20일(종료일 10/19 이후 월세 없음)
    expect(split(r, { year: 2028, month: 10 })).toMatchObject({ total: 20_000_000, depositOut: 20_000_000, ordinary: 0, income: 0, depositIn: 0 });
  });
  test('16. 역할 변경 → 역할로 계산한 금액만 다시 계산 (사용자가 직접 고른 방향은 그대로) · 변경 예정 목록 먼저', () => {
    const tenant = confirmRole(leaseDraft(), 'lessee');
    // 사용자가 관리비를 직접 "입금"으로 바꿔 둔 경우
    tenant.payments[3] = { ...tenant.payments[3], direction: 'income', directionBasis: 'user' };
    const preview = roleDirectionChanges({ ...tenant, userPartyRole: 'lessor' }, tenant.payments);
    expect(preview.map((c) => [c.label, c.from, c.to])).toEqual([
      ['보증금 계약금', 'expense', 'income'],
      ['보증금 잔금', 'expense', 'income'],
      ['월세', 'expense', 'income'],
    ]);
    // 역할을 "모름"으로 되돌리면 역할로 계산한 금액은 다시 확인 필요
    expect(roleDirectionChanges({ ...tenant, userPartyRole: null }, tenant.payments).map((c) => c.to)).toEqual(['neutral', 'neutral', 'neutral']);
  });
  test('13. 프로필 이름을 바꿔도 확정한 역할은 그대로 (추천만 달라짐)', () => {
    const d = confirmRole(leaseDraft(), 'lessee');
    expect(matchUserParty('lease', d.parties, ['김민수'])).toMatchObject({ role: 'lessor' });
    expect(userSideOf(d)).toEqual({ role: 'lessee', basis: 'role' });
    expect(roleDirectionChanges(d, d.payments)).toEqual([]);
  });
  test('6. 다른 사람의 계약 관리 → 관리하는 분의 역할 기준으로 계산 (관계 on_behalf 저장)', () => {
    const d = confirmRole(leaseDraft(), 'lessee', 'on_behalf');
    expect(d.userPartyRelation).toBe('on_behalf');
    expect(split(rec(d))).toMatchObject({ total: 20_950_000, depositOut: 20_000_000 });
  });
  test('7. 사용자가 보증인으로 확정 → 금액은 확인 필요 (돈을 내거나 받는 쪽이 아님)', () => {
    const d = confirmRole(leaseDraft({ parties: [...LEASE_PARTIES, { role: 'guarantor', name: '최영희' }] }), 'guarantor');
    expect(d.payments.every((p) => p.direction === 'neutral')).toBe(true);
    expect(split(rec(d)).undetermined).toBe(20_950_000);
  });
  test('18. 계약상 역할과 실제 지급자가 다름: 계약서가 "보증금은 보증인이 지급"이라고 밝힘 → 임차인 사용자에게 보증금은 확인 필요, 보증인 사용자에게는 출금', () => {
    const base = leaseDraft();
    base.payments = base.payments.map((p) => (p.moneyNature === 'refundable_deposit' ? { ...p, payerRole: 'guarantor', payeeRole: 'lessor' } : p));
    const tenant = confirmRole(base, 'lessee');
    expect(tenant.payments.map((p) => p.direction)).toEqual(['neutral', 'neutral', 'expense', 'expense']);
    const guarantor = confirmRole(base, 'guarantor');
    expect(guarantor.payments.map((p) => p.direction)).toEqual(['expense', 'expense', 'neutral', 'neutral']);
  });
});

describe('보증금 묶음 · 반환 (10·12 · 반환일 있음/없음 · 갱신)', () => {
  const tenant = () => confirmRole(leaseDraft(), 'lessee');
  test('보증금 총액 2,000만 = 계약금 200만 + 잔금 1,800만 (총액을 따로 세지 않음)', () => {
    const v = fundViews(rec(tenant()), TODAY)[0];
    expect([v.total, v.members.map((p) => p.amount)]).toEqual([20_000_000, [2_000_000, 18_000_000]]);
    expect(rec(tenant()).payments.some((p) => p.amount === 20_000_000)).toBe(false);
  });
  test('반환일이 계약서에 없음 → 종료일에 "반환 확인" 일정만 (금액 합계에 넣지 않음) · 상태 반환 예정', () => {
    const r = rec(tenant());
    const v = fundViews(r, TODAY)[0];
    expect([v.checkDate, v.checkBasis, FUND_STATUS_LABEL[v.status]]).toEqual(['2028-10-19', 'contract_end', '반환 예정']);
    const items = scheduleForRange([r], { start: '2028-10-01', end: '2028-10-31' }, TODAY).filter((i) => i.title.includes('반환'));
    expect(items.map((i) => [i.title, i.type, i.amount, i.actionType])).toEqual([['보증금 반환 확인', 'key_date', null, 'deposit_return']]);
    expect(split(r, { year: 2028, month: 10 })).toMatchObject({ income: 0, depositIn: 0 });
    // 종료일이 지나도 기록이 없으면 "지연"으로 단정하지 않고 확인 필요
    const after = fundViews(r, '2028-11-01')[0];
    expect([after.status, after.needsCheck]).toEqual(['scheduled', true]);
  });
  test('반환일이 계약서에 있음 → 그날 확정 반환 예정 (입금 예정에 포함)', () => {
    const r = rec({ ...tenant(), funds: [FUND({ returnDueOn: '2028-10-25' })] });
    const v = fundViews(r, TODAY)[0];
    expect([v.checkDate, v.checkBasis]).toEqual(['2028-10-25', 'explicit']);
    expect(split(r, { year: 2028, month: 10 })).toMatchObject({ income: 20_000_000, depositIn: 20_000_000 });
  });
  test('10. 임차인 전액 반환 기록 → 입금(보증금 반환) · 반환 완료 · 원래 지급 결제는 그대로', () => {
    const d = { ...tenant(), funds: [FUND({ returnDueOn: '2028-10-25' })] };
    const r = rec(d, [refund(20_000_000, '2028-10-25')]);
    const v = fundViews(r, '2028-10-26')[0];
    expect([v.status, v.refunded, v.remaining, v.refundDirection]).toEqual(['returned', 20_000_000, 0, 'income']);
    // 반환 예정 일정은 사라지고 실제 반환 기록만 (같은 돈을 두 번 세지 않음)
    expect(split(r, { year: 2028, month: 10 })).toMatchObject({ income: 20_000_000, depositIn: 20_000_000 });
    expect(r.payments.slice(0, 2).map((p) => p.direction)).toEqual(['expense', 'expense']);
  });
  test('12. 일부 반환 + 지연: 500만만 돌려받음 → 일부 반환 · 남은 1,500만 · 계약서 반환일이 지나면 반환 지연', () => {
    const d = { ...tenant(), funds: [FUND({ returnDueOn: '2028-10-25' })] };
    const r = rec(d, [refund(5_000_000, '2028-10-25')]);
    const before = fundViews(r, '2028-10-25')[0];
    expect([before.status, before.remaining]).toEqual(['partial', 15_000_000]);
    const late = fundViews(r, '2028-11-10')[0];
    expect([FUND_STATUS_LABEL[late.status], late.remaining]).toEqual(['반환 지연', 15_000_000]);
    // 그달: 실제 반환 500만 + 남은 반환 예정 1,500만 (중복 없음)
    expect(fundCashEntries(r, { start: '2028-10-01', end: '2028-10-31' }, '2028-10-20').map((e) => [e.type, e.amount])).toEqual([
      ['refund', 5_000_000],
      ['due', 15_000_000],
    ]);
  });
  test('갱신하면 반환 확인 기준일도 함께 이동 (저장된 날짜를 바꾸지 않음)', () => {
    const d = { ...tenant(), autoRenewal: true, renewalPeriodMonths: 24 };
    expect(fundViews(rec(d), '2028-11-01')[0].checkDate).toBe('2030-10-19');
  });
  test('보증금 + 예치금: 한 계약에 묶음 여러 개 · 각각 반환 관리', () => {
    const d = {
      ...tenant(),
      funds: [FUND(), FUND({ key: 'esc', kind: 'escrow' as const, label: '관리 예치금', totalAmount: 300_000 })],
      payments: [...tenant().payments, P({ label: '관리 예치금', amount: 300_000, startsOn: '2026-10-20', moneyNature: 'refundable_deposit', fundKey: 'esc', direction: 'expense', directionBasis: 'role' })],
    };
    const views = fundViews(rec(d), TODAY);
    expect(views.map((v) => [v.label, v.total, v.members.length])).toEqual([
      ['보증금', 20_000_000, 2],
      ['관리 예치금', 300_000, 1],
    ]);
    expect(split(rec(d))).toMatchObject({ depositOut: 20_300_000, ordinary: 950_000 });
  });
});

describe('공통 구조 (계약 종류 공통 · 예전 데이터 · 화면 일치)', () => {
  test('매매 계약금은 보증금이 아님 → 일반 지출 (매수인)', () => {
    const d = confirmRole(
      {
        ...EMPTY_DRAFT,
        title: '아파트 매매',
        contractKind: 'sale',
        contractType: 'sale',
        payments: [P({ kind: 'down_payment', label: '계약금', amount: 50_000_000, startsOn: '2026-10-10', moneyNature: 'ordinary' })],
      },
      'buyer',
    );
    expect(split(rec(d))).toMatchObject({ total: 50_000_000, ordinary: 50_000_000, depositOut: 0 });
  });
  test('사용자가 보통 한쪽인 종류(렌탈·구독…)는 그쪽을 추천만 — 확인 전에는 묻고, 방향은 확인한 역할로', () => {
    const d: ContractDraft = { ...EMPTY_DRAFT, title: '정수기 렌탈', contractKind: 'rental', contractType: 'recurring', payments: [P({ kind: 'recurring_fee', amount: 29_900, frequency: 'monthly', dayOfMonth: 10, startsOn: '2026-10-10', moneyNature: 'ordinary' })] };
    expect(userSideOf(d)).toBeNull();
    expect(recommendedSide(d)).toEqual({ role: 'customer', reason: 'contract' });
    expect(needsRoleQuestion(d, d.payments)).toBe(true);
    expect(roleDirectionChanges(d, d.payments)).toEqual([]);
    expect(roleDirectionChanges({ ...d, userPartyRole: 'customer' }, d.payments).map((c) => [c.to, c.basis])).toEqual([['expense', 'role']]);
  });
  test('근로: 근로자 확정 → 급여 입금 / 고용주 확정 → 급여 출금', () => {
    const d: ContractDraft = { ...EMPTY_DRAFT, title: '근로계약', contractKind: 'employment', contractType: 'employment', payments: [P({ kind: 'salary', amount: 3_000_000, frequency: 'monthly', dayOfMonth: 25, startsOn: '2026-10-25', moneyNature: 'ordinary' })] };
    expect(confirmRole(d, 'employee').payments[0].direction).toBe('income');
    expect(confirmRole(d, 'employer').payments[0].direction).toBe('expense');
  });
  test('14. 예전 neutral 데이터: 바꾸지 않고 확인 필요(합계 제외) · 보증금 몫만 성격 해석 · 예전 출금은 역할을 확정해도 그대로', () => {
    const legacy: ContractDraft = {
      ...EMPTY_DRAFT,
      title: '예전 전세',
      contractKind: 'lease',
      contractType: 'lease',
      depositAmount: 20_000_000,
      payments: [
        P({ kind: 'down_payment', label: '계약금', amount: 2_000_000, startsOn: '2026-10-08' }),
        P({ kind: 'other', label: '기타 중립', amount: 10_000, startsOn: '2026-10-09' }),
        P({ kind: 'rent', label: '월세', amount: 850_000, frequency: 'monthly', dayOfMonth: 20, direction: 'expense' }),
      ],
    };
    delete legacy.funds;
    const r = rec(legacy);
    expect(r.payments.map((p) => natureOf(p))).toEqual(['deposit', null, 'ordinary']);
    expect(split(r)).toEqual({ total: 850_000, ordinary: 850_000, depositOut: 0, income: 0, depositIn: 0, undetermined: 2_010_000 });
    // 묶음이 없어도 계약 요약의 보증금으로 반환 관리 (묶음은 반환을 기록할 때 만든다)
    expect(fundViews(r, TODAY).map((v) => [v.key, v.total, v.members.length])).toEqual([['summary', 20_000_000, 1]]);
    // 역할 확정 미리보기: 보증금 몫(neutral)만 제안, 성격을 모르는 neutral·예전 출금은 그대로
    expect(roleDirectionChanges({ ...legacy, userPartyRole: 'lessee' }, legacy.payments).map((c) => [c.label, c.to])).toEqual([['계약금', 'expense']]);
    // 반환을 기록하기 전 묶음 만들기: 보증금 몫을 연결 (결제 행·금액·방향은 그대로)
    const w = withSummaryFund(recordToDraft(r));
    expect([w.funds!.map((f) => f.key), w.payments.map((p) => p.fundKey ?? null), w.payments.map((p) => p.direction)]).toEqual([['summary'], ['summary', null, null], ['neutral', 'neutral', 'expense']]);
  });
  test('15. 수정 화면을 거쳐도 돈의 성격·방향 근거·지급자·묶음이 유지 (폼 왕복)', () => {
    const d = confirmRole(leaseDraft(), 'lessee');
    const back = formToDraft(contractFormSchema.parse(draftToForm(d)), TODAY);
    expect(back.payments.map((p) => [p.moneyNature ?? null, p.directionBasis ?? null, p.fundKey ?? null])).toEqual(d.payments.map((p) => [p.moneyNature ?? null, p.directionBasis ?? null, p.fundKey ?? null]));
    expect([back.userPartyRole, back.userPartyRelation, back.funds?.map((f) => f.key)]).toEqual(['lessee', 'self', ['dep']]);
  });
  test('17. 홈·캘린더·상세 합계 일치: 같은 일정 목록에서 계산', () => {
    const r = rec(confirmRole(leaseDraft(), 'lessee'));
    const m = monthSpending([r], OCT, TODAY);
    const days = scheduleForRange([r], { start: '2026-10-01', end: '2026-10-31' }, TODAY);
    const cal = summarizeCashflows(days).find((c) => c.direction === 'expense')!;
    expect(cal.total).toBe(m.total);
    expect(summarizeCashflows(days.filter((i) => i.date === '2026-10-08')).map((c) => c.headline)).toEqual(['2,000,000원 보증금 지급 예정']);
    expect(summarizeCashflows(days.filter((i) => i.date === '2026-10-20')).map((c) => c.headline)).toEqual(['18,950,000원 결제 예정']);
    // 역할을 모르면 같은 날 금액은 "방향 확인 필요 (합계 제외)"
    const unknown = scheduleForRange([rec(leaseDraft())], { start: '2026-10-08', end: '2026-10-08' }, TODAY);
    expect(summarizeCashflows(unknown).map((c) => c.headline)).toEqual(['2,000,000원 · 방향 확인 필요 (합계 제외)']);
  });
});
