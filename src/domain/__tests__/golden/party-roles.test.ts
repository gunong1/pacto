/**
 * 계약 당사자 자동 연결 → 사용자 역할 → 지급 방향 → 홈·캘린더 합계 Golden — 모든 이름·금액은 가짜다.
 * 기준 예: 자동차 장기렌트 (계약서는 "임대인·임차인"이라고 씀 — 렌탈 종류의 역할은 렌탈회사·고객)
 *   보증금 5,000,000(10/20) · 월 렌트료 649,000(매월 20일, 임차인이 자동이체) · 초기 등록대행비 120,000(10/20) · 탁송비 70,000(선택)
 *   고객 기준 10월 총 출금 5,769,000 = 일반 769,000 + 보증금 5,000,000 / 11월 649,000
 * 공통 규칙: contractRegistry ROLE_EQUIVALENTS · normalizePartyRoles (서버·앱이 같은 함수)
 */
import { draftToRecord, recordToDraft } from '@/data/draft';
import { contractFormSchema, draftToForm, formToDraft } from '@/features/contracts/form';
import { toReviewModel } from '@/features/registration/extraction';

import { toAppResult } from '../../../../supabase/functions/_shared/extraction.ts';
import { normalizePartyRoles, samePartyName, splitRepresentative } from '../../../../supabase/functions/_shared/contractRegistry.ts';
import { directionStatusOf, needsRoleQuestion, normalizeRecord, recommendedSide, roleDirectionChanges, userSideOf, withConfirmedRole } from '../../cashflow';
import { partyRows, partySummary } from '../../parties';
import { matchUserParty } from '../../partyMatch';
import { scheduleForRange } from '../../schedule';
import { monthSpending } from '../../spending';
import type { ContractRecord } from '../../types';
import { contract, pay } from './classificationFixtures';

const TODAY = '2026-10-09';
const OCT = { year: 2026, month: 10 };
const NOV = { year: 2026, month: 11 };
const q = (quote: string) => ({ evidence_quote: quote, evidence_page: 1, evidence_file: 1 });
const once = (p: Record<string, unknown>) => pay({ frequency: 'one_time', role: 'one_time_cashflow', day_of_month: null, ...p });
const RENT_Q = '임차인은 매월 20일 월 렌트료 649,000원을 지정 계좌에서 자동이체한다.';

const rentalOut = (o: { parties?: unknown[]; payments?: Record<string, unknown>[] } = {}) => ({
  ...contract({
    cls: { kind: 'rental', subtype: 'vehicle', domains: ['vehicle'] },
    title: '자동차 장기렌트 계약서',
    dates: [
      { date: '2026-10-09', meaning: 'contract_signed', label: '계약 체결일', confidence: 'high', source_type: 'explicit', ...q('계약 체결일 2026년 10월 9일') },
      { date: '2026-10-20', meaning: 'contract_start', label: '계약 시작일', confidence: 'high', source_type: 'explicit', ...q('계약 시작일 2026년 10월 20일') },
      { date: '2030-10-19', meaning: 'contract_end', label: '계약 종료일', confidence: 'high', source_type: 'explicit', ...q('계약 종료일 2030년 10월 19일') },
    ],
    fields: { depositAmount: { value: 5000000, confidence: 'high', ...q('보증금 5,000,000원 2026년 10월 20일 1회 지급') } },
    payments: o.payments ?? [
      once({ kind: 'deposit', role: 'deposit', direction: 'neutral', label: '보증금', amount: 5000000, date: '2026-10-20', payer_role: 'lessee', payee_role: 'lessor', ...q('보증금 5,000,000원 2026년 10월 20일 1회 지급 / 계약 종료 후 정산 반환') }),
      pay({ kind: 'rent', label: '월 렌트료', amount: 649000, day_of_month: 20, payer_role: 'lessee', payee_role: 'lessor', ...q(RENT_Q) }),
      once({ kind: 'setup_fee', label: '초기 등록대행비', amount: 120000, date: '2026-10-20', payer_role: 'unknown', payee_role: 'unknown', ...q('초기 등록대행비 120,000원 2026년 10월 20일 1회 지급') }),
      once({ kind: 'other', label: '탁송비', amount: 70000, date: null, payment_obligation: 'optional', condition: '차량 탁송을 이용하는 경우', ...q('탁송비 70,000원 차량 직접 수령 시 발생하지 않는 선택 비용') }),
    ],
  }),
  parties: o.parties ?? [
    { role: 'lessor', name: '주식회사 팩토렌터카', confidence: 'high', ...q('임대인 주식회사 팩토렌터카') },
    { role: 'lessee', name: '김도윤', confidence: 'high', ...q('임차인 김도윤') },
  ],
});
const review = (out: unknown) => toReviewModel(toAppResult(out, 'openai'), ['doc-1']);
const rec = (d: Parameters<typeof draftToRecord>[0]): ContractRecord => draftToRecord(d, 'c-rent', TODAY);
const totals = (r: ContractRecord, ym = OCT) => {
  const m = monthSpending([r], ym, TODAY);
  return { total: m.total, ordinary: m.ordinaryExpense, deposit: m.depositOut, income: m.incomeTotal, undetermined: m.undeterminedTotal };
};

