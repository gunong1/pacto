/**
 * 계약 정보 ↔ PACTO 계약 체크 역할 분리 golden (결정론 층) — 모든 값은 가짜다.
 *
 * 원칙: 계약 정보 = 사실 / 계약 체크 = 그 사실 때문에 사용자가 해야 할 일·주의할 위험
 * - 같은 의미(semantic key)의 체크는 문장이 달라도 하나
 * - 사실만 있는 체크(정책 none)는 계약 정보에 같은 의미의 값이 있으면 만들지 않는다
 * - 행동이 필요한 구조화 값(통보기한·갱신 협의 기한)만 체크로 파생 (derivedFrom으로 출처 기록)
 * - 체크 카드는 "할 일 + 짧은 이유". 원문 조항은 "계약서에서 보기"로만 (두 영역에 같은 문장 반복 없음)
 */
import { draftToRecord } from '@/data/draft';
import { toReviewModel } from '@/features/registration/extraction';

import { toAppResult } from '../../../../supabase/functions/_shared/extraction.ts';
import { checkHeadline } from '../../checkDisplay';
import { coreInfo } from '../../coreInfo';
import { contract, pay } from './classificationFixtures';

const TODAY = '2026-10-11';
const q = (quote: string) => ({ evidence_quote: quote, evidence_page: 1, evidence_file: 1 });
const f = (value: unknown, quote: string | null = null) => ({ value, confidence: 'high', evidence_quote: quote, evidence_page: quote ? 1 : null, evidence_file: quote ? 1 : null });
const check = (c: Record<string, unknown>) => ({ severity: 'check', confidence: 'high', behavior: 'info', condition: null, action: null, offset_days: null, related_date: null, amount: null, amount_basis: null, user_action: null, ...c });
const detail = (key: string, text: string) => ({ key, text_value: text, number_value: null, boolean_value: null, confidence: 'high', source_type: 'explicit', ...q(text) });

const RENEW = '계약 종료 60일 전까지 갱신 여부를 협의한다.';
const lease = (o: { checks?: unknown[]; fields?: Record<string, unknown>; details?: unknown[]; payments?: Record<string, unknown>[] } = {}) =>
  contract({
    cls: { kind: 'lease', subtype: 'housing', domains: ['real_estate'] },
    title: '주택 월세 임대차계약서',
    dates: [
      { date: '2026-10-20', meaning: 'contract_start', label: '임대차 시작일', confidence: 'high', source_type: 'explicit', ...q('임대차기간 2026년 10월 20일부터') },
      { date: '2028-10-19', meaning: 'contract_end', label: '임대차 종료일', confidence: 'high', source_type: 'explicit', ...q('2028년 10월 19일까지') },
    ],
    payments: o.payments ?? [pay({ kind: 'rent', label: '월세', amount: 850000, day_of_month: 20, ...q('월세 850,000원은 매월 20일에 지급한다.') })],
    fields: { depositAmount: f(20000000, '보증금 20,000,000원'), terminationNoticeDays: f(60, RENEW), noticeKind: f('renewal_decision', RENEW), autoRenewal: f(false, RENEW), ...(o.fields ?? {}) },
    details: o.details ?? [],
    checks: o.checks ?? [],
  });
const run = (output: unknown) => {
  const result = toAppResult(output, 'openai');
  const model = toReviewModel(result, ['doc-1']);
  const record = draftToRecord(model.draft, 'c1', TODAY);
  return { result, model, record };
};
const byKey = <T extends { semanticKey?: string | null }>(checks: T[], key: string): T[] => checks.filter((c) => c.semanticKey === key);

describe('1. 갱신 협의 기한 (사실은 계약 정보, 할 일은 체크)', () => {
  test('원문 "계약 종료 60일 전까지 갱신 여부를 협의한다" → 정보: 갱신 협의 기한 / 체크: "2028. 8. 20.까지 갱신 여부 확인"', () => {
    const { result, record, model } = run(lease({ checks: [check({ topic: 'renewal_terms', title: '갱신 조건', description: RENEW, ...q(RENEW) })] }));
    const renew = byKey(result.checks, 'renewal_decision');
    expect(renew).toHaveLength(1);
    expect(renew[0].suggestion).toMatchObject({ kind: 'set_termination_notice', terminationNoticeDays: 60 });

    // 계약 정보: 사실
    const info = coreInfo(record, TODAY).find((r) => r.key === 'notice')!;
    expect(info.value).toContain('종료 60일 전까지');

    // 계약 체크: 할 일 + 짧은 이유 (원문을 그대로 반복하지 않음 — 원문은 "계약서에서 보기")
    // 등록 확인 화면의 체크(저장되는 체크와 같은 내용)
    const card = checkHeadline(model.checks.find((c) => c.semanticKey === 'renewal_decision')!, record.contract, TODAY);
    expect(card.title).toBe('2028. 8. 20.까지 갱신 여부 확인');
    expect(card.reason).not.toBe(RENEW);
    expect(card.reason).toContain('60일 전');
  });

  test('AI가 체크를 따로 만들지 않아도, 행동이 필요한 구조화 값이면 서버가 체크를 하나 파생 (derivedFrom 기록)', () => {
    const { result } = run(lease());
    const renew = byKey(result.checks, 'renewal_decision');
    expect(renew).toHaveLength(1);
    expect(renew[0].derivedFrom).toEqual(['terminationNoticeDays', 'endDate']);
  });

  test('같은 의미의 체크는 문장이 달라도 하나 (갱신 조건 + 통보기한 → renewal_decision 1개)', () => {
    const { result } = run(
      lease({
        checks: [
          check({ topic: 'renewal_terms', title: '갱신 조건', description: '갱신은 협의로 정합니다.', ...q(RENEW) }),
          check({ topic: 'notice_deadline', title: '갱신 협의 기한', description: '종료 60일 전까지 협의해야 해요.', ...q(RENEW) }),
        ],
      }),
    );
    expect(byKey(result.checks, 'renewal_decision')).toHaveLength(1);
  });
});

