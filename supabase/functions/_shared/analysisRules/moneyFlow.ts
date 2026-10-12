// 규칙 F1: 돈의 성격과 방향 — 분석 시점에는 사용자가 어느 쪽인지 모른다 (이름 대조·역할 확정은 앱에서, 사용자가)
// 입력: 결제 목록(R1~R7 적용 후) · 계약 종류
// 출력: 각 결제의 moneyNature · direction · directionBasis
//   - 성격: 보증금(kind=deposit 또는 보증금의 몫 — R7) → refundable_deposit, 그 밖 → ordinary (이름만으로 정하지 않음)
//   - 지급자·수령자(payer/payee): 계약서가 밝힌 역할 그대로 보존 (같은 자리 연결은 앞 단계 cleanParties의 roleMap)
//   - 방향: 분석 단계에서는 정하지 않는다 → neutral(방향 확인 필요). 사용자 쪽은 사용자가 확인한 역할로만 정한다
//     (렌탈·구독·통신처럼 사용자가 보통 고객 쪽인 종류도 "추천"일 뿐 확정 출금으로 세지 않는다 — 앱이 추천 역할을 보여주고 확인받음)
//     모델이 사용자 기준이라고 답한 방향은 쓰지 않는다
// 예: 임대차 월세 → neutral · 정수기 렌탈료 → neutral + 지급자 고객 (앱: "고객(추천)"을 확인하면 출금)
// 테스트: src/domain/__tests__/golden/cashflow-analysis.test.ts · party-roles.test.ts
import type { ExtractedPayment } from './types.ts';

export function resolveMoneyFlow(payments: ExtractedPayment[], _kind: string): void {
  for (const p of payments) {
    const deposit = p.moneyNature === 'refundable_deposit' || p.kind === 'deposit';
    p.moneyNature = deposit ? 'refundable_deposit' : 'ordinary';
    p.direction = 'neutral';
    p.directionBasis = null;
  }
}