describe('1·2·12 당사자 자동 연결 (계약서 용어 ≠ 계약 종류의 역할 이름)', () => {
  test('장기렌트: 임대인 → 렌탈회사, 임차인 → 고객 (확인 필요 없음, 계약서 용어는 함께 표시)', () => {
    const m = review(rentalOut());
    expect(m.draft.parties).toEqual([
      { role: 'provider', name: '주식회사 팩토렌터카', term: '임대인' },
      { role: 'customer', name: '김도윤', term: '임차인' },
    ]);
    expect([...m.flagged].filter((p) => p.startsWith('parties.'))).toEqual([]);
    const rows = partyRows({ ...m.draft, contractKind: 'rental', userPartyRole: null });
    expect(rows.map((r) => [r.label, r.names.join(','), r.missing])).toEqual([
      ['렌탈회사(임대인)', '주식회사 팩토렌터카', false],
      ['고객(임차인)', '김도윤', false],
    ]);
  });

  test('12. 저장 → 다시 읽기 → 수정 폼 → 저장: 당사자는 한 목록(역할 하나에 한 번), 용어 유지', () => {
    const r = rec(review(rentalOut()).draft);
    const again = formToDraft(contractFormSchema.parse(draftToForm(recordToDraft(r))));
    expect(again.parties).toEqual(r.contract.parties);
    expect(partySummary({ ...r.contract, details: r.contract.details })).toBe('렌탈회사(임대인) 주식회사 팩토렌터카 · 고객(임차인) 김도윤');
  });
});

describe('3 법인과 대표자', () => {
  test('"주식회사 팩토렌터카 / 대표 박지훈" → 렌탈회사는 법인, 대표자는 따로 (돈을 내거나 받는 쪽 아님)', () => {
    expect(splitRepresentative('주식회사 팩토렌터카 / 대표 박지훈')).toEqual({ name: '주식회사 팩토렌터카', representative: '박지훈' });
    expect(splitRepresentative('(주)가상물산 대표이사 홍가상')).toEqual({ name: '(주)가상물산', representative: '홍가상' });
    expect(splitRepresentative('김도윤')).toEqual({ name: '김도윤', representative: null });
    // 개인 이름 뒤 "대표"는 법인이 아니므로 나누지 않음
    expect(splitRepresentative('가상상회 대표 김가상').representative).toBe('김가상');
    expect(splitRepresentative('김대표')).toEqual({ name: '김대표', representative: null });
    const m = review(rentalOut({ parties: [
      { role: 'lessor', name: '주식회사 팩토렌터카 / 대표 박지훈', confidence: 'high', ...q('임대인 주식회사 팩토렌터카 / 대표 박지훈') },
      { role: 'lessee', name: '김도윤', confidence: 'high', ...q('임차인 김도윤') },
    ] }));
    expect(m.draft.parties).toEqual([
      { role: 'provider', name: '주식회사 팩토렌터카', term: '임대인' },
      { role: 'customer', name: '김도윤', term: '임차인' },
      { role: 'representative', name: '박지훈' },
    ]);
    // 등록한 이름이 대표자와 같으면 "대표자"로만 — 렌탈회사로 추천하지 않음
    expect(matchUserParty('rental', m.draft.parties, ['박지훈'])).toMatchObject({ status: 'match', role: 'representative', moneySide: false });
  });

  test('모델이 대표자를 같은 역할의 당사자로 따로 넣어도 대표자로 정리', () => {
    const m = review(rentalOut({ parties: [
      { role: 'lessor', name: '주식회사 팩토렌터카', representative: '박지훈', confidence: 'high', ...q('임대인 주식회사 팩토렌터카 / 대표 박지훈') },
      { role: 'lessor', name: '박지훈', confidence: 'high', ...q('대표 박지훈') },
      { role: 'lessee', name: '김도윤', confidence: 'high', ...q('임차인 김도윤') },
    ] }));
    expect(m.draft.parties.map((p) => [p.role, p.name])).toEqual([
      ['provider', '주식회사 팩토렌터카'],
      ['customer', '김도윤'],
      ['representative', '박지훈'],
    ]);
  });
});

