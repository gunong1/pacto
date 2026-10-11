// 값 정제 도우미 — 모델 출력의 형식만 검사한다 (의미 판단 없음).
import { BANNED_PHRASES, CONFIDENCE, MODEL_SOURCES } from './vocabulary.ts';
import type { Classification, Confidence, Evidence, ModelSource } from './types.ts';

export const MAX_AMOUNT = 100_000_000_000;

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => ((list as readonly string[]).includes(v as string) ? (v as T) : null);

export function validDate(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1950 || y > 2100 || mo < 1 || mo > 12) return false;
  return d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

export function toInt(raw: unknown, min: number, max: number): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.replace(/[^\d.-]/g, '')) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return i >= min && i <= max ? i : null;
}

export function text(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().slice(0, max);
  return s.length > 0 ? s : null;
}

export function quoteOf(o: Record<string, unknown>): { evidence?: Evidence[] } {
  const quote = typeof o.evidence_quote === 'string' ? o.evidence_quote.trim().slice(0, 200) : '';
  const page = typeof o.evidence_page === 'number' && o.evidence_page >= 1 ? Math.round(o.evidence_page) : null;
  const file = typeof o.evidence_file === 'number' && o.evidence_file >= 1 ? Math.round(o.evidence_file) : null;
  return quote ? { evidence: [{ page: page ?? 1, quote, ...(file ? { file } : {}) }] } : {};
}

export function confidenceOf(v: unknown): Confidence {
  return oneOf(CONFIDENCE, v) ?? 'low';
}

/** 출처를 모르면 계약서에 적힌 값으로 보지 않는다 */
export function sourceOf(v: unknown): ModelSource {
  return oneOf(MODEL_SOURCES, v) ?? 'inferred';
}

/** 금지 표현이 있으면 해당 문구를 중립 문장으로 대체 */
export function neutralize(value: string, fallback: string): string {
  return BANNED_PHRASES.some((p) => value.includes(p)) ? fallback : value;
}

export function classify<T extends string>(raw: unknown, codes: readonly T[], fallback: T): Classification<T> {
  const o = isObj(raw) ? raw : {};
  const value = oneOf(codes, o.value);
  const reason = text(o.reason, 200);
  return {
    value: value ?? fallback,
    confidence: value ? confidenceOf(o.confidence) : 'low',
    alternatives: (Array.isArray(o.alternatives) ? o.alternatives : [])
      .map((a) => oneOf(codes, a))
      .filter((a): a is T => !!a && a !== value)
      .filter((a, i, arr) => arr.indexOf(a) === i)
      .slice(0, 3),
    reason: reason ? neutralize(reason, '계약서 내용을 바탕으로 분류했어요.') : null,
  };
}
