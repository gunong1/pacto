/**
 * DB 행 → 도메인 기록 (앱 저장소와 서버 알림 계획이 같은 변환을 쓴다 — Edge Function용 번들에 포함)
 * 이 파일은 Supabase 클라이언트를 import하지 않는다.
 */
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
  ProtectionStatus,
  SensitiveRegion,
} from '@/domain/types';
import type { Database } from '@/types/database';

export type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type ContractRow = Row<'contracts'> & {
  contract_payments: Row<'contract_payments'>[];
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
export const CONTRACT_SELECT = `*, contract_payments(*), contract_dates(*), contract_events(*), contract_documents(${DOCUMENT_SELECT})`;

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

const firstBox = (r: Row<'document_sensitive_regions'>): { x: number; y: number } => {
  const b = Array.isArray(r.bbox_json) ? (r.bbox_json[0] as { x?: number; y?: number } | undefined) : undefined;
  return { x: Number(b?.x ?? 0), y: Math.round(Number(b?.y ?? 0) * 200) / 200 };
};

/** 보호 결과 — 원문 값은 DB에 없으므로 가린 표시값·위치·상태만 */
export function toProtection(r: DocumentRow): DocumentProtection {
  const view = (r.document_derivatives ?? []).find((d) => d.kind === 'protected_view');
  return {
    status: r.protection_status as ProtectionStatus,
    detail: r.protection_detail,
    imagesUnchecked: r.protection_images_unchecked,
    protectedViewPath: r.protection_status === 'protected' && view ? view.storage_path : null,
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

export function toRecord(r: ContractRow): ContractRecord {
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

