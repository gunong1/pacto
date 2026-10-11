-- 저장된 총액·구성항목 정리 (일회성) — 분석 규칙 리팩터링 G
--
-- A) 일회성 총액: 이전에는 읽을 때마다 앱이 "보증금 20,000,000 = 계약금 2,000,000 + 잔금 18,000,000"의 보증금 결제 행을
--    참고 금액으로 다시 판단했다. 이제 읽기 단계는 다시 판단하지 않으므로 저장 데이터를 한 번 정리한다.
--    규칙 (paymentAggregate.ts findAggregateTotals와 같음): 일회성·확정 금액 중 몫 이름(계약금·중도금·잔금·착수금…)이 아닌 금액이
--    같은 계약의 몫(일회성·확정, 2개 이상) 전체의 합, 또는 그보다 작은 몫 2개 이상의 합과 정확히 같으면 총액
--    → 참고 금액 정리(migrate_informational_payments)와 같은 방식으로 요약 칸(보증금·계약 총액) 또는 참고 금액 목록으로 옮긴다.
--
-- B) 정기 금액의 구성항목
--
-- 이전에는 저장된 계약을 "읽을 때마다" 앱이 기본급·수당을 급여(총액)의 구성항목으로 다시 판단했다 (rowMapping).
-- 이제 읽기 단계는 DB에 저장된 의미를 그대로 쓰므로, 이미 저장된 데이터를 한 번 정리한다.
-- 규칙 (supabase/functions/_shared/paymentAggregate.ts와 같은 원칙, 보수적으로):
--   같은 계약 · 같은 주기 · 같은 방향의 확정 정기 금액 중, 더 작은 나머지 금액(2개 이상)의 합이 정확히 총액과 같고
--   총액 이름이 급여·월급·임금·보수·합계·총액 등이거나 총액에만 지급일이 있을 때만
--   → 나머지 금액은 총액의 components로 옮기고 결제 행은 지운다. 애매하면 건드리지 않는다.

create or replace function public.fold_one_time_totals() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.contract_payments t set obligation = 'informational', condition_note = '총액 — 계약금·잔금 등으로 나눠 지급'
  where t.frequency = 'one_time' and t.obligation = 'confirmed' and t.amount > 0
    and t.label !~ '계약금(?!액)|중도금|잔금|착수금|선금|선급금|중간금|잔여금'
    and exists (
      select 1 from (
        select count(*) as n, sum(p.amount) as total,
          count(*) filter (where p.amount < t.amount) as n_small, sum(p.amount) filter (where p.amount < t.amount) as small
        from public.contract_payments p
        where p.contract_id = t.contract_id and p.id <> t.id and p.frequency = 'one_time' and p.obligation = 'confirmed'
          and p.label ~ '계약금(?!액)|중도금|잔금|착수금|선금|선급금|중간금|잔여금'
      ) x
      where x.n >= 2 and (x.total = t.amount or (x.n_small >= 2 and x.small = t.amount))
    );
  perform public.migrate_informational_payments();
end;
$$;
revoke all on function public.fold_one_time_totals() from public, anon, authenticated;
grant execute on function public.fold_one_time_totals() to service_role;

create or replace function public.fold_recurring_components() returns void
language plpgsql security definer set search_path = '' as $$
declare
  g record;
begin
  for g in
    select t.id as total_id,
      array_agg(p.id order by p.sort_order) as part_ids,
      jsonb_agg(jsonb_build_object('label', p.label, 'amount', p.amount) order by p.sort_order) as parts
    from public.contract_payments t
    join public.contract_payments p
      on p.contract_id = t.contract_id and p.id <> t.id and p.frequency = t.frequency and p.direction = t.direction
      and p.obligation = 'confirmed' and p.amount > 0 and p.amount < t.amount
    where t.frequency <> 'one_time' and t.obligation = 'confirmed' and t.amount > 0
    group by t.id, t.amount, t.label, t.day_of_month
    having count(p.id) >= 2
      and sum(p.amount) = t.amount
      and (t.label ~ '(급여|월급|임금|보수|합계|총액|총 |총계|월 지급액|실수령)' or (t.day_of_month is not null and bool_and(p.day_of_month is null)))
  loop
    update public.contract_payments set components = components || coalesce((
      select jsonb_agg(x) from jsonb_array_elements(g.parts) x
      where not exists (select 1 from jsonb_array_elements(components) c where c ->> 'label' = x ->> 'label')
    ), '[]'::jsonb)
    where id = g.total_id;
    delete from public.contract_payments where id = any (g.part_ids);
  end loop;
end;
$$;
revoke all on function public.fold_recurring_components() from public, anon, authenticated;
grant execute on function public.fold_recurring_components() to service_role;

select public.fold_one_time_totals();
select public.fold_recurring_components();
