-- 보증금의 계약금·중도금·잔금 = 보증금 자금 이동 (일회성 정리) — 분석 규칙 R7 installmentParents와 같은 규칙
--
-- 계약금이라는 이름만 보고 일반 지출로 두지 않는다. 몫이 무엇의 일부인지(상위 금액)로 성격을 정한다.
-- 저장된 계약에서: 같은 계약의 일회성·확정 몫(계약금·중도금·잔금·착수금…) 전체의 합, 또는 보증금보다 작은 몫 2개 이상의 합이
-- 계약 요약의 보증금(contracts.deposit_amount)과 정확히 같으면 → 그 몫들의 방향을 neutral(보증금 자금 이동)로.
-- 지급 일정(날짜·금액)은 그대로 — 월 지출 합계에서만 빠진다. 금액이 정확히 맞지 않으면 건드리지 않는다. 행을 지우지 않는다.

create or replace function public.mark_deposit_installment_parts() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer := 0;
  m integer := 0;
  c record;
  part_re constant text := '계약금(?!액)|중도금|잔금|착수금|선금|선급금|중간금|잔여금';
begin
  for c in
    select k.id, k.deposit_amount from public.contracts k where k.deposit_amount is not null and k.deposit_amount > 0
  loop
    -- 몫 전체의 합 = 보증금
    if (select count(*) >= 2 and sum(p.amount) = c.deposit_amount from public.contract_payments p
        where p.contract_id = c.id and p.frequency = 'one_time' and p.obligation = 'confirmed' and p.label ~ part_re) then
      update public.contract_payments p set direction = 'neutral'
      where p.contract_id = c.id and p.frequency = 'one_time' and p.obligation = 'confirmed' and p.label ~ part_re and p.direction <> 'neutral';
      get diagnostics m = row_count;
      n := n + m;
    -- 보증금보다 작은 몫 2개 이상의 합 = 보증금
    elsif (select count(*) >= 2 and sum(p.amount) = c.deposit_amount from public.contract_payments p
        where p.contract_id = c.id and p.frequency = 'one_time' and p.obligation = 'confirmed' and p.label ~ part_re and p.amount < c.deposit_amount) then
      update public.contract_payments p set direction = 'neutral'
      where p.contract_id = c.id and p.frequency = 'one_time' and p.obligation = 'confirmed' and p.label ~ part_re
        and p.amount < c.deposit_amount and p.direction <> 'neutral';
      get diagnostics m = row_count;
      n := n + m;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.mark_deposit_installment_parts() from public, anon, authenticated;
grant execute on function public.mark_deposit_installment_parts() to service_role;

select public.mark_deposit_installment_parts();
