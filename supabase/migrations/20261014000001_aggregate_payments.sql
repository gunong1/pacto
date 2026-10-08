-- 총액(aggregate) ≠ 실제 지급 — 이미 저장된 계약 정리
-- 보증금 20,000,000 = 계약금 2,000,000 + 잔금 18,000,000 처럼 총액과 나눠 내는 몫이 모두 확정 결제로 저장된 경우,
-- 총액 행을 참고 금액(informational)으로 바꾼다. 행은 지우지 않는다 (금액·라벨 그대로, 되돌릴 수 있음).
-- 판단 규칙은 supabase/functions/_shared/paymentAggregate.ts (앱·서버 공용)와 같다:
--   일회성·확정 · 나눠 내는 몫 이름이 아닌 금액 = 같은 계약의 나눠 내는 몫(일회성·확정, 2개 이상) 합  (전체 합 또는 그보다 작은 몫들의 합)
-- 보증금 총액이 계약 정보(deposit_amount)에 없으면 채워 핵심 정보에 보증금으로 보이게 한다.

with parts as (
  select contract_id, amount
  from public.contract_payments
  where frequency = 'one_time' and obligation = 'confirmed'
    and label ~ '(계약금(?!액)|중도금|잔금|착수금|선금|선급금|중간금|잔여금)'
),
totals as (
  select t.id, t.contract_id, t.kind, t.amount
  from public.contract_payments t
  where t.frequency = 'one_time' and t.obligation = 'confirmed' and t.amount > 0
    and t.label !~ '(계약금(?!액)|중도금|잔금|착수금|선금|선급금|중간금|잔여금)'
    and (
      ((select count(*) from parts p where p.contract_id = t.contract_id) >= 2
        and (select sum(p.amount) from parts p where p.contract_id = t.contract_id) = t.amount)
      or ((select count(*) from parts p where p.contract_id = t.contract_id and p.amount < t.amount) >= 2
        and (select sum(p.amount) from parts p where p.contract_id = t.contract_id and p.amount < t.amount) = t.amount)
    )
),
fill_deposit as (
  update public.contracts c
  set deposit_amount = t.amount
  from totals t
  where t.contract_id = c.id and t.kind = 'deposit' and c.deposit_amount is null
  returning c.id
)
update public.contract_payments cp
set obligation = 'informational',
    condition_note = coalesce(cp.condition_note, '총액 — 계약금·잔금 등으로 나눠 지급')
from totals t
where cp.id = t.id;
