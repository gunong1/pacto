/**
 * 계약 정보(사실·중요한 조건) ↔ PACTO 계약 체크(행동·기한·주의·위험) 역할 golden — 모든 값은 가짜다.
 *
 * - 조건 문장(레지스트리 DETAIL role=condition)은 보존하되 기본 정보가 아니라 "상세 조건"에서
 * - 체크는 행동·기한·위험이 있을 때만. 모든 조건을 체크로 옮기지 않는다
 * - 같은 조항이 양쪽에 있으면 정보 = 조건 문장, 체크 = 할 일·짧은 이유 (같은 문장 반복 없음)
 * - 저장된 값은 지우지 않는다 (수정 화면 왕복에도 유지)
 */
import { draftToForm, formToDraft } from '@/features/contracts/form';
import { EMPTY_DRAFT } from '@/data/draft';

import { toAppResult } from '../../../../supabase/functions/_shared/extraction.ts';
import { splitDetailFields } from '../../contractTypes';
import { contract, pay } from './classificationFixtures';

const q = (quote: string) => ({ evidence_quote: quote, evidence_page: 1, evidence_file: 1 });
const f = (value: unknown, quote: string | null = null) => ({ value, confidence: 'high', evidence_quote: quote, evidence_page: quote ? 1 : null, evidence_file: quote ? 1 : null });
const check = (c: Record<string, unknown>) => ({ severity: 'check', confidence: 'high', behavior: 'info', condition: null, action: null, offset_days: null, related_date: null, amount: null, amount_basis: null, user_action: null, ...c });
const detail = (key: string, text: string) => ({ key, text_value: text, number_value: null, boolean_value: null, confidence: 'high', source_type: 'explicit', ...q(text) });
const norm = (x: string | null | undefined) => (x ?? '').replace(/\s/g, '');

const RENEW = '계약 종료 60일 전까지 갱신 여부를 협의한다.';
const lease = (o: { details?: unknown[]; checks?: unknown[]; fields?: Record<string, unknown> } = {}) =>
  toAppResult(
    contract({
      cls: { kind: 'lease', subtype: 'housing', domains: ['real_estate'] },
      title: '주택 월세 임대차계약서',
      dates: [
        { date: '2026-10-20', meaning: 'contract_start', label: '임대차 시작일', confidence: 'high', source_type: 'explicit', ...q('2026년 10월 20일부터') },
        { date: '2028-10-19', meaning: 'contract_end', label: '임대차 종료일', confidence: 'high', source_type: 'explicit', ...q('2028년 10월 19일까지') },
      ],
      payments: [pay({ kind: 'rent', label: '월세', amount: 850000, day_of_month: 20, ...q('월세 850,000원') })],
      fields: { depositAmount: f(20000000, '보증금 20,000,000원'), ...(o.fields ?? {}) },
      details: o.details ?? [],
      checks: o.checks ?? [],
    }),
    'openai',
  );
const byKey = (r: ReturnType<typeof lease>, key: string) => r.checks.filter((c) => c.semanticKey === key);

describe('화면 구성: 사실은 기본 정보, 조건 문장은 상세 조건 (레지스트리 한 곳)', () => {
  test('임대차: 기본 정보 = 임대 형태 (임대인·임차인은 "계약 당사자"에서) / 상세 조건 = 갱신 관련 조건·보증금 반환 조건', () => {
    const { facts, conditions } = splitDetailFields('lease');
    expect(facts.map((x) => x.key)).toEqual(['leaseKind']);
    expect(conditions.map((x) => x.key)).toEqual(['renewalTerms', 'depositReturnTerms']);
  });
  test('모든 계약 종류: 대출 중도상환수수료·보험 면책·렌탈 소유권 이전도 지우지 않고 상세 조건으로 보존', () => {
    expect(splitDetailFields('loan').conditions.map((x) => x.key)).toEqual(['prepaymentFeeTerms', 'overdueTerms']);
    expect(splitDetailFields('insurance').conditions.map((x) => x.key)).toEqual(['surrenderTerms', 'exclusions']);
    expect(splitDetailFields('recurring').conditions.map((x) => x.key)).toEqual(['equipmentReturnTerms', 'ownershipTransferTerms']);
    // 사실(근무시간·금리 등)은 기본 정보에 그대로
    expect(splitDetailFields('employment').facts.map((x) => x.key)).toContain('workHours');
    expect(splitDetailFields('loan').facts.map((x) => x.key)).toContain('interestRate');
  });
});

