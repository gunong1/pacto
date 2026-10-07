// 문서 확인 게이트 — "파일을 올렸다"와 "계약서로 인정한다"를 나눈다 (순수 TypeScript, Deno·Node 공용)
//
// 한 번의 AI 호출에서 document_check(문서 역할·쪽별 판정·계약 신호) + 계약 추출을 함께 받고,
// 서버가 여기서 진행 여부를 정한다. 통과하지 못한 파일의 추출 결과는 앱에 보내지 않는다
// → 엉뚱한 사진의 날짜·숫자로 계약·결제·일정·알림이 만들어지지 않는다.
//
// 쪽별 안전장치: 계약과 무관한 쪽(non_contract)·읽을 수 없는 쪽(unreadable)·사용자가 제외한 쪽에서만 근거가 나온 값은
// 결과에서 지운다 (모든 추출값에 evidence_file / evidence_page). 근거 위치를 알 수 없는 값이 남아 안전을 보장할 수 없으면
// 제외한 사진을 뺀 채 다시 분석한다 (needsReanalysis).

export const DOCUMENT_ROLES = ['contract', 'addendum', 'supporting', 'non_contract', 'uncertain', 'unreadable'] as const;
export type DocumentRole = (typeof DOCUMENT_ROLES)[number];

/** 판단 이유 코드 (원문 없음 — 화면 문구는 앱이 정한다) */
export const CHECK_REASONS = [
  'contract_terms', // 계약 조건(당사자·기간·금액·의무)이 있다
  'addendum_terms', // 특약·변경·추가 합의
  'supporting_material', // 견적서·청구서·납부내역·안내문 등 관련 자료
  'photo_not_document', // 문서가 아닌 사진 (음식·동물·사람·풍경·물건)
  'receipt', // 영수증
  'id_card', // 신분증
  'bank_statement', // 은행 거래내역
  'advertisement', // 광고·전단
  'screenshot', // SNS·뉴스 등 화면 캡처
  'blank_page', // 빈 종이
  'unrelated_document', // 계약과 무관한 문서
  'blurry', // 흔들림·초점
  'too_dark', // 너무 어두움
  'cropped', // 일부만 촬영
  'low_resolution', // 해상도 부족
  'mixed_pages', // 계약과 무관한 쪽이 섞임
  'duplicate_pages', // 같은 쪽이 중복
] as const;
export type CheckReason = (typeof CHECK_REASONS)[number];

/** 계약 신호 8종 */
export const SIGNAL_KEYS = ['parties', 'dates', 'amounts', 'obligations', 'purpose', 'termination_renewal', 'signature', 'contract_language'] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

const CONFIDENCE = ['high', 'medium', 'low'] as const;
type Confidence = (typeof CONFIDENCE)[number];

export interface PageCheck {
  /** 첨부 순서 (1부터) */
  file: number;
  /** 파일 안 쪽 번호 (1부터, 사진은 1) */
  page: number;
  role: DocumentRole;
  /** 같은 쪽으로 보이는 앞쪽 */
  duplicateOf: { file: number; page: number } | null;
}

export interface DocumentCheck {
  role: DocumentRole;
  confidence: Confidence;
  reasons: CheckReason[];
  signals: Record<SignalKey, boolean>;
  pages: PageCheck[];
}

export type GateDecision =
  | 'proceed' // 계약 분석 결과로 확인 화면
  | 'confirm_role' // 계약 관련 문서인지 사용자 확인
  | 'choose_pages' // 의심 사진 쪽을 제외할지 사용자 선택
  | 'stop_non_contract'
  | 'stop_unreadable'
  | 'stop_insufficient';

export interface FileKind {
  /** 첨부 순서 1부터 */
  file: number;
  pdf: boolean;
}

export interface DocumentValidation {
  role: DocumentRole;
  confidence: Confidence;
  reasons: CheckReason[];
  /** 서버가 추출 결과로 확인한 신호 (모델 판단 + 근거 있는 추출값) */
  signals: Record<SignalKey, boolean>;
  signalCount: number;
  decision: GateDecision;
  /** 의심 쪽 — 사진은 제외/포함 선택, PDF는 안내만 */
  suspiciousPages: (PageCheck & { pdf: boolean })[];
  /** 사용자가 "계약 관련 문서가 맞아요"를 눌러 진행했는지 */
  userConfirmedRole: boolean;
}

