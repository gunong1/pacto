import type { ExtractedDate, ExtractionResult } from '@/data/ai/provider';
import { EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft, DateDraft, PaymentDraft } from '@/data/repository';
import {
  CONTRACT_TYPE_PROFILES,
  CONTRACT_TYPES,
  DETAIL_FIELDS,
  cleanDetails,
  type ContractDateKind,
  type ContractType,
  type DetailValue,
} from '@/domain/contractTypes';
import { diffDays } from '@/domain/dates';
import type { Confidence } from '@/domain/types';

/**
 * AI 추출 결과(초안) → 확인 화면 모델.
 * 순서: 계약 유형 → 날짜의 의미로 시작·종료·체결일·주요 날짜를 고름 → 금액을 결제 목록으로 → 유형별 속성.
 * 유형은 날짜 이름을 고르는 기준일 뿐, 계약서에 있는 날짜·금액은 버리지 않는다.
 * 추출값은 사실이 아니라 사용자가 확인할 초안이다.
 */

type Meaning = ExtractedDate['meaning'];

/** 유형별 시작일·종료일로 쓸 날짜 의미 (앞쪽 우선) */
const START_MEANINGS: Record<ContractType, Meaning[]> = {
  recurring: ['service_start', 'contract_start', 'installation', 'activation'],
  lease: ['contract_start', 'move_in'],
  auto_installment: ['loan_execution', 'contract_start'],
  loan: ['loan_execution', 'contract_start'],
  insurance: ['coverage_start', 'contract_start'],
  one_time: ['contract_start', 'service_start'],
  other: ['contract_start', 'service_start', 'coverage_start', 'loan_execution'],
};
const END_MEANINGS: Record<ContractType, Meaning[]> = {
  recurring: ['contract_end', 'maturity'],
  lease: ['contract_end', 'maturity'],
  auto_installment: ['maturity', 'contract_end'],
  loan: ['maturity', 'contract_end'],
  insurance: ['maturity', 'contract_end'],
  one_time: ['completion', 'contract_end'],
  other: ['contract_end', 'maturity', 'completion'],
};
/** 주요 날짜(contract_dates)로 옮길 의미 */
const KEY_DATE_KIND: Partial<Record<Meaning, ContractDateKind>> = {
  installation: 'installation',
  activation: 'activation',
  move_in: 'move_in',
  balance_due: 'balance_due',
  renewal: 'renewal',
};
/** 시작·종료로 쓰이지 않으면 '기타 날짜'로 남길 의미 (계약서의 날짜를 버리지 않는다) */
const KEEP_AS_OTHER: ReadonlySet<Meaning> = new Set(['service_start', 'contract_start', 'loan_execution', 'coverage_start', 'maturity', 'contract_end', 'completion', 'other']);

/** '월 이용료' → '월 이용료와', '관리비 청구금' → '관리비 청구금과' */
function withWa(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0;
  return `${word}${hasFinal ? '과' : '와'}`;
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: '높음', medium: '보통', low: '낮음' };

export interface TypeSuggestion {
  value: ContractType;
  confidence: Confidence;
  alternatives: ContractType[];
  reason: string | null;
}

export interface ReviewModel {
  draft: ContractDraft;
  /** "확인 필요" 표시 경로: 'contractType', 'startDate', 'payments.1.startsOn', 'dates.0' … */
  flagged: Set<string>;
  /** 경로별 원문 근거(첫 번째) */
  evidence: Partial<Record<string, string>>;
  /** 경로별 안내 (왜 확인이 필요한지) */
  notes: Partial<Record<string, string>>;
  typeSuggestion: TypeSuggestion;
  /** 모든 유형의 상세 속성 추출값 — 사용자가 유형을 바꾸면 새 유형에 맞는 값만 다시 고른다 */
  allDetails: Record<string, DetailValue>;
}

const DB_TO_KEY: Record<string, string> = Object.fromEntries(CONTRACT_TYPES.flatMap((t) => DETAIL_FIELDS[t].map((f) => [f.db, f.key])));

