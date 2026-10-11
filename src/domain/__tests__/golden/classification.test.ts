/**
 * 계약 종류 분류 golden (결정론 층) — "AI가 이렇게 답했다"고 가정하고, 그 뒤의 서버 검증·저장·표시·일정이
 * 계약 종류를 바꾸지 않는지 확인한다. AI 정확도 자체는 모델 평가 스크립트에서 따로 잰다 (scripts/eval-classification).
 *
 * 원칙
 * - 계약 종류(contract_kind) = 계약의 본질. 결제 방식(주기·방향·의무)은 독립된 값 — 결제가 바뀌어도 종류는 그대로
 * - 서버는 형식·명백한 모순(상세 분류가 다른 종류의 것 등)만 검증한다. 단어로 종류를 뒤집지 않는다
 * - "자동차"는 종류가 아니라 대상(domain) — 자동차보험은 보험 / auto, domains=[vehicle]
 * - 기존 계약(contract_kind 없음)은 자동 변경하지 않고 기존 표시를 유지한다
 * 모든 값은 가짜다.
 */
import { draftToRecord } from '@/data/draft';
import { toReviewModel } from '@/features/registration/extraction';

import { CONTRACT_KIND_CODES, CONTRACT_KIND_DEFS } from '../../../../supabase/functions/_shared/contractRegistry';
import { toAppResult } from '../../../../supabase/functions/_shared/extraction.ts';
import { suggestKind } from '../../categorySuggestion';
import { canRegisterKind, classificationView, kindDisplay, profileFor } from '../../contractKinds';
import { scheduleForRange } from '../../schedule';
import type { Contract } from '../../types';
import { answer, CASES, contract, pay, saas } from './classificationFixtures';

const TODAY = '2026-10-11';
const run = (output: unknown) => {
  const result = toAppResult(output, 'openai');
  const model = toReviewModel(result, ['doc-1']);
  const record = draftToRecord(model.draft, 'c1', TODAY);
  return { result, model, record };
};

describe('1. 사용자에게 보여주는 계약 종류는 13개 (자동차는 종류가 아님)', () => {
  test('계약 종류 정의', () => {
    expect(CONTRACT_KIND_DEFS.map((k) => k.label)).toEqual(['근로', '부동산·임대차', '대출', '보험', '통신', '구독·회원권', '렌탈', '할부', '매매', '용역·프리랜서', '교육', '사업·거래', '기타']);
    expect(CONTRACT_KIND_CODES).not.toContain('vehicle');
  });
});

describe('2. 대표 계약 14종 — AI 답을 서버·앱이 그대로 저장·표시', () => {
  test.each(CASES.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const { result, model, record } = run(c.output);
    expect(result.classification).toMatchObject({ kind: c.kind, subtype: c.subtype });
    if (c.domains) expect(result.classification.domains).toEqual(c.domains);
    expect(model.draft).toMatchObject({ contractKind: c.kind, contractSubtype: c.subtype });
    expect(record.contract).toMatchObject({ contractKind: c.kind, contractSubtype: c.subtype });
    // 하위 호환 값(contract_type·category)은 레지스트리에 적힌 호환값 — 새 코드는 읽지 않는다
    const def = CONTRACT_KIND_DEFS.find((k) => k.code === c.kind)!;
    expect(record.contract).toMatchObject({ contractType: def.legacy.type, category: def.legacy.category });
    expect(kindDisplay(record.contract)).toMatchObject({ label: def.label, legacy: false });
  });
});

describe('3. SaaS (이번 오분류 사례) — 전용 규칙 없이 전체 원칙으로', () => {
  test('"서비스" 단어·매월 청구·초기 설정비가 있어도 구독·회원권 / 소프트웨어·SaaS (용역·렌탈 아님)', () => {
    const { record, model } = run(saas());
    expect(record.contract.contractKind).toBe('subscription_membership');
    expect(kindDisplay(record.contract)).toEqual({ label: '구독·회원권', subtypeLabel: '소프트웨어·SaaS', legacy: false });
    expect(classificationView(model.classification)).toMatchObject({ headline: '구독·회원권 · 소프트웨어·SaaS', confidenceLabel: '신뢰도 높음', showAlternatives: false, needsChoice: false });
    expect(profileFor(record.contract).startLabel).toBe('이용 시작일');
  });
});

