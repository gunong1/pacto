-- 읽기 전용 (SELECT만): 최근 근로계약 분석 기록 — AI가 처음 고른 값 · 저장된 값 · 문서 크기를 나란히
-- 같은 PDF를 여러 번 분석했는지(문서 크기·쪽수가 같은지), 분석마다 시작일·금액이 달랐는지, 저장 후 수정했는지 확인용.
-- 이름·주소·계약서 문장은 출력하지 않는다 (날짜·금액·크기만).
select
  left(j.id::text, 8)                                                        as 분석,
  to_char(j.created_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI')            as 분석시각,
  j.prompt_version                                                           as 지시문,
  j.model                                                                    as 모델,
  (select string_agg(d.size_bytes::text || 'B/' || coalesce(d.page_count, 0) || '쪽', ', ')
     from public.contract_documents d where d.analysis_job_id = j.id)        as 문서크기,
  (select string_agg(coalesce(x->>'use', x->>'meaning', '?') || '=' || coalesce(x->>'date', '-') || '(' || coalesce(x->>'confidence', '-') || ')', ', ')
     from jsonb_array_elements(coalesce(j.result->'dates', '[]'::jsonb)) x)   as AI_날짜,
  (select string_agg(coalesce(x->>'amount', '-') || '(구성 ' || coalesce(jsonb_array_length(x->'components'), 0) || ')', ', ')
     from jsonb_array_elements(coalesce(j.result->'payments', '[]'::jsonb)) x) as AI_금액,
  left(c.id::text, 8)                                                        as 저장계약,
  c.start_date                                                               as 저장_시작일,
  c.contract_date                                                            as 저장_체결일,
  (select string_agg(p.amount::text || '(구성 ' || coalesce(jsonb_array_length(p.components), 0) || ')', ', ')
     from public.contract_payments p where p.contract_id = c.id)            as 저장_금액,
  case when c.id is null then '-' when c.updated_at > c.created_at + interval '1 minute' then '저장 후 수정됨' else '수정 없음' end as 수정여부
from public.analysis_jobs j
left join public.contracts c on c.analysis_job_id = j.id
where j.status = 'succeeded'
  and (j.result->'classification'->>'kind' = 'employment' or j.result::text like '%employment%')
order by j.created_at desc
limit 6;