export const documentCheckJsonSchema = () => {
  const strict = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
  return strict({
    role: { type: 'string', enum: [...DOCUMENT_ROLES], description: '첨부 전체를 보고 판단한 문서 역할' },
    confidence: { type: 'string', enum: [...CONFIDENCE] },
    reasons: { type: 'array', items: { type: 'string', enum: [...CHECK_REASONS] }, description: '판단 이유 (최대 4개)' },
    signals: { type: 'array', items: { type: 'string', enum: [...SIGNAL_KEYS] }, description: '문서에서 확인된 계약 신호' },
    pages: {
      type: 'array',
      description: '파일·쪽마다 역할 (사진은 page=1). 같은 쪽을 두 번 찍었으면 duplicate_of',
      items: strict({
        file: { type: 'integer' },
        page: { type: 'integer' },
        role: { type: 'string', enum: [...DOCUMENT_ROLES] },
        duplicate_of_file: { type: ['integer', 'null'], description: '같은 쪽으로 보이는 앞 파일 (같은 PDF 안이면 이 파일 번호)' },
      }),
    },
  });
};

export const DOCUMENT_CHECK_INSTRUCTIONS = [
  '0) document_check — 추출보다 먼저, 첨부가 계약 관리 대상 문서인지 판단합니다. 제목 하나로 정하지 않고 신호를 함께 봅니다:',
  '   당사자(parties)·기간/날짜(dates)·금액/대가(amounts)·의무/약정(obligations)·계약 목적(purpose)·해지/갱신 조건(termination_renewal)·서명/날인(signature)·계약형 문장(contract_language: "…하기로 약정한다", "갑과 을은" 등).',
  '   role: contract(계약 본문: 임대차·근로·렌탈·보험·대출약정서, 제목이 신청서여도 요금·기간·해지 조건·당사자가 있으면 계약 성격) / addendum(특약서·변경계약서·추가합의서) /',
  '   supporting(견적서·청구서·납부내역·확인서·안내문처럼 계약과 관련된 자료) / non_contract(음식·동물·사람·풍경·물건 사진, 광고, 뉴스·SNS 캡처, 일반 영수증, 신분증만, 은행 거래내역만, 빈 종이, 무관한 문서) /',
  '   uncertain(판단하기 어려움) / unreadable(문서처럼 보이지만 흐림·어두움·잘림·저해상도로 글자를 읽기 어려움).',
  '   개인정보(주민등록번호 등)가 보인다는 이유만으로 계약으로 보지 않습니다. pages에 파일·쪽마다 역할을 적고, 같은 쪽을 두 번 찍었으면 duplicate_of_file/page.',
  '   계약 문서가 아니거나(non_contract) 읽을 수 없는(unreadable) 경우 계약정보를 추측하여 생성하지 않습니다: fields의 value는 모두 null, dates·payments·details·checks는 빈 배열, category·contract_type은 other(confidence low).',
  '   계약과 무관하거나 읽을 수 없는 쪽의 날짜·숫자는 추출에 쓰지 않습니다. 같은 쪽이 중복되어도 같은 금액·날짜를 두 번 넣지 않습니다.',
  '   모든 추출값(fields·dates·payments·details·checks)에는 근거가 있는 파일 번호(evidence_file, 첨부 순서 1부터)와 쪽(evidence_page, 사진은 1)을 넣습니다.',
].join('\n');

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => ((list as readonly string[]).includes(v as string) ? (v as T) : null);
const posInt = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max ? v : null);

/** 모델 출력의 document_check 정리. 없거나 형식이 틀리면 uncertain(low) — 계약으로 확정하지 않는다 */
export function parseDocumentCheck(output: unknown, files: readonly FileKind[]): DocumentCheck {
  const raw = isObj(output) && isObj(output.document_check) ? output.document_check : {};
  const role = oneOf(DOCUMENT_ROLES, raw.role) ?? 'uncertain';
  const confidence = oneOf(CONFIDENCE, raw.confidence) ?? 'low';
  const reasons = (Array.isArray(raw.reasons) ? raw.reasons : []).map((r) => oneOf(CHECK_REASONS, r)).filter((r): r is CheckReason => !!r).slice(0, 4);
  // v7 스키마는 신호 목록(배열), mock·이전 형식은 객체
  const sig = Array.isArray(raw.signals) ? Object.fromEntries(raw.signals.map((k) => [k, true])) : isObj(raw.signals) ? raw.signals : {};
  const signals = Object.fromEntries(SIGNAL_KEYS.map((k) => [k, sig[k] === true])) as Record<SignalKey, boolean>;
  const pages: PageCheck[] = [];
  for (const p of Array.isArray(raw.pages) ? raw.pages : []) {
    if (!isObj(p)) continue;
    const file = posInt(p.file, files.length);
    if (file === null) continue;
    const pdf = files[file - 1].pdf;
    const page = pdf ? (posInt(p.page, 2000) ?? 1) : 1;
    if (pages.some((x) => x.file === file && x.page === page)) continue;
    const df = posInt(p.duplicate_of_file, files.length);
    // 같은 PDF 안의 중복은 쪽 번호를 모르면 표시만 (쪽 번호 없는 PDF 중복은 앞쪽으로 본다)
    const dp = df === null ? null : files[df - 1].pdf ? (posInt(p.duplicate_of_page, 2000) ?? (df === file ? page - 1 : 1)) : 1;
    const duplicateOf = df !== null && dp !== null && (df < file || (df === file && dp < page)) ? { file: df, page: dp } : null;
    pages.push({ file, page, role: oneOf(DOCUMENT_ROLES, p.role) ?? 'uncertain', duplicateOf });
  }
  return { role, confidence, reasons, signals, pages };
}

