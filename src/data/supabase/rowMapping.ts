/**
 * DB 행 → 도메인 기록 (앱 저장소와 서버 알림 계획이 같은 변환을 쓴다 — Edge Function용 번들에 포함)
 * 이 파일은 Supabase 클라이언트를 import하지 않는다.
 */
import { profileKeyOf, type ClassificationMeta } from '@/domain/contractKinds';
import { isNoticeKind } from '@/domain/noticeKind';
import { detailsFromDb } from '@/domain/contractTypes';
import type {
  AiCheck,
  Contract,
  ContractDate,
  ContractDocument,
  ContractEvent,
  ContractPayment,
  ContractRecord,
  DocumentProtection,
  PaymentAmountChange,
  ProtectionPage,
  ReferenceAmount,
  ReferenceAmountRole,
  ProtectionStatus,
  SensitiveRegion,
} from '@/domain/types';
import type { Database } from '@/types/database';

export type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type PaymentRow = Row<'contract_payments'> & { contract_payment_changes?: Row<'contract_payment_changes'>[] };
export type ContractRow = Row<'contracts'> & {
  contract_payments: PaymentRow[];
  contract_dates: Row<'contract_dates'>[];
  contract_events: Row<'contract_events'>[];
  contract_documents: DocumentRow[];
};
/** 원본 + 민감정보 보호 결과 (영역·파생본) */
export type DocumentRow = Row<'contract_documents'> & {
  document_sensitive_regions?: Row<'document_sensitive_regions'>[];
  document_derivatives?: Row<'document_derivatives'>[];
};
export const DOCUMENT_SELECT = '*, document_sensitive_regions(*), document_derivatives(*)';

/** 계약 + 결제·날짜·일정·문서 */
export const CONTRACT_SELECT = `*, contract_payments(*, contract_payment_changes(*)), contract_dates(*), contract_events(*), contract_documents(${DOCUMENT_SELECT})`;

// ===== row → domain =====
function toAmountChange(r: Row<'contract_payment_changes'>): PaymentAmountChange {
  return {
    id: r.id,
    paymentId: r.payment_id,
    effectiveFrom: r.effective_from,
    amount: r.amount,
    changeReason: r.change_reason,
    sourceDocumentId: r.source_document_id,
    createdAt: r.created_at,
  };
}

function toPayment(r: PaymentRow): ContractPayment {
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
    amountChanges: (r.contract_payment_changes ?? []).map(toAmountChange).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1)),
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

const firstBox = (r: Row<'document_sensitive_regions'>): { x: number; y: number } => {
  const b = Array.isArray(r.bbox_json) ? (r.bbox_json[0] as { x?: number; y?: number } | undefined) : undefined;
  return { x: Number(b?.x ?? 0), y: Math.round(Number(b?.y ?? 0) * 200) / 200 };
};

const PAGE_KINDS = new Set(['text', 'scan', 'unsupported']);
const PAGE_STATUSES = new Set(['protected', 'no_sensitive_data', 'unreadable', 'unsupported_scan', 'failed', 'skipped']);
/** 페이지별 상태 (모양이 다르면 버린다) */
function toProtectionPages(v: unknown): ProtectionPage[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    const o = x as Record<string, unknown>;
    return typeof o?.page === 'number' && PAGE_KINDS.has(o.kind as string) && PAGE_STATUSES.has(o.status as string)
      ? [{ page: o.page, kind: o.kind as ProtectionPage['kind'], status: o.status as ProtectionPage['status'] }]
      : [];
  });
}

/** 보호 결과 — 원문 값은 DB에 없으므로 가린 표시값·위치·상태만 */
export function toProtection(r: DocumentRow): DocumentProtection {
  const view = (r.document_derivatives ?? []).find((d) => d.kind === 'protected_view');
  return {
    status: r.protection_status as ProtectionStatus,
    detail: r.protection_detail,
    access: (r.access_status as DocumentProtection['access']) ?? null,
    imagesUnchecked: r.protection_images_unchecked,
    protectedViewPath: r.protection_status === 'protected' && view ? view.storage_path : null,
    pages: toProtectionPages(r.protection_pages),
    regions: [...(r.document_sensitive_regions ?? [])]
      // 문서에서 나오는 순서 (쪽 → 위에서 아래 → 왼쪽에서 오른쪽)
      .sort((a, b) => a.page_number - b.page_number || firstBox(a).y - firstBox(b).y || firstBox(a).x - firstBox(b).x)
      .map((g) => ({
        id: g.id,
        page: g.page_number,
        type: g.sensitive_type,
        level: g.mask_level as 1 | 2 | 3,
        confidence: g.confidence as SensitiveRegion['confidence'],
        state: g.state as SensitiveRegion['state'],
        userConfirmed: g.user_confirmed,
        maskedPreview: g.masked_preview,
        contextLabel: g.context_label,
      })),
  };
}

