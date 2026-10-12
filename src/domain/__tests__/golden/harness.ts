/**
 * Golden 테스트 하네스 — 모델 출력 → 서버 정리(toAppResult) → 등록 확인 초안(toReviewModel) → 저장 레코드 → 일정·지출.
 * 리팩터링 중 내부 구조가 바뀌어도 "사용자가 보는 결과"로 비교할 수 있게, 화면·DB·캘린더에 나오는 값만 꺼낸다.
 * 사용자는 등록 확인 화면을 그대로 저장한다고 가정한다 (금액이 비워진 결제는 사용자가 채우기 전이라 저장 결과에서 뺀다).
 * role: 등록 확인 화면의 "이 계약에서 누구세요?"에서 사용자가 확정한 역할 (없으면 역할 미확정 — 역할에 따라 방향이 달라지는 금액은 확인 필요)
 */
import { draftToRecord } from '@/data/draft';
import { toReviewModel } from '@/features/registration/extraction';
import { withConfirmedRole } from '@/domain/cashflow';

import { toAppResult } from '../../../../supabase/functions/_shared/extraction.ts';
import { groupCalendarItems } from '../../calendarGroups';
import { scheduleForRange } from '../../schedule';
import { monthSpending } from '../../spending';
import type { ContractRecord, ISODate } from '../../types';

export const TODAY: ISODate = '2026-10-11';

export interface Observed {
  type: string;
  category: string;
  /** 결제 (금액 섹션) — 확정·선택형. 금액이 비워진 결제는 amount null */
  payments: { label: string; amount: number | null; direction: string; frequency: string; day: number | null; obligation: string; components: string[] }[];
  /** 결제로 저장되지만 확정·선택형이 아닌 금액 (조건부·발생 가능·참고) — 최종 목표: 없음 */
  nonCashPayments: { label: string; obligation: string }[];
  startDate: string | null;
  endDate: string | null;
  keyDates: { kind: string; label: string; date: string }[];
  checks: { topic: string; title: string; amount: number | null }[];
  references: { label: string; amount: number; role: string }[];
  /** 계약 요약 칸 — 총액은 여기 한 곳에 (보증금 · 계약 총액) */
  summary: { deposit: number | null; total: number | null };
  autoRenewal: boolean;
  terminationNoticeDays: number | null;
  /** 자동으로 채워진 중도해지·위약금 글 (최종 목표: 없음 — 계약 체크에만) */
  terms: { early: string | null; penalty: string | null };
  /** "확인 필요" 표시 경로 */
  flagged: string[];
  record: ContractRecord;
}

export function observe(output: unknown, role: string | null = null): Observed {
  const result = toAppResult(output, 'openai');
  const m = toReviewModel(result, ['doc-1']);
  const d = role ? withConfirmedRole(m.draft, role) : m.draft;
  const blank = new Set(m.blankAmounts);
  const cash = (o: string) => o === 'confirmed' || o === 'optional';
  const payments = d.payments
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => cash(p.obligation))
    .map(({ p, i }) => ({
      label: p.label,
      amount: blank.has(i) ? null : p.amount,
      direction: p.direction,
      frequency: p.frequency,
      day: p.dayOfMonth,
      obligation: p.obligation,
      components: p.components.map((c) => c.label),
    }));
  // 저장: 비워진 금액은 사용자가 채우기 전이므로 빼고 저장
  const saved = { ...d, payments: d.payments.filter((_, i) => !blank.has(i)) };
  const record = draftToRecord(saved, 'c1', TODAY);
  return {
    type: d.contractType,
    category: d.category,
    payments,
    nonCashPayments: d.payments.filter((p) => !cash(p.obligation)).map((p) => ({ label: p.label, obligation: p.obligation })),
    startDate: d.startDate,
    endDate: d.endDate,
    keyDates: d.dates.map((x) => ({ kind: x.kind, label: x.label, date: x.date })),
    checks: m.checks.map((c) => ({ topic: c.topic, title: c.title, amount: (c as { amount?: number | null }).amount ?? null })),
    references: m.references.map((r) => ({ label: r.label, amount: r.amount, role: r.role })),
    summary: { deposit: d.depositAmount, total: d.totalAmount },
    autoRenewal: d.autoRenewal,
    terminationNoticeDays: d.terminationNoticeDays,
    terms: { early: d.earlyTerminationTerms ?? null, penalty: d.penaltyTerms ?? null },
    flagged: [...m.flagged].sort(),
    record,
  };
}

/** 기간 안의 일정 — "날짜 종류 제목 금액" */
export function schedule(o: Observed, start: ISODate, end: ISODate): string[] {
  return scheduleForRange([o.record], { start, end }, TODAY).map((i) => `${i.date} ${i.type} ${i.title}${i.amount != null ? ` ${i.amount}` : ''}`);
}

/** 그 달 홈 요약 (총 출금 · 총 입금 · 방향 확인 필요) */
export function month(o: Observed, year: number, m: number) {
  const s = monthSpending([o.record], { year, month: m });
  return { expense: s.total, income: s.incomeTotal, neutral: s.undeterminedTotal };
}

/** 그 달 출금 구분 (일반 지출 · 보증금 지급) */
export function outflow(o: Observed, year: number, m: number) {
  const s = monthSpending([o.record], { year, month: m });
  return { total: s.total, ordinary: s.ordinaryExpense, deposit: s.depositOut };
}

/** 그 날 캘린더 카드 (같은 계약 + 같은 날짜는 카드 하나) */
export function calendarCards(o: Observed, day: ISODate): (string | null)[] {
  return groupCalendarItems(scheduleForRange([o.record], { start: day, end: day }, TODAY)).map((g) => g.primary?.label ?? null);
}
