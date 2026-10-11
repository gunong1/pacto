-- 결제일이 없는 기존 정기 지출의 결제일 채우기 (일회성) — 분석 규칙 리팩터링 D
--
-- 새 원칙: 결제일(day_of_month)이 없는 정기 결제는 다른 날짜(계약 시작일·다른 결제의 결제일)에서 추측하지 않고
--          "결제일 확인 필요"로 두며 반복 일정을 만들지 않는다 (앱 계산 isPaymentDayUnknown).
-- 이전 버전은 결제일이 없으면 결제 시작일(starts_on)의 날짜로 캘린더에 보여줬다. 이미 저장된 계약의 캘린더가
-- 갑자기 비지 않도록, 그때 보이던 날짜를 결제일로 한 번만 채운다 (사용자가 보던 일정 그대로).
-- 정기 수입(급여 등)은 이전에도 지급일이 없으면 일정을 만들지 않았으므로 그대로 둔다.

create or replace function public.backfill_payment_days() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.contract_payments
  set day_of_month = extract(day from starts_on)::smallint
  where frequency <> 'one_time'
    and day_of_month is null
    and direction <> 'income'
    and starts_on is not null;
end;
$$;
revoke all on function public.backfill_payment_days() from public, anon, authenticated;
grant execute on function public.backfill_payment_days() to service_role;

select public.backfill_payment_days();
