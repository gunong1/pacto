// 민감정보 탐지 — 순수 TypeScript (Deno·앱·jest 공용). 외부 전송 없음.
// 숫자 모양만으로 판단하지 않는다: 패턴 + 주변 필드명(문맥) + 검증(날짜·성별 자리·Luhn)을 함께 본다.
// - 바로 앞의 필드명이 "계약번호·증권번호·고객번호·사업자·차대번호 …"면 개인정보로 보지 않는다.
// - 필드명 없이 숫자 모양만 맞으면 신뢰도를 낮춘다 (low = 자동으로 가리지 않는 후보).
// 원문 값은 반환값의 위치(start/end)로만 다루고, 저장·로그에는 가린 표시값(maskedPreview)만 쓴다.

export const SENSITIVE_TYPES = [
  'resident_registration_number',
  'foreigner_registration_number',
  'credit_card',
  'bank_account',
  'phone',
  'email',
] as const;
export type SensitiveType = (typeof SENSITIVE_TYPES)[number];
export type DetectionConfidence = 'high' | 'medium' | 'low';

/** 1 강한 보호(자동 가림) / 2 기본 가림 권장 */
export const MASK_LEVEL: Record<SensitiveType, 1 | 2> = {
  resident_registration_number: 1,
  foreigner_registration_number: 1,
  credit_card: 1,
  bank_account: 1,
  phone: 2,
  email: 2,
};

export interface Detection {
  type: SensitiveType;
  level: 1 | 2;
  confidence: DetectionConfidence;
  /** 값 전체의 문자 위치 [start, end) */
  start: number;
  end: number;
  /** 가릴 문자 위치들 [start, end) — 앞자리 등 일부는 남긴다 (예: 901225-1******) */
  hide: [number, number][];
  /** 가린 표시값 — 저장·화면·로그에 쓸 수 있는 유일한 값 */
  maskedPreview: string;
  /** 판단 근거가 된 필드명 (예: 주민등록번호) */
  contextLabel: string | null;
}

/** 이 필드명 바로 뒤의 숫자는 개인정보로 보지 않는다 */
const EXCLUDE_LABEL =
  /계약\s*번호|증권\s*번호|보험\s*증권|고객\s*번호|회원\s*번호|사업자(?:\s*등록)?(?:\s*번호)?|법인\s*등록\s*번호|법인\s*번호|차대\s*번호|차량\s*번호|차량\s*식별\s*번호|VIN|관리\s*번호|주문\s*번호|접수\s*번호|일련\s*번호|모델(?:\s*번호|명)?|품번|청약\s*번호|가입\s*번호|증서\s*번호|승인\s*번호|거래\s*번호|문서\s*번호|사건\s*번호|우편\s*번호|대표\s*번호|팩스|FAX|계약\s*금액|금액|원금|보증금|월세/gi;

const POSITIVE_LABEL: Record<SensitiveType, RegExp> = {
  resident_registration_number: /주민\s*등록\s*번호|주민\s*번호|주민\s*등록|생년월일\s*및\s*성별/g,
  foreigner_registration_number: /외국인\s*등록\s*번호|외국인\s*번호|외국인\s*등록|주민\s*등록\s*번호|주민\s*번호/g,
  credit_card: /신용\s*카드|체크\s*카드|카드\s*번호|결제\s*카드|카드/g,
  bank_account: /계좌|입금|예금주|은행|뱅크|금고|농협|신협|우체국|송금|account/gi,
  phone: /휴대\s*전화|휴대폰|핸드폰|전화|연락처|H\.?P|mobile|phone|tel/gi,
  email: /이메일|e-?mail|메일/gi,
};

/**
 * OCR이 필드명 글자를 하나 틀리게 읽는 경우 (예: 주민등록번호 → 주민동록번호) — 공백을 뺀 글자에서 한 글자 차이까지 같은 필드명으로 본다.
 * 필드명은 문맥 근거일 뿐이다: 값 모양 검증(생년월일·Luhn·자리수)을 통과한 값에만 쓰고, 이것만으로 민감정보로 정하지 않는다.
 * 짧은 이름(3글자 이하)은 오탐이 많아 넣지 않는다.
 */
