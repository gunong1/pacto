/** 직접 입력 계약 수정 — 등록과 같은 화면(빠른 입력 + 상세 정보 추가). 불러온 뒤 그대로 저장하면 데이터가 바뀌지 않아야 한다 */
import { EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft } from '@/data/repository';
import { contractFormSchema, draftToQuickForm, formToDraft, quickHasDetails } from '@/features/contracts/form';

const TODAY = '2026-10-11';
const pay = (p: Partial<ContractDraft['payments'][number]>): ContractDraft['payments'][number] => ({
  kind: 'recurring_fee', direction: 'expense', label: '정기 이용료', amount: 14900, frequency: 'monthly', dayOfMonth: 12, monthOfYear: null, startsOn: '2026-03-12', endsOn: null,
  installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null, ...p,
});
const save = (d: ContractDraft, edit: (v: ReturnType<typeof draftToQuickForm>) => void = () => undefined) => {
  const v = draftToQuickForm(d);
  edit(v);
  return formToDraft(contractFormSchema.parse(v), TODAY);
};

test('간단한 계약: 금액·금액 구분·주기·결제일이 위쪽에, 상세 정보는 접힘', () => {
  const d: ContractDraft = { ...EMPTY_DRAFT, title: '유튜브 프리미엄', contractType: 'recurring', payments: [pay({})] };
  const v = draftToQuickForm(d);
  // 시작일이 없는 계약의 기준일은 "첫 결제일 직접 지정"으로 보지 않는다
  expect(v.quick).toMatchObject({ amount: '14,900', direction: 'expense', frequency: 'monthly', day: '12', nextDate: '' });
  expect(v.payments).toEqual([]);
  expect(quickHasDetails(v)).toBe(false);
});

test('그대로 저장 → 결제·이름·첫 결제일(과거 기록)·종료일 모두 그대로', () => {
  const d: ContractDraft = { ...EMPTY_DRAFT, title: '정수기', contractType: 'recurring', payments: [pay({ label: '월 렌탈료', endsOn: '2029-03-11', installmentCount: 36 })] };
  expect(save(d).payments).toEqual(d.payments);
});

test('결제일만 12일 → 20일: 첫 결제 달(2026-03)은 유지 → 지난 결제 기록이 사라지지 않음 · 이름 유지', () => {
  const out = save({ ...EMPTY_DRAFT, title: '정수기', contractType: 'recurring', payments: [pay({ label: '월 렌탈료' })] }, (v) => (v.quick!.day = '20'));
  // 기준일(2026-03-12)은 그대로 → 첫 결제는 2026-03-20 (지난 기록 유지)
  expect(out.payments[0]).toMatchObject({ label: '월 렌탈료', dayOfMonth: 20, startsOn: '2026-03-12', amount: 14900 });
});

test('금액·금액 구분 수정 → 그 값만 바뀜', () => {
  const out = save({ ...EMPTY_DRAFT, title: '중고차', contractType: 'sale', payments: [pay({ kind: 'other', label: '매매 대금', frequency: 'one_time', dayOfMonth: null, startsOn: '2026-11-20' })] }, (v) => {
    v.quick!.amount = '12,500,000';
    v.quick!.direction = 'income';
  });
  expect(out.payments[0]).toMatchObject({ kind: 'other', label: '매매 대금', amount: 12500000, direction: 'income', frequency: 'one_time', startsOn: '2026-11-20' });
});

test('매월 → 분기: 결제일 그대로, 첫 결제일을 직접 지정하면 그 날짜부터', () => {
  const out = save({ ...EMPTY_DRAFT, title: '회비', contractType: 'recurring', payments: [pay({})] }, (v) => {
    v.quick!.frequency = 'quarterly';
    v.quick!.day = '1';
    v.quick!.nextDate = '2026-12-01';
  });
  expect(out.payments[0]).toMatchObject({ frequency: 'quarterly', startsOn: '2026-12-01', dayOfMonth: 1, monthOfYear: null });
});

test('추가 결제·상대방·주요 날짜가 있는 계약 → 상세 정보 펼침, 추가 결제는 "추가 결제"에 그대로 · 두 결제 모두 그대로', () => {
  const setup = pay({ kind: 'setup_fee', label: '설치비', amount: 50000, frequency: 'one_time', dayOfMonth: null, startsOn: '2026-03-02' });
  const d: ContractDraft = { ...EMPTY_DRAFT, title: '정수기', contractType: 'recurring', counterparty: '가짜렌탈', payments: [setup, pay({ label: '월 렌탈료' })], dates: [{ kind: 'installation', label: '설치일', date: '2026-03-02' }] };
  const v = draftToQuickForm(d);
  expect(v.quick?.amount).toBe('14,900'); // 대표 결제 = 첫 정기 결제
  expect(v.payments.map((p) => p.label)).toEqual(['설치비']);
  expect(quickHasDetails(v)).toBe(true);
  const out = save(d);
  expect(out.payments.map((p) => p.label).sort()).toEqual(['설치비', '월 렌탈료']);
  expect(out.payments.find((p) => p.label === '설치비')).toEqual(setup);
  expect(out.counterparty).toBe('가짜렌탈');
  expect(out.dates).toEqual(d.dates);
});

test('결제가 없는 계약 → 금액 비어 있음, 유형 추천 구분 · 그대로 저장하면 결제 없음', () => {
  const d: ContractDraft = { ...EMPTY_DRAFT, title: '근로계약', contractType: 'employment' };
  expect(draftToQuickForm(d).quick).toMatchObject({ amount: '', direction: 'income', frequency: 'monthly' });
  expect(save(d).payments).toEqual([]);
});