describe('4·5·6 다른 계약 종류도 같은 규칙', () => {
  const norm = (kind: string, parties: { role: string; name: string; term?: string | null }[]) => normalizePartyRoles(kind, parties).parties.map((p) => [p.role, p.name, p.term ?? null]);
  test('근로: 사용자·근로자 그대로 / 보험: 보험회사·계약자 그대로 / 용역: 발주자·수급인 그대로', () => {
    expect(norm('employment', [{ role: 'employer', name: '가나다상사' }, { role: 'employee', name: '홍가상' }])).toEqual([['employer', '가나다상사', null], ['employee', '홍가상', null]]);
    expect(norm('insurance', [{ role: 'insurer', name: '가상생명' }, { role: 'policyholder', name: '이가상' }])).toEqual([['insurer', '가상생명', null], ['policyholder', '이가상', null]]);
    expect(norm('service', [{ role: 'client', name: '가상물산' }, { role: 'contractor', name: '가상디자인' }])).toEqual([['client', '가상물산', null], ['contractor', '가상디자인', null]]);
  });
  test('근로계약서가 "갑·을"로 쓴 경우는 단어만으로 바꾸지 않음 (누가 사용자인지 계약마다 다름)', () => {
    expect(norm('employment', [{ role: 'party_a', name: '가나다상사' }, { role: 'party_b', name: '홍가상' }])).toEqual([['party_a', '가나다상사', null], ['party_b', '홍가상', null]]);
  });
  test('통신·교육·구독: "고객"으로 쓴 계약서 → 가입자·수강생·이용자', () => {
    expect(norm('telecom', [{ role: 'customer', name: '이가상' }])).toEqual([['subscriber', '이가상', '고객']]);
    expect(norm('education', [{ role: 'customer', name: '이가상' }])).toEqual([['learner', '이가상', '고객']]);
    expect(norm('subscription_membership', [{ role: 'customer', name: '이가상' }])).toEqual([['member', '이가상', '고객']]);
  });
});

describe('7·8·9 애매하거나 충돌하면 바꾸지 않고 확인 필요', () => {
  test('7. 역할이 없는 당사자(party)는 그대로', () => {
    expect(normalizePartyRoles('rental', [{ role: 'party', name: '가상' }]).parties).toEqual([{ role: 'party', name: '가상' }]);
  });
  test('8. 같은 자리에 다른 이름(렌탈회사 A + 임대인 B) → 임대인을 렌탈회사로 바꾸지 않고 둘 다 확인 필요', () => {
    const n = normalizePartyRoles('rental', [{ role: 'provider', name: '가상렌탈' }, { role: 'lessor', name: '주식회사 팩토렌터카' }, { role: 'lessee', name: '김도윤' }]);
    expect(n.parties.map((p) => [p.role, p.name])).toEqual([['provider', '가상렌탈'], ['lessor', '주식회사 팩토렌터카'], ['customer', '김도윤']]);
    expect(n.conflicts).toEqual(['lessor']);
    const m = review(rentalOut({ parties: [
      { role: 'provider', name: '가상렌탈', confidence: 'high', ...q('렌탈회사 가상렌탈') },
      { role: 'lessor', name: '주식회사 팩토렌터카', confidence: 'high', ...q('임대인 주식회사 팩토렌터카') },
      { role: 'lessee', name: '김도윤', confidence: 'high', ...q('임차인 김도윤') },
    ] }));
    expect(m.flagged.has('parties.provider') && m.flagged.has('parties.lessor')).toBe(true);
    expect(m.flagged.has('parties.customer')).toBe(false);
  });
  test('9. 같은 사람을 두 이름으로 (렌탈회사 = 임대인, 표기만 다름 "(주)" ↔ "주식회사") → 하나로', () => {
    const n = normalizePartyRoles('rental', [{ role: 'provider', name: '(주)팩토렌터카' }, { role: 'lessor', name: '주식회사 팩토렌터카' }]);
    expect(n.parties).toEqual([{ role: 'provider', name: '(주)팩토렌터카' }]);
    expect(n.conflicts).toEqual([]);
  });
  test('9. 비슷하지만 다른 이름(팩토렌트카 ≠ 팩토렌터카)은 같은 사람으로 보지 않음', () => {
    expect(normalizePartyRoles('rental', [{ role: 'provider', name: '팩토렌트카' }, { role: 'lessor', name: '주식회사 팩토렌터카' }]).conflicts).toEqual(['lessor']);
  });
});

