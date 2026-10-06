// 로컬 개발·테스트용 (AI_PROVIDER=mock). 실제 계약서를 읽지 않는다 — 항상 같은 렌탈 계약 형태(v4)로 응답.
import type { ContractFile, ExtractionProvider } from './types.ts';

export class MockExtractionProvider implements ExtractionProvider {
  readonly name = 'mock';
  async extract(files: ContractFile[]) {
    const q = (quote: string | null) => ({ evidence_quote: quote });
    const f = (value: unknown, confidence = 'high', quote: string | null = null) => ({ value, confidence, ...q(quote) });
    const pay = (p: Record<string, unknown>) => ({ day_of_month: null, date: null, end_date: null, installment_count: null, is_variable: false, optional: false, confidence: 'high', evidence_quote: null, ...p });
    return {
      model: 'mock',
      json: {
        category: { value: 'rental', confidence: 'high', alternatives: [], reason: '공기청정기 렌탈 계약으로 기재되어 있습니다.' },
        contract_type: { value: 'recurring', confidence: 'high', alternatives: ['other'], reason: '매월 렌탈료를 내는 계약으로 기재되어 있습니다.' },
        fields: {
          title: f(files[0]?.fileName.replace(/\.[^.]+$/, '') ?? '계약서'),
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
          { date: '2026-10-05', meaning: 'contract_signed', label: '계약 체결일', confidence: 'high', ...q('계약 체결일 2026년 10월 5일') },
          { date: '2026-10-12', meaning: 'service_start', label: '계약 기간 시작', confidence: 'high', ...q('계약 기간 2026.10.12 ~ 2029.10.11') },
          { date: '2029-10-11', meaning: 'contract_end', label: '계약 기간 종료', confidence: 'high', ...q('계약 기간 2026.10.12 ~ 2029.10.11') },
        ],
        payments: [
          pay({ kind: 'recurring_fee', direction: 'expense', label: '월 렌탈료', amount: 29900, frequency: 'monthly', day_of_month: 12, ...q('월 렌탈료 29,900원') }),
          pay({ kind: 'setup_fee', direction: 'expense', label: '초기 설치비', amount: 20000, frequency: 'one_time', ...q('초기 설치비 20,000원 (1회)') }),
        ],
        details: [
          { key: 'commitment_months', text_value: null, number_value: 36, boolean_value: null, confidence: 'high', ...q('계약 기간 36개월') },
          { key: 'ownership_transfer_terms', text_value: '계약 종료 후 전액 납부 완료 시 이전', number_value: null, boolean_value: null, confidence: 'high', ...q('계약 종료 후 전액 납부 완료 시 이전') },
        ],
        checks: [
          {
            severity: 'caution', topic: 'auto_renewal', title: '자동갱신', confidence: 'high', related_date: null,
            description: '계약 종료 30일 전까지 해지 의사를 표시하지 않으면 12개월 자동 연장되는 것으로 기재되어 있습니다.',
            evidence_quote: '계약 종료 30일 전까지 해지 의사를 표시하지 않으면 동일 조건으로 12개월 자동 연장됩니다.', evidence_page: 1, evidence_file: 1,
          },
          {
            severity: 'check', topic: 'early_termination', title: '중도해지 위약금', confidence: 'high', related_date: null,
            description: '의무사용기간 내 중도해지 시 잔여 렌탈료 총액의 10%가 위약금으로 부과되는 것으로 기재되어 있습니다.',
            evidence_quote: '의무사용기간 내 중도해지 시 잔여 렌탈료 총액의 10%가 위약금으로 부과됩니다.', evidence_page: 1, evidence_file: 1,
          },
        ],
      },
    };
  }
}
