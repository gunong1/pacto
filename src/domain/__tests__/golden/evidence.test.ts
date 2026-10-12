/**
 * 계약서 근거 보기 golden — 모든 값은 가짜다.
 * 근거 있음 · 신뢰도 낮음 · 사용자 수정 · 민감정보 포함 · 직접 입력 · 가림 실패 · 등록 확인 모델의 근거 위치
 */
import { toReviewModel } from '@/features/registration/extraction';

import { toAppResult } from '../../../../supabase/functions/_shared/extraction.ts';
import { evidenceView, stableEvidence } from '../../evidence';
import { contract, pay } from './classificationFixtures';

const ev = (quote: string, page: number | null = 2) => ({ quote, page, documentId: 'doc-2' });

describe('근거 아이콘·시트 표시 규칙', () => {
  test('근거 있음 → 아이콘 · 문장 · 쪽 · 문서', () => {
    const v = evidenceView(ev('임대인(갑) 성명 김민수'), { aiValue: '김민수', currentValue: '김민수' });
    expect(v).toMatchObject({ hasEvidence: true, needsReview: false, quote: '임대인(갑) 성명 김민수', page: 2, documentId: 'doc-2', aiValue: '김민수', edited: false });
  });
  test('직접 입력(근거 없음) → 아이콘 없음 · AI 값 없음', () => {
    expect(evidenceView(undefined, { currentValue: '김민수' })).toMatchObject({ hasEvidence: false, quote: null, aiValue: null, edited: false });
  });
  test('신뢰도 낮음 → 확인 필요 강조 (근거와 별개)', () => {
    expect(evidenceView(ev('임차인 이지운'), { flagged: true, aiValue: '이지운', currentValue: '이지운' }).needsReview).toBe(true);
    expect(evidenceView(undefined, { flagged: true }).needsReview).toBe(true);
  });
  test('사용자가 값을 고쳐도 AI가 읽은 값과 근거는 그대로 (수정됨 표시)', () => {
    const v = evidenceView(ev('임차인(을) 성명 이지운'), { aiValue: '이지운', currentValue: '이지은' });
    expect(v).toMatchObject({ edited: true, aiValue: '이지운', quote: '임차인(을) 성명 이지운', hasEvidence: true });
    // 표기만 다른 값(쉼표·공백)은 고친 것으로 보지 않음
    expect(evidenceView(ev('보증금 20,000,000원'), { aiValue: '20000000', currentValue: '20,000,000' }).edited).toBe(false);
  });
  test('민감정보가 포함된 근거 → 공통 가림 정책으로 표시 (원문 없음)', () => {
    const v = evidenceView(ev('임대인 홍길동 / 주민등록번호 800101-1234567 / 010-1234-5678'), { aiValue: '홍길동' });
    expect(v.quote).toBe('임대인 홍길동 / 주민등록번호 800101-1****** / 010-****-5678');
  });
  test('저장된 계약 수정: 순서가 바뀔 수 있는 결제·주요 날짜 경로에는 근거를 붙이지 않음', () => {
    expect(Object.keys(stableEvidence({ title: ev('계약명'), 'details.landlord': ev('임대인'), 'payments.0.amount': ev('월세'), 'dates.0': ev('입주일') }))).toEqual(['title', 'details.landlord']);
  });
});

describe('등록 확인 모델 — 값마다 근거 문장 · 쪽 · 문서 id', () => {
  test('계약명·당사자·기간·금액·상세 조건 모두 같은 형식의 근거 (문서 번호 → 보관 문서 id)', () => {
    const q = (quote: string, page = 1, file = 1) => ({ evidence_quote: quote, evidence_page: page, evidence_file: file });
    const out = contract({
      cls: { kind: 'lease', subtype: 'housing', domains: ['real_estate'] },
      title: '주택 월세 임대차계약서',
      fields: { counterparty: { value: '김민수', confidence: 'high', ...q('임대인 김민수', 3, 2) }, depositAmount: { value: 20000000, confidence: 'high', ...q('보증금 20,000,000원') } },
      payments: [pay({ kind: 'rent', label: '월세', amount: 850000, day_of_month: 20, ...q('월세 850,000원은 매월 20일', 1, 1) })],
      details: [{ key: 'landlord', text_value: '김민수', number_value: null, boolean_value: null, confidence: 'low', source_type: 'explicit', ...q('임대인(갑) 성명 김민수', 3, 2) }],
    });
    const m = toReviewModel(toAppResult(out, 'openai'), ['doc-1', 'doc-2']);
    expect(m.evidence.counterparty).toEqual({ quote: '임대인 김민수', page: 3, documentId: 'doc-2' });
    expect(m.evidence['details.landlord']).toEqual({ quote: '임대인(갑) 성명 김민수', page: 3, documentId: 'doc-2' });
    expect(m.evidence.depositAmount).toMatchObject({ quote: '보증금 20,000,000원', page: 1, documentId: 'doc-1' });
    expect(m.evidence['payments.0.amount']).toMatchObject({ quote: '월세 850,000원은 매월 20일' });
    expect(m.flagged.has('details.landlord')).toBe(true);
  });
});
