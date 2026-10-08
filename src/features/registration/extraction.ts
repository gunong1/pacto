import type { ExtractedDate, ExtractedPayment, ExtractionResult } from '@/data/ai/provider';
import { isNoticeKind } from '@/domain/noticeKind';
import { EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft, DateDraft, PaymentDraft } from '@/data/repository';
import {
  DETAIL_DB_TO_KEY,
  cleanDetails,
  detailFields,
  profileOf,
  type ContractCategory,
  type ContractDateKind,
  type ContractType,
  type DetailValue,
  type SourceType,
} from '@/domain/contractTypes';
import { formatWon } from '@/domain/money';
import { addDays, diffDays, formatDateKo } from '@/domain/dates';
import type { AiCheck, Confidence } from '@/domain/types';

/**
 * AI 분석 결과(초안) → 확인 화면 모델.
 * 순서: 분야·유형 → 날짜 의미로 시작·종료·체결일·주요 날짜 → 금액을 결제 목록(의미·방향)으로 → 유형별 속성 → PACTO 계약 체크.
 * 유형은 날짜 이름을 고르는 기준일 뿐, 계약서에 있는 날짜·금액은 버리지 않는다. 계약서에 없는 값은 만들지 않는다.
 * 추출값은 사실이 아니라 사용자가 확인할 초안이다 — 신뢰도가 높지 않은 값은 "확인 필요"로 표시한다.
 */

type Meaning = ExtractedDate['meaning'];

/** 기준 날짜를 따르는 결제 날짜 안내 (계약서 문구 · 기준 날짜 이름) */
const DATE_ANCHOR_COPY: Partial<Record<NonNullable<ExtractedPayment['dateSource']>, { phrase: string; label: string }>> = {
  contract_date: { phrase: '계약 당일', label: '계약일' },
  balance_date: { phrase: '잔금일', label: '잔금일' },
  move_in_date: { phrase: '입주일', label: '입주일' },
  start_date: { phrase: '계약 시작일', label: '계약 시작일' },
  end_date: { phrase: '종료일', label: '종료일' },
};

/** 유형별 시작일·종료일로 쓸 날짜 의미 (앞쪽 우선). 없는 유형은 기본값 */
const START_MEANINGS: Partial<Record<ContractType, Meaning[]>> = {
  recurring: ['service_start', 'contract_start', 'installation', 'activation'],
  lease: ['contract_start', 'move_in'],
  installment: ['loan_execution', 'contract_start'],
  loan: ['loan_execution', 'contract_start'],
  insurance: ['coverage_start', 'contract_start'],
  employment: ['contract_start', 'hire'],
  service: ['contract_start', 'service_start'],
  sale: ['contract_start'],
  one_time: ['contract_start', 'service_start'],
};
const END_MEANINGS: Partial<Record<ContractType, Meaning[]>> = {
  installment: ['maturity', 'contract_end'],
  loan: ['maturity', 'contract_end'],
  insurance: ['maturity', 'contract_end'],
  service: ['contract_end', 'completion', 'delivery'],
  sale: ['completion', 'contract_end'],
  one_time: ['completion', 'contract_end'],
};
const DEFAULT_START: Meaning[] = ['contract_start', 'service_start', 'coverage_start', 'loan_execution'];
const DEFAULT_END: Meaning[] = ['contract_end', 'maturity', 'completion'];

/** 주요 날짜(contract_dates)로 옮길 의미 */
const KEY_DATE_KIND: Partial<Record<Meaning, ContractDateKind>> = {
  installation: 'installation',
  activation: 'activation',
  move_in: 'move_in',
  balance_due: 'balance_due',
  renewal: 'renewal',
  hire: 'hire',
  delivery: 'delivery',
  inspection: 'inspection',
  handover: 'handover',
  ownership_transfer: 'ownership_transfer',
};
/** 시작·종료로 쓰이지 않으면 '기타 날짜'로 남길 의미 (계약서의 날짜를 버리지 않는다) */
const KEEP_AS_OTHER: ReadonlySet<Meaning> = new Set(['service_start', 'contract_start', 'loan_execution', 'coverage_start', 'maturity', 'contract_end', 'completion', 'other']);