const BAD_PAGE_ROLES: readonly DocumentRole[] = ['non_contract', 'unreadable'];

/** 의심 쪽: 계약과 무관·읽기 어려움·판단 어려움·중복 (전체가 계약일 때만 의미가 있다) */
export function suspiciousPages(check: DocumentCheck, files: readonly FileKind[]): DocumentValidation['suspiciousPages'] {
  return check.pages
    .filter((p) => BAD_PAGE_ROLES.includes(p.role) || p.role === 'uncertain' || p.duplicateOf !== null)
    .map((p) => ({ ...p, pdf: files[p.file - 1]?.pdf ?? false }));
}

// ───────── 쪽별 필터 (모델 출력 JSON 단계 — 앱 형식으로 바꾸기 전에 적용) ─────────

export interface PageRef {
  file: number;
  /** null = 파일 전체 (사진) */
  page: number | null;
}

const matches = (ex: readonly PageRef[], file: unknown, page: unknown) =>
  typeof file === 'number' && ex.some((e) => e.file === file && (e.page === null || (typeof page === 'number' && e.page === page)));

/**
 * 제외할 쪽에서만 근거가 나온 값을 지운다.
 * - 제외 쪽이 근거인 값 → 제거 (fields는 null, 목록 항목은 삭제)
 * - 근거 위치를 알 수 없는 값(evidence_file 없음, PDF 쪽 제외인데 evidence_page 없음) → unknownOrigin으로 센다 (지우지는 않음)
 * 제외할 쪽이 없으면 그대로.
 */
export function filterOutputByPages(output: unknown, exclude: readonly PageRef[]): { output: unknown; removed: number; unknownOrigin: number } {
  if (!isObj(output) || exclude.length === 0) return { output, removed: 0, unknownOrigin: 0 };
  let removed = 0;
  let unknownOrigin = 0;
  const pdfPageExcluded = (file: unknown) => exclude.some((e) => e.file === file && e.page !== null);
  const origin = (o: Record<string, unknown>): 'excluded' | 'unknown' | 'ok' => {
    if (typeof o.evidence_file !== 'number') return 'unknown';
    if (matches(exclude, o.evidence_file, o.evidence_page)) return 'excluded';
    if (pdfPageExcluded(o.evidence_file) && typeof o.evidence_page !== 'number') return 'unknown';
    return 'ok';
  };
  const out: Record<string, unknown> = { ...output };
  if (isObj(output.fields)) {
    const fields: Record<string, unknown> = {};
    for (const [k, f] of Object.entries(output.fields)) {
      if (!isObj(f) || f.value === null || f.value === undefined) {
        fields[k] = f;
        continue;
      }
      const o = origin(f);
      if (o === 'excluded') {
        fields[k] = { ...f, value: null, confidence: 'low', evidence_quote: null, evidence_file: null, evidence_page: null };
        removed++;
      } else {
        if (o === 'unknown') unknownOrigin++;
        fields[k] = f;
      }
    }
    out.fields = fields;
  }
  for (const key of ['dates', 'payments', 'details', 'checks'] as const) {
    if (!Array.isArray(output[key])) continue;
    out[key] = (output[key] as unknown[]).filter((item) => {
      if (!isObj(item)) return false;
      const o = origin(item);
      if (o === 'excluded') {
        removed++;
        return false;
      }
      if (o === 'unknown') unknownOrigin++;
      return true;
    });
  }
  return { output: out, removed, unknownOrigin };
}

/** 근거 위치를 모르는 값의 신뢰도를 낮춘다 (PDF처럼 다시 분석할 수 없는 경우 — 확인 화면에서 "확인 필요") */
export function downgradeUnknownOrigin(output: unknown): unknown {
  if (!isObj(output)) return output;
  const low = (o: Record<string, unknown>) => (typeof o.evidence_file === 'number' ? o : { ...o, confidence: 'low' });
  const out: Record<string, unknown> = { ...output };
  if (isObj(output.fields)) out.fields = Object.fromEntries(Object.entries(output.fields).map(([k, f]) => [k, isObj(f) && f.value !== null ? low(f) : f]));
  for (const key of ['dates', 'payments', 'details', 'checks'] as const) {
    if (Array.isArray(output[key])) out[key] = (output[key] as unknown[]).map((x) => (isObj(x) ? low(x) : x));
  }
  return out;
}