describe('지급 방향 · 합계 (두 번째 지시서) — 추천 역할 ≠ 확인한 역할', () => {
  test('분석 직후: 계약서 지급자(임차인)를 보존하고 같은 자리(고객)로 연결 · 방향은 정하지 않음 (사용자가 고객인지 아직 모름)', () => {
    const r = toAppResult(rentalOut(), 'openai');
    expect(r.payments.map((p) => [p.label, p.payerRole ?? null, p.payeeRole ?? null, p.direction, p.directionBasis ?? null, p.obligation])).toEqual([
      ['보증금', 'customer', 'provider', 'neutral', null, 'confirmed'],
      ['월 렌트료', 'customer', 'provider', 'neutral', null, 'confirmed'],
      ['초기 등록대행비', null, null, 'neutral', null, 'confirmed'],
      ['탁송비', null, null, 'neutral', null, 'optional'],
    ]);
  });

  test('확인 전: 추천은 고객(이 종류의 계약은 보통 이쪽)이지만 확정 출금으로 세지 않음 — 방향 확인 필요 5,769,000 · 역할 질문', () => {
    const d = review(rentalOut()).draft;
    expect(userSideOf(d)).toBeNull();
    expect(recommendedSide(d)).toEqual({ role: 'customer', reason: 'contract' });
    expect(needsRoleQuestion(d, d.payments, true)).toBe(true);
    expect(totals(rec(d))).toEqual({ total: 0, ordinary: 0, deposit: 0, income: 0, undetermined: 5769000 });
  });

  test('고객(임차인)을 확인하면 10월 총 출금 5,769,000 = 일반 769,000 + 보증금 5,000,000 · 11월 649,000 · 탁송비(선택) 제외', () => {
    const r = rec(withConfirmedRole(review(rentalOut()).draft, 'customer'));
    expect(totals(r)).toEqual({ total: 5769000, ordinary: 769000, deposit: 5000000, income: 0, undetermined: 0 });
    expect(totals(r, NOV)).toEqual({ total: 649000, ordinary: 649000, deposit: 0, income: 0, undetermined: 0 });
    const oct = scheduleForRange([r], { start: '2026-10-01', end: '2026-10-31' }, TODAY).filter((i) => i.type === 'payment');
    expect(oct.some((i) => i.title.includes('탁송비'))).toBe(false);
    expect(r.payments.filter((p) => p.obligation === 'confirmed').every((p) => p.directionBasis === 'role')).toBe(true);
  });

  test('렌탈회사(임대인)를 확인하면 미리보기 후 입금 · 같은 금액', () => {
    const d = review(rentalOut()).draft;
    const preview = roleDirectionChanges({ ...d, userPartyRole: 'provider' }, d.payments);
    expect(preview.map((c) => [c.label, c.from, c.to])).toEqual([
      ['보증금', 'neutral', 'income'],
      ['월 렌트료', 'neutral', 'income'],
      ['초기 등록대행비', 'neutral', 'income'],
      ['탁송비', 'neutral', 'income'],
    ]);
    expect(totals(rec(withConfirmedRole(d, 'provider')))).toEqual({ total: 0, ordinary: 0, deposit: 0, income: 5769000, undetermined: 0 });
  });

  test('추천 근거: 등록 이름이 고객과 같으면 "이름 일치" · 대표자와 같으면 추천하지 않음 · 확인 후에는 다시 묻지 않음', () => {
    const d = { ...review(rentalOut()).draft, parties: [...review(rentalOut()).draft.parties, { role: 'representative', name: '박지훈' }] };
    expect(recommendedSide(d, ['김도윤'])).toEqual({ role: 'customer', reason: 'name' });
    expect(recommendedSide(d, ['박지훈'])).toBeNull();
    const confirmed = withConfirmedRole(d, 'customer');
    expect(needsRoleQuestion(confirmed, confirmed.payments, true)).toBe(false);
    expect(recommendedSide(confirmed, ['김도윤'])).toBeNull();
  });
});

