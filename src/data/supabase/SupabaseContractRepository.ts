import { detailsFromDb, detailsToDb } from '@/domain/contractTypes';
import type {
  AiCheck,
  Contract,
  ContractDate,
  ContractDocument,
  ContractEvent,
  ContractLifecycle,
  ContractPayment,
  ContractRecord,
  ISODate,
} from '@/domain/types';
import type { Database, Json } from '@/types/database';

import { draftToPayment } from '../draft';
import type { ContractDraft, ContractRepository, CreateContractInput, NewEventInput } from '../repository';
import type { PactoSupabase } from './client';

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
type ContractRow = Row<'contracts'> & {
  contract_payments: Row<'contract_payments'>[];
  contract_dates: Row<'contract_dates'>[];
  contract_events: Row<'contract_events'>[];
  contract_documents: Row<'contract_documents'>[];
};

export const CONTRACT_BUCKET = 'contract-files';

const SELECT = '*, contract_payments(*), contract_dates(*), contract_events(*), contract_documents(*)';

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

// ===== row → domain =====
function toPayment(r: Row<'contract_payments'>): ContractPayment {
  return {
    id: r.id,
    contractId: r.contract_id,
    kind: r.kind as ContractPayment['kind'],
    direction: r.direction as ContractPayment['direction'],
    label: r.label,
    amount: r.amount,
    frequency: r.frequency,
    dayOfMonth: r.day_of_month,
    monthOfYear: r.month_of_year,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    installmentCount: r.installment_count,
    isVariable: r.is_variable,
    components: Array.isArray(r.components) ? (r.components as unknown as ContractPayment['components']) : [],
    businessDayRule: r.business_day_rule as ContractPayment['businessDayRule'],
    obligation: r.obligation as ContractPayment['obligation'],
    conditionNote: r.condition_note,
  };
}

function toDate(r: Row<'contract_dates'>): ContractDate {
  return { id: r.id, contractId: r.contract_id, kind: r.kind as ContractDate['kind'], label: r.label, date: r.date };
}

function toEvent(r: Row<'contract_events'>): ContractEvent {
  return {
    id: r.id,
    contractId: r.contract_id,
    eventType: r.event_type,
    title: r.title,
    eventDate: r.event_date,
    amount: r.amount,
    source: r.source,
    notificationEnabled: r.notification_enabled,
    completedAt: r.completed_at,
  };
}

function toDocument(r: Row<'contract_documents'>): ContractDocument {
  return {
    id: r.id,
    contractId: r.contract_id ?? '',
    fileName: r.original_filename ?? '계약서',
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    storagePath: r.storage_path,
    localUri: null,
    pageCount: r.page_count,
  };
}

function toContract(r: Row<'contracts'>): Contract {
  return {
    id: r.id,
    title: r.title,
    // 앱이 모르는 코드(나중에 DB 레지스트리에 추가된 분야·유형)도 그대로 보존한다 — 화면은 '기타'로 표시
    category: r.category as Contract['category'],
    contractType: r.contract_type as Contract['contractType'],
    details: detailsFromDb(r.contract_type, r.contract_details),
    valueSources: (r.value_sources && typeof r.value_sources === 'object' && !Array.isArray(r.value_sources) ? r.value_sources : {}) as Contract['valueSources'],
    counterparty: r.counterparty,
    lifecycle: r.lifecycle,
    lifecycleChangedOn: r.lifecycle_changed_on,
    contractDate: r.contract_date,
    startDate: r.start_date,
    endDate: r.end_date,
    totalAmount: r.total_amount,
    autoRenewal: r.auto_renewal,
    renewalPeriodMonths: r.renewal_period_months,
    terminationNoticeDays: r.termination_notice_days,
    earlyTerminationTerms: r.early_termination_terms,
    penaltyTerms: r.penalty_terms,
    depositAmount: r.deposit_amount,
    currency: 'KRW',
    memo: r.memo,
    source: r.source,
    notificationsEnabled: r.notifications_enabled,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toRecord(r: ContractRow): ContractRecord {
  const contract = toContract(r);
  return {
    contract,
    payments: [...r.contract_payments].sort((a, b) => a.sort_order - b.sort_order).map(toPayment),
    dates: [...r.contract_dates].sort((a, b) => a.date.localeCompare(b.date) || a.sort_order - b.sort_order).map(toDate),
    events: [...r.contract_events].sort((a, b) => a.event_date.localeCompare(b.event_date)).map(toEvent),
    documents: [...r.contract_documents].sort((a, b) => a.sort_order - b.sort_order).map(toDocument),
    aiChecks: (Array.isArray(r.ai_checks) ? (r.ai_checks as unknown as AiCheck[]) : []).map((c) => ({ ...c, contractId: r.id })),
  };
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

  /** 계약 삭제: 원본 파일(Storage) → 계약 행(하위 데이터 cascade) 순서 */
  async remove(id: string) {
    const docs = check(await this.sb.from('contract_documents').select('storage_path').eq('contract_id', id));
    const paths = (docs ?? []).map((d) => d.storage_path);
    if (paths.length > 0) {
      const { error } = await this.sb.storage.from(CONTRACT_BUCKET).remove(paths);
      if (error) throw new RepositoryError('원본 계약서를 삭제하지 못했어요. 잠시 후 다시 시도해주세요.');
    }
    check(await this.sb.from('contracts').delete().eq('id', id));
  }
}
