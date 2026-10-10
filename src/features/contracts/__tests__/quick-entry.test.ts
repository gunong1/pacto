/** 직접 입력(빠른 입력) — 계약명·금액·주기·다음 결제일만으로 저장, 결제 일정이 그 날짜 기준으로 만들어진다 */
import { EMPTY_DRAFT, draftToRecord } from '@/data/draft';
import { expandPayment } from '@/domain/schedule';
import { contractFormSchema, draftToForm, formToDraft, quickDirectionAdvice, type ContractFormValues } from '@/features/contracts/form';

const base = (patch: Partial<ContractFormValues> = {}, quick: Partial<NonNullable<ContractFormValues['quick']>> = {}): ContractFormValues => ({
  ...draftToForm({ ...EMPTY_DRAFT, contractType: 'recurring' }),
  // 화면과 같게: 돈의 방향 기본값은 유형별 추천
  quick: { amount: '', direction: quickDirectionAdvice(patch.contractType ?? 'recurring').direction, frequency: 'monthly', nextDate: '', ...quick },
  ...patch,
});

test('유튜브 프리미엄: 월 14,900원 · 다음 결제일 10/12 · 자동갱신 → 저장 가능, 매월 12일 결제', () => {
  const parsed = contractFormSchema.safeParse(base({ title: '유튜브 프리미엄', autoRenewal: true, renewalPeriodMonths: '1' }, { amount: '14,900', nextDate: '261012' }));
  expect(parsed.success).toBe(true);
  const draft = formToDraft(parsed.data!);
  expect(draft.payments).toHaveLength(1);
  expect(draft.payments[0]).toMatchObject({ kind: 'recurring_fee', direction: 'expense', amount: 14900, frequency: 'monthly', dayOfMonth: 12, startsOn: '2026-10-12', obligation: 'confirmed' });
  expect(draft.autoRenewal).toBe(true);
  const record = draftToRecord(draft, 'x', '2026-10-09');
  const dates = expandPayment(record.payments[0], record.contract, { start: '2026-10-01', end: '2027-01-31' }).map((o) => o.date);
  expect(dates).toEqual(['2026-10-12', '2026-11-12', '2026-12-12', '2027-01-12']);
});

test('계약명만 → 결제 없이 저장', () => {
  const parsed = contractFormSchema.safeParse(base({ title: '헬스장' }));
  expect(parsed.success).toBe(true);
  expect(formToDraft(parsed.data!).payments).toEqual([]);
});

test('금액만 있고 다음 결제일 없음 → 다음 결제일 오류 / 날짜만 있고 금액 없음 → 금액 오류', () => {
  const a = contractFormSchema.safeParse(base({ title: '넷플릭스' }, { amount: '17000' }));
  expect(a.success).toBe(false);
  expect(a.error!.issues.map((i) => i.path.join('.'))).toContain('quick.nextDate');
  const b = contractFormSchema.safeParse(base({ title: '넷플릭스' }, { nextDate: '2026-10-20' }));
  expect(b.error!.issues.map((i) => i.path.join('.'))).toContain('quick.amount');
});

test('근로 유형 → 급여(수입), 일시불 → 결제일 하루', () => {
  const salary = formToDraft(contractFormSchema.parse(base({ title: '아르바이트', contractType: 'employment' }, { amount: '1,000,000', nextDate: '2026-10-25' })));
  expect(salary.payments[0]).toMatchObject({ kind: 'salary', direction: 'income', dayOfMonth: 25 });
  const once = formToDraft(contractFormSchema.parse(base({ title: '이사 견적', contractType: 'one_time' }, { amount: '500000', frequency: 'one_time', nextDate: '2026-11-01' })));
  expect(once.payments[0]).toMatchObject({ frequency: 'one_time', dayOfMonth: null, startsOn: '2026-11-01' });
});

test('추가 결제(상세 정보)는 빠른 입력 결제 뒤에 그대로 이어진다', () => {
  const v = base({ title: '정수기' }, { amount: '39,900', nextDate: '2026-10-25' });
  const full = draftToForm({ ...EMPTY_DRAFT, contractType: 'recurring', payments: [{ ...formToDraft(contractFormSchema.parse({ ...v })).payments[0], kind: 'setup_fee', label: '설치비', frequency: 'one_time', amount: 50000, dayOfMonth: null }] });
  const draft = formToDraft(contractFormSchema.parse({ ...v, payments: full.payments }));
  expect(draft.payments.map((p) => p.label)).toEqual(['정기 이용료', '설치비']);
});

test('확인·수정 화면(빠른 입력 없음)은 기존과 같다', () => {
  const v = draftToForm({ ...EMPTY_DRAFT, title: '보험' });
  expect(v.quick).toBeUndefined();
  expect(formToDraft(contractFormSchema.parse(v)).payments).toEqual([]);
});

describe('돈의 방향 — 유형으로 고정하지 않고 사용자가 고른다 (추천만)', () => {
  const save = (contractType: ContractFormValues['contractType'], direction?: 'expense' | 'income' | 'neutral') =>
    formToDraft(contractFormSchema.parse(base({ title: '계약', contractType }, { amount: '1,000,000', frequency: 'one_time', nextDate: '2026-11-01', ...(direction ? { direction } : {}) }))).payments[0];

  test('추천: 근로 → 수입 / 월 납입형·할부·대출·보험 → 지출 (추천 표시) / 매매·용역·임대차 → 역할에 따라 (추천 표시 없음)', () => {
    expect(quickDirectionAdvice('employment')).toMatchObject({ direction: 'income', clear: true });
    for (const t of ['recurring', 'installment', 'loan', 'insurance'] as const) expect(quickDirectionAdvice(t)).toMatchObject({ direction: 'expense', clear: true });
    for (const t of ['sale', 'service', 'lease', 'one_time', 'other'] as const) expect(quickDirectionAdvice(t).clear).toBe(false);
    expect(quickDirectionAdvice('sale').roles).toContain('수입 = 내가 파는(매도) 경우');
  });

  test.each([
    ['sale', 'expense', '매수'],
    ['sale', 'income', '매도'],
    ['service', 'expense', '발주'],
    ['service', 'income', '내가 돈을 받음'],
    ['employment', 'income', '근로자'],
    ['employment', 'expense', '고용주'],
    ['lease', 'expense', '임차인'],
    ['lease', 'income', '임대인'],
    ['lease', 'neutral', '보증금'],
  ] as const)('%s · %s (%s) → 고른 방향 그대로 저장', (type, direction, _who) => {
    expect(save(type, direction).direction).toBe(direction);
  });

  test('매매 수입(매도) → 지출 합계가 아니라 수입 일정', () => {
    const p = save('sale', 'income');
    const record = draftToRecord(formToDraft(contractFormSchema.parse(base({ title: '중고차 매도', contractType: 'sale' }, { amount: '12,000,000', frequency: 'one_time', nextDate: '2026-11-01', direction: 'income' }))), 'x', '2026-10-09');
    expect(p.direction).toBe('income');
    expect(record.payments[0].direction).toBe('income');
  });
});