describe('4. 결제 구조는 계약 종류와 독립', () => {
  test.each([
    ['월납', { frequency: 'monthly', day_of_month: 25 }, 12],
    ['연납', { frequency: 'yearly', day_of_month: 25, amount: 1944000, label: '연 이용료' }, 1],
    ['기간 전체 일시불', { frequency: 'one_time', role: 'one_time_cashflow', day_of_month: null, date: '2026-11-25', amount: 2160000, label: '이용료(1년 선납)' }, 1],
  ] as const)('SaaS %s → 종류·상세 분류·호환값 그대로, 일정은 결제대로', (_, payment, count) => {
    const { record } = run(saas(payment as Record<string, unknown>));
    expect(record.contract).toMatchObject({ contractKind: 'subscription_membership', contractSubtype: 'software_saas' });
    const fee = record.payments.find((p) => p.label !== '초기 설정비')!;
    const items = scheduleForRange([record], { start: '2026-11-01', end: '2027-10-31' }, TODAY).filter((i) => i.type === 'payment' && i.title.includes(fee.label));
    expect(items).toHaveLength(count);
  });

  test('보험이 월납이든 연납이든 보험, 렌탈이 일시불이어도 렌탈', () => {
    const insurance = CASES.find((c) => c.kind === 'insurance')!.output;
    const monthly = { ...insurance, payments: [pay({ kind: 'premium', label: '월 보험료', amount: 68000 })] };
    expect(run(monthly).record.contract).toMatchObject({ contractKind: 'insurance', contractSubtype: 'auto' });
    const rental = CASES.find((c) => c.subtype === 'appliance')!.output;
    const lump = { ...rental, payments: [pay({ label: '렌탈료(36개월 선납)', amount: 980000, frequency: 'one_time', role: 'one_time_cashflow', day_of_month: null, date: '2026-11-01' })] };
    expect(run(lump).record.contract).toMatchObject({ contractKind: 'rental', contractSubtype: 'appliance' });
  });
});

describe('5. 서버 검증 — 형식·명백한 모순만 (단어로 종류를 뒤집지 않음)', () => {
  const withAnswer = (a: Parameters<typeof answer>[0]) => ({ ...saas(), classification: answer(a) });

  test('상세 분류가 다른 종류의 것이면 상세 분류만 비운다 (종류는 유지)', () => {
    const { result } = run(withAnswer({ kind: 'subscription_membership', subtype: 'vehicle' }));
    expect(result.classification).toMatchObject({ kind: 'subscription_membership', subtype: null });
  });

  test('없는 종류(예: 예전 "자동차")는 기타 + 신뢰도 낮음', () => {
    const { result } = run(withAnswer({ kind: 'vehicle', subtype: null }));
    expect(result.classification).toMatchObject({ kind: 'other', confidence: 'low' });
  });

  test('다른 후보: 주 분류와 같은 값·없는 값은 빼고 최대 2개', () => {
    const { result } = run(withAnswer({ kind: 'rental', subtype: null, confidence: 'low', alternatives: ['rental', 'installment', 'nope', 'sale', 'loan'] }));
    expect(result.classification.alternatives).toEqual(['installment', 'sale']);
  });

  test('대상(domain): 정해진 값만 (자동차 = vehicle)', () => {
    const { result } = run(withAnswer({ kind: 'insurance', subtype: 'auto', domains: ['vehicle', 'spaceship', 'vehicle'] }));
    expect(result.classification.domains).toEqual(['vehicle']);
  });

  test('계약 제목·금액 이름에 다른 종류의 단어가 있어도 AI 답 그대로 (서버가 다시 판단하지 않음)', () => {
    const out = contract({ cls: { kind: 'service', subtype: 'development' }, title: '구독 서비스 렌탈 할부 보험 개발 용역계약', payments: [pay({ label: '월 렌탈 구독료', amount: 100000 })] });
    expect(run(out).result.classification.kind).toBe('service');
  });
});