const FUZZY_LABELS: Record<SensitiveType, readonly string[]> = {
  resident_registration_number: ['주민등록번호', '주민번호'],
  foreigner_registration_number: ['외국인등록번호', '주민등록번호'],
  credit_card: ['카드번호', '신용카드', '체크카드'],
  bank_account: ['계좌번호', '입금계좌', '예금주명'],
  phone: ['휴대전화', '전화번호', '휴대폰번호'],
  email: ['이메일주소'],
};

/** 한 글자 차이까지 (치환·삽입·삭제 1회) */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** 공백을 뺀 글자에서 필드명(한 글자 차이 허용)이 끝나는 원래 위치들 */
function fuzzyLabelEnds(before: string, labels: readonly string[]): { pos: number; label: string }[] {
  const chars: { ch: string; end: number }[] = [];
  for (let i = 0; i < before.length; i++) if (!/\s/.test(before[i])) chars.push({ ch: before[i], end: i + 1 });
  const flat = chars.map((c) => c.ch).join('');
  const out: { pos: number; label: string }[] = [];
  for (const label of labels) {
    for (let len = label.length - 1; len <= label.length + 1; len++) {
      for (let s = 0; s + len <= flat.length; s++) {
        const w = flat.slice(s, s + len);
        // 첫 글자는 맞아야 한다 (엉뚱한 단어와 겹치지 않게)
        if (w[0] !== label[0] || !withinOneEdit(w, label)) continue;
        out.push({ pos: chars[s + len - 1].end, label });
      }
    }
  }
  return out;
}

/** 값 앞 이 정도 글자 안의 필드명을 문맥으로 본다 */
const CONTEXT_WINDOW = 28;

type LabelKind = 'positive' | 'exclude' | null;

/** 값 바로 앞에서 가장 가까운 필드명 (긍정·제외 중 더 가까운 쪽이 이긴다) */
function nearestLabel(text: string, start: number, type: SensitiveType): { kind: LabelKind; label: string | null } {
  const from = Math.max(0, start - CONTEXT_WINDOW);
  const before = text.slice(from, start);
  let best: { pos: number; kind: LabelKind; label: string } | null = null;
  const scan = (re: RegExp, kind: LabelKind) => {
    re.lastIndex = 0;
    for (const m of before.matchAll(re)) {
      const pos = (m.index ?? 0) + m[0].length;
      if (!best || pos > best.pos || (pos === best.pos && kind === 'exclude')) best = { pos, kind, label: m[0].replace(/\s+/g, '') };
    }
  };
  scan(new RegExp(POSITIVE_LABEL[type].source, POSITIVE_LABEL[type].flags), 'positive');
  scan(new RegExp(EXCLUDE_LABEL.source, EXCLUDE_LABEL.flags), 'exclude');
  // OCR 오타 필드명 (정확히 맞은 필드명이 같은 위치에 있으면 그쪽이 우선)
  for (const f of fuzzyLabelEnds(before, FUZZY_LABELS[type])) {
    const cur = best as { pos: number; kind: LabelKind; label: string } | null;
    if (!cur || f.pos > cur.pos) best = { pos: f.pos, kind: 'positive', label: f.label };
  }
  const b = best as { pos: number; kind: LabelKind; label: string } | null;
  return b ? { kind: b.kind, label: b.label } : { kind: null, label: null };
}

function validBirthDate(yy: string, mm: string, dd: string): boolean {
  const m = Number(mm), d = Number(dd);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] && /^\d{2}$/.test(yy);
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** 숫자 자리만 골라 위치로 (구분자는 남긴다) */
function digitPositions(text: string, start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i < end; i++) if (/\d/.test(text[i])) out.push(i);
  return out;
}

/** 연속된 위치를 구간으로 */
function toRanges(positions: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of positions) {
    const last = out[out.length - 1];
    if (last && last[1] === p) last[1] = p + 1;
    else out.push([p, p + 1]);
  }
  return out;
}

function preview(text: string, start: number, end: number, hide: [number, number][]): string {
  let s = '';
  for (let i = start; i < end; i++) s += hide.some(([a, b]) => i >= a && i < b) ? '*' : text[i];
  return s.replace(/\s+/g, ' ').slice(0, 80);
}

interface Candidate {
  type: SensitiveType;
  confidence: DetectionConfidence;
  start: number;
  end: number;
  hide: [number, number][];
  contextLabel: string | null;
}

