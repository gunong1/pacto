/**
 * 계약 당사자 역할 golden (3단계) — 모든 이름·번호는 가짜다.
 *
 * 원칙
 * - 역할 이름은 레지스트리(PARTY_ROLE_DEFS) 한 곳: AI 결과 · 등록 확인 · 수정 · 상세 · 목록이 같은 규칙 (src/domain/parties.ts)
 * - 계약서에 있는 당사자만. 한쪽만 찾았으면 다른 쪽은 비워 두고 "확인 필요" (다른 쪽 이름으로 채우지 않음)
 * - 사용자가 어느 쪽인지는 추측하지 않는다 (기본 모름)
 * - 예전 계약: counterparty를 지우거나 역할로 바꾸지 않고 "계약 상대방"으로
 * - 이름도 공통 민감정보 가림 정책을 따른다
 */
import { draftToRecord, EMPTY_DRAFT } from '@/data/draft';
import { contractFormSchema, draftToForm, formToDraft } from '@/features/contracts/form';
import { toReviewModel } from '@/features/registration/extraction';

import { filterOutputByPages } from '../../../../supabase/functions/_shared/documentGate.ts';
import { toAppResult } from '../../../../supabase/functions/_shared/extraction.ts';
import { coreInfo } from '../../coreInfo';
import { partyRows, partyRowText, partySearchText, partySummary } from '../../parties';
import { contract, pay } from './classificationFixtures';

const TODAY = '2026-10-08';
const party = (role: string, name: string, quote: string | null = `${name}`, confidence = 'high') => ({ role, name, confidence, evidence_quote: quote, evidence_page: quote ? 1 : null, evidence_file: quote ? 1 : null });
const lease = (parties: unknown[]) => ({
  ...contract({ cls: { kind: 'lease', subtype: 'housing', domains: ['real_estate'] }, title: '주택 월세 임대차계약서', payments: [pay({ kind: 'rent', label: '월세', amount: 850000, day_of_month: 20, evidence_quote: '월세 850,000원' })] }),
  parties,
});
/** 분석 → 확인 화면 → 저장된 계약 (같은 규칙을 거치는 전체 흐름) */
const run = (output: unknown) => {
  const result = toAppResult(output, 'openai');
  const model = toReviewModel(result, ['doc-1']);
  const record = draftToRecord(model.draft, 'c1', TODAY);
  const rows = partyRows(record.contract);
  return { result, model, record, rows, text: rows.map((r) => `${r.label} ${partyRowText(r)}`) };
};

