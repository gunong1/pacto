import type { ExtractedDate, ExtractedPayment, ExtractionResult } from '@/data/ai/provider';
import { isNoticeKind } from '@/domain/noticeKind';
import { assignDateUses } from '../../../supabase/functions/_shared/analysisRules/dates';
import type { ReferenceRole } from '../../../supabase/functions/_shared/extraction';
import { EMPTY_DRAFT } from '@/data/draft';
import type { ContractDraft, DateDraft, PaymentDraft } from '@/data/repository';
import {
  DETAIL_DB_TO_KEY,
  cleanDetails,
  detailFields,
  profileOf,
  type ContractDateKind,
  type ContractType,
  type DetailValue,
  type SourceType,
} from '@/domain/contractTypes';
import { contractKindDef, legacyOf, type ClassificationMeta, type KindClassification } from '@/domain/contractKinds';
import { formatWon } from '@/domain/money';
import { isPayoutLike } from '@/domain/cashflow';
import type { EvidenceMap } from '@/domain/evidence';
import { maskSensitiveDeep } from '@/domain/sensitive';
import { kindMoneyFlows, normalizePartyRoles, partyRolesOf, ROLE_EQUIVALENTS } from '../../../supabase/functions/_shared/contractRegistry';
import { addDays, formatDateKo } from '@/domain/dates';
import type { AiCheck, Confidence } from '@/domain/types';

/**
 * 서버 분석 결과 → 등록 확인 화면 모델 (변환만).
 * 계약 의미(확정·조건부·총액·구성항목·참고 금액·결제일·날짜의 쓰임·통보기한·자동갱신)는 서버(supabase/functions/_shared/analysisRules)가
 * 한 곳에서 정한다. 이 파일은 그 결과를 폼 초안으로 옮기고, 서버가 준 신뢰도·출처·확인 사유를 "확인 필요" 표시와 안내 문구로 바꾼다.
 * 추출값은 사실이 아니라 사용자가 확인할 초안이다 — 사용자가 고친 값이 항상 우선한다.
 */


/** 분석 결과로 만드는 보증금 묶음의 임시 키 (저장하면 DB id로 바뀐다) */
export const DEPOSIT_FUND_KEY = 'deposit';

/** 기준 날짜를 따르는 결제 날짜 안내 (계약서 문구 · 기준 날짜 이름) */
const DATE_ANCHOR_COPY: Partial<Record<NonNullable<ExtractedPayment['dateSource']>, { phrase: string; label: string }>> = {
  contract_date: { phrase: '계약 당일', label: '계약일' },
  balance_date: { phrase: '잔금일', label: '잔금일' },
  move_in_date: { phrase: '입주일', label: '입주일' },
  start_date: { phrase: '계약 시작일', label: '계약 시작일' },
  end_date: { phrase: '종료일', label: '종료일' },
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: '높음', medium: '보통', low: '낮음' };

/** 저장할 계약 체크 (id·계약 id·상태는 저장소가 채움) */
export type ReviewCheck = Omit<AiCheck, 'id' | 'contractId' | 'status'>;

export interface ReviewModel {
  draft: ContractDraft;
  /** "확인 필요" 표시 경로: 'contractKind', 'startDate', 'payments.1.startsOn', 'details.interestRate', 'dates.0' … */
  flagged: Set<string>;
  /** 경로별 원문 근거(첫 번째) */
  /** 값마다 계약서 근거 (문장·쪽·문서) — 화면에서는 "계약서 근거 보기"로만 (src/domain/evidence.ts) */
  evidence: EvidenceMap;
  /** 경로별 안내 (왜 확인이 필요한지) */
  notes: Partial<Record<string, string>>;
  /** AI의 계약 종류 판단 (확인 화면 한 줄 표시 · 신뢰도 낮음이면 사용자가 골라야 최종 등록) */
  classification: KindClassification;
  /** 모든 유형의 상세 속성 추출값 — 사용자가 유형을 바꾸면 새 유형에 맞는 값만 다시 고른다 */
  allDetails: Record<string, DetailValue>;
  /** PACTO 계약 체크 (원문 근거 문서 id 연결) */
  checks: ReviewCheck[];
  /** 결제로 만들지 않은 합계·참고·면제·할인 금액 (예: 차량가, 등록비 면제) — 확인용으로만 보여준다 */
  references: { label: string; amount: number; role: ReferenceRole }[];
  /**
   * 금액을 비워 두는 결제 (폼의 결제 순서) — 계약서 금액이 할인 전(정상가)이라 실제 결제액을 사용자가 입력해야 저장된다.
   * draft의 amount는 계약서에 적힌 할인 전 금액 그대로 (안내 문구용)
   */
  blankAmounts: number[];
}

