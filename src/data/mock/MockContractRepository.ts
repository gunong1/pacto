import type { AmountChangeOp } from '@/domain/amountEdits';
import { todayInSeoul } from '@/domain/dates';
import type { AiCheck, ContractRecord } from '@/domain/types';

import { applyDraftToContract, blankContract, draftToDates, draftToPayments } from '../draft';
import type { ContractDraft, ContractRepository, CreateContractInput, NewEventInput } from '../repository';
import { createMockRecords } from './mockContracts';

let seq = 0;
function newId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 인메모리 저장소. 앱을 다시 시작하면 초기 mock으로 돌아간다.
 * 반환값은 항상 복사본 (호출자가 수정해도 저장소에 영향 없음 — 실제 DB와 같은 의미).
 */
export class MockContractRepository implements ContractRepository {
  private records: ContractRecord[];

  constructor(
    seed: ContractRecord[] = createMockRecords(),
    private readonly latencyMs = 120,
  ) {
    this.records = clone(seed);
  }

  private async delay() {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  private find(id: string): ContractRecord {
    const r = this.records.find((x) => x.contract.id === id);
    if (!r) throw new Error(`계약을 찾을 수 없습니다: ${id}`);
    return r;
  }

  private touch(r: ContractRecord): ContractRecord {
    r.contract.updatedAt = new Date().toISOString();
    return clone(r);
  }

  async list() {
    await this.delay();
    return clone(this.records);
  }

  async analysisResult() {
    return null;
  }

  async get(id: string) {
    await this.delay();
    const r = this.records.find((x) => x.contract.id === id);
    return r ? clone(r) : null;
  }

  async create(input: CreateContractInput) {
    await this.delay();
    const id = newId('c');
    const now = new Date().toISOString();
    const contract = applyDraftToContract(blankContract(id, input.source, now), input.draft);
    const record: ContractRecord = {
      contract,
      payments: draftToPayments(input.draft, id, () => newId('p'), now.slice(0, 10)),
      dates: draftToDates(input.draft, id, () => newId('dt')),
      events: (input.events ?? []).map((e) => ({
        id: newId('e'),
        contractId: id,
        eventType: e.eventType,
        title: e.title.trim(),
        eventDate: e.eventDate,
        amount: null,
        source: 'ai' as const,
        notificationEnabled: true,
        completedAt: null,
      })),
      documents: input.documents.map((d) => ({ ...d, id: d.id ?? newId('d'), contractId: id })),
      aiChecks: input.aiChecks.map((c) => ({ ...c, id: newId('ai'), contractId: id })),
    };
    this.records.unshift(record);
    return clone(record);
  }

  async update(id: string, draft: ContractDraft, amountChanges: readonly AmountChangeOp[] = []) {
    await this.delay();
    const r = this.find(id);
    // DB save_contract와 같은 의미: 저장된 결제는 id 유지(수정), 새 결제는 추가, 목록에서 빠진 결제만 삭제 (변경 이력도 함께)
    const before = new Map(r.payments.map((p) => [p.id, p]));
    for (const p of draft.payments) if (p.id && !before.has(p.id)) throw new Error('결제 항목을 찾을 수 없어요.');
    const payments = draftToPayments(draft, id, () => newId('p'), r.contract.createdAt.slice(0, 10)).map((p) => ({ ...p, amountChanges: before.get(p.id)?.amountChanges ?? [] }));
    for (const c of amountChanges) {
      if (c.op === 'add') {
        const p = payments.find((x) => x.id === c.paymentId);
        if (!p || p.frequency === 'one_time' || c.effectiveFrom <= p.startsOn) throw new Error('금액 변경 적용일을 확인해주세요.');
        const list = p.amountChanges ?? [];
        const same = list.find((x) => x.effectiveFrom === c.effectiveFrom);
        if (same) same.amount = c.amount;
        else list.push({ id: newId('pc'), paymentId: p.id, effectiveFrom: c.effectiveFrom, amount: c.amount, changeReason: null, sourceDocumentId: null, createdAt: new Date().toISOString() });
        p.amountChanges = list.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
      } else {
        const hit = payments.flatMap((p) => p.amountChanges ?? []).find((x) => x.id === c.changeId);
        if (!hit) throw new Error('금액 변경 이력을 찾을 수 없어요.');
        hit.amount = c.amount;
      }
    }
    r.contract = applyDraftToContract(r.contract, draft);
    r.payments = payments;
    r.dates = draftToDates(draft, id, () => newId('dt'));
    return this.touch(r);
  }

  async cancelAmountChange(id: string, changeId: string) {
    await this.delay();
    const r = this.find(id);
    const today = todayInSeoul();
    for (const p of r.payments) {
      const hit = p.amountChanges?.find((x) => x.id === changeId);
      if (!hit) continue;
      // 이미 적용이 시작된 변경은 취소할 수 없다
      if (hit.effectiveFrom <= today) throw new Error('이미 적용된 변경은 취소할 수 없어요.');
      p.amountChanges = p.amountChanges!.filter((x) => x.id !== changeId);
      return this.touch(r);
    }
    throw new Error('금액 변경 이력을 찾을 수 없어요.');
  }

  async setLifecycle(id: string, lifecycle: ContractRecord['contract']['lifecycle'], on: string | null) {
    await this.delay();
    const r = this.find(id);
    r.contract.lifecycle = lifecycle;
    r.contract.lifecycleChangedOn = lifecycle === 'active' ? null : on;
    return this.touch(r);
  }

  async setNotificationsEnabled(id: string, enabled: boolean) {
    await this.delay();
    const r = this.find(id);
    r.contract.notificationsEnabled = enabled;
    return this.touch(r);
  }

  async addEvent(id: string, input: NewEventInput) {
    await this.delay();
    const r = this.find(id);
    r.events.push({
      id: newId('e'),
      contractId: id,
      eventType: input.eventType,
      title: input.title.trim(),
      eventDate: input.eventDate,
      amount: null,
      source: 'user',
      notificationEnabled: true,
      completedAt: null,
    });
    return this.touch(r);
  }

  async updateEvent(id: string, eventId: string, input: NewEventInput) {
    await this.delay();
    const r = this.find(id);
    const e = r.events.find((x) => x.id === eventId);
    if (e) Object.assign(e, { title: input.title.trim(), eventDate: input.eventDate, eventType: input.eventType });
    return this.touch(r);
  }

  async removeEvent(id: string, eventId: string) {
    await this.delay();
    const r = this.find(id);
    r.events = r.events.filter((x) => x.id !== eventId);
    return this.touch(r);
  }

  async setEventCompleted(id: string, eventId: string, completed: boolean) {
    await this.delay();
    const r = this.find(id);
    const e = r.events.find((x) => x.id === eventId);
    if (e) e.completedAt = completed ? new Date().toISOString() : null;
    return this.touch(r);
  }

  async applyAiSuggestion(id: string, checkId: string) {
    await this.delay();
    const r = this.find(id);
    const check = r.aiChecks.find((c) => c.id === checkId);
    const s = check?.suggestion;
    if (!check || !s) return clone(r);
    if (s.kind === 'set_termination_notice') {
      r.contract.terminationNoticeDays = s.terminationNoticeDays;
      r.contract.autoRenewal = s.autoRenewal;
      r.contract.renewalPeriodMonths = s.renewalPeriodMonths ?? r.contract.renewalPeriodMonths;
    } else {
      r.events.push({
        id: newId('e'),
        contractId: id,
        eventType: s.eventType,
        title: s.title,
        eventDate: s.eventDate,
        amount: null,
        source: 'ai',
        notificationEnabled: true,
        completedAt: null,
      });
    }
    check.status = 'acknowledged';
    return this.touch(r);
  }

  async setAiCheckStatus(id: string, checkId: string, status: AiCheck['status']) {
    await this.delay();
    const r = this.find(id);
    const check = r.aiChecks.find((c) => c.id === checkId);
    if (check) check.status = status;
    return this.touch(r);
  }

  async remove(id: string) {
    await this.delay();
    this.records = this.records.filter((r) => r.contract.id !== id);
  }
}
