-- 보증금 계약금·잔금 분류 조사 (읽기 전용 — SELECT만, 운영 데이터를 바꾸지 않는다)
-- Supabase SQL Editor에 붙여넣고 Run. 계약서 원문·이름·메모·결제 이름 원문은 출력하지 않는다 (예/아니오와 코드값만).
-- 최근 등록된 보증금 있는 계약 10개의 결제를 한 줄씩 보여 준다.
with c as (
  select id, contract_kind, deposit_amount, analysis_job_id, created_at
  from public.contracts
  where coalesce(deposit_amount, 0) > 0
  order by created_at desc
  limit 10
), j as (
  select c.id as contract_id, a.prompt_version, a.result, a.raw_output is not null as has_raw
  from c left join public.analysis_jobs a on a.id = c.analysis_job_id
), ai as (
  -- AI 분석 결과(앱으로 보낸 초안)의 같은 금액 결제: 근거 문장에 '보증금/전세금'이 있었는지, part_of를 답했는지 (예/아니오만)
  select j.contract_id, (p->>'amount')::numeric as amount,
         bool_or(coalesce(p->'evidence', '[]'::jsonb)::text ~ '(보증금|전세금)') as ai_quote_has_deposit_word,
         bool_or(p ? 'partOf') as ai_part_of,
         max(p->>'moneyNature') as ai_money_nature,
         bool_or(p->>'natureCheck' = 'deposit_part') as ai_nature_check
  from j cross join lateral jsonb_array_elements(coalesce(j.result->'payments', '[]'::jsonb)) p
  group by 1, 2
)
select
  left(c.id::text, 8) as contract,
  c.contract_kind,
  c.deposit_amount,
  j.prompt_version,
  j.has_raw as raw_output_kept,
  (select count(*) from public.contract_funds f where f.contract_id = c.id) as funds,
  (select count(*) from public.fund_refunds r join public.contract_funds f on f.id = r.fund_id where f.contract_id = c.id) as refunds,
  p.kind,
  p.label in ('계약금', '중도금', '잔금') or p.label ~ '^(보증금|전세금) ?(계약금|중도금|잔금)' as label_is_installment,
  p.label ~ '(보증금|전세금)' as label_has_deposit_word,
  p.amount,
  p.frequency,
  p.starts_on,
  p.direction,
  p.money_nature,
  p.direction_basis,
  p.fund_id is not null as fund_linked,
  ai.ai_quote_has_deposit_word,
  ai.ai_part_of,
  ai.ai_money_nature,
  ai.ai_nature_check
from c
join public.contract_payments p on p.contract_id = c.id
left join j on j.contract_id = c.id
left join ai on ai.contract_id = c.id and ai.amount = p.amount
order by c.created_at desc, p.sort_order;
