-- PACTO: 근로계약 급여 방식 (월급제·시급제·일급제·연봉제 — src/domain/payBasis.ts)
-- 추가만 한다 (기존 키·데이터·함수는 바꾸지 않음). 다시 실행해도 같은 결과 (on conflict do update).
-- - pay_basis: monthly 월급제 / hourly 시급제 / daily 일급제 / annual 연봉제 (비어 있으면 예전 계약 = 월급 금액 그대로)
-- - hourly_wage·daily_wage: 시급·일급 (원, 정수) — 단가 그대로 보관 (월급으로 바꿔 저장하지 않음)
-- - daily_work_hours: 하루 근무시간 (0~24, 소수 허용) · monthly_work_days: 월 예상 근무일수 (0~31, 소수 허용)
-- 예상 월 수입(세전 기본급 추정)은 기존처럼 급여 결제(contract_payments) 금액으로 저장한다 — 스키마 변경 없음.
insert into public.contract_detail_fields (contract_type, key, value_type, options) values
  ('employment', 'pay_basis', 'enum', array['monthly', 'hourly', 'daily', 'annual']),
  ('employment', 'hourly_wage', 'integer', null),
  ('employment', 'daily_work_hours', 'number', null),
  ('employment', 'daily_wage', 'integer', null),
  ('employment', 'monthly_work_days', 'number', null)
on conflict (contract_type, key) do update set value_type = excluded.value_type, options = excluded.options;