export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: '높음', medium: '보통', low: '낮음' };

/** '월 이용료' → '월 이용료와', '관리비 청구금' → '관리비 청구금과' */
function withWa(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0;
  return `${word}${hasFinal ? '과' : '와'}`;
}

export interface Suggestion<T extends string> {
  value: T;
  confidence: Confidence;
  alternatives: T[];
  reason: string | null;
}

/** 저장할 계약 체크 (id·계약 id·상태는 저장소가 채움) */
export type ReviewCheck = Omit<AiCheck, 'id' | 'contractId' | 'status'>;

export interface ReviewModel {
  draft: ContractDraft;
  /** "확인 필요" 표시 경로: 'category', 'contractType', 'startDate', 'payments.1.startsOn', 'details.interestRate', 'dates.0' … */
  flagged: Set<string>;
  /** 경로별 원문 근거(첫 번째) */
  evidence: Partial<Record<string, string>>;
  /** 경로별 안내 (왜 확인이 필요한지) */
  notes: Partial<Record<string, string>>;
  categorySuggestion: Suggestion<ContractCategory>;
  typeSuggestion: Suggestion<ContractType>;
  /** 모든 유형의 상세 속성 추출값 — 사용자가 유형을 바꾸면 새 유형에 맞는 값만 다시 고른다 */
  allDetails: Record<string, DetailValue>;
  /** PACTO 계약 체크 (원문 근거 문서 id 연결) */
  checks: ReviewCheck[];
  /** 결제로 만들지 않은 합계·참고 금액 (예: 차량가) — 확인용으로만 보여준다 */
  references: { label: string; amount: number }[];
}

/**
 * @param documentIds 보관된 원본 id (첨부 순서) — 계약 체크의 근거 파일 번호를 문서 id로 연결한다
 */