function toDocument(r: DocumentRow): ContractDocument {
  return {
    id: r.id,
    contractId: r.contract_id ?? '',
    fileName: r.original_filename ?? '계약서',
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    storagePath: r.storage_path,
    localUri: null,
    pageCount: r.page_count,
    protection: toProtection(r),
  };
}

/** 분류 메타데이터 (형식이 틀린 값은 버린다) */
export function toClassification(raw: unknown): ClassificationMeta {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const conf = o.confidence === 'high' || o.confidence === 'medium' || o.confidence === 'low' ? o.confidence : null;
  const ev = o.evidence && typeof o.evidence === 'object' ? (o.evidence as Record<string, unknown>) : null;
  const source = o.source === 'ai' || o.source === 'user' || o.source === 'suggested' ? o.source : null;
  return {
    confidence: conf,
    alternatives: strings(o.alternatives),
    reason: typeof o.reason === 'string' ? o.reason : null,
    evidence: ev && typeof ev.quote === 'string' ? { quote: ev.quote, page: typeof ev.page === 'number' ? ev.page : null, fileIndex: typeof ev.fileIndex === 'number' ? ev.fileIndex : null } : null,
    secondaryElements: (Array.isArray(o.secondaryElements) ? o.secondaryElements : [])
      .filter((x): x is { kind: string; note: string } => !!x && typeof x === 'object' && typeof (x as { kind?: unknown }).kind === 'string')
      .map((x) => ({ kind: x.kind, note: typeof x.note === 'string' ? x.note : '' })),
    domains: strings(o.domains),
    source,
  };
}

function toContract(r: Row<'contracts'>): Contract {
  return {
    id: r.id,
    title: r.title,
    // 계약 종류(기준값) — 분류 개편 전 계약은 null (자동 변경하지 않음)
    contractKind: r.contract_kind ?? null,
    contractSubtype: r.contract_subtype ?? null,
    classification: toClassification(r.classification),
    // 하위 호환값. 앱이 모르는 코드(나중에 DB 레지스트리에 추가된 분야·유형)도 그대로 보존한다 — 화면은 '기타'로 표시
    category: r.category as Contract['category'],
    contractType: r.contract_type as Contract['contractType'],
    details: detailsFromDb(profileKeyOf({ contractKind: r.contract_kind ?? null, contractType: r.contract_type as Contract['contractType'] }), r.contract_details),
    referenceAmounts: toReferenceAmounts(r.reference_amounts),
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
    // 앱이 모르는 값은 unknown (확인 필요)
    noticeKind: isNoticeKind(r.notice_kind) ? r.notice_kind : 'unknown',
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

export function toRecord(r: ContractRow): ContractRecord {
  const contract = toContract(r);
  return {
    contract,
    // 저장된 의미 그대로 (읽을 때 다시 판단하지 않는다 — 이전 데이터 정리는 마이그레이션으로 한 번)
    payments: [...r.contract_payments].sort((a, b) => a.sort_order - b.sort_order).map(toPayment),
    dates: [...r.contract_dates].sort((a, b) => a.date.localeCompare(b.date) || a.sort_order - b.sort_order).map(toDate),
    events: [...r.contract_events].sort((a, b) => a.event_date.localeCompare(b.event_date)).map(toEvent),
    documents: [...r.contract_documents].sort((a, b) => a.sort_order - b.sort_order).map(toDocument),
    aiChecks: (Array.isArray(r.ai_checks) ? (r.ai_checks as unknown as AiCheck[]) : []).map((c) => ({ ...c, contractId: r.id })),
  };
}


const REFERENCE_ROLES: readonly ReferenceAmountRole[] = ['total', 'reference', 'waived', 'discount', 'before_discount'];

/** 저장된 참고 금액 목록 — 형식이 맞는 항목만 (의미를 다시 판단하지 않는다) */
function toReferenceAmounts(v: unknown): ReferenceAmount[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    const o = x as Record<string, unknown>;
    if (!o || typeof o.label !== 'string' || typeof o.amount !== 'number' || !REFERENCE_ROLES.includes(o.role as ReferenceAmountRole)) return [];
    return [{ label: o.label, amount: o.amount, role: o.role as ReferenceAmountRole }];
  });
}