describe('6. 혼합 계약 — 주 분류 하나 + 함께 포함된 요소, 금액은 독립', () => {
  test('휴대전화 회선 + 단말 할부 → 통신 / secondary 할부, 요금·할부금 둘 다 결제로', () => {
    const out = contract({
      cls: { kind: 'telecom', subtype: 'mobile', domains: ['mobile_device'], secondary: [{ kind: 'installment', note: '단말기 24개월 할부' }, { kind: 'telecom', note: '같은 종류는 무시' }] },
      title: '이동전화 가입 및 단말기 할부 계약서',
      payments: [pay({ label: '월 요금', amount: 69000 }), pay({ kind: 'installment', label: '단말 할부금', amount: 52000, installment_count: 24 })],
    });
    const { result, record } = run(out);
    expect(result.classification).toMatchObject({ kind: 'telecom', secondaryElements: [{ kind: 'installment', note: '단말기 24개월 할부' }] });
    expect(record.payments.map((p) => [p.label, p.amount])).toEqual([['월 요금', 69000], ['단말 할부금', 52000]]);
    expect(record.contract.classification.secondaryElements).toEqual([{ kind: 'installment', note: '단말기 24개월 할부' }]);
  });
});

describe('7. 신뢰도 처리 (등록 확인 화면)', () => {
  const view = (a: Parameters<typeof answer>[0]) => classificationView(run({ ...saas(), classification: answer(a) }).model.classification);

  test('높음: 자동 선택, 다른 가능성 숨김 (같은 값을 다시 보여주지 않음)', () => {
    expect(view({ kind: 'subscription_membership', subtype: 'software_saas', alternatives: ['subscription_membership'] })).toMatchObject({ showAlternatives: false, needsChoice: false, note: null });
  });

  test('보통: 가장 가능성 높은 값 선택 + "○○로 분류했어요 · 변경" + 다른 가능성', () => {
    const v = view({ kind: 'education', subtype: 'online_course', confidence: 'medium', alternatives: ['subscription_membership'] });
    expect(v).toMatchObject({ needsChoice: false, showAlternatives: true, note: '교육으로 분류했어요', alternativeLabels: ['구독·회원권'] });
  });

  test('낮음: 후보 2개 + 이유, 사용자가 고르기 전에는 최종 등록 불가 (고르면 가능)', () => {
    const { model } = run({ ...saas(), classification: answer({ kind: 'rental', subtype: null, confidence: 'low', alternatives: ['installment', 'sale'], reason: '반납 조건과 소유권 이전 조건이 함께 있어요' }) });
    const v = classificationView(model.classification);
    expect(v).toMatchObject({ needsChoice: true, candidates: ['rental', 'installment'], reason: '반납 조건과 소유권 이전 조건이 함께 있어요' });
    expect(canRegisterKind(model.classification, null)).toBe(false);
    expect(canRegisterKind(model.classification, 'installment')).toBe(true);
    // 높음·보통은 고르지 않아도 등록 가능
    expect(canRegisterKind(run(saas()).model.classification, null)).toBe(true);
  });
});

describe('8. 기존 계약 (contract_kind 없음) — 자동 변경하지 않고 기존 표시 유지', () => {
  const legacy = (contractType: Contract['contractType'], category: Contract['category']) =>
    ({ contractKind: null, contractSubtype: null, contractType, category } as unknown as Contract);
  test('예전 "자동차"(월 납입형·자동차)는 그대로 "자동차"로 보인다', () => {
    expect(kindDisplay(legacy('recurring', 'vehicle'))).toEqual({ label: '자동차', subtypeLabel: null, legacy: true });
  });
  test('예전 구독·임대차도 기존 표시 그대로', () => {
    expect(kindDisplay(legacy('recurring', 'subscription')).label).toBe('구독·회원권');
    expect(kindDisplay(legacy('lease', 'real_estate')).label).toBe('부동산·임대차');
  });
});

describe('9. 직접 입력 계약명 추천 — 같은 계약 종류 정의 사용 (확정 아님)', () => {
  test.each([
    ['넷플릭스 프리미엄', 'subscription_membership'],
    ['삼성화재 자동차보험', 'insurance'],
    ['코웨이 정수기', 'rental'],
    ['SKT 요금제', 'telecom'],
    ['필라테스 10회권', 'subscription_membership'],
  ])('%s → %s 추천', (title, kind) => {
    expect(suggestKind(title)?.kind).toBe(kind);
  });
  test('애매하거나 단서가 없으면 추천하지 않음', () => {
    expect(suggestKind('넷플릭스 보험')).toBeNull();
    expect(suggestKind('계약서')).toBeNull();
  });
});
