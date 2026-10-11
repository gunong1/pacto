import { addDays, addMonths } from '@/domain/dates';

import { finalize, firstPass } from '../../../supabase/functions/_shared/analysis';
import { mockDocumentOutput } from '../../../supabase/functions/_shared/ai/mockFixtures';
import { toAppResult } from '../../../supabase/functions/_shared/extraction';
import type { AIProvider, AnalysisChoice, AnalysisOutcome, ExtractInput, ExtractionResult } from './provider';

/**
 * 실제 LLM 없이 등록 흐름을 검증하기 위한 mock.
 * 문서 확인은 서버 mock과 같은 규칙(파일 이름: 음식·강아지·흐림·특약·영수증·신분증·견적서 …)과 같은 게이트 코드로 판정하고,
 * 통과하면 "공기청정기 렌탈" 계약(월 렌탈료 + 초기 설치비)을 추출한 것처럼 응답한다.
 * 결제일 신뢰도 low, 설치비 날짜 없음 등으로 "확인 필요" UI를 확인할 수 있게 한다.
 */
export class MockAIProvider implements AIProvider {
  readonly name = 'mock';

  constructor(private readonly latencyMs = 2200) {}

  async analyze(input: ExtractInput, signal?: AbortSignal): Promise<AnalysisOutcome> {
    const result = await this.extract(input, signal);
    const { validation } = this.gate(input);
    return { validation, result: validation.decision === 'proceed' ? result : null };
  }

  async finalize(_jobId: string | undefined, choice: AnalysisChoice, input: ExtractInput, signal?: AbortSignal): Promise<AnalysisOutcome> {
    const { raw, files, validation } = this.gate(input);
    const out = finalize(raw, validation, files, choice, this.name);
    const excluded = out.excluded.filter((e) => e.page === null).map((e) => e.file);
    if (out.kind === 'reanalyze') return { validation: { ...validation, decision: 'proceed' }, result: await this.extract(input, signal), excludedFiles: excluded };
    return { validation: out.validation, result: out.result ? await this.extract(input, signal) : null, excludedFiles: excluded };
  }

  private gate(input: ExtractInput) {
    const names = input.files.map((f) => f.name);
    const files = names.map((n, i) => ({ file: i + 1, pdf: /\.pdf$/i.test(n) }));
    const raw = mockDocumentOutput(names);
    return { raw, files, validation: firstPass(raw, files, this.name).validation };
  }

  private async extract(input: ExtractInput, signal?: AbortSignal): Promise<ExtractionResult> {
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
    // 모델 출력(검증 전 JSON) 형식으로 만들고 서버와 같은 정리 규칙(toAppResult)을 거친다 — 앱이 따로 판단하지 않는다
    const f = (value: unknown, confidence: 'high' | 'medium' | 'low' = 'high', quote: string | null = null) => ({ value, confidence, evidence_quote: quote, evidence_page: quote ? 1 : null, evidence_file: quote ? 1 : null });
    const q = (quote: string, page = 1) => ({ evidence_quote: quote, evidence_page: page, evidence_file: 1 });
    const pay = (p: Record<string, unknown>) => ({
      role: 'recurring_cashflow', price_basis: 'actual', part_of: null, day_of_month: null, date: null, date_source: 'explicit', end_date: null, installment_count: null, is_variable: false,
      payment_obligation: 'confirmed', condition: null, business_day_rule: 'none', confidence: 'high', source_type: 'explicit', ...p,
    });
    const check = (c: Record<string, unknown>) => ({ confidence: 'high', behavior: 'info', condition: null, action: null, offset_days: null, related_date: null, amount: null, amount_basis: null, evidence_page: 3, evidence_file: 1, ...c });
    const renew = '계약 만료 1개월 전까지 별도 의사표시가 없으면 12개월 단위로 연장된다.';
    const raw = {
      category: { value: 'rental', confidence: 'high', alternatives: [], reason: '공기청정기 렌탈 계약으로 기재되어 있습니다.' },
      contract_type: { value: 'recurring', confidence: 'high', alternatives: ['other'], reason: '매월 렌탈료를 내는 계약으로 기재되어 있습니다.' },
      fields: {
        title: f('공기청정기 렌탈'),
        counterparty: f('클린에어렌탈(주)', 'high', '렌탈회사: 클린에어렌탈 주식회사'),
        totalAmount: f(null, 'low'),
        depositAmount: f(null, 'low'),
        autoRenewal: f(true, 'medium', renew),
        renewalPeriodMonths: f(12, 'medium', renew),
        terminationNoticeDays: f(30, 'medium', renew),
        noticeKind: f('termination_notice', 'medium', renew),
      },
      dates: [
        { date: signed, meaning: 'contract_signed', label: '계약 체결일', confidence: 'high', source_type: 'explicit', evidence_quote: null, evidence_page: null, evidence_file: null },
        { date: start, meaning: 'service_start', label: '렌탈 개시일', confidence: 'high', source_type: 'explicit', ...q(`렌탈 개시일: ${start}`) },
        { date: end, meaning: 'contract_end', label: '의무사용기간 종료', confidence: 'medium', source_type: 'explicit', ...q('의무사용기간: 개시일로부터 36개월') },
      ],
      payments: [
        pay({ kind: 'recurring_fee', direction: 'expense', label: '월 렌탈료', amount: 29_900, frequency: 'monthly', day_of_month: 10, confidence: 'low', ...q('렌탈료는 매월 지정일(10일)에 자동이체된다', 2) }),
        pay({ role: 'one_time_cashflow', kind: 'setup_fee', direction: 'expense', label: '초기 설치비', amount: 20_000, frequency: 'one_time', date_source: null, ...q('초기 설치비 20,000원 (1회)') }),
      ],
      details: [{ key: 'commitment_months', text_value: null, number_value: 36, boolean_value: null, confidence: 'high', source_type: 'explicit', ...q('의무사용기간: 개시일로부터 36개월') }],
      checks: [
        check({ severity: 'caution', topic: 'auto_renewal', title: '자동갱신', behavior: 'fixed_event', description: '계약 만료 1개월 전까지 별도 의사표시가 없으면 12개월 단위로 연장되는 것으로 기재되어 있습니다.', evidence_quote: renew }),
        check({
          severity: 'check', topic: 'early_termination', title: '중도해지 위약금', behavior: 'conditional_rule', condition: '의무사용기간 내 해지하는 경우', action: '잔여 렌탈료의 10% 위약금', amount_basis: '잔여 렌탈료의 10%',
          description: '의무사용기간 내 해지하는 경우 잔여 렌탈료의 10%를 위약금으로 납부하는 것으로 기재되어 있습니다.', evidence_quote: '의무사용기간 내 해지 시 잔여 렌탈료의 10%를 위약금으로 납부한다.',
        }),
        check({ severity: 'check', topic: 'equipment_return', title: '장비 반환', confidence: 'low', description: '계약 종료 시 제품을 반환해야 하며, 반환하지 않으면 잔존가액이 청구될 수 있는 것으로 기재되어 있습니다.', evidence_quote: '계약 종료 시 제품을 반환하지 않으면 잔존가액을 청구할 수 있다.' }),
      ],
    };
    return toAppResult(raw, this.name);
  }
}
