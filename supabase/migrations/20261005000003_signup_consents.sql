-- 가입 시 동의 기록: 가입 요청의 user metadata(terms/privacy/ai)를 profiles 동의 시각으로 옮긴다.
-- (이메일 인증이 켜져 있으면 가입 직후 세션이 없으므로 트리거에서 처리)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, display_name, terms_agreed_at, privacy_agreed_at, ai_processing_agreed_at)
  values (
    new.id,
    nullif(meta ->> 'display_name', ''),
    case when (meta ->> 'terms_agreed')::boolean then now() end,
    case when (meta ->> 'privacy_agreed')::boolean then now() end,
    case when (meta ->> 'ai_processing_agreed')::boolean then now() end
  );
  return new;
end;
$$;
