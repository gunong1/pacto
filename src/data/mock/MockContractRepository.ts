import type { AiCheck, ContractRecord } from '@/domain/types';

import { applyDraftToContract, blankContract, draftToPayment } from '../draft';
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
    const payment = draftToPayment(input.draft, id, newId('p'), now.slice(0, 10));
    const record: ContractRecord = {
      contract,
      payments: payment ? [payment] : [],
      events: [],
      documents: input.documents.map((d) => ({ ...d, id: d.id ?? newId('d'), contractId: id })),
      aiChecks: input.aiChecks.map((c) => ({ ...c, id: newId('ai'), contractId: id })),
    };
    this.records.unshift(record);
    return clone(record);
  }

  async update(id: string, draft: ContractDraft) {
    await this.delay();
    const r = this.find(id);
    r.contract = applyDraftToContract(r.contract, draft);
    const [primary, ...rest] = r.payments;
    const payment = draftToPayment(draft, id, primary?.id ?? newId('p'), r.contract.createdAt.slice(0, 10));
    r.payments = payment ? [{ ...payment, monthOfYear: primary?.frequency === payment.frequency ? primary.monthOfYear : null }, ...rest] : rest;
    return this.touch(r);
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
