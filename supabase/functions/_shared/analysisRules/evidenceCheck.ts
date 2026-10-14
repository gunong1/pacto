/**
 * 근거 대조 — AI가 고른 날짜·금액이 그 값의 근거 문장(evidence_quote)에 실제로 적힌 값인지 확인한다.
 * 같은 계약서를 다시 분석해도 결과가 달라질 수 있으므로(모델 응답은 매번 같지 않다), 값을 그대로 믿지 않고
 * 근거 문장과 다르면 신뢰도를 낮춰 사용자 확인을 받는다. 값을 고치지는 않는다 (어느 쪽이 맞는지 서버가 정하지 않음).
 *   - 근거 문장에 날짜가 있는데 그 날짜와 다름 → evidence_mismatch
 *   - 근거 문장이 없거나 날짜가 없으면 판단하지 않음 (기존 신뢰도 그대로)
 */

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null);

/** 문장 속 날짜 — 연도가 있는 날짜(full)와 "10월 15일"처럼 연도 없는 날짜(md: MM-DD) */
export function datesInText(text: string): { full: string[]; md: string[] } {
  const full = new Set<string>();
  const md = new Set<string>();
  const t = text.replace(/\s+/g, ' ');
  for (const m of t.matchAll(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) {
    const v = iso(+m[1], +m[2], +m[3]);
    if (v) full.add(v);
  }
  for (const m of t.matchAll(/(?<!\d)(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})(?!\d)/g)) {
    const v = iso(+m[1], +m[2], +m[3]);
    if (v) full.add(v);
  }
  // 연도 없는 "10월 15일" (앞에 "2026년"이 붙은 것은 위에서 이미 셈)
  for (const m of t.matchAll(/(?<!년\s?)(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) {
    const mm = +m[1];
    const dd = +m[2];
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) md.add(`${pad(mm)}-${pad(dd)}`);
  }
  for (const f of full) md.delete(f.slice(5));
  return { full: [...full], md: [...md] };
}

/** 근거 문장의 날짜와 고른 날짜가 다름 (문장에 날짜가 하나도 없으면 false — 판단할 수 없음) */
export function quoteContradictsDate(date: string, quote: string | null | undefined): boolean {
  if (!quote) return false;
  const { full, md } = datesInText(quote);
  if (full.length === 0 && md.length === 0) return false;
  return !full.includes(date) && !md.includes(date.slice(5));
}

/** 문장 속 원 단위 금액: "3,100,000원" · "3100000원" · "310만 원" · "1억 2천만원" */
export function amountsInText(text: string): number[] {
  const out = new Set<number>();
  const t = text.replace(/\s+/g, '');
  for (const m of t.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)원/g)) out.add(Number(m[1].replace(/,/g, '')));
  for (const m of t.matchAll(/(?:(\d+)억)?(?:(\d+)천)?(?:(\d+)백)?(\d+(?:\.\d+)?)?만원?/g)) {
    if (!m[0] || !/만/.test(m[0])) continue;
    const eok = m[1] ? +m[1] * 10000 : 0;
    const v = (eok + (m[2] ? +m[2] * 1000 : 0) + (m[3] ? +m[3] * 100 : 0) + (m[4] ? +m[4] : 0)) * 10000;
    if (v > 0) out.add(Math.round(v));
  }
  return [...out];
}

/** 근거 문장의 금액과 고른 금액이 다름 (문장에 금액이 없으면 false) */
export function quoteContradictsAmount(amount: number, quote: string | null | undefined): boolean {
  if (!quote) return false;
  const found = amountsInText(quote);
  return found.length > 0 && !found.includes(amount);
}