test('상세 정보 판단: 통보기한·보증금·유형별 속성만 있어도 펼침', () => {
  expect(quickHasDetails(draftToQuickForm({ ...EMPTY_DRAFT, title: 'x', terminationNoticeDays: 30 }))).toBe(true);
  expect(quickHasDetails(draftToQuickForm({ ...EMPTY_DRAFT, title: 'x', depositAmount: 1000000 }))).toBe(true);
});

test('첫 결제일 없이 계약 시작일을 따르던 결제 → 수정해도 시작일 기준 유지 (시작일을 바꾸면 결제도 따라감)', () => {
  const d: ContractDraft = { ...EMPTY_DRAFT, title: '정수기', contractType: 'recurring', startDate: '2026-10-12', payments: [pay({ label: '월 렌탈료', startsOn: null, dayOfMonth: 12 })] };
  expect(save(d).payments).toEqual(d.payments);
  const moved = save(d, (v) => (v.startDate = '2026-10-15'));
  expect(moved.startDate).toBe('2026-10-15');
  expect(moved.payments[0]).toMatchObject({ startsOn: null, dayOfMonth: 12 });
  // 리팩터링 D: 결제일(일)이 비어 있던 결제 → 시작일의 날짜로 채우지 않고 빈칸 (결제일을 입력해야 저장 · 입력한 날이 결제일)
  const noDay: ContractDraft = { ...d, payments: [pay({ startsOn: null, dayOfMonth: null })] };
  expect(draftToQuickForm(noDay).quick?.day).toBe('');
  expect(contractFormSchema.safeParse(draftToQuickForm(noDay)).success).toBe(false);
  expect(save(noDay, (v) => (v.quick!.day = '20')).payments[0]).toMatchObject({ startsOn: null, dayOfMonth: 20 });
  // 일시불도 같음
  const once: ContractDraft = { ...d, contractType: 'one_time', payments: [pay({ frequency: 'one_time', startsOn: null, dayOfMonth: null })] };
  expect(save(once).payments).toEqual(once.payments);
});

test('첫 결제일 직접 지정 → 그 날짜부터 (진행 회차 기준) / 시작일이 있는 계약에서 직접 지정을 비우면 시작일 기준으로', () => {
  const withStart: ContractDraft = { ...EMPTY_DRAFT, title: '대출', contractType: 'loan', startDate: '2026-01-10', payments: [pay({ startsOn: '2026-02-15', dayOfMonth: 15 })] };
  const v = draftToQuickForm(withStart);
  expect(v.quick?.nextDate).toBe('2026-02-15');
  expect(quickHasDetails(v)).toBe(true); // 직접 지정한 값이 있으면 상세 정보 펼침
  expect(save(withStart, (x) => (x.quick!.nextDate = '')).payments[0]).toMatchObject({ startsOn: null, dayOfMonth: 15 });
  const d = save({ ...EMPTY_DRAFT, title: '대출', contractType: 'loan', payments: [pay({})] }, (v) => {
    v.quick!.nextDate = '2026-01-15';
    v.quick!.day = '15';
  });
  expect(d.payments[0]).toMatchObject({ startsOn: '2026-01-15', dayOfMonth: 15 });
});

test('구성항목: 불러오기 → 추가·삭제 → 저장 (금액·일정은 그대로, 구성항목만 바뀜)', () => {
  const d: ContractDraft = { ...EMPTY_DRAFT, title: '근로', contractType: 'employment', startDate: '2026-08-01', payments: [pay({ kind: 'salary', direction: 'income', label: '급여', amount: 1_270_000, dayOfMonth: 31, startsOn: null, components: [{ label: '기본급', amount: 1_200_000 }] })] };
  expect(draftToQuickForm(d).quick?.components).toEqual([{ label: '기본급', amount: 1_200_000 }]);
  const out = save(d, (v) => (v.quick!.components = [...v.quick!.components!, { label: '식대·수당', amount: 70_000 }]));
  expect(out.payments).toHaveLength(1);
  expect(out.payments[0]).toMatchObject({ label: '급여', amount: 1_270_000, components: [{ label: '기본급', amount: 1_200_000 }, { label: '식대·수당', amount: 70_000 }] });
  expect(save(d, (v) => (v.quick!.components = [])).payments[0].components).toEqual([]);
});

test('지급일·결제일이 휴일이면: 수정 화면에 저장된 값 그대로 · 바꿔 저장하면 그 값만 바뀜', () => {
  const d: ContractDraft = { ...EMPTY_DRAFT, title: '카페 아르바이트', contractType: 'employment', contractKind: 'employment', payments: [pay({ kind: 'salary', direction: 'income', label: '급여', dayOfMonth: 25, businessDayRule: 'previous' })] };
  expect(draftToQuickForm(d).quick?.businessDayRule).toBe('previous');
  expect(save(d).payments).toEqual(d.payments);
  const changed = save(d, (v) => (v.quick!.businessDayRule = 'next'));
  expect(changed.payments).toEqual([{ ...d.payments[0], businessDayRule: 'next' }]);
});

test('새로 입력: 휴일 규칙을 고르면 저장 · 고르지 않으면 그날 그대로', () => {
  const base = draftToQuickForm({ ...EMPTY_DRAFT, title: '급여', contractType: 'employment', contractKind: 'employment' });
  const withRule = { ...base, quick: { ...base.quick!, amount: '1,000,000', direction: 'income' as const, day: '25', businessDayRule: 'previous' as const } };
  expect(formToDraft(contractFormSchema.parse(withRule), TODAY).payments[0].businessDayRule).toBe('previous');
  const without = { ...base, quick: { ...base.quick!, amount: '1,000,000', direction: 'income' as const, day: '25' } };
  expect(formToDraft(contractFormSchema.parse(without), TODAY).payments[0].businessDayRule).toBe('none');
});
