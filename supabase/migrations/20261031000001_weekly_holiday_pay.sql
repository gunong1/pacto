-- PACTO: 시급제 주휴수당 예상 계산 (src/domain/payBasis.ts weeklyPay)
-- 추가만 한다 (기존 키·데이터·함수는 바꾸지 않음). 다시 실행해도 같은 결과 (on conflict do update).
-- - weekly_work_days: 주 근무일수 (0~7, 소수 허용)
-- - weekly_holiday_pay: included 포함(사용자가 지급 대상이라고 확인 — 법적 요건 판정 아님) / excluded 제외 / in_wage 시급에 이미 포함
-- 주 기본급·주휴수당·예상 월 수입은 저장하지 않고 계산한다 (예상 월 수입은 기존처럼 급여 결제 금액).
insert into public.contract_detail_fields (contract_type, key, value_type, options) values
  ('employment', 'weekly_work_days', 'number', null),
  ('employment', 'weekly_holiday_pay', 'enum', array['included', 'excluded', 'in_wage'])
on conflict (contract_type, key) do update set value_type = excluded.value_type, options = excluded.options;