describe('10·11·13 기존 데이터 · 수동 수정 · 재계산', () => {
  /** 이번 수정 전에 저장된 계약과 같은 모양: 당사자는 임대인·임차인, 결제는 지급자 임차인 · 방향 neutral */
  const legacy = (): ContractRecord => {
    const d = review(rentalOut()).draft;
    const r = rec(d);
    r.contract = { ...r.contract, parties: [{ role: 'lessor', name: '주식회사 팩토렌터카' }, { role: 'lessee', name: '김도윤' }] };
    r.payments = r.payments.map((p) => ({ ...p, direction: 'neutral', directionBasis: null, payerRole: p.payerRole ? 'lessee' : null, payeeRole: p.payeeRole ? 'lessor' : null }));
    return r;
  };

  test('10·13. 예전 저장 데이터: 당사자는 같은 자리로 정리 · 역할 확인 전에는 합계 제외 (결제 id 그대로)', () => {
    const before = legacy();
    const r = normalizeRecord(before);
    expect(r.payments.map((p) => p.id)).toEqual(before.payments.map((p) => p.id));
    expect(r.contract.parties).toEqual([{ role: 'provider', name: '주식회사 팩토렌터카', term: '임대인' }, { role: 'customer', name: '김도윤', term: '임차인' }]);
    expect(totals(r)).toEqual({ total: 0, ordinary: 0, deposit: 0, income: 0, undetermined: 5769000 });
  });

  test('10·13. 예전에 사용자가 확정한 역할(임차인)은 유지 → 같은 자리(고객)로 읽고 방향 채움 · 합계 5,769,000', () => {
    const before = legacy();
    before.contract = { ...before.contract, userPartyRole: 'lessee', userPartyRelation: 'self' };
    const r = normalizeRecord(before);
    expect(r.contract.userPartyRole).toBe('customer');
    expect(totals(r)).toEqual({ total: 5769000, ordinary: 769000, deposit: 5000000, income: 0, undetermined: 0 });
  });

  test('과거 AI 자동 판단(계약 구조로 출금): 일괄로 확인 필요로 바꾸지 않음 — 계약서 지급자와 맞으면 유지 · "자동 판단"으로 따로 표시', () => {
    const before = legacy();
    before.payments = before.payments.map((p) => ({ ...p, direction: 'expense', directionBasis: 'contract' }));
    const r = normalizeRecord(before);
    expect(r.payments.map((p) => [p.direction, p.directionBasis ?? null, p.reviewReason ?? null])).toEqual(before.payments.map(() => ['expense', 'contract', null]));
    const t = monthSpending([r], OCT, TODAY);
    expect([t.total, t.autoExpense, t.undeterminedTotal]).toEqual([5769000, 5769000, 0]);
  });

  test('과거 자동 판단이 계약서 지급자·수령자와 반대(임차인이 내는데 입금으로 저장) → 그 결제만 확인 필요 + 이유', () => {
    const before = legacy();
    before.payments = before.payments.map((p, i) => ({ ...p, direction: i === 1 ? 'income' : 'expense', directionBasis: 'contract' }));
    const r = normalizeRecord(before);
    expect(r.payments.map((p) => [p.label, p.direction, p.reviewReason ?? null])).toEqual([
      ['보증금', 'expense', null],
      ['월 렌트료', 'neutral', 'document_conflict'],
      ['초기 등록대행비', 'expense', null],
      ['탁송비', 'expense', null],
    ]);
  });

  test('네 가지 상태 구분: 확인한 역할 · 사용자 선택 · 과거 자동 판단(계약서로 등록, 근거 없음 포함) · 직접 입력 예전 값 · 확인 필요', () => {
    const c = rec(review(rentalOut()).draft).contract;
    const upload = { ...c, source: 'upload' as const, userPartyRole: null };
    const manual = { ...c, source: 'manual' as const, userPartyRole: null };
    expect(directionStatusOf({ direction: 'expense', directionBasis: 'role' }, { ...upload, userPartyRole: 'customer' })).toBe('role');
    expect(directionStatusOf({ direction: 'income', directionBasis: 'user' }, upload)).toBe('user');
    expect(directionStatusOf({ direction: 'expense', directionBasis: 'contract' }, upload)).toBe('auto');
    expect(directionStatusOf({ direction: 'expense', directionBasis: null }, upload)).toBe('auto');
    expect(directionStatusOf({ direction: 'expense', directionBasis: null }, manual)).toBe('legacy');
    expect(directionStatusOf({ direction: 'neutral', directionBasis: null }, upload)).toBe('pending');
  });

  test('직접 입력한 예전 계약·사용자가 고른 방향은 재검증으로도 바꾸지 않음', () => {
    const before = legacy();
    before.contract = { ...before.contract, source: 'manual' };
    before.payments = before.payments.map((p) => ({ ...p, direction: 'income', directionBasis: null }));
    expect(normalizeRecord(before).payments.every((p) => p.direction === 'income')).toBe(true);
    const userPicked = legacy();
    userPicked.payments = userPicked.payments.map((p) => ({ ...p, direction: 'income', directionBasis: 'user' }));
    expect(normalizeRecord(userPicked).payments.every((p) => p.direction === 'income' && !p.reviewReason)).toBe(true);
  });

  test('임대차처럼 추천 쪽이 없는 과거 자동 판단은 재검증할 근거가 없어 유지(자동 판단 표시)', () => {
    const before = legacy();
    before.contract = { ...before.contract, contractKind: 'lease', source: 'upload', parties: [{ role: 'lessor', name: '김민수' }, { role: 'lessee', name: '박지훈' }] };
    before.payments = before.payments.map((p) => ({ ...p, direction: 'expense', directionBasis: null, payerRole: null, payeeRole: null }));
    const r = normalizeRecord(before);
    expect(r.payments.every((p) => p.direction === 'expense')).toBe(true);
    expect(monthSpending([r], OCT, TODAY).autoExpense).toBe(5769000);
  });

  test('13. 사용자가 직접 고른 방향(입금)과 예외 지급자는 덮어쓰지 않음', () => {
    const before = legacy();
    before.payments[1] = { ...before.payments[1], direction: 'income', directionBasis: 'user' };
    before.payments[2] = { ...before.payments[2], payerRole: 'guarantor' };
    const r = normalizeRecord(before);
    expect(r.payments[1]).toMatchObject({ direction: 'income', directionBasis: 'user' });
    expect(r.payments[2]).toMatchObject({ payerRole: 'guarantor', direction: 'neutral' });
  });

  test('역할(고객)을 확정했는데 예전 지급자 코드(임차인) 때문에 neutral로 남던 문제 → 해결', () => {
    const before = legacy();
    const d = recordToDraft(before);
    const confirmed = withConfirmedRole({ ...d, parties: before.contract.parties }, 'customer');
    expect(confirmed.payments.filter((p) => p.obligation === 'confirmed').map((p) => p.direction)).toEqual(['expense', 'expense', 'expense']);
  });

  test('11. 자동 연결 후 사용자가 이름을 고치면 고친 값 · 용어는 유지', () => {
    const r = rec(review(rentalOut()).draft);
    const form = draftToForm(recordToDraft(r));
    form.parties = { ...form.parties, provider: '팩토렌터카 본사' };
    const d = formToDraft(contractFormSchema.parse(form));
    expect(d.parties).toEqual([{ role: 'provider', name: '팩토렌터카 본사', term: '임대인' }, { role: 'customer', name: '김도윤', term: '임차인' }]);
  });

  test('임대차는 그대로: 역할 미확정이면 neutral + 역할 질문 (구조로 정하지 않음)', () => {
    const lease = { ...review(rentalOut()).draft, contractKind: 'lease', parties: [{ role: 'lessor', name: '김민수' }, { role: 'lessee', name: '박지훈' }] };
    const r = rec({ ...lease, payments: lease.payments.map((p) => ({ ...p, direction: 'neutral' as const, directionBasis: null, payerRole: 'lessee', payeeRole: 'lessor' })) });
    expect(totals(r).undetermined).toBeGreaterThan(0);
    expect(needsRoleQuestion(lease, r.payments, true)).toBe(true);
  });
});

