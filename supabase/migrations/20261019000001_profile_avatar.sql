-- 프로필: 닉네임(display_name 재사용) 규칙 + 프로필 사진(비공개 Storage, 본인 폴더만)
-- - 닉네임: 앞뒤 공백 없이 2~20자. 없으면 null (화면에서는 이메일을 대신 보여준다)
-- - 프로필 사진: profile-images/{user_id}/avatar.jpg (512x512 JPEG). profiles.avatar_path에 경로만 저장 — 공개 URL 없음, Signed URL로만 표시
-- - 다른 사용자의 사진은 읽기·올리기·바꾸기·지우기 모두 불가 (Storage 정책 + avatar_path 검사)

-- ===== 닉네임 =====
create or replace function public.valid_display_name(v text) returns boolean
language sql immutable set search_path = '' as $$
  select v is null or (v = btrim(v) and char_length(v) between 2 and 20)
$$;

-- 기존 값 정리 (그동안 화면에서 쓰지 않던 값): 앞뒤 공백 제거, 규칙에 맞지 않으면 비움
update public.profiles set display_name = nullif(btrim(display_name), '') where display_name is not null and display_name <> btrim(display_name);
update public.profiles set display_name = null where not public.valid_display_name(display_name);

alter table public.profiles drop constraint if exists profiles_display_name_check;
alter table public.profiles add constraint profiles_display_name_valid check (public.valid_display_name(display_name));

-- 가입 트리거: 가입 정보의 이름이 규칙에 맞지 않으면 비운다 (가입이 실패하지 않도록)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  name text := nullif(btrim(coalesce(meta ->> 'display_name', '')), '');
begin
  insert into public.profiles (id, display_name, terms_agreed_at, privacy_agreed_at, ai_processing_agreed_at)
  values (
    new.id,
    case when public.valid_display_name(name) then name end,
    case when (meta ->> 'terms_agreed')::boolean then now() end,
    case when (meta ->> 'privacy_agreed')::boolean then now() end,
    case when (meta ->> 'ai_processing_agreed')::boolean then now() end
  );
  return new;
end;
$$;

-- ===== 프로필 사진 =====
alter table public.profiles add column if not exists avatar_path text;
-- 본인 폴더의 정해진 파일만 가리킬 수 있다
alter table public.profiles add constraint profiles_avatar_path_own check (avatar_path is null or avatar_path = id::text || '/avatar.jpg');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-images', 'profile-images', false, 1048576, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "profile-images: read own" on storage.objects for select to authenticated
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "profile-images: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- 같은 경로에 덮어쓰기(사진 변경)
create policy "profile-images: update own" on storage.objects for update to authenticated
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'profile-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "profile-images: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
