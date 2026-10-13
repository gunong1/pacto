-- 기존 데이터 영향 조사 (읽기 전용 — SELECT만, 운영 데이터를 바꾸지 않는다). Supabase SQL Editor에 붙여넣고 Run.
-- 계약서 원문·이름·메모는 출력하지 않는다 (계약 id 앞 8자리 · 코드값 · 금액 · 날짜 · 예/아니오만).
-- ① 결제로 저장된 보증금 반환 (앱 정리 카드에 나올 항목 — misfiledDepositReturns와 같은 이름 규칙)
-- ② 급여 구성항목: 지급 유형이 없는 예전 데이터 중 합계가 월 급여와 다른 것 (새 앱에서 "유형 확인 필요"로 보임)
select 'deposit_return_as_payment' as finding,
  left(c.id::text, 8) as contract, c.contract_kind, p.kind, p.amount, p.starts_on, c.end_date,
  p.starts_on = c.end_date + 1 as is_day_after_end, p.direction, p.money_nature, p.obligation,
  exists (select 1 from public.contract_funds f where f.contract_id = c.id and f.kind = 'deposit') as has_deposit_fund,
  c.deposit_amount = p.amount as equals_deposit
from public.contract_payments p join public.contracts c on c.id = p.contract_id
where coalesce(p.money_nature, '') <> 'deposit_refund'
  and p.label ~ '(보증금|전세금|예치금)[^,]{0,12}(반환|돌려 ?(받|주)|환급|정산)|(반환|환급) ?(예정 ?)?(보증금|전세금|예치금)'
union all
select 'salary_components_untyped',
  left(c.id::text, 8), c.contract_kind, p.kind, p.amount, p.starts_on, c.end_date,
  null, p.direction, p.money_nature, p.obligation, null,
  (select coalesce(sum((x->>'amount')::bigint), 0) from jsonb_array_elements(p.components) x) = p.amount
from public.contract_payments p join public.contracts c on c.id = p.contract_id
where p.kind = 'salary' and jsonb_array_length(p.components) > 0
  and not exists (select 1 from jsonb_array_elements(p.components) x where x ? 'pay')
order by 1, 2;
