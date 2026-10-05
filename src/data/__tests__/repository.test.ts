import { MockAIProvider } from '@/data/ai/MockAIProvider';
import { EMPTY_DRAFT } from '@/data/draft';
import { MockContractRepository } from '@/data/mock/MockContractRepository';
import { findBannedPhrases } from '@/domain/aiCopy';
import { actionCandidates } from '@/domain/nextAction';
import { scheduleForRange } from '@/domain/schedule';
import { monthSpending } from '@/domain/spending';
import { contractFormSchema, draftToForm, formToDraft } from '@/features/contracts/form';
import { toReviewModel } from '@/features/registration/extraction';

const TODAY = '2026-10-05';


describe('등록 흐름 (mock): AI 추출 → 확인/수정 → 저장 → 홈/캘린더/지출 반영', () => {
  test('end-to-end on data layer', async () => {
    const repo = new MockContractRepository(undefined, 0);
    const ai = new MockAIProvider(0);

    // 1) AI mock 추출 — 법적 판단 표현 없음
    const result = await ai.extractContract({ files: [{ name: 'a.pdf', uri: 'file://a.pdf', mimeType: 'application/pdf', size: 1 }], today: TODAY });
    for (const c of result.checks) expect(findBannedPhrases(c.description)).toEqual([]);

    // 2) 확인 화면: 폼으로 변환 후 사용자가 결제일 수정
    const model = toReviewModel(result);
    expect([...model.flagged].sort()).toEqual(['contractDate', 'paymentDay', 'totalAmount']);
    const form = draftToForm(model.draft);
    form.paymentDay = '12';
    const parsed = contractFormSchema.parse(form);
    const draft = formToDraft(parsed);
    expect(draft.paymentAmount).toBe(29_900);
    expect(draft.paymentDay).toBe(12);

    // 3) 저장
    const before = await repo.list();
    const saved = await repo.create({
      draft,
      source: 'upload',
      documents: [{ fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1, storagePath: null, localUri: 'file://a.pdf', pageCount: null }],
      aiChecks: result.checks.map((c) => ({ ...c, status: 'new' as const })),
    });
    const after = await repo.list();
    expect(after).toHaveLength(before.length + 1);
    expect(after[0].contract.id).toBe(saved.contract.id); // 최근 등록 맨 앞

    // 4) 캘린더 반영: 10/12 결제는 시작일(10/10) 이후라 포함
    const oct = scheduleForRange(after, { start: '2026-10-01', end: '2026-10-31' }, TODAY);
    expect(oct.some((i) => i.contractId === saved.contract.id && i.type === 'payment' && i.date === '2026-10-12')).toBe(true);
    expect(oct.some((i) => i.contractId === saved.contract.id && i.type === 'contract_start' && i.date === '2026-10-10')).toBe(true);

    // 5) 월 지출 반영
    const diff = monthSpending(after, { year: 2026, month: 10 }).total - monthSpending(before, { year: 2026, month: 10 }).total;
    expect(diff).toBe(29_900);
  });

  test('직접 입력: 결제 없음 + 검증 오류', () => {
    const v = draftToForm({ ...EMPTY_DRAFT, title: '' });
    expect(contractFormSchema.safeParse(v).success).toBe(false);
    const ok = contractFormSchema.parse({ ...v, title: '주차장 임대' });
    expect(formToDraft(ok).paymentAmount).toBeNull();
    const bad = contractFormSchema.safeParse({ ...ok, startDate: '2026-05-01', endDate: '2026-04-01' });
    expect(bad.success).toBe(false);
    const noFreq = contractFormSchema.safeParse({ ...ok, paymentAmount: '10,000' });
    expect(noFreq.success).toBe(false);
  });

  test('수정/상태 변경/AI 제안 적용/일정 추가', async () => {
    const repo = new MockContractRepository(undefined, 0);
    const water = (await repo.get('c-water-purifier'))!;

    // 해지 처리 → 이후 결제 제외
    await repo.setLifecycle(water.contract.id, 'cancelled', '2026-10-31');
    const list = await repo.list();
    const nov = monthSpending(list, { year: 2026, month: 11 });
    expect(nov.items.some((i) => i.contractId === 'c-water-purifier')).toBe(false);

    // AI 제안(해지 통보기한) → 계약 정보 반영 → 처리할 계약에 등장
    const created = await repo.create({
      draft: { ...EMPTY_DRAFT, title: '테스트 회원권', category: 'membership', startDate: '2025-11-01', endDate: '2026-10-31' },
      source: 'manual',
      documents: [],
      aiChecks: [
        { severity: 'caution', topic: 'auto_renewal', title: '자동갱신', description: '자동갱신 조건이 포함되어 있습니다.', evidenceQuote: null, evidencePage: null, status: 'new', suggestion: { kind: 'set_termination_notice', terminationNoticeDays: 14, autoRenewal: true, renewalPeriodMonths: 12 } },
      ],
    });
    const applied = await repo.applyAiSuggestion(created.contract.id, created.aiChecks[0].id);
    expect(applied.contract.terminationNoticeDays).toBe(14);
    expect(applied.aiChecks[0].status).toBe('acknowledged');
    const items = actionCandidates(applied, TODAY);
    expect(items.map((i) => i.kind)).toEqual(['termination_notice', 'renewal']);
    expect(items[0].date).toBe('2026-10-17');

    const withEvent = await repo.addEvent(created.contract.id, { title: '해지 신청서 제출', eventDate: '2026-10-10', eventType: 'custom' });
    expect(withEvent.events).toHaveLength(1);
  });
});
