import { detailsToDb } from '@/domain/contractTypes';
import type { AiCheck, ContractLifecycle, ContractRecord, ISODate } from '@/domain/types';
import type { Database, Json } from '@/types/database';

import { draftToPayment } from '../draft';
import type { ContractDraft, ContractRepository, CreateContractInput, NewEventInput } from '../repository';
import type { PactoSupabase } from './client';
import { CONTRACT_SELECT, toRecord, type ContractRow } from './rowMapping';

export { DOCUMENT_SELECT, toProtection, type DocumentRow } from './rowMapping';

export const CONTRACT_BUCKET = 'contract-files';

const SELECT = CONTRACT_SELECT;

/** 오류 원문(내부 정보)을 그대로 노출하지 않는 저장소 오류 */
export class RepositoryError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

function check<T>(res: { data: T; error: { code?: string; message: string } | null }): T {
  if (res.error) throw new RepositoryError('데이터를 처리하지 못했어요. 잠시 후 다시 시도해주세요.', res.error.code);
  return res.data;
}

// ===== domain → RPC payload =====
function contractPayload(d: ContractDraft, extra: Record<string, unknown> = {}): Json {
  return {
    title: d.title.trim(),
    category: d.category,
    contract_type: d.contractType,
    contract_details: detailsToDb(d.contractType, d.details),
    value_sources: d.valueSources,
    counterparty: d.counterparty,
    contract_date: d.contractDate,
    start_date: d.startDate,
    end_date: d.endDate,
    total_amount: d.totalAmount,
    auto_renewal: d.autoRenewal,
    renewal_period_months: d.autoRenewal ? d.renewalPeriodMonths : null,
    termination_notice_days: d.terminationNoticeDays,
    early_termination_terms: d.earlyTerminationTerms,
    penalty_terms: d.penaltyTerms,
    deposit_amount: d.depositAmount,
    memo: d.memo,
    ...extra,
  } as Json;
}

function paymentsPayload(d: ContractDraft, today: ISODate): Json {
  return d.payments.map((p) => {
    const r = draftToPayment(p, d, '', '', today);
    return {
      kind: r.kind,
      direction: r.direction,
      label: r.label,
      amount: r.amount,
      frequency: r.frequency,
      day_of_month: r.dayOfMonth,
      month_of_year: r.monthOfYear,
      starts_on: r.startsOn,
      ends_on: r.endsOn,
      installment_count: r.installmentCount,
      is_variable: r.isVariable,
      components: r.components as unknown as Json,
      business_day_rule: r.businessDayRule,
      obligation: r.obligation,
      condition_note: r.conditionNote,
    };
  });
}

function datesPayload(d: ContractDraft): Json {
  return d.dates.map((x) => ({ kind: x.kind, label: x.label.trim(), date: x.date }));
}