// ───────── 신호 · 판정 ─────────

/** 추출 결과(앱 형식)에서 근거가 있는 신호만 센다 — 모델이 "있다"고 해도 근거 있는 값이 없으면 인정하지 않는다 */
export interface ExtractionLike {
  category: { value: string };
  fields: Record<string, { value: unknown; evidence?: unknown[] }>;
  dates: { evidence?: unknown[] }[];
  payments: { evidence?: unknown[] }[];
  details: Record<string, unknown>;
  checks: { evidenceQuote: string | null }[];
}

export function verifiedSignals(check: DocumentCheck, r: ExtractionLike): Record<SignalKey, boolean> {
  const has = (k: string) => r.fields[k] != null && r.fields[k].value !== null && r.fields[k].value !== undefined;
  const evid = (x: { evidence?: unknown[] }) => (x.evidence?.length ?? 0) > 0;
  const m = check.signals;
  return {
    parties: m.parties && has('counterparty'),
    dates: m.dates && r.dates.some(evid),
    amounts: m.amounts && (r.payments.some(evid) || (has('totalAmount') && evid(r.fields.totalAmount)) || (has('depositAmount') && evid(r.fields.depositAmount))),
    obligations: m.obligations && (r.checks.some((c) => !!c.evidenceQuote) || r.payments.length > 0 || Object.keys(r.details).length > 0),
    purpose: m.purpose && (has('title') || r.category.value !== 'other'),
    termination_renewal: m.termination_renewal && (has('autoRenewal') || has('terminationNoticeDays') || has('earlyTerminationTerms') || r.dates.length > 0),
    signature: m.signature,
    contract_language: m.contract_language,
  };
}

/**
 * 진행 여부 (보수적으로 — 애매한 문서를 계약으로 만들지도, 실제 계약을 버리지도 않는다)
 * - 문서 전체가 unreadable → 다시 촬영 / non_contract → 분석 중단
 * - 신호 0~1개 → 정보 부족
 * - 계약·부속계약 + 신뢰도 high/medium + 신호 3개 이상 + 날짜 또는 금액 → 진행
 * - 날짜·금액이 없어도 당사자 + 의무/약정 + 계약형 문장이 있으면, 또는 신호 2개면 → 사용자 확인 (버리지 않음)
 * - 관련 자료(supporting)만 있거나 판단이 어렵거나 신뢰도가 낮으면 → 사용자 확인 (자동으로 새 계약을 만들지 않음)
 * - 진행이어도 의심 사진 쪽이 있으면 → 쪽 선택을 먼저
 */
export function decide(check: DocumentCheck, signals: Record<SignalKey, boolean>, files: readonly FileKind[]): DocumentValidation {
  const signalCount = SIGNAL_KEYS.filter((k) => signals[k]).length;
  const suspicious = suspiciousPages(check, files);
  let decision: GateDecision;
  if (check.role === 'unreadable') decision = 'stop_unreadable';
  else if (check.role === 'non_contract') decision = 'stop_non_contract';
  else if (signalCount <= 1) decision = 'stop_insufficient';
  else if ((check.role === 'contract' || check.role === 'addendum') && check.confidence !== 'low' && signalCount >= 3 && (signals.dates || signals.amounts)) decision = 'proceed';
  else decision = 'confirm_role';
  if (decision === 'proceed' && suspicious.some((p) => !p.pdf)) decision = 'choose_pages';
  return { role: check.role, confidence: check.confidence, reasons: check.reasons, signals, signalCount, decision, suspiciousPages: suspicious, userConfirmedRole: false };
}

/** 제외할 쪽: 사진은 사용자가 고른 대로(고르지 않은 의심 사진은 계약과 무관·읽기 어려움이면 제외), PDF는 계약과 무관·읽기 어려움 쪽 */
export function excludedPages(v: Pick<DocumentValidation, 'suspiciousPages'>, includeFiles: readonly number[], excludeFiles: readonly number[]): PageRef[] {
  const out: PageRef[] = [];
  for (const p of v.suspiciousPages) {
    if (p.pdf) {
      if (BAD_PAGE_ROLES.includes(p.role)) out.push({ file: p.file, page: p.page });
      continue;
    }
    const chosenExclude = excludeFiles.includes(p.file);
    const chosenInclude = includeFiles.includes(p.file);
    if (chosenExclude || (!chosenInclude && BAD_PAGE_ROLES.includes(p.role))) out.push({ file: p.file, page: null });
  }
  for (const f of excludeFiles) if (!out.some((e) => e.file === f && e.page === null)) out.push({ file: f, page: null });
  return out;
}
