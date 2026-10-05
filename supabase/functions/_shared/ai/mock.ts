// 로컬 개발·테스트용 (AI_PROVIDER=mock). 실제 계약서를 읽지 않는다.
import type { ContractFile, ExtractionProvider } from './types.ts';

export class MockExtractionProvider implements ExtractionProvider {
  readonly name = 'mock';
  async extract(files: ContractFile[]) {
    const f = (value: unknown, confidence = 'high', quote: string | null = null) => ({ value, confidence, evidence_page: quote ? 1 : null, evidence_quote: quote });
    return {
      model: 'mock',
      json: {
        fields: {
          title: f(files[0]?.fileName.replace(/\.[^.]+$/, '') ?? '계약서'),
          category: f('rental'),
          counterparty: f('테스트렌탈(주)', 'high', '렌탈회사: 테스트렌탈 주식회사'),
          contractDate: f(null, 'low'),
          startDate: f('2026-10-10'),
          endDate: f('2029-10-09', 'medium'),
          totalAmount: f(null, 'low'),
          paymentLabel: f('월 렌탈료'),
          paymentAmount: f(29900, 'high', '월 렌탈료 29,900원'),
          paymentFrequency: f('monthly'),
          paymentDay: f(10, 'low'),
          paymentVariable: f(false, 'medium'),
          autoRenewal: f(true, 'medium'),
          renewalPeriodMonths: f(12, 'medium'),
          terminationNoticeDays: f(30, 'medium'),
          depositAmount: f(null, 'high'),
          earlyTerminationTerms: f(null, 'low'),
          penaltyTerms: f(null, 'low'),
        },
        checks: [{ severity: 'caution', topic: 'auto_renewal', title: '자동갱신', description: '자동갱신 조건이 포함되어 있습니다. 해지 통보기한을 확인해주세요.', evidence_quote: null, evidence_page: null }],
      },
    };
  }
}