describe('2. 자동갱신 + 해지 통보기한 → 놓치면 불이익이 있어 체크 하나', () => {
  test('자동갱신 체크와 통보기한 체크가 함께 와도 termination_notice 체크 하나 (자동갱신 안내 포함)', () => {
    const NOTICE = '계약 만료 30일 전까지 해지 의사를 통지하지 않으면 1년 자동 연장된다.';
    const { result } = run(
      lease({
        fields: { terminationNoticeDays: f(30, NOTICE), noticeKind: f('termination_notice', NOTICE), autoRenewal: f(true, NOTICE), renewalPeriodMonths: f(12, NOTICE) },
        checks: [check({ topic: 'auto_renewal', title: '자동갱신', description: NOTICE, ...q(NOTICE) }), check({ topic: 'notice_deadline', title: '해지 통보기한', description: NOTICE, ...q(NOTICE) })],
      }),
    );
    const notice = byKey(result.checks, 'termination_notice');
    expect(notice).toHaveLength(1);
    expect(byKey(result.checks, 'auto_renewal')).toHaveLength(0);
    expect(notice[0].suggestion).toMatchObject({ kind: 'set_termination_notice', terminationNoticeDays: 30, autoRenewal: true });
    expect(notice[0].description).toContain('자동');
  });
});

describe('3. 사실만 있는 체크는 만들지 않음 (계약 정보에만)', () => {
  test('관리비 월 100,000원 (특별 조건 없음) → 금액 정보에만, 체크 없음', () => {
    const FEE = '관리비 월 100,000원';
    const { result, record } = run(
      lease({
        payments: [pay({ kind: 'rent', label: '월세', amount: 850000, day_of_month: 20 }), pay({ kind: 'maintenance_fee', label: '관리비', amount: 100000, day_of_month: 20, ...q(FEE) })],
        checks: [check({ topic: 'maintenance_fee', title: '관리비', description: FEE, severity: 'info', ...q(FEE) })],
      }),
    );
    expect(byKey(result.checks, 'maintenance_fee')).toHaveLength(0);
    expect(record.payments.some((p) => p.label === '관리비' && p.amount === 100000)).toBe(true);
  });

  test('관리비에 주의할 조건(추가 정산)이 있으면 체크로 남김', () => {
    const FEE = '관리비는 실제 사용량에 따라 추가 정산된다.';
    const { result } = run(lease({ checks: [check({ topic: 'maintenance_fee', title: '관리비 추가 정산', description: '사용량에 따라 추가로 낼 수 있어요.', user_action: '정산 내역을 확인하세요', ...q(FEE) })] }));
    expect(byKey(result.checks, 'maintenance_fee')).toHaveLength(1);
  });

  test('보증금 반환 조건 "종료 시 반환" → 정보에만 (별도 행동이 없으면 체크 없음)', () => {
    const RET = '임대인은 계약 종료 시 보증금을 반환한다.';
    const { result } = run(lease({ details: [detail('deposit_return_terms', RET)], checks: [check({ topic: 'deposit_return', title: '보증금 반환', description: RET, severity: 'info', ...q(RET) })] }));
    expect(byKey(result.checks, 'deposit_return')).toHaveLength(0);
  });

  test('같은 사실이 계약 정보에 없으면 정보가 사라지지 않도록 체크를 남긴다', () => {
    const RET = '임대인은 계약 종료 시 보증금을 반환한다.';
    const { result } = run(lease({ checks: [check({ topic: 'deposit_return', title: '보증금 반환', description: RET, severity: 'info', ...q(RET) })] }));
    expect(byKey(result.checks, 'deposit_return')).toHaveLength(1);
  });
});

describe('4. 행동·위험이 있는 조항은 체크', () => {
  test('중도해지 30일 전 통보 → 체크 (조건부)', () => {
    const EARLY = '임차인이 중도 해지하려면 30일 전에 통보하여야 한다.';
    const { result } = run(lease({ checks: [check({ topic: 'early_termination', title: '중도해지 통보', description: '중도 해지하려면 30일 전에 알려야 해요.', behavior: 'conditional_rule', condition: '중도 해지하려는 경우', action: '해지 희망일 30일 전 통보', offset_days: 30, ...q(EARLY) })] }));
    expect(byKey(result.checks, 'early_termination')).toHaveLength(1);
  });

  test('원상복구 의무 → 체크 (주의)', () => {
    const REST = '임차인은 계약 종료 시 목적물을 원상으로 복구하여 반환한다.';
    const { result } = run(lease({ checks: [check({ topic: 'restoration', title: '원상복구', description: '퇴거할 때 원래 상태로 돌려놓아야 해요.', severity: 'caution', ...q(REST) })] }));
    expect(byKey(result.checks, 'restoration')).toHaveLength(1);
  });
});