function* residentNumbers(text: string): Generator<Candidate> {
  // 하이픈 있음: 901225-1234567 (공백 허용)
  const re = /(?<![\d-])(\d{2})(\d{2})(\d{2})\s?-\s?([1-8])(\d{6})(?![\d-])/g;
  for (const m of text.matchAll(re)) {
    if (!validBirthDate(m[1], m[2], m[3])) continue;
    const start = m.index!, end = start + m[0].length;
    const type: SensitiveType = Number(m[4]) >= 5 ? 'foreigner_registration_number' : 'resident_registration_number';
    const ctx = nearestLabel(text, start, type);
    if (ctx.kind === 'exclude') continue;
    // 뒤 6자리를 가린다
    const digits = digitPositions(text, start, end);
    yield { type, confidence: ctx.kind === 'positive' ? 'high' : 'medium', start, end, hide: toRanges(digits.slice(7)), contextLabel: ctx.label };
  }
  // 하이픈 없는 13자리: 필드명이 있을 때만 high, 없으면 후보(low)
  for (const m of text.matchAll(/(?<![\d-])(\d{2})(\d{2})(\d{2})([1-8])(\d{6})(?![\d-])/g)) {
    if (!validBirthDate(m[1], m[2], m[3])) continue;
    const start = m.index!, end = start + m[0].length;
    const type: SensitiveType = Number(m[4]) >= 5 ? 'foreigner_registration_number' : 'resident_registration_number';
    const ctx = nearestLabel(text, start, type);
    if (ctx.kind === 'exclude') continue;
    yield { type, confidence: ctx.kind === 'positive' ? 'high' : 'low', start, end, hide: [[start + 7, end]], contextLabel: ctx.label };
  }
}

function* cardNumbers(text: string): Generator<Candidate> {
  const re = /(?<![\d-])(?:\d{4}([ -])\d{4}\1\d{4}\1\d{4}|\d{4}([ -])\d{6}\2\d{5}|\d{16})(?![\d-])/g;
  for (const m of text.matchAll(re)) {
    const start = m.index!, end = start + m[0].length;
    const digits = m[0].replace(/\D/g, '');
    const ctx = nearestLabel(text, start, 'credit_card');
    if (ctx.kind === 'exclude') continue;
    const valid = luhn(digits);
    // 카드 필드명 + Luhn = high / 필드명만 = medium(확인 필요) / Luhn만 = medium / 둘 다 없음 = 카드번호로 보지 않음
    let confidence: DetectionConfidence | null = null;
    if (ctx.kind === 'positive') confidence = valid ? 'high' : 'medium';
    else if (valid) confidence = m[0].length === 16 ? 'low' : 'medium';
    if (!confidence) continue;
    const pos = digitPositions(text, start, end);
    // 앞 4자리·뒤 4자리만 남긴다
    yield { type: 'credit_card', confidence, start, end, hide: toRanges(pos.slice(4, pos.length - 4)), contextLabel: ctx.label };
  }
}

function* bankAccounts(text: string): Generator<Candidate> {
  // 계좌번호는 형태가 은행마다 달라 필드명(계좌·은행·입금 …)이 있을 때만 판단한다
  const re = /(?<![\d-])(?:\d{2,6}(?:-\d{2,7}){1,3}|\d{10,14})(?![\d-])/g;
  for (const m of text.matchAll(re)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 16) continue;
    if (/^01[016789]/.test(digits) && digits.length <= 11 && /^01[016789]-?\d{3,4}-?\d{4}$/.test(m[0])) continue; // 휴대전화
    if (/^(19|20)\d{2}-\d{1,2}-\d{1,2}$/.test(m[0])) continue; // 날짜
    const start = m.index!, end = start + m[0].length;
    const ctx = nearestLabel(text, start, 'bank_account');
    if (ctx.kind !== 'positive') continue;
    const pos = digitPositions(text, start, end);
    // 뒤 4자리만 남긴다
    yield { type: 'bank_account', confidence: 'high', start, end, hide: toRanges(pos.slice(0, pos.length - 4)), contextLabel: ctx.label };
  }
}

