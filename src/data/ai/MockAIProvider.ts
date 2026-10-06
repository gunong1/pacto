import { addDays, addMonths } from '@/domain/dates';

import type { AIProvider, ExtractInput, ExtractionResult } from './provider';

/**
 * 실제 LLM 없이 등록 흐름을 검증하기 위한 mock.
 * 어떤 파일을 넣어도 같은 "공기청정기 렌탈" 계약(월 렌탈료 + 초기 설치비)을 추출한 것처럼 응답한다.
 * 결제일 신뢰도 low, 설치비 날짜 없음 등으로 "확인 필요" UI를 확인할 수 있게 한다.
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

    const signed = addDays(input.today, -1);
    const start = addDays(input.today, 5);
    const end = addDays(addMonths(start, 36), -1);
    const f = <T>(value: T | null, confidence: 'high' | 'medium' | 'low' = 'high', quote?: string) => ({
      value,
      confidence,
      ...(quote ? { evidence: [{ page: 1, quote }] } : {}),
    });

    return {
      provider: this.name,
      promptVersion: 'mock-5',
      category: { value: 'rental', confidence: 'high', alternatives: [], reason: '공기청정기 렌탈 계약으로 기재되어 있습니다.' },
      contractType: { value: 'recurring', confidence: 'high', alternatives: ['other'], reason: '매월 렌탈료를 내는 계약으로 기재되어 있습니다.' },
      fields: {
        title: f('공기청정기 렌탈'),
        counterparty: f('클린에어렌탈(주)', 'high', '렌탈회사: 클린에어렌탈 주식회사'),
        totalAmount: f(null, 'low'),
        depositAmount: f(null, 'high'),
        autoRenewal: f(true, 'medium', '계약 만료 1개월 전까지 별도 의사표시가 없으면 12개월 단위로 연장된다'),
        renewalPeriodMonths: f(12, 'medium'),
        terminationNoticeDays: f(30, 'medium', '계약 만료 1개월 전까지'),
        earlyTerminationTerms: f('의무사용기간 내 해지 시 위약금이 발생할 수 있습니다.', 'medium'),
        penaltyTerms: f('잔여 렌탈료의 10%', 'medium', '잔여 렌탈료의 10%를 위약금으로 납부한다'),
      },
      dates: [
        { date: signed, meaning: 'contract_signed', label: '계약 체결일', confidence: 'high', sourceType: 'explicit' },
        { date: start, meaning: 'service_start', label: '렌탈 개시일', confidence: 'high', sourceType: 'explicit', evidence: [{ page: 1, quote: `렌탈 개시일: ${start}` }] },
        { date: end, meaning: 'contract_end', label: '의무사용기간 종료', confidence: 'medium', sourceType: 'explicit', evidence: [{ page: 1, quote: '의무사용기간: 개시일로부터 36개월' }] },
      ],
      payments: [
        {
          kind: 'recurring_fee', direction: 'expense', label: '월 렌탈료', amount: 29_900, frequency: 'monthly', dayOfMonth: 10, date: null, endDate: null, installmentCount: null, isVariable: false, optional: false, components: [], businessDayRule: 'none', sourceType: 'explicit',
          confidence: 'low', evidence: [{ page: 2, quote: '렌탈료는 매월 지정일(10일)에 자동이체된다' }],
        },
        {
          kind: 'setup_fee', direction: 'expense', label: '초기 설치비', amount: 20_000, frequency: 'one_time', dayOfMonth: null, date: null, endDate: null, installmentCount: null, isVariable: false, optional: false, components: [], businessDayRule: 'none', sourceType: 'explicit',
          confidence: 'high', evidence: [{ page: 1, quote: '초기 설치비 20,000원 (1회)' }],
        },
      ],
      references: [],
      details: { commitment_months: { value: 36, confidence: 'high', sourceType: 'explicit', evidence: [{ page: 1, quote: '의무사용기간: 개시일로부터 36개월' }] } },
      checks: [
        {
          severity: 'caution',
          topic: 'auto_renewal',
          title: '자동갱신',
          description: '계약 만료 1개월 전까지 별도 의사표시가 없으면 12개월 단위로 연장되는 것으로 기재되어 있습니다.',
          confidence: 'high',
          evidenceQuote: '계약 만료 1개월 전까지 별도 의사표시가 없으면 12개월 단위로 연장된다.',
          evidencePage: 3,
          evidenceFileIndex: 0,
          behavior: 'fixed_event',
          rule: null,
          relatedDate: null,
          suggestion: { kind: 'set_termination_notice', terminationNoticeDays: 30, autoRenewal: true, renewalPeriodMonths: 12 },
        },
        {
          severity: 'check',
          topic: 'early_termination',
          title: '중도해지 위약금',
          description: '의무사용기간 내 해지하는 경우 잔여 렌탈료의 10%를 위약금으로 납부하는 것으로 기재되어 있습니다.',
          confidence: 'high',
          evidenceQuote: '의무사용기간 내 해지 시 잔여 렌탈료의 10%를 위약금으로 납부한다.',
          evidencePage: 3,
          evidenceFileIndex: 0,
          behavior: 'conditional_rule',
          rule: { condition: '의무사용기간 내 해지하는 경우', action: '잔여 렌탈료의 10% 위약금', offsetDays: null },
          relatedDate: null,
          suggestion: null,
        },
        {
          severity: 'check',
          topic: 'equipment_return',
          title: '장비 반환',
          description: '계약 종료 시 제품을 반환해야 하며, 반환하지 않으면 잔존가액이 청구될 수 있는 것으로 기재되어 있습니다.',
          confidence: 'low',
          evidenceQuote: '계약 종료 시 제품을 반환하지 않으면 잔존가액을 청구할 수 있다.',
          evidencePage: 3,
          evidenceFileIndex: 0,
          behavior: 'info',
          rule: null,
          relatedDate: null,
          suggestion: null,
        },
      ],
    };
  }
}