function newCheckId(): string {
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Supabase(PostgreSQL + RLS) 계약 저장소.
 * 모든 쿼리는 로그인한 사용자 권한으로 실행되어, 다른 계정의 행은 RLS로 보이지도 바뀌지도 않는다.
 */
export class SupabaseContractRepository implements ContractRepository {
  constructor(
    private readonly sb: PactoSupabase,
    private readonly today: () => ISODate = () => new Date().toISOString().slice(0, 10),
  ) {}

  async list() {
    const rows = check(await this.sb.from('contracts').select(SELECT).order('created_at', { ascending: false }));
    return (rows as unknown as ContractRow[]).map(toRecord);
  }

  async get(id: string) {
    const row = check(await this.sb.from('contracts').select(SELECT).eq('id', id).maybeSingle());
    return row ? toRecord(row as unknown as ContractRow) : null;
  }

  private async mustGet(id: string): Promise<ContractRecord> {
    const r = await this.get(id);
    if (!r) throw new RepositoryError('계약을 찾을 수 없어요.');
    return r;
  }

  async create(input: CreateContractInput) {
    const checks = input.aiChecks.map((c) => ({ ...c, id: newCheckId() }));
    const id = check(
      await this.sb.rpc('save_contract', {
        p_contract: contractPayload(input.draft, { source: input.source, analysis_job_id: input.analysisJobId ?? null }),
        p_payments: paymentsPayload(input.draft, this.today()),
        p_dates: datesPayload(input.draft),
        p_document_ids: input.documents.map((d) => d.id).filter((x): x is string => !!x),
        p_ai_checks: checks as unknown as Json,
      }),
    );
    if (!id) throw new RepositoryError('계약을 저장하지 못했어요.');
    if (input.events?.length) {
      check(await this.sb.from('contract_events').insert(input.events.map((e) => ({ contract_id: id, title: e.title.trim(), event_date: e.eventDate, event_type: e.eventType, source: 'ai' as const }))));
    }
    return this.mustGet(id);
  }

  async update(id: string, draft: ContractDraft) {
    check(
      await this.sb.rpc('save_contract', {
        p_contract: contractPayload(draft),
        p_payments: paymentsPayload(draft, this.today()),
        p_dates: datesPayload(draft),
        p_contract_id: id,
      }),
    );
    return this.mustGet(id);
  }

  private async patchContract(id: string, patch: Database['public']['Tables']['contracts']['Update']) {
    const rows = check(await this.sb.from('contracts').update(patch).eq('id', id).select('id'));
    if (!rows || rows.length === 0) throw new RepositoryError('계약을 찾을 수 없어요.');
    return this.mustGet(id);
  }

  setLifecycle(id: string, lifecycle: ContractLifecycle, on: ISODate | null) {
    return this.patchContract(id, { lifecycle, lifecycle_changed_on: lifecycle === 'active' ? null : on });
  }

  setNotificationsEnabled(id: string, enabled: boolean) {
    return this.patchContract(id, { notifications_enabled: enabled });
  }

  async addEvent(id: string, input: NewEventInput) {
    check(await this.sb.from('contract_events').insert({ contract_id: id, title: input.title.trim(), event_date: input.eventDate, event_type: input.eventType, source: 'user' }));
    return this.mustGet(id);
  }

  async updateEvent(id: string, eventId: string, input: NewEventInput) {
    check(await this.sb.from('contract_events').update({ title: input.title.trim(), event_date: input.eventDate, event_type: input.eventType }).eq('id', eventId).eq('contract_id', id));
    return this.mustGet(id);
  }

  async removeEvent(id: string, eventId: string) {
    check(await this.sb.from('contract_events').delete().eq('id', eventId).eq('contract_id', id));
    return this.mustGet(id);
  }

  async setEventCompleted(id: string, eventId: string, completed: boolean) {
    check(await this.sb.from('contract_events').update({ completed_at: completed ? new Date().toISOString() : null }).eq('id', eventId).eq('contract_id', id));
    return this.mustGet(id);
  }

  private async writeChecks(id: string, checks: AiCheck[], patch: Database['public']['Tables']['contracts']['Update'] = {}) {
    // contractId는 행에서 알 수 있으므로 저장하지 않는다
    const stored = checks.map((c) => ({ ...c, contractId: undefined }));
    return this.patchContract(id, { ...patch, ai_checks: JSON.parse(JSON.stringify(stored)) as Json[] });
  }

  async applyAiSuggestion(id: string, checkId: string) {
    const r = await this.mustGet(id);
    const target = r.aiChecks.find((c) => c.id === checkId);
    const s = target?.suggestion;
    if (!target || !s) return r;
    const checks = r.aiChecks.map((c) => (c.id === checkId ? { ...c, status: 'acknowledged' as const } : c));
    if (s.kind === 'set_termination_notice') {
      return this.writeChecks(id, checks, {
        termination_notice_days: s.terminationNoticeDays,
        auto_renewal: s.autoRenewal,
        renewal_period_months: s.renewalPeriodMonths ?? r.contract.renewalPeriodMonths,
      });
    }
    check(await this.sb.from('contract_events').insert({ contract_id: id, title: s.title, event_date: s.eventDate, event_type: s.eventType, source: 'ai' }));
    return this.writeChecks(id, checks);
  }

  async setAiCheckStatus(id: string, checkId: string, status: AiCheck['status']) {
    const r = await this.mustGet(id);
    return this.writeChecks(id, r.aiChecks.map((c) => (c.id === checkId ? { ...c, status } : c)));
  }

  /**
   * 계약 삭제: 원본·보호 표시본 등 파생 파일(Storage) → 계약 행 순서.
   * 계약 행을 지우면 원본 기록·민감정보 영역·파생본 기록·결제·일정이 cascade로 함께 지워진다 (고아 파일이 남지 않도록 파일 먼저).
   */
  async remove(id: string) {
    const docs = check(await this.sb.from('contract_documents').select('id, storage_path, document_derivatives(storage_path)').eq('contract_id', id));
    const paths = (docs ?? []).flatMap((d) => [d.storage_path, ...(d.document_derivatives ?? []).map((x) => x.storage_path)]);
    if (paths.length > 0) {
      const { error } = await this.sb.storage.from(CONTRACT_BUCKET).remove(paths);
      if (error) throw new RepositoryError('원본 계약서를 삭제하지 못했어요. 잠시 후 다시 시도해주세요.');
    }
    check(await this.sb.from('contracts').delete().eq('id', id));
  }
}