function* phones(text: string): Generator<Candidate> {
  for (const m of text.matchAll(/(?<![\d-])(01[016789])([-. ]?)(\d{3,4})\2(\d{4})(?![\d-])/g)) {
    const start = m.index!, end = start + m[0].length;
    const ctx = nearestLabel(text, start, 'phone');
    if (ctx.kind === 'exclude') continue;
    const midStart = start + m[1].length + m[2].length;
    yield { type: 'phone', confidence: 'high', start, end, hide: [[midStart, midStart + m[3].length]], contextLabel: ctx.label };
  }
  // 일반전화: 구분자가 있을 때만, 필드명이 있으면 high
  for (const m of text.matchAll(/(?<![\d-])(0(?:2|[3-6][1-5]|70))([-) ])(\d{3,4})-(\d{4})(?![\d-])/g)) {
    const start = m.index!, end = start + m[0].length;
    const ctx = nearestLabel(text, start, 'phone');
    if (ctx.kind === 'exclude') continue;
    const midStart = start + m[1].length + m[2].length;
    yield { type: 'phone', confidence: ctx.kind === 'positive' ? 'high' : 'medium', start, end, hide: [[midStart, midStart + m[3].length]], contextLabel: ctx.label };
  }
}

function* emails(text: string): Generator<Candidate> {
  for (const m of text.matchAll(/(?<![\w.%+-])([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})(?![\w-])/g)) {
    const start = m.index!, end = start + m[0].length;
    const ctx = nearestLabel(text, start, 'email');
    const keep = Math.min(2, m[1].length - 1);
    yield { type: 'email', confidence: 'high', start, end, hide: m[1].length > keep ? [[start + keep, start + m[1].length]] : [], contextLabel: ctx.label };
  }
}

/** 텍스트(한 줄 또는 문장)에서 민감정보 탐지. 겹치면 강한 보호 유형·높은 신뢰도가 우선 */
export function detectSensitive(text: string): Detection[] {
  const rank = { high: 3, medium: 2, low: 1 } as const;
  const order: SensitiveType[] = ['resident_registration_number', 'foreigner_registration_number', 'credit_card', 'bank_account', 'phone', 'email'];
  const all = [...residentNumbers(text), ...cardNumbers(text), ...bankAccounts(text), ...phones(text), ...emails(text)].sort(
    (a, b) => rank[b.confidence] - rank[a.confidence] || order.indexOf(a.type) - order.indexOf(b.type) || a.start - b.start,
  );
  const picked: Candidate[] = [];
  for (const c of all) {
    if (picked.some((p) => c.start < p.end && p.start < c.end)) continue;
    picked.push(c);
  }
  return picked
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ ...c, level: MASK_LEVEL[c.type], maskedPreview: preview(text, c.start, c.end, c.hide) }));
}

/**
 * 문장 속 강한 보호(Level 1) 정보를 가린다 — AI 결과의 인용문·설명 등에 쓴다.
 * 의미는 그대로 두고 값의 일부만 *로 바꾼다 (예: "주민등록번호: 901225-1234567" → "주민등록번호: 901225-1******").
 * 확신이 낮은 후보도 가린다 (저장·화면에 원문이 남지 않도록 보수적으로).
 */
export function maskLevel1Text(text: string): string {
  if (!/\d{6}/.test(text.replace(/[\s-]/g, ''))) return text;
  const hits = detectSensitive(text).filter((d) => d.level === 1);
  if (hits.length === 0) return text;
  let out = '';
  for (let i = 0; i < text.length; i++) out += hits.some((h) => h.hide.some(([a, b]) => i >= a && i < b)) ? '*' : text[i];
  return out;
}

/** 객체·배열 안의 모든 문자열에 maskLevel1Text 적용 (원본을 바꾸지 않고 새 값 반환) */
export function maskLevel1Deep<T>(value: T): T {
  if (typeof value === 'string') return maskLevel1Text(value) as T;
  if (Array.isArray(value)) return value.map((v) => maskLevel1Deep(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskLevel1Deep(v);
    return out as T;
  }
  return value;
}

/** 로그용 요약 — 종류별 개수만 (값은 절대 포함하지 않는다) */
export function detectionCounts(ds: Pick<Detection, 'type'>[]): string {
  const counts = new Map<string, number>();
  for (const d of ds) counts.set(d.type, (counts.get(d.type) ?? 0) + 1);
  return [...counts].map(([t, n]) => `${t}:${n}`).join(',') || 'none';
}