describe('Golden 1~7', () => {
  test('1. 임대인·임차인 모두 있음 → "임대인 김민수 / 임차인 박지훈", 확인 필요 없음', () => {
    const r = run(lease([party('lessor', '김민수', '임대인 성명 김민수'), party('lessee', '박지훈', '임차인 성명 박지훈')]));
    expect(r.result.parties.map((p) => [p.role, p.name])).toEqual([['lessor', '김민수'], ['lessee', '박지훈']]);
    expect(r.text).toEqual(['임대인 김민수', '임차인 박지훈']);
    expect([...r.model.flagged].filter((p) => p.startsWith('parties'))).toEqual([]);
    // 근거는 역할별 경로에 (계약서 근거 보기)
    expect(r.model.evidence['parties.lessor']?.quote).toBe('임대인 성명 김민수');
    // 상대방 한 칸(사용자 쪽 가정)은 쓰지 않는다
    expect(r.record.contract.counterparty).toBeNull();
    // 상세 기본 정보도 같은 행
    expect(coreInfo(r.record, TODAY).filter((x) => x.key.startsWith('party:')).map((x) => [x.label, x.value])).toEqual([['임대인', '김민수'], ['임차인', '박지훈']]);
  });

  test('2. 한쪽만 있음 → 다른 쪽은 비워 두고 "확인 필요" (임의로 채우지 않음)', () => {
    const r = run(lease([party('lessor', '김민수', '임대인 김민수')]));
    expect(r.record.contract.parties).toEqual([{ role: 'lessor', name: '김민수' }]);
    expect(r.text).toEqual(['임대인 김민수', '임차인 확인 필요']);
    expect(r.rows.find((x) => x.role === 'lessee')).toMatchObject({ missing: true, names: [] });
    expect(r.model.flagged.has('parties.lessee')).toBe(true);
    expect(r.model.flagged.has('parties.lessor')).toBe(false);
    const core = coreInfo(r.record, TODAY).find((x) => x.key === 'party:lessee');
    expect(core).toMatchObject({ value: '확인 필요', needsReview: true });
    // 폼에서도 빈칸 (다른 쪽 이름이 들어가지 않음)
    expect(draftToForm(r.model.draft).parties).toEqual({ lessor: '김민수' });
  });

  test('3. 공동 임대인·공동 임차인 → 한 역할에 여러 이름, 수정 화면 왕복에도 각각 보존', () => {
    const r = run(lease([party('lessor', '김민수'), party('lessor', '최영희'), party('lessee', '박지훈'), party('lessee', '이수진'), party('lessee', '이수진')]));
    expect(r.text).toEqual(['임대인 김민수, 최영희', '임차인 박지훈, 이수진']);
    const form = draftToForm(r.model.draft);
    expect(form.parties).toEqual({ lessor: '김민수, 최영희', lessee: '박지훈, 이수진' });
    expect(formToDraft(form as never).parties).toEqual([
      { role: 'lessor', name: '김민수' },
      { role: 'lessor', name: '최영희' },
      { role: 'lessee', name: '박지훈' },
      { role: 'lessee', name: '이수진' },
    ]);
  });

  test('4. 법인 당사자 → 회사명 그대로 (가리지 않음 — 민감정보가 아님)', () => {
    const r = run(lease([party('lessor', '주식회사 가짜부동산', '임대인: 주식회사 가짜부동산 (대표이사 김민수)'), party('lessee', '박지훈')]));
    expect(r.text).toEqual(['임대인 주식회사 가짜부동산', '임차인 박지훈']);
  });

  test('5. 사용자 역할 모름 → 내 역할 없음(기본 모름), 목록은 양쪽을 역할과 함께', () => {
    const r = run(lease([party('lessor', '김민수'), party('lessee', '박지훈')]));
    expect(r.record.contract.userPartyRole).toBeNull();
    expect(r.rows.some((x) => x.isUser)).toBe(false);
    expect(draftToForm(r.model.draft).userPartyRole).toBe('');
    expect(partySummary(r.record.contract)).toBe('임대인 김민수 · 임차인 박지훈');
    // 사용자가 고른 경우에만 상대 쪽 이름 + (나)
    const mine = { ...r.record.contract, userPartyRole: 'lessee' };
    expect(partySummary(mine)).toBe('김민수');
    expect(coreInfo({ ...r.record, contract: mine }, TODAY).find((x) => x.key === 'party:lessee')?.label).toBe('임차인 (나)');
  });

  test('6. 이름이 예전 필드(counterparty)에만 있음 → 역할을 추측하지 않고 "계약 상대방", 확인 필요 행 없음, 값 유지', () => {
    const old = draftToRecord({ ...EMPTY_DRAFT, title: '예전 임대차', contractKind: 'lease', contractType: 'lease', category: 'real_estate', counterparty: '홍길동' }, 'c-old', TODAY);
    expect(partyRows(old.contract).map((x) => [x.label, partyRowText(x), x.role])).toEqual([['계약 상대방', '홍길동', null]]);
    expect(partySummary(old.contract)).toBe('홍길동');
    expect(partySearchText(old.contract)).toContain('홍길동');
    // 수정 화면 왕복: counterparty 그대로, 당사자 목록을 만들지 않음
    const back = formToDraft(draftToForm({ ...EMPTY_DRAFT, ...old.contract, payments: [], dates: [] }) as never);
    expect([back.counterparty, back.parties]).toEqual(['홍길동', []]);
    // 역할이 이름에 붙은 예전 칸(임대인)은 그 역할로 — 이름이 같으면 두 번 보이지 않음
    const withLandlord = { ...old.contract, details: { landlord: '홍길동', tenant: '박지훈' } };
    expect(partyRows(withLandlord).map((x) => `${x.label} ${partyRowText(x)}`)).toEqual(['임대인 홍길동', '임차인 박지훈']);
  });

  test('7. 보험 — 역할 3개 이상 (보험회사·계약자·피보험자·수익자) 레지스트리 순서', () => {
    const r = run({
      ...contract({ cls: { kind: 'insurance', subtype: 'life' }, title: '종신보험 계약', payments: [pay({ kind: 'premium', label: '보험료', amount: 120000, evidence_quote: '월 보험료 120,000원' })] }),
      parties: [party('beneficiary', '이수진'), party('insured', '박지훈'), party('insurer', '가짜생명보험(주)'), party('policyholder', '박지훈')],
    });
    expect(r.text).toEqual(['보험회사 가짜생명보험(주)', '계약자 박지훈', '피보험자 박지훈', '수익자 이수진']);
  });
});

