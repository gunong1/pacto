-- 보증금의 계약금·중도금·잔금 = 보증금 자금 이동 (저장 데이터 정리) — 분석 규칙 R7 installmentParents와 같은 규칙
--
-- 계약금이라는 이름만 보고 판단하지 않는다. 두 조건이 모두 맞을 때만 방향을 neutral로 바꾼다.
--   ① 의미 관계(필수): 그 몫이 보증금의 일부라는 근거 — 결제 이름에 "보증금·전세금"이 있거나,
--      계약에 연결된 분석 결과(analysis_jobs.result)의 같은 이름·금액 결제 근거 문장이 "보증금·전세금"을 말한다
--   ② 합계 일치(보조): 같은 계약의 일회성·확정 몫(계약금·중도금·잔금·착수금…) 전체(또는 보증금보다 작은 몫 2개 이상)의 합
--      = 계약 요약의 보증금(contracts.deposit_amount)
-- 근거가 없는 계약(직접 입력·분석 결과 없음)은 그대로 둔다. 지급 일정·금액·행은 바꾸지 않는다.
-- 반복 실행해도 결과가 같다 (이미 neutral인 행은 다시 바꾸지 않고, 조건은 방향과 무관).

create or replace function public.mark_deposit_installment_parts() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer := 0;
  m integer := 0;
  c record;
  part_re constant text := '계약금(?!액)|중도금|잔금|착수금|선금|선급금|중간금|잔여금';
  ids uuid[];
begin
  for c in
    select k.id, k.deposit_amount, j.result
    from public.contracts k left join public.analysis_jobs j on j.id = k.analysis_job_id
    where k.deposit_amount is not null and k.deposit_amount > 0
  loop
    -- ② 합계: 몫 전체, 아니면 보증금보다 작은 몫들
    select array_agg(p.id) into ids from public.contract_payments p
    where p.contract_id = c.id and p.frequency = 'one_time' and p.obligation = 'confirmed' and p.label ~ part_re
    having count(*) >= 2 and sum(p.amount) = c.deposit_amount;
    if ids is null then
      select array_agg(p.id) into ids from public.contract_payments p
      where p.contract_id = c.id and p.frequency = 'one_time' and p.obligation = 'confirmed' and p.label ~ part_re and p.amount < c.deposit_amount
      having count(*) >= 2 and sum(p.amount) = c.deposit_amount;
    end if;
    if ids is null then continue; end if;
    -- ① 의미 관계: 모든 몫에 보증금 근거가 있어야 한다
    if exists (
      select 1 from public.contract_payments p
      where p.id = any(ids)
        and p.label !~ '보증금|전세금'
        and not exists (
          select 1 from jsonb_array_elements(coalesce(c.result -> 'payments', '[]'::jsonb)) rp
          where rp ->> 'label' = p.label and (rp ->> 'amount')::bigint = p.amount
            and (rp -> 'evidence')::text ~ '보증금|전세금'
        )
    ) then continue; end if;
    update public.contract_payments p set direction = 'neutral' where p.id = any(ids) and p.direction <> 'neutral';
    get diagnostics m = row_count;
    n := n + m;
  end loop;
  return n;
end;
$$;
revoke all on function public.mark_deposit_installment_parts() from public, anon, authenticated;
grant execute on function public.mark_deposit_installment_parts() to service_role;

select public.mark_deposit_installment_parts();
