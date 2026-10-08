/* 날짜 표기 규칙 — 일회성 날짜는 연도까지, 반복 일정은 반복 표현, 상대 표현은 실제 날짜와 함께 */
import { formatDateKo, formatDateLongKo, formatRecurringDayKo, formatRelativeDateKo } from '../dates';
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import { contractFormSchema, draftToForm, formToDraft } from '@/features/contracts/form';
import { actionCandidates } from '../nextAction';

test('A. 일회성 일정 2028-08-20 → 연도 포함', () => {
  expect(formatDateKo('2028-08-20')).toBe('2028. 8. 20.');
  expect(formatDateLongKo('2028-08-20')).toBe('2028년 8월 20일');
});

test('B. 매월 20일 반복 결제 → "매월 20일" (연도 없음)', () => {
  expect(formatRecurringDayKo(20)).toBe('매월 20일');
  expect(formatRecurringDayKo(1, 3)).toBe('매년 3월 1일');
});

test('C. 상대 표현에는 실제 날짜 병기', () => {
  expect(formatRelativeDateKo('2026-10-09', '2026-10-08')).toBe('내일 · 2026. 10. 9.');
  expect(formatRelativeDateKo('2026-10-08', '2026-10-08')).toBe('오늘 · 2026. 10. 8.');
  expect(formatRelativeDateKo('2026-12-01', '2026-10-08')).toBe('2026. 12. 1.');
});

test('D. 장기 계약 (올해 2026 ↔ 일정 2028) → 다음 행동 안내 문장에 연도 누락 없음', () => {
  const form = {
    ...draftToForm({ ...EMPTY_DRAFT, title: '주택 월세 임대차계약서', category: 'real_estate' as never, contractType: 'lease' as never }),
    startDate: '2026-10-20',
    endDate: '2028-10-19',
    terminationNoticeDays: '60',
    noticeKind: 'renewal_decision' as const,
  };
  const record = draftToRecord(formToDraft(contractFormSchema.parse(form)), 'lease', '2026-10-08');
  const notice = actionCandidates(record, '2026-10-08').find((a) => a.date === '2028-08-20')!;
  expect(notice.guidance).toContain('2028년 8월 20일');
  expect(notice.guidance).not.toMatch(/(^|[^0-9년 ])8월 20일/);
});
