/**
 * 보험계약서 회귀 — "새길 안심생활 종합보장보험(갱신형)" 모의 계약서 (2026-10 실전 테스트 PDF, 모든 값 가짜).
 * 모델 출력(insuranceFixtures) → 서버 정리 → 등록 확인 → 저장 결과. 모델이 흔히 섞는 함정(담보별 보험료·보장금액·해약환급금 예시)을 넣었다.
 * 민감정보 보호 쪽 회귀는 tests/protection/watermark.test.ts (같은 PDF 원본으로 보호 처리)
 */
import { savingsInsurance } from './insuranceFixtures';
import { observe } from './harness';

const o = observe(savingsInsurance(), 'policyholder');
const contract = (o.record as unknown as { contract: { parties: { role: string; name: string }[]; details: Record<string, unknown> } }).contract;

describe('보험계약서 — 월 보험료 89,700원 · 20년 · 매월 25일', () => {
  test('유형: 보험', () => expect([o.type, o.category]).toEqual(['insurance', 'insurance']));

  test('확정 금액은 월 보험료 89,700원 매월 25일 지출 한 건 (담보별 보험료는 구성항목 — 중복 계산 없음)', () => {
    expect(o.payments.map(({ label, amount, direction, frequency, day, obligation }) => ({ label, amount, direction, frequency, day, obligation }))).toEqual([
      { label: '월 보험료', amount: 89700, direction: 'expense', frequency: 'monthly', day: 25, obligation: 'confirmed' },
    ]);
    expect(o.payments[0].components).toEqual(['일반상해 사망 보험료', '암 진단비 보험료', '입원일당 갱신형 특약 보험료']);
  });

  test('보험기간 2026-11-01 ~ 2046-10-31', () => expect([o.startDate, o.endDate]).toEqual(['2026-11-01', '2046-10-31']));

  test('계약자와 피보험자를 각각의 역할로 구분 (같은 사람이어도 합치지 않음) · 수익자·보험사', () => {
    expect(contract.parties.map((p) => `${p.role}:${p.name}`)).toEqual(['policyholder:김도윤', 'insured:김도윤', 'beneficiary:박서연', 'insurer:새길손해보험 주식회사']);
  });

  test('갱신형 특약 구분: 갱신형 · 5년 주기 · 납입기간 20년납 월납', () => {
    expect(contract.details).toMatchObject({ renewable: true, renewalCycleYears: 5, paymentPeriod: '20년납 / 월납' });
  });

  test('3쪽 위험조항 A~F를 모두 계약 체크로 유지', () => {
    for (const k of ['A', 'B', 'C', 'D', 'E', 'F']) expect(o.checks.some((c) => c.title.includes(`(${k})`))).toBe(true);
  });

  test('보장금액(사망보험금·진단비·입원일당)을 수입으로 계산하지 않음', () => {
    expect(o.payments.filter((p) => p.direction === 'income')).toEqual([]);
    expect(o.nonCashPayments).toEqual([]);
  });

  test('해약환급금 예시는 확정 수입이 아니라 참고 금액', () => {
    expect(o.references).toEqual([{ label: '해약환급금 (5년 경과 예시)', amount: 1938000, role: 'reference' }]);
  });

  test('개인정보 동의 항목은 보험료 납부 항목이 되지 않음', () => {
    expect(o.payments.some((p) => /동의/.test(p.label))).toBe(false);
  });
});