describe('기존 계약의 직접 입력 이름 ↔ 계약서 이름 (덮어쓰지 않음)', () => {
  const base = () => draftToForm(recordToDraft(rec(review(rentalOut()).draft)));
  test('표기만 다르면 같은 당사자 — 칸에 입력된 이름을 그대로 두고 하나로 저장', () => {
    const form = { ...base(), parties: { provider: '(주)팩토렌터카', lessor: '주식회사 팩토렌터카', customer: '김도윤' } };
    expect(formToDraft(contractFormSchema.parse(form)).parties.map((p) => [p.role, p.name])).toEqual([['provider', '(주)팩토렌터카'], ['customer', '김도윤']]);
  });
  test('실제로 다른 이름이면 둘 다 그대로 저장 (화면에서 사용자가 고름) · 읽을 때도 바꾸지 않음', () => {
    const form = { ...base(), parties: { provider: '팩토렌트카', lessor: '주식회사 팩토렌터카', customer: '김도윤' } };
    const d = formToDraft(contractFormSchema.parse(form));
    expect(d.parties.map((p) => [p.role, p.name])).toEqual([['provider', '팩토렌트카'], ['lessor', '주식회사 팩토렌터카'], ['customer', '김도윤']]);
    expect(rec(d).contract.parties.map((p) => [p.role, p.name])).toEqual([['provider', '팩토렌트카'], ['lessor', '주식회사 팩토렌터카'], ['customer', '김도윤']]);
    expect(normalizePartyRoles('rental', d.parties).conflicts).toEqual(['lessor']);
  });
});

