-- PACTO: 근로계약 근무 요일 (중도 입사·퇴사 달의 실제 소정근로일 계산 — src/domain/payroll.ts)
-- 추가만 한다 (기존 키·데이터·함수는 바꾸지 않음). 다시 실행해도 같은 결과 (on conflict do update).
-- - work_weekdays: 근무 요일 "1,2,3,4,5" (월=1 … 일=7, 쉼표 구분). 형식 검사는 앱(레지스트리)이 한다 — DB는 text (500자 이하)
-- 값이 없는 기존 계약은 그대로 (근무 요일이 없으면 첫·마지막 달은 월평균 추정으로 구분해 보여 준다).
insert into public.contract_detail_fields (contract_type, key, value_type, options) values
  ('employment', 'work_weekdays', 'text', null)
on conflict (contract_type, key) do update set value_type = excluded.value_type, options = excluded.options;