export function toReviewModel(result: ExtractionResult, documentIds: readonly string[] = []): ReviewModel {
  const flagged = new Set<string>();
  const evidence: Partial<Record<string, string>> = {};
  const notes: Partial<Record<string, string>> = {};
  const quote = (path: string, e?: { quote: string }[]) => {
    if (e?.[0]?.quote) evidence[path] = e[0].quote;
  };
  const uncertain = (path: string, c: Confidence) => {
    if (c !== 'high') flagged.add(path);
  };
  // 값별 출처 — 계약서 명시(explicit) / AI 추정(inferred). 추정값은 계약서와 비교하도록 "확인 필요"
  const valueSources: Record<string, SourceType> = {};
  const source = (path: string, s: SourceType | undefined) => {
    if (!s) return;
    valueSources[path] = s;
    if (s === 'inferred') {
      flagged.add(path);
      notes[path] ??= '계약서에 그대로 적힌 값이 아니라 AI가 문맥으로 추정한 값이에요.';
    }
  };

  // 1·2) 분야·유형 — 확정하지 않고 사용자가 바꿀 수 있게 제안으로
  const type = result.contractType.value;
  const typeSuggestion: Suggestion<ContractType> = { ...result.contractType, alternatives: [...result.contractType.alternatives] };
  const categorySuggestion: Suggestion<ContractCategory> = { ...result.category, alternatives: [...result.category.alternatives] };
  uncertain('contractType', result.contractType.confidence);
  uncertain('category', result.category.confidence);

  // 공통 필드
  const draft: ContractDraft = { ...EMPTY_DRAFT, category: result.category.value, contractType: type, payments: [], dates: [] };
  for (const [key, f] of Object.entries(result.fields)) {
    if (!f) continue;
    if (f.value != null) (draft as unknown as Record<string, unknown>)[key] = f.value;
    if (f.value != null && f.confidence === 'low') flagged.add(key);
    quote(key, f.evidence);
  }

  // 3·4) 날짜: 의미별로 체결일·시작일·종료일을 고르고 나머지는 주요 날짜로
  const used = new Set<ExtractedDate>();
  const pick = (meanings: Meaning[]) => {
    for (const m of meanings) {
      const d = result.dates.find((x) => x.meaning === m && !used.has(x));
      if (d) return d;
    }
    return null;
  };
  const assignDate = (field: 'startDate' | 'endDate' | 'contractDate', d: ExtractedDate | null) => {
    if (!d) return;
    used.add(d);
    draft[field] = d.date;
    uncertain(field, d.confidence);
    quote(field, d.evidence);
    source(field, d.sourceType);
  };
  // 체결일은 계약서에 명확히 있을 때만 (다른 날짜로 대신하지 않는다)
  assignDate('contractDate', pick(['contract_signed']));
  assignDate('startDate', pick(START_MEANINGS[type] ?? DEFAULT_START));
  assignDate('endDate', pick(END_MEANINGS[type] ?? DEFAULT_END));

  // 통보기한 날짜만 있고 일수가 없으면 종료일과의 차이로 계산 (확인 필요)
  const noticeDate = result.dates.find((d) => d.meaning === 'notice_deadline');
  if (noticeDate) used.add(noticeDate);
  if (noticeDate && draft.terminationNoticeDays == null && draft.endDate && noticeDate.date <= draft.endDate) {
    draft.terminationNoticeDays = diffDays(noticeDate.date, draft.endDate);
    flagged.add('terminationNoticeDays');
    notes.terminationNoticeDays = `계약서의 통보기한 날짜(${noticeDate.date})로 계산했어요.`;
    quote('terminationNoticeDays', noticeDate.evidence);
  }

  // 통보기한의 의미 — 서버가 원문보다 강하게 해석하지 않도록 정리한 값. 없거나 불확실하면 unknown + 확인 필요
  const kind = result.fields.noticeKind;
  draft.noticeKind = draft.terminationNoticeDays != null && isNoticeKind(kind?.value) ? kind.value : 'unknown';
  if (draft.terminationNoticeDays != null && (draft.noticeKind === 'unknown' || kind?.confidence !== 'high')) {
    flagged.add('noticeKind');
    notes.noticeKind =
      draft.noticeKind === 'unknown'
        ? '이 기한이 해지 통보인지, 갱신 통보인지, 갱신 여부 협의인지 확실하지 않아요. 원문을 보고 골라주세요.'
        : `계약서 원문과 비교해 이 기한의 의미를 확인해주세요.${evidence.noticeKind ?? evidence.terminationNoticeDays ? ` 원문: “${evidence.noticeKind ?? evidence.terminationNoticeDays}”` : ''}`;
  }

  // 5·6) 결제 — 계약서에 있는 돈을 모두 결제 목록으로 (의미·주기·방향)
  const firstPayment = result.dates.find((d) => d.meaning === 'first_payment');
  result.payments.forEach((p, i) => {
    const path = `payments.${i}`;
    let startsOn = p.date;
    if (!startsOn && p.frequency !== 'one_time' && firstPayment) {
      startsOn = firstPayment.date;
      used.add(firstPayment);
    }
    const confirmed = p.obligation === 'confirmed';
    if (!startsOn && p.frequency === 'one_time' && confirmed) {
      // 날짜가 없는 일회성 금액: 비워 두면 계약 시작일로 계산된다. 확정하지 않고 "확인 필요"로 보여준다
      flagged.add(`${path}.startsOn`);
      notes[`${path}.startsOn`] = draft.startDate
        ? '계약서에 날짜가 없어 계약 시작일로 계산했어요. 다른 날이면 입력해주세요.'
        : '계약서에 날짜가 없어요. 날짜를 입력해주세요.';
    }
    // 날짜의 출처: "계약 당일 지급"처럼 다른 날짜를 기준으로 한 금액은 그 기준 날짜로 (옆 줄 날짜를 옮기지 않는다)
    const anchor = p.dateSource ? DATE_ANCHOR_COPY[p.dateSource] : undefined;
    if (anchor && p.frequency === 'one_time') {
      if (startsOn) {
        notes[`${path}.startsOn`] = `계약서에 '${anchor.phrase}'로 적혀 있어 ${anchor.label}(${formatDateKo(startsOn)})로 넣었어요.`;
      } else if (confirmed) {
        flagged.add(`${path}.startsOn`);
        notes[`${path}.startsOn`] = `계약서에 '${anchor.phrase}'로 적혀 있지만 ${anchor.label}이 계약서에 없어요. 비워두면 계약 시작일로 계산되니 실제 날짜를 입력해주세요.`;
      }
    } else if (startsOn && (p.dateSource === 'calculated' || p.dateSource === 'inferred')) {
      flagged.add(`${path}.startsOn`);
      notes[`${path}.startsOn`] =
        p.dateSource === 'calculated' ? '계약서 문구로 계산한 날짜예요. 계약서와 같은지 확인해주세요.' : '계약서에 이 금액의 날짜가 직접 적혀 있지 않아 AI가 추정한 날짜예요. 확인해주세요.';
    }
    let dayOfMonth = p.dayOfMonth;
    if (p.frequency !== 'one_time' && dayOfMonth == null && !startsOn && p.obligation !== 'conditional') {
      // 같은 주기의 다른 결제에 결제일이 있으면 함께 청구되는 것으로 보고 그 날짜를 쓴다 (예: 락커 이용료 → 월 이용료 결제일)
      const sibling = result.payments.find((x) => x !== p && x.frequency === p.frequency && x.dayOfMonth != null);
      dayOfMonth = sibling?.dayOfMonth ?? null;
      if (confirmed) flagged.add(`${path}.dayOfMonth`);
      notes[`${path}.dayOfMonth`] = sibling
        ? `날짜가 따로 없어 ${withWa(sibling.label)} 같은 ${sibling.dayOfMonth}일로 넣었어요. 확인해주세요.`
        : '계약서에 날짜가 없어요. 시작일 기준으로 계산되니 실제 날짜를 확인해주세요.';
    }
    uncertain(`${path}.amount`, p.confidence);
    quote(`${path}.amount`, p.evidence);
    // 확정이 아닌 금액은 결제 일정·지출에 넣지 않는다 — 실제로 신청했거나 이미 생긴 일이면 "확정 결제"로 바꾸도록 안내
    if (p.obligation === 'optional') {
      flagged.add(`${path}.obligation`);
      notes[`${path}.obligation`] = '선택 항목이에요. 신청(이용)한 경우에만 "확정 결제"로 바꿔주세요. 그 전에는 캘린더·지출에 넣지 않아요.';
    } else if (p.obligation === 'conditional' || p.obligation === 'potential') {
      notes[`${path}.obligation`] = '상황이 생겼을 때만 내는 돈이에요. 캘린더·지출에는 넣지 않고 계약 조건으로 보관해요.';
    }
    source(`${path}.amount`, p.sourceType);
    if (p.components.length > 0 && !notes[`${path}.amount`]) {
      notes[`${path}.amount`] = `${p.components.map((c) => `${c.label} ${formatWon(c.amount)}`).join(' + ')}로 구성된 금액이에요 (따로 더하지 않아요).`;
    }
    const payment: PaymentDraft = {
      kind: p.kind,
      direction: p.direction,
      label: p.label,
      amount: p.amount,
      frequency: p.frequency,
      dayOfMonth,
      monthOfYear: null,
      startsOn,
      endsOn: p.endDate,
      installmentCount: p.installmentCount,
      isVariable: p.isVariable,
      components: p.components.map((c) => ({ ...c })),
      businessDayRule: p.businessDayRule,
      obligation: p.obligation,
      conditionNote: p.conditionNote,
    };
    draft.payments.push(payment);
  });

  // 주요 날짜 — 체결·시작·종료·첫 결제일로 쓴 날짜, 결제와 겹치는 잔금일은 제외
  const dates: DateDraft[] = [];
  for (const d of result.dates) {
    if (used.has(d) || d.meaning === 'contract_signed') continue;
    const kind = KEY_DATE_KIND[d.meaning] ?? (KEEP_AS_OTHER.has(d.meaning) ? 'other' : null);
    if (!kind) continue;
    if (kind === 'balance_due' && draft.payments.some((p) => p.startsOn === d.date && p.frequency === 'one_time')) continue;
    if ((d.date === draft.startDate || d.date === draft.endDate) && kind === 'other') continue;
    if (dates.some((x) => x.kind === kind && x.date === d.date)) continue;
    uncertain(`dates.${dates.length}`, d.confidence);
    quote(`dates.${dates.length}`, d.evidence);
    source(`dates.${dates.length}`, d.sourceType);
    dates.push({ kind, label: d.label, date: d.date });
  }
  draft.dates = dates;

  // 7) 유형별 속성 — 모든 유형 값을 보관하고, 현재 유형에 맞는 값만 초안에
  const allDetails: Record<string, DetailValue> = {};
  for (const [db, d] of Object.entries(result.details ?? {})) {
    const key = DETAIL_DB_TO_KEY[db];
    if (!key) continue;
    allDetails[key] = d.value;
    if (detailFields(type).some((f) => f.key === key)) {
      uncertain(`details.${key}`, d.confidence);
      quote(`details.${key}`, d.evidence);
    }
    // 유형을 바꿔도 출처가 따라가도록 모든 속성의 출처를 남긴다 (저장 시 없는 속성의 출처는 무시됨)
    source(`details.${key}`, d.sourceType);
  }
  draft.details = cleanDetails(type, allDetails);
  draft.valueSources = valueSources;

  // 값이 없으면 "확인 필요"
  if (!draft.title) flagged.add('title');
  if (!draft.counterparty) flagged.add('counterparty');
  if (!draft.startDate) flagged.add('startDate');
  if (!draft.payments.some((p) => p.obligation === 'confirmed')) {
    flagged.add('payments');
    notes.payments =
      draft.payments.length === 0
        ? '계약서에서 금액 정보를 찾지 못했어요. 오가는 돈이 있으면 추가해주세요.'
        : '확정된 결제를 찾지 못했어요. 실제로 내는 돈이 있으면 "확정 결제"로 바꾸거나 추가해주세요.';
  }
  if (profileOf(type).hasRenewal && draft.autoRenewal && draft.terminationNoticeDays == null) flagged.add('terminationNoticeDays');

  // 9) PACTO 계약 체크 — 근거 파일 번호 → 보관된 원본 id
  const checks: ReviewCheck[] = result.checks.map((c) => ({
    severity: c.severity,
    topic: c.topic,
    title: c.title,
    description: c.description,
    confidence: c.confidence,
    evidenceQuote: c.evidenceQuote,
    evidencePage: c.evidencePage,
    evidenceDocumentId: c.evidenceFileIndex != null ? (documentIds[c.evidenceFileIndex] ?? documentIds[0] ?? null) : (documentIds[0] ?? null),
    relatedDate: c.relatedDate,
    behavior: c.behavior,
    rule: c.rule,
    suggestion: c.suggestion,
  }));

  return { draft, flagged, evidence, notes, categorySuggestion, typeSuggestion, allDetails, checks, references: (result.references ?? []).map(({ label, amount }) => ({ label, amount })) };
}

/** 해지 통보기한 날짜 (계약 체크 카드에 "언제까지"를 보여주기 위해) */
export function noticeDeadlineFor(endDate: string | null, noticeDays: number | null): string | null {
  return endDate && noticeDays != null ? addDays(endDate, -noticeDays) : null;
}