describe('"서로 다른 당사자" · 법인과 대표자 — 합치지 않고 방향에도 잘못 반영하지 않음', () => {
  const draftWith = (parties: { role: string; name: string; term?: string; distinct?: boolean }[]) => ({ ...review(rentalOut()).draft, parties });
  test('렌탈회사 "가상렌탈"과 계약서 임대인 "주식회사 팩토렌터카"를 서로 다른 당사자로 → 연결·충돌 표시 없음 · 저장 후에도 유지', () => {
    const parties = [{ role: 'provider', name: '가상렌탈' }, { role: 'lessor', name: '주식회사 팩토렌터카', distinct: true }, { role: 'customer', name: '김도윤', term: '임차인' }];
    const n = normalizePartyRoles('rental', parties);
    expect(n.conflicts).toEqual([]);
    expect(n.parties.map((p) => p.role)).toEqual(['provider', 'lessor', 'customer']);
    const r = rec(draftWith(parties));
    const again = formToDraft(contractFormSchema.parse(draftToForm(recordToDraft(r))));
    expect(again.parties).toEqual(r.contract.parties);
    expect(again.parties.find((p) => p.role === 'lessor')?.distinct).toBe(true);
  });

  test('방향: 계약서가 "임대인에게 지급"이라고 했으면, 따로 둔 임대인이 받는 쪽 — 렌탈회사로 확인해도 입금으로 단정하지 않음', () => {
    const base = review(rentalOut()).draft;
    const d = { ...base, parties: [{ role: 'provider', name: '가상렌탈' }, { role: 'lessor', name: '주식회사 팩토렌터카', distinct: true }, { role: 'customer', name: '김도윤' }], payments: base.payments.map((p) => (p.label === '월 렌트료' ? { ...p, payerRole: 'customer', payeeRole: 'lessor' } : p)) };
    const rent = (role: string) => withConfirmedRole(d, role).payments.find((p) => p.label === '월 렌트료')!.direction;
    expect(rent('customer')).toBe('expense');
    expect(rent('provider')).toBe('neutral');
    expect(rent('lessor')).toBe('income');
  });

  test('법인과 대표자는 같은 자리로 합치지 않음 · 대표자로 확인하면 어떤 금액도 출금·입금으로 정하지 않음', () => {
    const parties = [{ role: 'provider', name: '주식회사 팩토렌터카' }, { role: 'customer', name: '김도윤' }, { role: 'representative', name: '박지훈' }];
    expect(normalizePartyRoles('rental', parties)).toEqual({ parties, roleMap: { lessor: 'provider', lessee: 'customer' }, conflicts: [] });
    expect(samePartyName('주식회사 팩토렌터카', '박지훈')).toBe(false);
    const d = withConfirmedRole(draftWith(parties), 'representative');
    expect(d.payments.every((p) => p.direction === 'neutral')).toBe(true);
    expect(matchUserParty('rental', parties, ['박지훈'])).toMatchObject({ role: 'representative', moneySide: false });
  });
});

