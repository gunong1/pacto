import { addDays, addMonths } from '@/domain/dates';

import type { AIProvider, ExtractInput, ExtractionResult } from './provider';

/**
 * 실제 LLM 없이 등록 흐름을 검증하기 위한 mock.
 * 어떤 파일을 넣어도 같은 "공기청정기 렌탈" 계약을 추출한 것처럼 응답한다.
 * 일부 필드는 신뢰도 low/값 없음으로 두어 "확인 필요" UI를 확인할 수 있게 한다.
 */
export class MockAIProvider implements AIProvider {
  readonly name = 'mock';

  constructor(private readonly latencyMs = 2200) {}

  async extractContract(input: ExtractInput, signal?: AbortSignal): Promise<ExtractionResult> {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, this.latencyMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      });
    });

    const start = addDays(input.today, 5);
    const end = addDays(addMonths(start, 36), -1);

    return {
      provider: this.name,
      promptVersion: 'mock-1',
      fields: {
        title: { value: '공기청정기 렌탈', confidence: 'high' },
        category: { value: 'rental', confidence: 'high' },
        counterparty: { value: '클린에어렌탈(주)', confidence: 'high', evidence: [{ page: 1, quote: '렌탈회사: 클린에어렌탈 주식회사' }] },
        contractDate: { value: null, confidence: 'low' },
        startDate: { value: start, confidence: 'high', evidence: [{ page: 1, quote: `렌탈 개시일: ${start}` }] },
        endDate: { value: end, confidence: 'medium', evidence: [{ page: 1, quote: '의무사용기간: 개시일로부터 36개월' }] },
        totalAmount: { value: null, confidence: 'low' },
        paymentLabel: { value: '월 렌탈료', confidence: 'high' },
        paymentAmount: { value: 29_900, confidence: 'high', evidence: [{ page: 1, quote: '월 렌탈료 29,900원 (VAT 포함)' }] },
        paymentFrequency: { value: 'monthly', confidence: 'high' },
        paymentDay: { value: 10, confidence: 'low', evidence: [{ page: 2, quote: '렌탈료는 매월 지정일(10일)에 자동이체된다' }] },
        paymentVariable: { value: false, confidence: 'medium' },
        autoRenewal: { value: true, confidence: 'medium', evidence: [{ page: 3, quote: '계약 만료 1개월 전까지 별도 의사표시가 없으면 12개월 단위로 연장된다' }] },
        renewalPeriodMonths: { value: 12, confidence: 'medium' },
        terminationNoticeDays: { value: 30, confidence: 'medium', evidence: [{ page: 3, quote: '계약 만료 1개월 전까지' }] },
        depositAmount: { value: null, confidence: 'high' },
        earlyTerminationTerms: { value: '의무사용기간 내 해지 시 위약금이 발생할 수 있습니다.', confidence: 'medium' },
        penaltyTerms: { value: '잔여 렌탈료의 10%', confidence: 'medium', evidence: [{ page: 3, quote: '잔여 렌탈료의 10%를 위약금으로 납부한다' }] },
      },
      checks: [
        {
          severity: 'caution',
          topic: 'auto_renewal',
          title: '자동갱신',
          description: '계약 만료 1개월 전까지 별도 의사표시가 없으면 12개월 단위로 연장되는 것으로 기재되어 있습니다. 해지 통보기한을 확인해주세요.',
          evidenceQuote: '계약 만료 1개월 전까지 별도 의사표시가 없으면 12개월 단위로 연장된다.',
          evidencePage: 3,
          suggestion: { kind: 'set_termination_notice', terminationNoticeDays: 30, autoRenewal: true, renewalPeriodMonths: 12 },
        },
        {
          severity: 'check',
          topic: 'penalty',
          title: '위약금 관련 조건',
          description: '의무사용기간 내 해지하는 경우 잔여 렌탈료의 10%를 위약금으로 납부하는 것으로 기재되어 있습니다.',
          evidenceQuote: '의무사용기간 내 해지 시 잔여 렌탈료의 10%를 위약금으로 납부한다.',
          evidencePage: 3,
          suggestion: null,
        },
        {
          severity: 'info',
          topic: 'payment',
          title: '결제일',
          description: '렌탈료는 매월 지정일에 자동이체되는 것으로 기재되어 있습니다. 실제 결제일을 확인해주세요.',
          evidenceQuote: '렌탈료는 매월 지정일(10일)에 자동이체된다.',
          evidencePage: 2,
          suggestion: null,
        },
      ],
    };
  }
}
