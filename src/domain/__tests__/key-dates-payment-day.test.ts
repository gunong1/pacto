/**
 * 주요 날짜에 반복 결제일(월세 지급일 등)을 넣지 않는다 (모든 값은 가짜)
 * 월세 계약: 입주일·잔금일은 주요 날짜, "월세 지급일 매월 5일"은 금액의 결제일(매월 5일)로만
 */
import { rentalOutput } from '../../../supabase/functions/_shared/ai/mockFixtures';
import { toAppResult } from '../../../supabase/functions/_shared/extraction.ts';
import { isRecurringPaymentDay, toReviewModel } from '@/features/registration/extraction';

const q = (quote: string) => ({ evidence_quote: quote, evidence_page: 1, evidence_file: 1 });
const date = (d: string, meaning: string, label: string, quote: string) => ({ date: d, meaning, label, confidence: 'high', source_type: 'explicit', ...q(quote) });

test('월세 지급일(매월 5일)은 주요 날짜가 아님 · 입주일·잔금일은 그대로', () => {
  const base = rentalOutput('주택 월세 임대차계약서');
  const out = {
    ...base,
    dates: [
      ...base.dates,
      date('2024-03-01', 'move_in', '입주일', '입주일 2024년 3월 1일'),
      date('2024-03-05', 'other', '월세 지급일', '월세 지급일 매월 5일 (임차인 명의 계좌로 자동이체)'),
      date('2024-03-20', 'balance_due', '잔금일', '잔금 금 1,000,000원 지급일 2024년 3월 20일'),
    ],
  };
  const m = toReviewModel(toAppResult(out, 'openai'), ['doc-1']);
  const labels = m.draft.dates.map((d) => d.label);
  expect(labels).toEqual(expect.arrayContaining(['입주일', '잔금일']));
  expect(labels).not.toContain('월세 지급일');
});

test('반복 결제일 판별', () => {
  const d = (label: string, quote = '') => ({ label, evidence: quote ? [{ quote, page: 1 }] : [] });
  for (const x of [d('월세 지급일'), d('관리비 납부일'), d('렌탈료 결제일'), d('급여일'), d('기타 날짜', '매월 25일 보험료 자동이체'), d('지급일', '매월 10일 지급')]) expect(isRecurringPaymentDay(x as never)).toBe(true);
  for (const x of [d('입주일', '입주일 2024년 3월 1일'), d('잔금일', '잔금 지급일 2024년 3월 1일'), d('계약금 지급일', '계약금 지급일 2024년 2월 10일'), d('설치일', '설치 예정일 2026년 10월 12일'), d('만기일')]) expect(isRecurringPaymentDay(x as never)).toBe(false);
});