describe('Golden 1~6 (임대차 실제 사례 구조)', () => {
  test('1. 갱신 협의 60일 전 → 갱신 여부 확인 체크 1개, 해지 통보로 해석하지 않음, 체크 설명이 조건 문장을 반복하지 않음', () => {
    const r = lease({
      fields: { terminationNoticeDays: f(60, RENEW), noticeKind: f('renewal_decision', RENEW), autoRenewal: f(false, RENEW) },
      details: [detail('renewal_terms', RENEW)],
      checks: [check({ topic: 'renewal_terms', title: '갱신 조건', description: RENEW, ...q(RENEW) })],
    });
    expect(byKey(r, 'renewal_decision')).toHaveLength(1);
    expect(byKey(r, 'termination_notice')).toHaveLength(0);
    expect(norm(byKey(r, 'renewal_decision')[0].description)).not.toBe(norm(RENEW));
    // 조건 문장은 상세 조건으로 보존
    expect(r.details.renewal_terms?.value).toBe(RENEW);
  });

  test('2. 자동갱신 + 해지 통보기한 → 해지 통보 체크 하나 (자동갱신 안내 포함)', () => {
    const NOTICE = '계약 만료 30일 전까지 해지 의사를 통지하지 않으면 1년 자동 연장된다.';
    const r = lease({
      fields: { terminationNoticeDays: f(30, NOTICE), noticeKind: f('termination_notice', NOTICE), autoRenewal: f(true, NOTICE), renewalPeriodMonths: f(12, NOTICE) },
      checks: [check({ topic: 'auto_renewal', title: '자동갱신', description: NOTICE, ...q(NOTICE) })],
    });
    expect(byKey(r, 'termination_notice')).toHaveLength(1);
    expect(byKey(r, 'auto_renewal')).toHaveLength(0);
  });

  test('3. 단순 보증금 반환 사실("종료 시 반환") → 체크 없음, 조건은 보존', () => {
    const RET = '임대인은 계약 종료 시 보증금을 반환한다.';
    const r = lease({ details: [detail('deposit_return_terms', RET)], checks: [check({ topic: 'deposit_return', title: '보증금 반환', description: RET, severity: 'info', ...q(RET) })] });
    expect(r.checks).toHaveLength(0);
    expect(r.details.deposit_return_terms?.value).toBe(RET);
  });

  test('4. 퇴거 시 원상복구 부담(보증금 반환 조건 칸에 들어옴) → 원상복구 주의 체크 생성, 조건은 보존', () => {
    const REST = '임차인은 퇴거 시 통상적 사용을 초과한 훼손에 대하여 원상복구를 부담한다.';
    const r = lease({ details: [detail('deposit_return_terms', REST)] });
    const rest = byKey(r, 'restoration');
    expect(rest).toHaveLength(1);
    expect(rest[0]).toMatchObject({ severity: 'caution', evidenceQuote: REST, derivedFrom: ['details.deposit_return_terms'] });
    expect(norm(rest[0].description)).not.toBe(norm(REST));
    expect(r.details.deposit_return_terms?.value).toBe(REST);
  });

  test('5. 같은 조항이 정보와 체크에 있으면 역할을 나눔 — 체크는 할 일·이유, 원문은 근거로만', () => {
    const REST = '임차인은 퇴거 시 통상적 사용을 초과한 훼손에 대하여 원상복구를 부담한다.';
    const r = lease({ details: [detail('deposit_return_terms', REST)], checks: [check({ topic: 'restoration', title: '원상복구', description: REST, severity: 'caution', ...q(REST) })] });
    const rest = byKey(r, 'restoration');
    expect(rest).toHaveLength(1);
    expect(rest[0].evidenceQuote).toBe(REST);
    expect(norm(rest[0].description)).not.toBe(norm(REST));
  });

  test('6. 기존 계약 수정 → 저장된 조건 값이 지워지지 않음 (수정 폼 왕복)', () => {
    const draft = { ...EMPTY_DRAFT, title: '예전 임대차', contractKind: 'lease', contractType: 'lease' as const, category: 'real_estate' as const, details: { renewalTerms: RENEW, depositReturnTerms: '종료 시 반환', landlord: '김민수' } };
    const back = formToDraft(draftToForm(draft));
    expect(back.details).toMatchObject({ renewalTerms: RENEW, depositReturnTerms: '종료 시 반환', landlord: '김민수' });
  });
});

describe('계약 종류 전체 — 같은 원칙', () => {
  const loan = (checks: unknown[]) =>
    toAppResult(
      contract({
        cls: { kind: 'loan', subtype: 'credit' },
        title: '신용대출 약정서',
        payments: [pay({ kind: 'installment', label: '월 상환액', amount: 300000, ...q('매월 300,000원 상환') })],
        details: [detail('prepayment_fee_terms', '중도상환수수료 1.5%')],
        checks,
      }),
      'openai',
    );
  test('대출 중도상환수수료: 정보 "중도상환수수료 1.5%" · 체크 "조기 상환 전 수수료 발생 조건 확인" (같은 문장 반복 없음)', () => {
    const r = loan([check({ topic: 'prepayment', title: '중도상환수수료', description: '중도상환수수료 1.5%', behavior: 'conditional_rule', condition: '만기 전 상환하는 경우', action: '수수료 1.5%', ...q('중도상환수수료 1.5%') })]);
    expect(r.details.prepayment_fee_terms?.value).toBe('중도상환수수료 1.5%');
    const c = r.checks.filter((x) => x.semanticKey === 'prepayment');
    expect(c).toHaveLength(1);
    expect(c[0].description).toBe('미리 갚으면 수수료가 생길 수 있어요.');
  });
  test('대출 중도상환수수료 조건만 있고 체크가 없으면 → 조건부 체크 하나 (행동이 필요한 위험)', () => {
    const r = loan([]);
    const c = r.checks.filter((x) => x.semanticKey === 'prepayment');
    expect(c).toHaveLength(1);
    expect(c[0].behavior).toBe('conditional_rule');
  });
  test('렌탈 소유권 이전(사실만, 행동 없음) → 상세 조건에만, 체크 없음', () => {
    const OWN = '계약 종료 후 전액 납부 완료 시 소유권 이전';
    const r = toAppResult(
      contract({
        cls: { kind: 'rental', subtype: 'appliance', domains: ['appliance'] },
        title: '정수기 렌탈계약서',
        payments: [pay({ label: '월 렌탈료', amount: 29900, ...q('월 렌탈료 29,900원') })],
        details: [detail('ownership_transfer_terms', OWN)],
        checks: [check({ topic: 'ownership', title: '소유권 이전', description: OWN, severity: 'info', ...q(OWN) })],
      }),
      'openai',
    );
    expect(r.details.ownership_transfer_terms?.value).toBe(OWN);
    expect(r.checks.filter((x) => x.semanticKey === 'ownership')).toHaveLength(0);
  });
});
