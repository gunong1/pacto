-- 읽기 전용 (SELECT만): 대출 계약의 저장된 금액 항목 — 실행금이 결제로 저장됐는지, 이자가 회차별로 나뉘어 있는지 확인용
-- 이름·계약서 문장은 출력하지 않는다 (종류·금액·날짜·방향만). 수정은 앱의 정리 카드에서 사용자가 확인했을 때만.
select
  left(c.id::text, 8)                                                   as 계약,
  c.source                                                              as 등록방식,
  c.start_date                                                          as 실행일,
  c.end_date                                                            as 만기일,
  c.contract_details ->> 'principal'                                    as 원금정보,
  p.kind                                                                as 종류,
  p.label                                                               as 항목이름,
  p.amount                                                              as 금액,
  p.frequency                                                           as 주기,
  p.starts_on                                                           as 날짜,
  p.direction                                                           as 방향,
  case
    when p.frequency = 'one_time' and p.starts_on = c.start_date and p.kind <> 'loan_repayment' then '실행금 의심'
    when p.kind = 'interest' and p.frequency = 'one_time' then '회차별 이자'
    else ''
  end                                                                   as 점검
from public.contracts c
join public.contract_payments p on p.contract_id = c.id
where c.contract_type = 'loan'
order by c.created_at desc, p.starts_on
limit 60;
