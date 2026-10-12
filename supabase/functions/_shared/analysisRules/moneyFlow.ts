// 규칙 F1: 돈의 성격과 방향 — 분석 시점에는 사용자가 어느 쪽인지 모른다 (이름 대조·역할 확정은 앱에서, 사용자가)
// 입력: 결제 목록(R1~R7 적용 후) · 계약 종류
// 출력: 각 결제의 moneyNature · direction · directionBasis
//   - 성격: 보증금(kind=deposit 또는 보증금의 몫 — R7) → refundable_deposit, 그 밖 → ordinary (이름만으로 정하지 않음)
//   - 방향: 계약 구조상 사용자가 언제나 한쪽인 종류(구독·통신·렌탈·할부·교육·보험 — KIND_MONEY_FLOWS.consumerRole)는
//           "누가 내고 누가 받는가"(계약서가 밝힌 지급자·수령자 → 종류의 기본 흐름)로 정한다 (basis = contract)
//           그 밖(임대차·매매·용역·근로·대출·기타)은 사용자 역할을 알아야 정할 수 있어 neutral = 방향 확인 필요
//           (모델이 사용자 기준이라고 답한 방향은 쓰지 않는다 — 계약 종류·이름만으로 사용자 쪽을 추측하지 않음)
// 예: 임대차 월세·보증금 계약금 → neutral(확인 필요) · 정수기 렌탈료 → expense(contract) · 렌탈 보증금 → expense + refundable_deposit
// 테스트: src/domain/__tests__/golden/cashflow-analysis.test.ts
import { kindMoneyFlows } from '../contractRegistry.ts';
import type { ExtractedPayment } from './types.ts';

export function resolveMoneyFlow(payments: ExtractedPayment[], kind: string): void {
  const flows = kindMoneyFlows(kind);
  for (const p of payments) {
    const deposit = p.moneyNature === 'refundable_deposit' || p.kind === 'deposit';
    p.moneyNature = deposit ? 'refundable_deposit' : 'ordinary';
    const base = deposit ? flows.deposit : flows.ordinary;
    const payer = p.payerRole ?? base?.payer ?? null;
    const payee = p.payeeRole ?? base?.payee ?? null;
    const consumer = flows.consumerRole;
    if (consumer && (payer === consumer || payee === consumer)) {
      p.direction = payer === consumer ? 'expense' : 'income';
      p.directionBasis = 'contract';
    } else {
      p.direction = 'neutral';
      p.directionBasis = null;
    }
  }
}