describe('정리 규칙 · 하위 호환 · 보안', () => {
  test('모르는 역할 코드 → 당사자, 다른 종류의 역할은 계약서가 밝힌 이름 그대로 (잘못된 역할로 바꾸지 않음)', () => {
    const r = run(lease([party('lessor', '김민수'), party('lessee', '박지훈'), party('landlord_agent', '최중개'), party('guarantor', '정보증')]));
    expect(r.result.parties.map((p) => p.role)).toEqual(['lessor', 'lessee', 'party', 'guarantor']);
    expect(r.text).toEqual(['임대인 김민수', '임차인 박지훈', '당사자 최중개', '보증인 정보증']);
  });

  test('예전 당사자 칸(details 근로자)에 온 이름 → 근로자 당사자 (칸 이름이 곧 역할), parties에 이미 있으면 덮지 않음', () => {
    const emp = (parties: unknown[]) =>
      run({
        ...contract({
          cls: { kind: 'employment', subtype: 'fixed_term' },
          title: '근로계약서',
          payments: [pay({ kind: 'salary', direction: 'income', label: '월 급여', amount: 3000000, evidence_quote: '월 급여 3,000,000원' })],
          details: [{ key: 'employee_name', text_value: '박민준', number_value: null, boolean_value: null, confidence: 'high', source_type: 'explicit', evidence_quote: '근로자: 박민준', evidence_page: 1, evidence_file: 1 }],
        }),
        parties,
      });
    expect(emp([party('employer', '주식회사 가짜회사')]).text).toEqual(['사용자(고용주) 주식회사 가짜회사', '근로자 박민준']);
    expect(emp([party('employer', '주식회사 가짜회사'), party('employee', '김근로')]).text).toEqual(['사용자(고용주) 주식회사 가짜회사', '근로자 김근로']);
  });

  test('빈칸·서명란 표시는 이름이 아님 → 넣지 않음 (그 역할은 확인 필요)', () => {
    const r = run(lease([party('lessor', '김민수'), party('lessee', '(인)')]));
    expect(r.result.parties.map((p) => p.name)).toEqual(['김민수']);
    expect(r.model.flagged.has('parties.lessee')).toBe(true);
  });

  test('근거 문장이 없으면 신뢰도 낮음 → 확인 필요', () => {
    const r = run(lease([party('lessor', '김민수', null), party('lessee', '박지훈')]));
    expect(r.result.parties[0].confidence).toBe('low');
    expect(r.model.flagged.has('parties.lessor')).toBe(true);
  });

  test('이름 칸에 섞인 연락처·주민번호는 공통 정책으로 가림 (결과·화면 어디에도 원문 없음)', () => {
    const r = run(lease([party('lessor', '김민수 010-1234-5678', '임대인 김민수 010-1234-5678 주민등록번호 800101-1234567'), party('lessee', '박지훈')]));
    const all = JSON.stringify([r.result.parties, r.model.draft.parties, r.model.evidence, r.text]);
    expect(all).not.toContain('1234-5678');
    expect(all).not.toContain('1234567');
    expect(r.text[0]).toMatch(/^임대인 김민수 010-\*{4}-5678$/);
  });

  test('계약과 무관한 쪽에서 온 당사자는 쪽 제외 시 지운다', () => {
    const out = lease([party('lessor', '김민수'), { ...party('lessee', '메모속이름'), evidence_file: 2 }]);
    const { output, removed } = filterOutputByPages(out, [{ file: 2, page: null }]);
    expect(removed).toBe(1);
    expect((output as { parties: { name: string }[] }).parties.map((p) => p.name)).toEqual(['김민수']);
  });

  test('이전 버전 분석 결과(parties 없음) → 예전처럼 상대방 이름, 당사자 확인 필요 표시 없음', () => {
    const result = toAppResult(contract({ cls: { kind: 'lease', subtype: 'housing' }, title: '임대차', fields: { counterparty: { value: '김민수', confidence: 'high', evidence_quote: '임대인 김민수', evidence_page: 1, evidence_file: 1 } } }), 'openai');
    const { parties: _omit, ...v13 } = result;
    const model = toReviewModel(v13 as never, ['doc-1']);
    expect(model.draft.counterparty).toBe('김민수');
    expect(model.draft.parties).toEqual([]);
    expect([...model.flagged].filter((p) => p.startsWith('parties'))).toEqual([]);
  });

  test('한쪽 칸이 비어 있어도(값 없음) 폼 검증을 통과해 저장할 수 있음 — 빈칸은 확인 필요일 뿐 저장을 막지 않음', () => {
    const r = run(lease([party('lessor', '김민수')]));
    const form = { ...draftToForm(r.model.draft), parties: { lessor: '김민수', lessee: undefined } };
    const parsed = contractFormSchema.safeParse(form);
    expect(parsed.success).toBe(true);
    expect(formToDraft(parsed.data!).parties).toEqual([{ role: 'lessor', name: '김민수' }]);
  });

  test('계약 종류를 바꿔도 입력한 이름을 지우지 않음 — 같은 자리가 있는 종류면 연결(임대인 → 렌탈회사, 용어는 괄호로)', () => {
    const r = run(lease([party('lessor', '김민수'), party('lessee', '박지훈')]));
    const form = { ...draftToForm(r.model.draft), contractKind: 'rental' };
    const draft = formToDraft(form as never);
    const rec = draftToRecord(draft, 'c2', TODAY);
    expect(partyRows(rec.contract).map((x) => `${x.label} ${partyRowText(x)}`)).toEqual(['렌탈회사(임대인) 김민수', '고객(임차인) 박지훈']);
    // 같은 자리가 없는 종류(근로)는 원래 역할 이름으로 보존
    const emp = draftToRecord(formToDraft({ ...draftToForm(r.model.draft), contractKind: 'employment' } as never), 'c3', TODAY);
    expect(partyRows(emp.contract).map((x) => `${x.label} ${partyRowText(x)}`)).toEqual(['사용자(고용주) 확인 필요', '근로자 확인 필요', '임대인 김민수', '임차인 박지훈']);
  });

  test('수정 화면 저장 시 예전 당사자 칸(임대인·임차인)도 같은 이름으로 맞춤 (예전 앱 호환), 지운 이름은 다시 나타나지 않음', () => {
    const old = { ...EMPTY_DRAFT, title: '예전 임대차', contractKind: 'lease', contractType: 'lease' as const, category: 'real_estate' as const, details: { landlord: '김민수', tenant: '박지훈', leaseKind: 'monthly' } };
    const form = draftToForm(old);
    expect(form.parties).toEqual({ lessor: '김민수', lessee: '박지훈' });
    const back = formToDraft({ ...form, parties: { lessor: '김민수', lessee: '' } } as never);
    expect(back.details).toEqual({ landlord: '김민수', leaseKind: 'monthly' });
    expect(back.parties).toEqual([{ role: 'lessor', name: '김민수' }]);
  });
});
