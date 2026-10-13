/**
 * 보증금 반환 — 결제가 아니라 보증금 묶음(contract_funds)의 반환으로 다룬다 (앱 src/domain/cashflow.ts fundViews).
 * AI가 "보증금 반환 예정 200,000,000원 · 2028-11-30"을 결제로 답해도 일반 결제·출금으로 저장하지 않는다:
 * - 결제 목록에서 빼고 depositReturn으로 넘긴다 (최초 보증금 지급과 반환 예정액을 함께 세지 않음)
 * - 반환일은 그 금액의 문구에 날짜가 직접 적혀 있을 때만 반환 예정일(dateExplicit) — 계약 종료일·문맥 추정 날짜는 확정 반환일이 아님
 *   (없으면 앱이 계약 종료일에 "반환 확인"만 표시, 합계에 넣지 않음)
 * - 방향은 정하지 않는다 (사용자 역할: 임차인 = 돌려받음 / 임대인 = 돌려줌 — 묶음의 역할 규칙)
 * 판단은 금액 이름으로: 보증금·전세금·예치금의 반환·돌려받·돌려주·환급·정산 (최초 지급 "보증금"은 이름에 반환 표현이 없어 그대로)
 */
import type { ExtractedPayment } from './types.ts';

export const DEPOSIT_RETURN_LABEL = /(?:보증금|전세금|예치금|임대차\s*보증금)[^,]{0,12}(?:반환|돌려\s*(?:받|주)|환급|정산)|(?:반환|환급)\s*(?:예정\s*)?(?:보증금|전세금|예치금)/;

export interface DepositReturn {
  label: string;
  amount: number;
  /** 문구에 직접 적힌 반환일 (없으면 null) */
  date: string | null;
  /** 근거 문장 */
  quote: string | null;
}

/** 문구에 그 날짜가 직접 적혀 있는지 (2028년 11월 30일 · 2028.11.30 · 2028-11-30 · 2028/11/30) */
export function quoteHasDate(quote: string, iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  const re = new RegExp(`${y}\\s*(?:년\\s*0?${m}\\s*월\\s*0?${d}\\s*일|[.\\-/]\\s*0?${m}\\s*[.\\-/]\\s*0?${d}(?!\\d))`);
  return re.test(quote);
}

export function extractDepositReturns(payments: ExtractedPayment[]): DepositReturn[] {
  const out: DepositReturn[] = [];
  for (const p of [...payments]) {
    if (!DEPOSIT_RETURN_LABEL.test(p.label.replace(/\s+/g, ' '))) continue;
    const quote = (p.evidence ?? []).map((e) => e.quote).join(' ') || null;
    const date = p.date && p.dateSource === 'explicit' && quote && quoteHasDate(quote, p.date) ? p.date : null;
    payments.splice(payments.indexOf(p), 1);
    out.push({ label: p.label, amount: p.amount, date, quote });
  }
  return out;
}
