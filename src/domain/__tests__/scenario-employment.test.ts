/**
 * 기준 시나리오: 근로계약서 (주식회사 네오링크 · 박민준) — 의미를 이해한 뒤의 관리 데이터
 * 계약기간 2026-10-01 ~ 2027-09-30 / 월 임금 3,600,000 (기본급 3,280,000 + 고정연장근로수당 320,000)
 * 매월 25일 지급, 휴일이면 직전 영업일 / 수습 3개월, 수습 중 월 임금의 90% / 자동갱신 아님(별도 협의)
 * 자진 퇴직 시 30일 전 통보 = 조건부 의무 (계약 종료일 기준 통보기한이 아님)
 */
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft } from '@/data/repository';
import { adjustToBusinessDay, isBusinessDay } from '@/domain/businessDays';
import { coreInfo, otherDetails } from '@/domain/coreInfo';
import { attentionItems, nextAction } from '@/domain/nextAction';
import { scheduleForRange } from '@/domain/schedule';
import { monthSpending } from '@/domain/spending';
import { terminationNoticeDeadline } from '@/domain/status';

const TODAY = '2026-10-06';

const draft: ContractDraft = {
  ...EMPTY_DRAFT,
  title: '근로계약서',
  category: 'employment',
  contractType: 'employment',
  counterparty: '주식회사 네오링크',
  contractDate: '2026-09-25',
  startDate: '2026-10-01',
  endDate: '2027-09-30',
  autoRenewal: false,
  // 잘못 분석돼 "30일"이 들어와도 근로계약(갱신 통보를 관리하지 않는 유형)에서는 종료일 기준 통보기한을 만들지 않는다
  terminationNoticeDays: 30,
  details: { employeeName: '박민준', employmentKind: 'fixed_term', probationMonths: 3, probationPayRate: 90, renewalTerms: '업무평가·조직운영 상황·당사자 협의로 별도 결정' },
  valueSources: { 'details.employmentKind': 'inferred' },
  payments: [
    {
      kind: 'salary', direction: 'income', label: '월 임금', amount: 3_600_000, frequency: 'monthly', dayOfMonth: 25, monthOfYear: null,
      startsOn: null, endsOn: null, installmentCount: null, isVariable: false, businessDayRule: 'previous', obligation: 'confirmed', conditionNote: null,
      components: [{ label: '기본급', amount: 3_280_000 }, { label: '고정연장근로수당', amount: 320_000 }],
    },
  ],
};
const r = draftToRecord(draft, 'job', TODAY);
const on = (d: string) => scheduleForRange([r], { start: d, end: d }, TODAY).map((i) => `${i.title}${i.amount != null ? ` ${i.amount}` : ''}`);
const month = (y: number, m: number) => monthSpending([r], { year: y, month: m });
const core = Object.fromEntries(coreInfo(r, TODAY).map((x) => [x.label, x]));

describe('영업일', () => {
  test('주말·고정 공휴일 → 직전 영업일', () => {
    expect(isBusinessDay('2026-10-25')).toBe(false); // 일요일
    expect(adjustToBusinessDay('2026-10-25', 'previous')).toBe('2026-10-23');
    expect(adjustToBusinessDay('2026-12-25', 'previous')).toBe('2026-12-24'); // 성탄절(금)
    expect(adjustToBusinessDay('2026-11-25', 'previous')).toBe('2026-11-25');
    expect(adjustToBusinessDay('2026-10-25', 'none')).toBe('2026-10-25');
  });
});

describe('근로계약 회귀 (요청 12항목 중 도메인 부분)', () => {
  test('2·11. 월 임금 한 건만 수입 — 구성 항목(고정연장근로수당)은 합산하지 않음', () => {
    expect(r.payments).toHaveLength(1);
    expect(month(2027, 1)).toMatchObject({ incomeTotal: 3_600_000, total: 0 });
  });

  test('3. 수습기간(10~12월) 급여 3,240,000원, 이후 3,600,000원', () => {
    expect(month(2026, 10).incomeTotal).toBe(3_240_000);
    expect(month(2026, 11).incomeTotal).toBe(3_240_000);
    expect(month(2026, 12).incomeTotal).toBe(3_240_000);
    expect(month(2027, 1).incomeTotal).toBe(3_600_000);
  });

  test('4. 수습 종료 예정 2026-12-31 (입사일부터 3개월)', () => {
    expect(on('2026-12-31')).toEqual(['수습기간 종료 예정']);
    expect(core['수습기간'].value).toBe('2026. 10. 1. ~ 2026. 12. 31. (3개월)');
    expect(core['수습기간'].source).toBe('calculated');
  });

  test('5. 휴일 급여일 → 실제 지급 예정일 (10/25 일요일 → 10/23, 12/25 성탄절 → 12/24)', () => {
    expect(on('2026-10-25')).toEqual([]);
    expect(on('2026-10-23')).toEqual(['월 임금 (수습기간 90%) 3240000']);
    expect(on('2026-12-24')).toEqual(['월 임금 (수습기간 90%) 3240000']);
    expect(on('2027-01-25')).toEqual(['월 임금 3600000']);
  });

  test('6·12. 2027-08-31 퇴직 통보기한을 만들지 않고, 다음 행동에도 올리지 않음', () => {
    expect(terminationNoticeDeadline(r.contract, TODAY)).toBeNull();
    expect(on('2027-08-31')).toEqual([]);
    expect(nextAction(r, TODAY)).toMatchObject({ kind: 'payment', label: '다음 지급', date: '2026-10-23' });
    expect(attentionItems([r], TODAY)).toEqual([]);
  });

  test('7. 자동갱신 아님 · 갱신은 별도 협의, 계약 종료일은 일정으로 유지', () => {
    expect(core['갱신'].value).toBe('업무평가·조직운영 상황·당사자 협의로 별도 결정');
    expect(on('2027-09-30')).toEqual(['근로계약 종료']);
    expect(on('2026-09-25')).toEqual([]); // 체결일은 기록용
  });

  test('1·10. 연봉은 없음(만들지 않음), AI 추정·PACTO 계산 값 구분', () => {
    expect(core['연봉']).toBeUndefined();
    expect(core['고용 형태']).toMatchObject({ value: '계약직', source: 'inferred' });
    expect(core['수습기간 월 임금']).toMatchObject({ value: '+3,240,000원 (2026. 10. 1. ~ 2026. 12. 31.)', source: 'calculated' });
    expect(core['월 임금 구성'].value).toBe('기본급 3,280,000원 + 고정연장근로수당 320,000원');
    expect(core['다음 지급 예정']).toMatchObject({ value: '2026. 10. 23. (금) · +3,240,000원', source: 'calculated' });
    expect(core['월 임금'].value).toBe('+3,600,000원 · 매월 25일 (휴일이면 직전 영업일)');
  });
});

test('계약 조건 · 기록: 핵심 정보에 이미 반영된 수습·갱신 조건은 중복 표시하지 않고, 비율은 "연"을 붙이지 않음', () => {
  const labels = otherDetails(r).map((x) => x.label);
  expect(labels).not.toContain('수습기간');
  expect(labels).not.toContain('수습기간 임금 비율');
  expect(labels).not.toContain('갱신 관련 조건');
  const noSalary = draftToRecord({ ...draft, payments: [] }, 'x', TODAY);
  expect(otherDetails(noSalary).find((x) => x.label === '수습기간 임금 비율')?.value).toBe('90%');
});
