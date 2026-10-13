-- PACTO: 근로계약 급여 산정·지급 규정 (첫·마지막 급여 일할 계산용 — src/domain/payroll.ts)
-- 추가만 한다 (기존 키·데이터·함수는 바꾸지 않음). 다시 실행해도 같은 결과 (on conflict do update).
-- - pay_period_start_day: 급여 산정기간 시작일 (1 = 매월 1일~말일)
-- - pay_timing: same_month 산정기간이 끝나는 달 / next_month 다음 달 지급
-- - proration_basis: calendar_days 달력 일수 / scheduled_workdays 소정근로일수 / none 일할 계산 없음
-- - pay_rounding: 일할 금액 원 단위 처리
-- 구성항목의 지급 유형·조건·상태는 contract_payments.components(jsonb)의 선택 칸이라 스키마 변경 없음.
insert into public.contract_detail_fields (contract_type, key, value_type, options) values
  ('employment', 'pay_period_start_day', 'integer', null),
  ('employment', 'pay_timing', 'enum', array['same_month', 'next_month']),
  ('employment', 'proration_basis', 'enum', array['calendar_days', 'scheduled_workdays', 'none']),
  ('employment', 'pay_rounding', 'enum', array['floor_1', 'round_1', 'floor_10', 'floor_100', 'floor_1000'])
on conflict (contract_type, key) do update set value_type = excluded.value_type, options = excluded.options;
