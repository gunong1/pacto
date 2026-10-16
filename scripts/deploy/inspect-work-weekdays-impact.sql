-- 읽기 전용 (SELECT만) — 마이그레이션 20261101000001 · notifications 재배포 전 영향 범위 확인. 건수만 출력 (계약 내용·개인정보 없음)
-- Supabase SQL Editor에 붙여 넣어 실행
select '1. 근무 요일 키 등록 여부 (적용 전 0)' as 항목, count(*) as 건수
  from public.contract_detail_fields where contract_type = 'employment' and key = 'work_weekdays'
union all
select '2. 근무 요일 값이 저장된 계약 (적용 전 0)', count(*)
  from public.contracts where contract_details ? 'work_weekdays'
union all
select '3. 근로계약 전체', count(*)
  from public.contracts where contract_type = 'employment'
union all
select '4. 원 단위 처리를 골라 둔 계약 (재배포 후 일반 반올림으로 계산 → 첫·마지막 급여 알림 금액이 최대 999원 달라질 수 있음)', count(*)
  from public.contracts where contract_type = 'employment' and contract_details ? 'pay_rounding'
union all
select '5. 지급 시기·일할 기준은 있고 산정기간이 없는 계약 (재배포 후 1일~말일로 첫 달 일할 → 첫 급여 알림 금액이 월 전액에서 일할액으로)', count(*)
  from public.contracts where contract_type = 'employment' and contract_details ? 'pay_timing' and contract_details ? 'proration_basis'
   and not contract_details ? 'pay_period_start_day' and coalesce(contract_details->>'proration_basis', '') <> 'none'
union all
select '6. 시급제·일급제 계약 (근무 요일 없으면 재배포 후에도 알림 금액 그대로)', count(*)
  from public.contracts where contract_type = 'employment' and contract_details->>'pay_basis' in ('hourly', 'daily');
