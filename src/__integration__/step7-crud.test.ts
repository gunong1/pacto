import { EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft, PaymentDraft } from '@/data/repository';
import { SupabaseContractRepository } from '@/data/supabase/SupabaseContractRepository';
import { nextAction } from '@/domain/nextAction';
import { monthSpending } from '@/domain/spending';

import { anonClient, newUser } from './helpers';

const TODAY = '2026-10-05';
const fee: PaymentDraft = { kind: 'recurring_fee', direction: 'expense', label: '월 회비', amount: 55_000, frequency: 'monthly', dayOfMonth: 5, monthOfYear: null, startsOn: null, endsOn: null, installmentCount: null, isVariable: false, components: [], businessDayRule: 'none', obligation: 'confirmed', conditionNote: null };
const gymDraft: ContractDraft = {
  ...EMPTY_DRAFT,
  title: '헬스장',
  category: 'membership',
  contractType: 'recurring',
  counterparty: '바디핏',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  autoRenewal: true,
  renewalPeriodMonths: 12,
  payments: [fee],
};

describe('Step 7 — 실제 계약 CRUD (SupabaseContractRepository)', () => {
  test('생성 → 조회 → 수정 → 상태 변경 → 일정 CRUD → AI 제안 적용 → 삭제', async () => {
    const a = await newUser('crud');
    const repo = new SupabaseContractRepository(a.client, () => TODAY);

    const created = await repo.create({
      draft: gymDraft,
      source: 'upload',
      documents: [],
      aiChecks: [
        { severity: 'caution', topic: 'auto_renewal', title: '자동갱신', description: '자동갱신 조건이 포함되어 있습니다.', evidenceQuote: '만료 30일 전까지…', evidencePage: 2, status: 'new', suggestion: { kind: 'set_termination_notice', terminationNoticeDays: 30, autoRenewal: true, renewalPeriodMonths: 12 } },
      ],
    });
    expect(created.contract.title).toBe('헬스장');
    // 통보기한의 의미: 기본 unknown(확인 필요)
    expect(created.contract.noticeKind).toBe('unknown');
    expect(created.payments).toHaveLength(1);
    expect(created.payments[0]).toMatchObject({ amount: 55_000, frequency: 'monthly', dayOfMonth: 5, startsOn: '2026-01-01' });
    expect(created.aiChecks[0]).toMatchObject({ title: '자동갱신', status: 'new' });
    const id = created.contract.id;

    // 목록/월 지출 — domain 계산이 DB 데이터로 그대로 동작
    const list = await repo.list();
    expect(list.map((r) => r.contract.id)).toEqual([id]);
    expect(monthSpending(list, { year: 2026, month: 10 }).total).toBe(55_000);

    // 수정: 결제 금액·결제일 변경 + 결제 추가(가입비) + 주요 날짜 + 유형별 정보
    const updated = await repo.update(id, {
      ...gymDraft,
      memo: '락커 포함',
      details: { commitmentMonths: 12 },
      payments: [{ ...fee, amount: 60_000, dayOfMonth: 10 }, { ...fee, kind: 'setup_fee', label: '가입비', amount: 30_000, frequency: 'one_time', dayOfMonth: null, startsOn: '2026-10-20' }],
      dates: [{ kind: 'other', label: '락커 배정', date: '2026-10-20' }],
    });
    expect(updated.payments).toHaveLength(2);
    expect(updated.payments[0]).toMatchObject({ kind: 'recurring_fee', amount: 60_000, dayOfMonth: 10 });
    expect(updated.payments[1]).toMatchObject({ kind: 'setup_fee', amount: 30_000, frequency: 'one_time', startsOn: '2026-10-20' });
    expect(updated.dates).toEqual([expect.objectContaining({ kind: 'other', label: '락커 배정', date: '2026-10-20' })]);
    expect(updated.contract).toMatchObject({ memo: '락커 포함', contractType: 'recurring', details: { commitmentMonths: 12 } });
    expect(monthSpending([updated], { year: 2026, month: 10 }).total).toBe(90_000);

    // 통보기한의 의미: 수정 화면에서 고른 값 저장 → 다시 읽어도 같음
    const kinded = await repo.update(id, { ...gymDraft, terminationNoticeDays: 30, noticeKind: 'renewal_decision', payments: [{ ...fee, amount: 60_000, dayOfMonth: 10 }] });
    expect(kinded.contract.noticeKind).toBe('renewal_decision');
    expect((await repo.get(id))?.contract.noticeKind).toBe('renewal_decision');
    await repo.update(id, { ...gymDraft, payments: [{ ...fee, amount: 60_000, dayOfMonth: 10 }, { ...fee, kind: 'setup_fee', label: '가입비', amount: 30_000, frequency: 'one_time', dayOfMonth: null, startsOn: '2026-10-20' }], memo: '락커 포함', details: { commitmentMonths: 12 }, dates: [{ kind: 'other', label: '락커 배정', date: '2026-10-20' }] });

    // AI 제안 적용 → 해지 통보기한이 다음 행동으로
    const applied = await repo.applyAiSuggestion(id, created.aiChecks[0].id);
    expect(applied.contract.terminationNoticeDays).toBe(30);
    expect(applied.aiChecks[0].status).toBe('acknowledged');
    expect(nextAction(applied, TODAY)).toMatchObject({ kind: 'termination_notice', date: '2026-12-01' });

    // 일정 생성 → 수정 → 완료 → 삭제
    let r = await repo.addEvent(id, { title: '해지 신청서 제출', eventDate: '2026-11-20', eventType: 'custom' });
    const eventId = r.events[0].id;
    r = await repo.updateEvent(id, eventId, { title: '해지 신청서 방문 제출', eventDate: '2026-11-21', eventType: 'custom' });
    expect(r.events[0]).toMatchObject({ title: '해지 신청서 방문 제출', eventDate: '2026-11-21' });
    r = await repo.setEventCompleted(id, eventId, true);
    expect(r.events[0].completedAt).not.toBeNull();
    r = await repo.removeEvent(id, eventId);
    expect(r.events).toHaveLength(0);

    // 알림 off, 해지 처리
    r = await repo.setNotificationsEnabled(id, false);
    expect(r.contract.notificationsEnabled).toBe(false);
    r = await repo.setLifecycle(id, 'cancelled', '2026-10-31');
    expect(r.contract).toMatchObject({ lifecycle: 'cancelled', lifecycleChangedOn: '2026-10-31' });
    expect(monthSpending([r], { year: 2026, month: 11 }).total).toBe(0);

    // 결제·날짜를 모두 지우면 삭제
    r = await repo.update(id, { ...gymDraft, payments: [], dates: [] });
    expect(r.payments).toHaveLength(0);
    expect(r.dates).toHaveLength(0);

    await repo.remove(id);
    expect(await repo.get(id)).toBeNull();
    expect(await repo.list()).toEqual([]);
  });

  test('앱 재실행(새 클라이언트로 다시 로그인) 후에도 계약이 유지된다', async () => {
    const a = await newUser('persist');
    const repo = new SupabaseContractRepository(a.client, () => TODAY);
    const { contract } = await repo.create({ draft: gymDraft, source: 'manual', documents: [], aiChecks: [] });

    const reopened = anonClient();
    await reopened.auth.signInWithPassword({ email: a.email, password: a.password });
    const again = new SupabaseContractRepository(reopened, () => TODAY);
    const got = await again.get(contract.id);
    expect(got?.contract.title).toBe('헬스장');
    expect(got?.payments[0].amount).toBe(55_000);
  });

  test('다른 계정의 계약은 조회·수정·삭제·일정 추가 모두 불가', async () => {
    const a = await newUser('owner');
    const b = await newUser('intruder');
    const repoA = new SupabaseContractRepository(a.client, () => TODAY);
    const repoB = new SupabaseContractRepository(b.client, () => TODAY);
    const { contract } = await repoA.create({ draft: gymDraft, source: 'manual', documents: [], aiChecks: [] });

    expect(await repoB.get(contract.id)).toBeNull();
    expect(await repoB.list()).toEqual([]);
    await expect(repoB.update(contract.id, { ...gymDraft, title: '변조' })).rejects.toBeDefined();
    await expect(repoB.setLifecycle(contract.id, 'cancelled', TODAY)).rejects.toBeDefined();
    await expect(repoB.addEvent(contract.id, { title: 'x', eventDate: TODAY, eventType: 'custom' })).rejects.toBeDefined();
    await repoB.remove(contract.id).catch(() => undefined);

    const still = await repoA.get(contract.id);
    expect(still?.contract.title).toBe('헬스장');
    expect(still?.contract.lifecycle).toBe('active');
    expect(still?.events).toHaveLength(0);
  });
});