export function toReviewModel(result: ExtractionResult): ReviewModel {
  const flagged = new Set<string>();
  const evidence: Partial<Record<string, string>> = {};
  const notes: Partial<Record<string, string>> = {};
  const quote = (path: string, e?: { quote: string }[]) => {
    if (e?.[0]?.quote) evidence[path] = e[0].quote;
  };
  const uncertain = (path: string, c: Confidence) => {
    if (c !== 'high') flagged.add(path);
  };

  // 1) 유형
  const type = result.contractType.value;
  const typeSuggestion: TypeSuggestion = {
    value: type,
    confidence: result.contractType.confidence,
    alternatives: [...result.contractType.alternatives],
    reason: result.contractType.reason,
  };
  if (result.contractType.confidence !== 'high') flagged.add('contractType');
  quote('contractType', result.contractType.evidence);

  // 2) 공통 필드
  const draft: ContractDraft = { ...EMPTY_DRAFT, contractType: type, payments: [], dates: [] };
  for (const [key, f] of Object.entries(result.fields)) {
    if (!f) continue;
    if (f.value != null) (draft as unknown as Record<string, unknown>)[key] = f.value;
    if (f.value != null && f.confidence === 'low') flagged.add(key);
    quote(key, f.evidence);
  }

  // 3) 날짜: 의미별로 체결일·시작일·종료일을 고르고 나머지는 주요 날짜로
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
  };
  // 체결일은 계약서에 명확히 있을 때만 (없으면 만들지 않는다)
  assignDate('contractDate', pick(['contract_signed']));
  assignDate('startDate', pick(START_MEANINGS[type]));
  assignDate('endDate', pick(END_MEANINGS[type]));

  // 통보기한 날짜만 있고 일수가 없으면 종료일과의 차이로 계산 (확인 필요)
  const noticeDate = result.dates.find((d) => d.meaning === 'notice_deadline');
  if (noticeDate) used.add(noticeDate);
  if (noticeDate && draft.terminationNoticeDays == null && draft.endDate && noticeDate.date <= draft.endDate) {
    draft.terminationNoticeDays = diffDays(noticeDate.date, draft.endDate);
    flagged.add('terminationNoticeDays');
    notes.terminationNoticeDays = `계약서의 통보기한 날짜(${noticeDate.date})로 계산했어요.`;
    quote('terminationNoticeDays', noticeDate.evidence);
  }

  // 4) 결제 — 계약서에 있는 돈을 모두 결제 목록으로
  const firstPayment = result.dates.find((d) => d.meaning === 'first_payment');
  result.payments.forEach((p, i) => {
    const path = `payments.${i}`;
    let startsOn = p.date;
    if (!startsOn && p.frequency !== 'one_time' && firstPayment) {
      startsOn = firstPayment.date;
      used.add(firstPayment);
    }
    if (!startsOn && p.frequency === 'one_time') {
      // 날짜가 없는 일회성 비용: 비워 두면 계약 시작일로 계산된다. 확정하지 않고 "확인 필요"로 보여준다
      flagged.add(`${path}.startsOn`);
      notes[`${path}.startsOn`] = draft.startDate
        ? '계약서에 결제일이 없어 계약 시작일로 계산했어요. 다른 날이면 입력해주세요.'
        : '계약서에 결제일이 없어요. 결제일을 입력해주세요.';
    }
    let dayOfMonth = p.dayOfMonth;
    if (p.frequency !== 'one_time' && dayOfMonth == null && !startsOn) {
      // 같은 주기의 다른 결제에 결제일이 있으면 함께 청구되는 것으로 보고 그 날짜를 쓴다 (예: 락커 이용료 → 월 이용료 결제일)
      const sibling = result.payments.find((x) => x !== p && x.frequency === p.frequency && x.dayOfMonth != null);
      dayOfMonth = sibling?.dayOfMonth ?? null;
      flagged.add(`${path}.dayOfMonth`);
      notes[`${path}.dayOfMonth`] = sibling
        ? `결제일이 따로 없어 ${withWa(sibling.label)} 같은 ${sibling.dayOfMonth}일로 넣었어요. 확인해주세요.`
        : '계약서에 결제일이 없어요. 시작일 기준으로 계산되니 실제 결제일을 확인해주세요.';
    }
    if (p.optional) {
      flagged.add(`${path}.amount`);
      notes[`${path}.amount`] = '선택 항목이에요. 신청하지 않았다면 이 결제를 삭제해주세요.';
    }
    uncertain(`${path}.amount`, p.confidence);
    quote(`${path}.amount`, p.evidence);
    const payment: PaymentDraft = {
      kind: p.kind,
      label: p.label,
      amount: p.amount,
      frequency: p.frequency,
      dayOfMonth,
      monthOfYear: null,
      startsOn,
      endsOn: p.endDate,
      installmentCount: p.installmentCount,
      isVariable: p.isVariable,
    };
    draft.payments.push(payment);
  });

  // 5) 주요 날짜 — 체결·시작·종료·첫 결제일로 쓴 날짜, 결제와 겹치는 잔금일은 제외
  const dates: DateDraft[] = [];
  for (const d of result.dates) {
    if (used.has(d) || d.meaning === 'contract_signed') continue;
    const kind = KEY_DATE_KIND[d.meaning] ?? (KEEP_AS_OTHER.has(d.meaning) ? 'other' : null);
    if (!kind) continue;
    if (kind === 'balance_due' && draft.payments.some((p) => p.startsOn === d.date && p.frequency === 'one_time')) continue;
    if (d.date === draft.startDate && kind === 'other') continue;
    if (d.date === draft.endDate && kind === 'other') continue;
    if (dates.some((x) => x.kind === kind && x.date === d.date)) continue;
    uncertain(`dates.${dates.length}`, d.confidence);
    quote(`dates.${dates.length}`, d.evidence);
    dates.push({ kind, label: d.label, date: d.date });
  }
  draft.dates = dates;

  // 6) 유형별 속성
  const allDetails: Record<string, DetailValue> = {};
  for (const [db, v] of Object.entries(result.details ?? {})) {
    const key = DB_TO_KEY[db];
    if (key) allDetails[key] = v;
  }
  draft.details = cleanDetails(type, allDetails);

  // 7) 값이 없으면 "확인 필요"
  if (!draft.title) flagged.add('title');
  if (!draft.counterparty) flagged.add('counterparty');
  if (!draft.startDate) flagged.add('startDate');
  if (!draft.endDate && type !== 'recurring') flagged.add('endDate');
  if (draft.payments.length === 0) {
    flagged.add('payments');
    notes.payments = '계약서에서 결제 정보를 찾지 못했어요. 내는 돈이 있으면 추가해주세요.';
  }
  if (CONTRACT_TYPE_PROFILES[type].hasRenewal && draft.autoRenewal && draft.terminationNoticeDays == null) flagged.add('terminationNoticeDays');

  return { draft, flagged, evidence, notes, typeSuggestion, allDetails };
}
