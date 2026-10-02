-- Profile photos stay private: owners and users sharing a workspace can read them.
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles drop constraint if exists profiles_avatar_path_check;
alter table public.profiles add constraint profiles_avatar_path_check check (
  avatar_path is null or (
    split_part(avatar_path, '/', 1) = id::text
    and avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('papergraph-avatars', 'papergraph-avatars', false, 524288, array['image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_read_profile_avatar(target_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    auth.uid() = target_user_id or exists (
      select 1 from public.workspace_members as mine
      join public.workspace_members as theirs on theirs.workspace_id = mine.workspace_id
      where mine.user_id = auth.uid() and theirs.user_id = target_user_id
    )
  );
$$;
revoke all on function public.can_read_profile_avatar(uuid) from public;
grant execute on function public.can_read_profile_avatar(uuid) to authenticated;

drop policy if exists "profile avatars readable by workspace peers" on storage.objects;
create policy "profile avatars readable by workspace peers" on storage.objects
for select to authenticated using (
  bucket_id = 'papergraph-avatars' and
  case when split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.can_read_profile_avatar(split_part(name, '/', 1)::uuid)
    else false end
);
drop policy if exists "profile avatars insertable by owner" on storage.objects;
create policy "profile avatars insertable by owner" on storage.objects
for insert to authenticated with check (
  bucket_id = 'papergraph-avatars' and split_part(name, '/', 1) = auth.uid()::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'
);
drop policy if exists "profile avatars deletable by owner" on storage.objects;
create policy "profile avatars deletable by owner" on storage.objects
for delete to authenticated using (
  bucket_id = 'papergraph-avatars' and split_part(name, '/', 1) = auth.uid()::text
);

create or replace function public.list_workspace_member_avatars(target_workspace_id uuid)
returns table (user_id uuid, avatar_path text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_workspace_member(target_workspace_id) then raise exception 'not allowed'; end if;
  return query select members.user_id, profiles.avatar_path
    from public.workspace_members as members
    join public.profiles on profiles.id = members.user_id
    where members.workspace_id = target_workspace_id and profiles.avatar_path is not null;
end;
$$;
revoke all on function public.list_workspace_member_avatars(uuid) from public;
grant execute on function public.list_workspace_member_avatars(uuid) to authenticated;
