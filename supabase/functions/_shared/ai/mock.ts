// 로컬 개발·테스트용 (AI_PROVIDER=mock). 실제 계약서를 읽지 않는다 — 항상 같은 렌탈 계약 형태로 응답.
import type { ContractFile, ExtractionProvider } from './types.ts';

export class MockExtractionProvider implements ExtractionProvider {
  readonly name = 'mock';
  async extract(files: ContractFile[]) {
    const ev = (quote: string | null) => ({ evidence_page: quote ? 1 : null, evidence_quote: quote });
    const f = (value: unknown, confidence = 'high', quote: string | null = null) => ({ value, confidence, ...ev(quote) });
    return {
      model: 'mock',
      json: {
        contract_type: { value: 'recurring', confidence: 'high', alternatives: ['other'], reason: '매월 렌탈료를 내는 계약으로 기재되어 있습니다.', ...ev('월 렌탈료 29,900원') },
        fields: {
          title: f(files[0]?.fileName.replace(/\.[^.]+$/, '') ?? '계약서'),
          category: f('rental'),
          counterparty: f('테스트렌탈(주)', 'high', '렌탈회사: 테스트렌탈 주식회사'),
          totalAmount: f(null, 'low'),
          depositAmount: f(null, 'high'),
          autoRenewal: f(true, 'medium'),
          renewalPeriodMonths: f(12, 'medium'),
          terminationNoticeDays: f(30, 'medium'),
          earlyTerminationTerms: f(null, 'low'),
          penaltyTerms: f(null, 'low'),
        },
        dates: [
          { date: '2026-10-05', meaning: 'contract_signed', label: '계약 체결일', confidence: 'high', ...ev('계약 체결일 2026년 10월 5일') },
          { date: '2026-10-12', meaning: 'service_start', label: '계약 기간 시작', confidence: 'high', ...ev('계약 기간 2026.10.12 ~ 2029.10.11') },
          { date: '2029-10-11', meaning: 'contract_end', label: '계약 기간 종료', confidence: 'high', ...ev('계약 기간 2026.10.12 ~ 2029.10.11') },
        ],
        payments: [
          { kind: 'recurring_fee', label: '월 렌탈료', amount: 29900, frequency: 'monthly', day_of_month: 12, date: null, end_date: null, installment_count: null, is_variable: false, confidence: 'high', ...ev('월 렌탈료 29,900원') },
          { kind: 'setup_fee', label: '초기 설치비', amount: 20000, frequency: 'one_time', day_of_month: null, date: null, end_date: null, installment_count: null, is_variable: false, confidence: 'high', ...ev('초기 설치비 20,000원 (1회)') },
        ],
        details: { commitment_months: 36, ownership_transfer_terms: '계약 종료 후 전액 납부 완료 시 이전' },
        checks: [{ severity: 'caution', topic: 'auto_renewal', title: '자동갱신', description: '자동갱신 조건이 포함되어 있습니다. 해지 통보기한을 확인해주세요.', evidence_quote: null, evidence_page: null }],
      },
    };
  }
}
