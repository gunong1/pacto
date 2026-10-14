/**
 * 대출 계약 금액 정리 (관리 프로필 loan) — 금융계약 공통 규칙 (특정 계약서 문구에 맞춘 예외 없음)
 *
 * 규칙 L1 대출 실행금: 대출 원금을 받는 돈(실행·지급·대출금)은 결제가 아니다 → 대출 정보(principal)로 옮기고 참고 금액으로만 보관
 *   - 원금 "상환"(만기에 갚는 돈)은 실제 현금 유출 → 결제로 남긴다 (kind=loan_repayment)
 * 규칙 L2 이자: 회차마다 금액이 다른 이자를 결제 여러 개로 만들지 않는다 → 이자 납부 규칙 1건(매월 · 납부일 · 첫 납부일~만기)
 *   - 계약서에 적힌 회차별 이자(예시)는 참고 금액으로 남겨 계산 검증에만 쓴다 (앱의 loanPlan이 회차별 금액을 계산)
 *   - 연체이자·지연이자처럼 조건부 이자는 이 규칙에 넣지 않는다 (계약 체크로)
 * 규칙 L3 같은 경제적 의무의 중복: 본문·거래조건표·부속 상환일정에 같은 원금 상환이 반복되면 하나만 (종류·금액·날짜가 모두 같을 때만 —
 *   금액만 같다고 합치지 않음)
 * 규칙 L4 만기일시 상환인데 원금 상환이 없으면 만기일에 원금 상환을 만든다 (원금·만기일이 계약서에 있을 때만)
 */
import type { AppExtractionResult, ExtractedDate, ExtractedDetail, ExtractedPayment } from './types.ts';

const DISBURSE = /(대출\s*(금|금액|원금)|원금|실행\s*금|실행\s*금액|대출\s*실행|대여\s*금|차입\s*금)/;
const REPAY = /상환|변제|갚/;
const INTEREST = /이자/;
const CONDITIONAL_INTEREST = /연체|지연|지체|가산|위약/;

const num = (d: ExtractedDetail | undefined) => (d && typeof d.value === 'number' ? d.value : null);

export function normalizeLoan(
  payments: ExtractedPayment[],
  references: AppExtractionResult['references'],
  details: Record<string, ExtractedDetail>,
  dates: readonly ExtractedDate[],
): void {
  const start = dates.find((d) => d.meaning === 'loan_execution')?.date ?? dates.find((d) => d.meaning === 'contract_start')?.date ?? null;
  const maturity = dates.find((d) => d.meaning === 'maturity')?.date ?? dates.find((d) => d.meaning === 'contract_end')?.date ?? null;

  // L1 대출 실행금
  for (let i = payments.length - 1; i >= 0; i--) {
    const p = payments[i];
    const said = `${p.label} ${(p.evidence ?? []).map((e) => e.quote).join(' ')}`;
    const principalLike = p.frequency === 'one_time' && DISBURSE.test(p.label) && !REPAY.test(p.label) && !INTEREST.test(p.label);
    const atStart = start != null && p.date === start && !REPAY.test(said);
    const sameAsPrincipal = num(details.principal) === p.amount;
    // 만기일 원금(갚는 돈)은 그대로 · 실행일의 원금이거나, 상환 종류가 아닌 원금(날짜 없음·원금과 같은 금액)만 뺀다
    if (principalLike && (maturity == null || p.date !== maturity) && (atStart || (p.kind !== 'loan_repayment' && (p.date == null || sameAsPrincipal)))) {
      payments.splice(i, 1);
      references.push({ label: p.label, amount: p.amount, role: 'reference' });
      if (details.principal == null) details.principal = { value: p.amount, confidence: p.confidence, sourceType: p.sourceType, ...(p.evidence ? { evidence: p.evidence } : {}) };
    }
  }

  // L2 이자 — 확정 이자(조건부 제외)를 규칙 1건으로
  const interest = payments.filter((p) => (p.kind === 'interest' || INTEREST.test(p.label)) && !CONDITIONAL_INTEREST.test(p.label) && p.obligation === 'confirmed' && !REPAY.test(p.label));
  if (interest.length > 1 || (interest.length === 1 && interest[0].frequency === 'one_time')) {
    const dated = interest.filter((p) => p.date).sort((a, b) => a.date!.localeCompare(b.date!));
    const days = new Map<number, number>();
    for (const p of interest) {
      const day = p.dayOfMonth ?? (p.date ? Number(p.date.slice(8, 10)) : null);
      if (day && (maturity == null || p.date !== maturity)) days.set(day, (days.get(day) ?? 0) + 1);
    }
    const payDay = [...days.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const first = dated[0] ?? interest[0];
    const rule: ExtractedPayment = {
      ...first,
      kind: 'interest',
      label: '대출 이자',
      // 대표 금액 = 계약서 첫 회차 이자 (앱이 계산 조건을 확인하면 회차별 금액으로 바꿔 보여줌)
      amount: first.amount,
      frequency: 'monthly',
      dayOfMonth: payDay,
      date: first.date,
      endDate: maturity ?? dated[dated.length - 1]?.date ?? first.endDate,
      installmentCount: null,
      isVariable: true,
      components: [],
    };
    for (const p of interest) {
      references.push({ label: p.label, amount: p.amount, role: 'reference' });
      payments.splice(payments.indexOf(p), 1);
    }
    payments.push(rule);
  }

  // L3 원금 상환 중복 — 종류·금액·날짜가 모두 같은 것만
  const seen = new Set<string>();
  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];
    if (p.kind !== 'loan_repayment' || p.frequency !== 'one_time') continue;
    const key = `${p.amount}|${p.date}`;
    if (seen.has(key)) payments.splice(i--, 1);
    else seen.add(key);
  }

  // L4 만기일시 상환인데 원금 상환이 없으면 만기일에 만든다
  const principal = num(details.principal);
  if (details.repayment_method?.value === 'bullet' && principal && maturity && !payments.some((p) => p.kind === 'loan_repayment' && p.frequency === 'one_time')) {
    const base = payments[0];
    payments.push({
      kind: 'loan_repayment',
      direction: 'expense',
      label: '대출 원금 상환',
      amount: principal,
      frequency: 'one_time',
      dayOfMonth: null,
      date: maturity,
      dateSource: null,
      endDate: null,
      installmentCount: null,
      isVariable: false,
      obligation: 'confirmed',
      conditionNote: null,
      components: [],
      businessDayRule: base?.businessDayRule ?? 'none',
      confidence: details.principal.confidence,
      sourceType: details.principal.sourceType,
      ...(details.principal.evidence ? { evidence: details.principal.evidence } : {}),
    });
  }
}