export type { ReferenceRole };

/** 할인 전 금액 안내 */
export const DISCOUNT_CHECK_LABEL = '할인 적용 금액 확인 필요';
export const discountNote = (base: number) =>
  `${DISCOUNT_CHECK_LABEL} — 계약서의 ${formatWon(base)}은 할인 전(정상가) 금액이에요. 할인을 적용한 실제 결제액을 입력해주세요. (할인 조건은 아래 계약 체크에 있어요)`;

/**
 * @param documentIds 보관된 원본 id (첨부 순서) — 계약 체크의 근거 파일 번호를 문서 id로 연결한다
 */
export function toReviewModel(input: ExtractionResult, documentIds: readonly string[] = []): ReviewModel {
  // 방어선: 서버가 이미 가렸어도(또는 예전 서버 결과여도) 화면 모델에 들어오기 전에 공통 정책으로 다시 가린다 (이미 가린 값은 그대로)
  const result = maskSensitiveDeep(input);
  const flagged = new Set<string>();
  const evidence: EvidenceMap = {};
  const notes: Partial<Record<string, string>> = {};
  const quote = (path: string, e?: { quote: string; page?: number | null; file?: number | null }[]) => {
    const x = e?.[0];
    if (x?.quote) evidence[path] = { quote: x.quote, page: x.page ?? null, documentId: (x.file ? documentIds[x.file - 1] : undefined) ?? documentIds[0] ?? null };
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

  // 1) 계약 종류 — 서버가 검증한 AI 판단 그대로 (앱이 다시 분류하지 않음). 사용자가 바꿀 수 있다
  const c = result.classification;
  const classification: KindClassification = { kind: c.kind, subtype: c.subtype, confidence: c.confidence, alternatives: [...c.alternatives], reason: c.reason };
  uncertain('contractKind', c.confidence);
  const ev = c.evidence?.[0];
  const meta: ClassificationMeta = {
    confidence: c.confidence,
    alternatives: [...c.alternatives],
    reason: c.reason,
    evidence: ev ? { quote: ev.quote, page: ev.page ?? null, fileIndex: ev.file ? ev.file - 1 : null } : null,
    secondaryElements: c.secondaryElements.map((x) => ({ ...x })),
    domains: [...c.domains],
    source: 'ai',
  };
  /** 관리 프로필 (화면 이름·유형별 속성 묶음) — 결제 방식이 아님 */
  const type = (contractKindDef(c.kind)?.profile ?? 'other') as ContractType;

  // 공통 필드
  const draft: ContractDraft = { ...EMPTY_DRAFT, contractKind: c.kind, contractSubtype: c.subtype, classification: meta, ...legacyOf(c.kind), payments: [], dates: [] };
  for (const [key, f] of Object.entries(result.fields)) {
    if (!f) continue;
    if (f.value != null) (draft as unknown as Record<string, unknown>)[key] = f.value;
    if (f.value != null && f.confidence === 'low') flagged.add(key);
    quote(key, f.evidence);
  }

  // 3·4) 날짜 — 서버가 정한 쓰임(체결·시작·종료·통보·주요 날짜·결제 정보)대로 옮긴다 (앱이 다시 고르지 않음)
  // 쓰임이 없는 결과(이전 버전 서버)는 같은 공용 규칙으로 한 번 정한다
  const dated = result.dates.some((d) => d.use) ? result.dates : withDateUses(result, type);
  const assignDate = (field: 'startDate' | 'endDate' | 'contractDate', d: ExtractedDate | undefined) => {
    if (!d) return;
    draft[field] = d.date;
    uncertain(field, d.confidence);
    quote(field, d.evidence);
    source(field, d.sourceType);
  };
  assignDate('contractDate', dated.find((d) => d.use === 'contract_date'));
  assignDate('startDate', dated.find((d) => d.use === 'start'));
  assignDate('endDate', dated.find((d) => d.use === 'end'));

  // 통보기한 — 서버가 확정(일수·신뢰도)한 값 그대로. 날짜만 있던 경우의 일수 계산도 서버가 한다
  if (draft.terminationNoticeDays != null && result.fields.terminationNoticeDays?.confidence === 'low') {
    notes.terminationNoticeDays = '계약서에서 확인이 필요한 통보기한이에요. 계약 체크에서 넣을지 골라주세요.';
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
  const blankAmounts: number[] = [];
  // 결제 — 서버가 정한 결제(총액·구성항목·참고 금액은 이미 나뉘어 있음)를 그대로 옮긴다
  result.payments.forEach((p, i) => {
    const path = `payments.${i}`;
    const startsOn = p.date;
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
    // 결제일은 서버가 정한 값 그대로 — 모르면 비워 두고 "확인 필요" (다른 결제의 결제일·시작일의 날짜를 쓰지 않음, 반복 일정도 만들지 않음)
    const dayOfMonth = p.dayOfMonth;
    if (p.frequency !== 'one_time' && dayOfMonth == null && p.obligation !== 'conditional') {
      if (confirmed) flagged.add(`${path}.dayOfMonth`);
      notes[`${path}.dayOfMonth`] =
        isPayoutLike(p)
          ? '계약서에 지급일이 없어요. 지급일을 입력하면 매월 지급 일정이 캘린더에 생겨요. (근로 시작일을 지급일로 쓰지 않아요)'
          : '계약서에 결제일이 없어요. 결제일을 입력하면 반복 결제 일정이 캘린더에 생겨요. (계약 시작일이나 다른 결제의 날짜를 결제일로 쓰지 않아요)';
    }
    uncertain(`${path}.amount`, p.confidence);
    quote(`${path}.amount`, p.evidence);
    // 할인 전(정상가) 금액: 결제액으로 채우지 않는다 — 사용자가 실제 결제액을 입력해야 저장 (자동 계산하지 않음)
    if (p.amountCheck === 'discount_unconfirmed') {
      blankAmounts.push(i);
      flagged.add(`${path}.amount`);
      notes[`${path}.amount`] = discountNote(p.amount);
    }
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
      // 돈의 성격·계약서가 밝힌 지급자/수령자·방향 근거 (서버 F1) — 이전 버전 결과에는 없음 (예전 데이터처럼)
      ...(p.moneyNature ? { moneyNature: p.moneyNature } : {}),
      ...(p.payerRole ? { payerRole: p.payerRole } : {}),
      ...(p.payeeRole ? { payeeRole: p.payeeRole } : {}),
      ...(p.directionBasis ? { directionBasis: p.directionBasis } : {}),
      ...(p.moneyNature === 'refundable_deposit' ? { fundKey: DEPOSIT_FUND_KEY } : {}),
    };
    draft.payments.push(payment);
  });

  // 주요 날짜 — 서버가 주요 날짜(key)로 정한 날짜만 (반복 결제일·결제와 같은 잔금일·체결일 등은 서버가 이미 뺐다)
  const dates: DateDraft[] = [];
  for (const d of dated) {
    if (d.use !== 'key' || !d.keyKind) continue;
    uncertain(`dates.${dates.length}`, d.confidence);
    quote(`dates.${dates.length}`, d.evidence);
    source(`dates.${dates.length}`, d.sourceType);
    dates.push({ kind: d.keyKind as ContractDateKind, label: d.label, date: d.date });
  }
  draft.dates = dates;
  // 결제가 아닌 금액 (참고·면제·할인 전 …) — 서버가 정한 그대로 저장
  draft.referenceAmounts = (result.references ?? []).map(({ label, amount, role }) => ({ label, amount, role }));

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

  // 7-1) 계약 당사자 — 서버가 계약 종류의 역할로 정리한 값 그대로. 원래 있어야 하는 역할을 찾지 못했으면 비워 두고 "확인 필요"
  // (다른 쪽 이름으로 채우지 않음). 내 역할은 고르지 않는다 (기본 모름). 이전 버전 결과(parties 없음)는 상대방 이름(counterparty) 그대로
  const parties = (result as { parties?: ExtractionResult['parties'] }).parties;
  if (parties) {
    // 계약서 용어(임대인)는 서버가 계약 종류의 자리(렌탈회사)로 이미 연결 — 용어는 표시용으로 함께
    draft.parties = parties.map((p) => (p.term ? { role: p.role, name: p.name, term: p.term } : { role: p.role, name: p.name }));
    // 같은 자리에 서로 다른 이름(렌탈회사 A · 임대인 B)이 있으면 두 칸 모두 확인 필요 — 어느 쪽이 맞는지 사용자가
    const eq = ROLE_EQUIVALENTS[c.kind] ?? {};
    for (const role of normalizePartyRoles(c.kind, draft.parties).conflicts) {
      for (const path of [`parties.${role}`, `parties.${eq[role]}`]) {
        flagged.add(path);
        notes[path] ??= '같은 자리에 서로 다른 이름이 있어요. 계약서를 보고 맞는 이름을 남겨주세요.';
      }
    }
    // 당사자를 찾았으면 "상대방" 한 칸(사용자 쪽을 가정한 값)은 쓰지 않는다
    if (parties.length > 0) draft.counterparty = null;
    const roles = [...partyRolesOf(c.kind).map((r) => r.code), ...parties.map((p) => p.role)];
    for (const role of roles.filter((r, i) => roles.indexOf(r) === i)) {
      const path = `parties.${role}`;
      const mine = parties.filter((p) => p.role === role);
      if (mine.length === 0) {
        if (partyRolesOf(c.kind).find((r) => r.code === role)?.main) {
          flagged.add(path);
          notes[path] ??= '계약서에서 찾지 못했어요. 계약서를 보고 입력해주세요.';
        }
        continue;
      }
      if (mine.some((p) => p.confidence !== 'high')) flagged.add(path);
      quote(path, mine.find((p) => p.evidence?.length)?.evidence);
    }
  }

  // 돌려받을 돈 묶음 — 보증금 몫(계약금·잔금)이 있거나 계약 요약에 보증금이 있으면 보증금 묶음 하나 (총액 = 계약 요약 보증금)
  // 반환일은 계약서에 적혀 있지 않으면 비워 둔다 (종료일을 확정 반환일로 쓰지 않음 — 종료일에 "반환 확인")
  const depositParts = draft.payments.some((p) => p.fundKey === DEPOSIT_FUND_KEY);
  if (depositParts || ((draft.depositAmount ?? 0) > 0 && kindMoneyFlows(c.kind).deposit)) {
    draft.funds = [{ key: DEPOSIT_FUND_KEY, kind: 'deposit', label: '보증금', totalAmount: null, returnDueOn: null, depositorRole: null, holderRole: null }];
  }

  // 값이 없으면 "확인 필요"
  if (!draft.title) flagged.add('title');
  if (!parties && !draft.counterparty) flagged.add('counterparty');
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
    amount: c.amount ?? null,
    amountNote: c.amountNote ?? null,
    semanticKey: c.semanticKey ?? null,
    derivedFrom: c.derivedFrom ?? null,
    userAction: c.userAction ?? null,
    suggestion: c.suggestion,
  }));

  return {
    draft,
    flagged,
    evidence,
    notes,
    classification,
    allDetails,
    checks,
    references: draft.referenceAmounts.map((r) => ({ ...r })),
    blankAmounts,
  };
}

/** 날짜 쓰임이 없는 분석 결과(이전 버전 서버) — 서버와 같은 공용 규칙(analysisRules/dates.ts)으로 한 번 정한다 */
function withDateUses(result: ExtractionResult, type: ContractType): ExtractedDate[] {
  const dates = result.dates.map((d) => ({ ...d }));
  assignDateUses(dates, type, result.payments);
  return dates;
}

/** 해지 통보기한 날짜 (계약 체크 카드에 "언제까지"를 보여주기 위해) */
export function noticeDeadlineFor(endDate: string | null, noticeDays: number | null): string | null {
  return endDate && noticeDays != null ? addDays(endDate, -noticeDays) : null;
}
