-- PACTO: 대출 이자 계산 기준 (월별 이자·만기 원금 상환 계획용 — src/domain/loanPlan.ts)
-- 추가만 한다 (기존 키·데이터·함수는 바꾸지 않음). 다시 실행해도 같은 결과 (on conflict do update).
-- - interest_day_count: actual_365 실제 일수÷365 / actual_360 실제 일수÷360 / monthly_12 연 이자율÷12
-- - interest_period: calendar_month 매월 1일~말일(다음 달 납부일 납부) / pay_cycle 납부일~다음 납부일 전날
-- - interest_rounding: 이자 원 단위 처리
insert into public.contract_detail_fields (contract_type, key, value_type, options) values
  ('loan', 'interest_day_count', 'enum', array['actual_365', 'actual_360', 'monthly_12']),
  ('loan', 'interest_period', 'enum', array['calendar_month', 'pay_cycle']),
  ('loan', 'interest_rounding', 'enum', array['floor_1', 'round_1', 'floor_10'])
on conflict (contract_type, key) do update set value_type = excluded.value_type, options = excluded.options;
