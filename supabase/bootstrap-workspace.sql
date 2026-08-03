create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'PaperGraph',
  language text not null default 'pt' check (language in ('pt', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  member_role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table public.workspace_members
drop constraint if exists workspace_members_member_role_check;

alter table public.workspace_members
add constraint workspace_members_member_role_check
check (member_role in ('owner', 'member', 'editor', 'viewer'));

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  invited_email text not null,
  invited_by uuid not null references auth.users (id) on delete cascade,
  member_role text not null default 'editor' check (member_role in ('member', 'editor', 'viewer')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint workspace_invites_workspace_id_invited_email_key unique (workspace_id, invited_email)
);

alter table public.workspace_invites
drop constraint if exists workspace_invites_member_role_check;

alter table public.workspace_invites
alter column member_role set default 'editor';

alter table public.workspace_invites
add constraint workspace_invites_member_role_check
check (member_role in ('member', 'editor', 'viewer'));

create table if not exists public.articles (
  id text not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null,
  author text not null default 'PaperGraph',
  status text not null default 'Draft' check (status in ('Draft', 'Review', 'Published')),
  source_type text not null default 'latex' check (source_type in ('latex', 'pdf')),
  source text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists public.article_collaboration_states (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  article_id text not null,
  state_base64 text not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, article_id)
);

create table if not exists public.relations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  from_article_id text not null,
  to_article_id text not null,
  relation_type text not null default 'manual' check (relation_type in ('auto', 'explicit', 'manual', 'suggested')),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.article_positions (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  article_id text not null,
  x numeric not null default 50,
  y numeric not null default 50,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, article_id)
);

create table if not exists public.assets (
  id text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  article_id text,
  bucket text not null default 'papergraph-assets',
  storage_path text not null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.ignored_unlinked_mentions (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_article_id text not null,
  target_article_id text not null,
  mention_key text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, mention_key)
);

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.articles enable row level security;
alter table public.article_collaboration_states enable row level security;
alter table public.relations enable row level security;
alter table public.article_positions enable row level security;
alter table public.assets enable row level security;
alter table public.ignored_unlinked_mentions enable row level security;

create or replace function public.is_workspace_member(workspace_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_members.workspace_id = workspace_uuid
      and workspace_members.user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_owner(workspace_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_members.workspace_id = workspace_uuid
      and workspace_members.user_id = auth.uid()
      and workspace_members.member_role = 'owner'
  );
$$;

create or replace function public.can_edit_workspace(workspace_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_members.workspace_id = workspace_uuid
      and workspace_members.user_id = auth.uid()
      and workspace_members.member_role in ('owner', 'editor', 'member')
  );
$$;

create or replace function public.prevent_workspace_owner_id_direct_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.owner_id is distinct from new.owner_id
    and coalesce(current_setting('papergraph.allow_owner_transfer', true), '') <> 'on' then
    raise exception 'workspace owner can only be changed through transfer_workspace_owner';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_workspace_owner_id_direct_update on public.workspaces;

create trigger prevent_workspace_owner_id_direct_update
before update of owner_id on public.workspaces
for each row
execute function public.prevent_workspace_owner_id_direct_update();

drop policy if exists "profiles visible to owner" on public.profiles;
drop policy if exists "profiles insertable by owner" on public.profiles;
drop policy if exists "profiles editable by owner" on public.profiles;
drop policy if exists "workspaces visible to members" on public.workspaces;
drop policy if exists "workspaces insertable by owner" on public.workspaces;
drop policy if exists "workspaces editable by members" on public.workspaces;
drop policy if exists "workspace members visible to members" on public.workspace_members;
drop policy if exists "workspace members insertable by self" on public.workspace_members;
drop policy if exists "workspace members insertable by owners" on public.workspace_members;
drop policy if exists "workspace members editable by owners" on public.workspace_members;
drop policy if exists "workspace members deletable by owners" on public.workspace_members;
drop policy if exists "workspace invites visible to owners and invitee" on public.workspace_invites;
drop policy if exists "workspace invites insertable by owners" on public.workspace_invites;
drop policy if exists "workspace invites editable by owners" on public.workspace_invites;
drop policy if exists "workspace invites deletable by owners" on public.workspace_invites;
drop policy if exists "articles visible to members" on public.articles;
drop policy if exists "articles insertable by members" on public.articles;
drop policy if exists "articles editable by members" on public.articles;
drop policy if exists "articles deletable by members" on public.articles;
drop policy if exists "article collaboration states visible to members" on public.article_collaboration_states;
drop policy if exists "article collaboration states insertable by members" on public.article_collaboration_states;
drop policy if exists "article collaboration states editable by members" on public.article_collaboration_states;
drop policy if exists "article collaboration states deletable by members" on public.article_collaboration_states;
drop policy if exists "relations visible to members" on public.relations;
drop policy if exists "relations insertable by members" on public.relations;
drop policy if exists "relations editable by members" on public.relations;
drop policy if exists "relations deletable by members" on public.relations;
drop policy if exists "positions visible to members" on public.article_positions;
drop policy if exists "positions insertable by members" on public.article_positions;
drop policy if exists "positions editable by members" on public.article_positions;
drop policy if exists "positions deletable by members" on public.article_positions;
drop policy if exists "assets visible to members" on public.assets;
drop policy if exists "assets insertable by members" on public.assets;
drop policy if exists "assets editable by members" on public.assets;
drop policy if exists "assets deletable by members" on public.assets;
drop policy if exists "ignored mentions visible to members" on public.ignored_unlinked_mentions;
drop policy if exists "ignored mentions insertable by members" on public.ignored_unlinked_mentions;
drop policy if exists "ignored mentions editable by members" on public.ignored_unlinked_mentions;
drop policy if exists "ignored mentions deletable by members" on public.ignored_unlinked_mentions;

create policy "profiles visible to owner"
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy "profiles insertable by owner"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

create policy "profiles editable by owner"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "workspaces visible to members"
on public.workspaces for select
to authenticated
using (public.is_workspace_member(id));

create policy "workspaces insertable by owner"
on public.workspaces for insert
to authenticated
with check (owner_id = auth.uid());

create policy "workspaces editable by members"
on public.workspaces for update
to authenticated
using (public.can_edit_workspace(id))
with check (public.can_edit_workspace(id));

create policy "workspace members visible to members"
on public.workspace_members for select
to authenticated
using (public.is_workspace_member(workspace_id) or user_id = auth.uid());

create policy "workspace members insertable by owners"
on public.workspace_members for insert
to authenticated
with check (public.is_workspace_owner(workspace_id));

create policy "workspace members editable by owners"
on public.workspace_members for update
to authenticated
using (public.is_workspace_owner(workspace_id))
with check (public.is_workspace_owner(workspace_id));

create policy "workspace members deletable by owners"
on public.workspace_members for delete
to authenticated
using (public.is_workspace_owner(workspace_id));

create policy "workspace invites visible to owners and invitee"
on public.workspace_invites for select
to authenticated
using (
  public.is_workspace_owner(workspace_id)
  or lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

create policy "workspace invites insertable by owners"
on public.workspace_invites for insert
to authenticated
with check (public.is_workspace_owner(workspace_id));

create policy "workspace invites editable by owners"
on public.workspace_invites for update
to authenticated
using (public.is_workspace_owner(workspace_id))
with check (public.is_workspace_owner(workspace_id));

create policy "workspace invites deletable by owners"
on public.workspace_invites for delete
to authenticated
using (public.is_workspace_owner(workspace_id));

create policy "articles visible to members"
on public.articles for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "articles insertable by members"
on public.articles for insert
to authenticated
with check (public.can_edit_workspace(workspace_id));

create policy "articles editable by members"
on public.articles for update
to authenticated
using (public.can_edit_workspace(workspace_id))
with check (public.can_edit_workspace(workspace_id));

create policy "articles deletable by members"
on public.articles for delete
to authenticated
using (public.can_edit_workspace(workspace_id));

create policy "article collaboration states visible to members"
on public.article_collaboration_states for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "article collaboration states insertable by members"
on public.article_collaboration_states for insert
to authenticated
with check (public.can_edit_workspace(workspace_id));

create policy "article collaboration states editable by members"
on public.article_collaboration_states for update
to authenticated
using (public.can_edit_workspace(workspace_id))
with check (public.can_edit_workspace(workspace_id));

create policy "article collaboration states deletable by members"
on public.article_collaboration_states for delete
to authenticated
using (public.can_edit_workspace(workspace_id));

create policy "relations visible to members"
on public.relations for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "relations insertable by members"
on public.relations for insert
to authenticated
with check (public.can_edit_workspace(workspace_id));

create policy "relations editable by members"
on public.relations for update
to authenticated
using (public.can_edit_workspace(workspace_id))
with check (public.can_edit_workspace(workspace_id));

create policy "relations deletable by members"
on public.relations for delete
to authenticated
using (public.can_edit_workspace(workspace_id));

create policy "positions visible to members"
on public.article_positions for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "positions insertable by members"
on public.article_positions for insert
to authenticated
with check (public.can_edit_workspace(workspace_id));

create policy "positions editable by members"
on public.article_positions for update
to authenticated
using (public.can_edit_workspace(workspace_id))
with check (public.can_edit_workspace(workspace_id));

create policy "positions deletable by members"
on public.article_positions for delete
to authenticated
using (public.can_edit_workspace(workspace_id));

create policy "assets visible to members"
on public.assets for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "assets insertable by members"
on public.assets for insert
to authenticated
with check (public.can_edit_workspace(workspace_id));

create policy "assets editable by members"
on public.assets for update
to authenticated
using (public.can_edit_workspace(workspace_id))
with check (public.can_edit_workspace(workspace_id));

create policy "assets deletable by members"
on public.assets for delete
to authenticated
using (public.can_edit_workspace(workspace_id));

create policy "ignored mentions visible to members"
on public.ignored_unlinked_mentions for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "ignored mentions insertable by members"
on public.ignored_unlinked_mentions for insert
to authenticated
with check (public.can_edit_workspace(workspace_id));

create policy "ignored mentions editable by members"
on public.ignored_unlinked_mentions for update
to authenticated
using (public.can_edit_workspace(workspace_id))
with check (public.can_edit_workspace(workspace_id));

create policy "ignored mentions deletable by members"
on public.ignored_unlinked_mentions for delete
to authenticated
using (public.can_edit_workspace(workspace_id));

drop function if exists public.ensure_user_workspace(text);
drop function if exists public.list_user_workspaces();
drop function if exists public.create_user_workspace(text);
drop function if exists public.rename_user_workspace(uuid, text);
drop function if exists public.delete_user_workspace(uuid);
drop function if exists public.list_workspace_members(uuid);
drop function if exists public.list_workspace_invites(uuid);
drop function if exists public.list_my_pending_workspace_invites();
drop function if exists public.create_workspace_invite(uuid, text, text);
drop function if exists public.accept_workspace_invite(uuid);
drop function if exists public.decline_workspace_invite(uuid);
drop function if exists public.revoke_workspace_invite(uuid);
drop function if exists public.update_workspace_member_role(uuid, uuid, text);
drop function if exists public.remove_workspace_member(uuid, uuid);
drop function if exists public.transfer_workspace_owner(uuid, uuid);

create function public.ensure_user_workspace(requested_workspace_name text default 'PaperGraph')
returns table (
  workspace_id uuid,
  workspace_name text,
  workspace_language text,
  member_role text,
  workspace_created_at timestamptz,
  workspace_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_workspace_id uuid;
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  insert into public.profiles (id, display_name)
  values (
    current_user_id,
    coalesce(
      nullif(auth.jwt() -> 'user_metadata' ->> 'display_name', ''),
      nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
      nullif(auth.jwt() -> 'user_metadata' ->> 'name', ''),
      nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), '')
    )
  )
  on conflict (id) do update
  set
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    updated_at = now();

  select workspace_members.workspace_id
  into current_workspace_id
  from public.workspace_members
  where workspace_members.user_id = current_user_id
  order by workspace_members.created_at asc
  limit 1;

  if current_workspace_id is null then
    insert into public.workspaces (owner_id, name)
    values (current_user_id, requested_workspace_name)
    returning id into current_workspace_id;

    insert into public.workspace_members (workspace_id, user_id, member_role)
    select current_workspace_id, current_user_id, 'owner'
    where not exists (
      select 1
      from public.workspace_members as existing_member
      where existing_member.workspace_id = current_workspace_id
        and existing_member.user_id = current_user_id
    );
  end if;

  return query
  select
    workspaces.id,
    workspaces.name,
    workspaces.language,
    workspace_members.member_role,
    workspaces.created_at,
    workspaces.updated_at
  from public.workspaces
  join public.workspace_members
    on workspace_members.workspace_id = workspaces.id
  where workspaces.id = current_workspace_id
    and workspace_members.user_id = current_user_id
  limit 1;
end;
$$;

create function public.list_user_workspaces()
returns table (
  workspace_id uuid,
  workspace_name text,
  workspace_language text,
  member_role text,
  workspace_created_at timestamptz,
  workspace_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  return query
  select
    workspaces.id,
    workspaces.name,
    workspaces.language,
    workspace_members.member_role,
    workspaces.created_at,
    workspaces.updated_at
  from public.workspaces
  join public.workspace_members
    on workspace_members.workspace_id = workspaces.id
  where workspace_members.user_id = current_user_id
  order by workspaces.updated_at desc, workspace_members.created_at asc;
end;
$$;

create function public.create_user_workspace(requested_workspace_name text default 'PaperGraph')
returns table (
  workspace_id uuid,
  workspace_name text,
  workspace_language text,
  member_role text,
  workspace_created_at timestamptz,
  workspace_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  next_workspace_name text := coalesce(nullif(btrim(requested_workspace_name), ''), 'PaperGraph');
  next_workspace_id uuid;
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  insert into public.profiles (id, display_name)
  values (
    current_user_id,
    coalesce(
      nullif(auth.jwt() -> 'user_metadata' ->> 'display_name', ''),
      nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
      nullif(auth.jwt() -> 'user_metadata' ->> 'name', ''),
      nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), '')
    )
  )
  on conflict (id) do update
  set
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    updated_at = now();

  insert into public.workspaces (owner_id, name)
  values (current_user_id, next_workspace_name)
  returning id into next_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, member_role)
  values (next_workspace_id, current_user_id, 'owner');

  return query
  select
    workspaces.id,
    workspaces.name,
    workspaces.language,
    workspace_members.member_role,
    workspaces.created_at,
    workspaces.updated_at
  from public.workspaces
  join public.workspace_members
    on workspace_members.workspace_id = workspaces.id
  where workspaces.id = next_workspace_id
    and workspace_members.user_id = current_user_id
  limit 1;
end;
$$;

create function public.rename_user_workspace(
  target_workspace_id uuid,
  requested_workspace_name text
)
returns table (
  workspace_id uuid,
  workspace_name text,
  workspace_language text,
  member_role text,
  workspace_created_at timestamptz,
  workspace_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  next_workspace_name text := coalesce(nullif(btrim(requested_workspace_name), ''), 'PaperGraph');
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_workspace_owner(target_workspace_id) then
    raise exception 'only workspace owners can rename workspaces';
  end if;

  update public.workspaces
  set
    name = next_workspace_name,
    updated_at = now()
  where workspaces.id = target_workspace_id;

  return query
  select
    workspaces.id,
    workspaces.name,
    workspaces.language,
    workspace_members.member_role,
    workspaces.created_at,
    workspaces.updated_at
  from public.workspaces
  join public.workspace_members
    on workspace_members.workspace_id = workspaces.id
  where workspaces.id = target_workspace_id
    and workspace_members.user_id = current_user_id
  limit 1;
end;
$$;

create function public.delete_user_workspace(target_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_workspace_owner(target_workspace_id) then
    raise exception 'only workspace owners can delete workspaces';
  end if;

  delete from public.workspaces
  where workspaces.id = target_workspace_id;
end;
$$;

create function public.list_workspace_members(target_workspace_id uuid)
returns table (
  workspace_id uuid,
  user_id uuid,
  member_role text,
  member_created_at timestamptz,
  display_name text,
  member_email text
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_workspace_member(target_workspace_id) then
    raise exception 'not allowed';
  end if;

  return query
  select
    workspace_members.workspace_id::uuid,
    workspace_members.user_id::uuid,
    workspace_members.member_role::text,
    workspace_members.created_at::timestamptz,
    coalesce(
      public.profiles.display_name,
      nullif(split_part(coalesce(auth_users.email, ''), '@', 1), '')
    )::text as display_name,
    auth_users.email::text as member_email
  from public.workspace_members
  left join public.profiles
    on profiles.id = workspace_members.user_id
  left join auth.users as auth_users
    on auth_users.id = workspace_members.user_id
  where workspace_members.workspace_id = target_workspace_id
  order by
    case workspace_members.member_role when 'owner' then 0 else 1 end,
    workspace_members.created_at asc;
end;
$$;

create function public.list_workspace_invites(target_workspace_id uuid)
returns table (
  invite_id uuid,
  workspace_id uuid,
  workspace_name text,
  invited_email text,
  invited_by uuid,
  invited_by_name text,
  invited_by_email text,
  member_role text,
  invite_status text,
  invite_created_at timestamptz,
  invite_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_workspace_owner(target_workspace_id) then
    raise exception 'not allowed';
  end if;

  return query
  select
    workspace_invites.id::uuid,
    workspace_invites.workspace_id::uuid,
    workspaces.name::text,
    workspace_invites.invited_email::text,
    workspace_invites.invited_by::uuid,
    coalesce(
      inviter_profiles.display_name,
      nullif(split_part(coalesce(inviter_users.email, ''), '@', 1), '')
    )::text as invited_by_name,
    inviter_users.email::text as invited_by_email,
    workspace_invites.member_role::text,
    workspace_invites.status::text,
    workspace_invites.created_at::timestamptz,
    workspace_invites.expires_at::timestamptz
  from public.workspace_invites
  join public.workspaces
    on workspaces.id = workspace_invites.workspace_id
  left join public.profiles as inviter_profiles
    on inviter_profiles.id = workspace_invites.invited_by
  left join auth.users as inviter_users
    on inviter_users.id = workspace_invites.invited_by
  where workspace_invites.workspace_id = target_workspace_id
  order by
    case workspace_invites.status when 'pending' then 0 when 'accepted' then 1 else 2 end,
    workspace_invites.created_at desc;
end;
$$;

create function public.list_my_pending_workspace_invites()
returns table (
  invite_id uuid,
  workspace_id uuid,
  workspace_name text,
  invited_email text,
  invited_by uuid,
  invited_by_name text,
  invited_by_email text,
  member_role text,
  invite_status text,
  invite_created_at timestamptz,
  invite_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  current_user_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if current_user_email = '' then
    raise exception 'account email unavailable';
  end if;

  return query
  select
    workspace_invites.id::uuid,
    workspace_invites.workspace_id::uuid,
    workspaces.name::text,
    workspace_invites.invited_email::text,
    workspace_invites.invited_by::uuid,
    coalesce(
      inviter_profiles.display_name,
      nullif(split_part(coalesce(inviter_users.email, ''), '@', 1), '')
    )::text as invited_by_name,
    inviter_users.email::text as invited_by_email,
    workspace_invites.member_role::text,
    workspace_invites.status::text,
    workspace_invites.created_at::timestamptz,
    workspace_invites.expires_at::timestamptz
  from public.workspace_invites
  join public.workspaces
    on workspaces.id = workspace_invites.workspace_id
  left join public.profiles as inviter_profiles
    on inviter_profiles.id = workspace_invites.invited_by
  left join auth.users as inviter_users
    on inviter_users.id = workspace_invites.invited_by
  where lower(workspace_invites.invited_email) = current_user_email
    and workspace_invites.status = 'pending'
    and workspace_invites.expires_at > now()
    and not exists (
      select 1
      from public.workspace_members
      where workspace_members.workspace_id = workspace_invites.workspace_id
        and workspace_members.user_id = auth.uid()
    )
  order by workspace_invites.created_at desc;
end;
$$;

create function public.create_workspace_invite(
  target_workspace_id uuid,
  target_email text,
  requested_member_role text default 'editor'
)
returns table (
  invite_id uuid,
  workspace_id uuid,
  workspace_name text,
  invited_email text,
  invited_by uuid,
  invited_by_name text,
  invited_by_email text,
  member_role text,
  invite_status text,
  invite_created_at timestamptz,
  invite_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_user_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  normalized_email text := lower(btrim(target_email));
  next_member_role text := 'editor';
  invited_user_id uuid;
  next_invite_id uuid;
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_workspace_owner(target_workspace_id) then
    raise exception 'only workspace owners can invite members';
  end if;

  if normalized_email = '' or normalized_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email';
  end if;

  if normalized_email = current_user_email then
    raise exception 'you are already a member of this workspace';
  end if;

  select auth_users.id
  into invited_user_id
  from auth.users as auth_users
  where lower(auth_users.email) = normalized_email
  limit 1;

  if invited_user_id is not null and exists (
    select 1
    from public.workspace_members
    where workspace_members.workspace_id = target_workspace_id
      and workspace_members.user_id = invited_user_id
  ) then
    raise exception 'user is already a member of this workspace';
  end if;

  if requested_member_role in ('member', 'editor', 'viewer') then
    next_member_role := requested_member_role;
  end if;

  insert into public.workspace_invites (
    workspace_id,
    invited_email,
    invited_by,
    member_role,
    status,
    expires_at,
    created_at,
    accepted_at,
    revoked_at
  )
  values (
    target_workspace_id,
    normalized_email,
    current_user_id,
    next_member_role,
    'pending',
    now() + interval '14 days',
    now(),
    null,
    null
  )
  on conflict on constraint workspace_invites_workspace_id_invited_email_key do update
  set
    invited_by = excluded.invited_by,
    member_role = excluded.member_role,
    status = 'pending',
    expires_at = now() + interval '14 days',
    created_at = now(),
    accepted_at = null,
    revoked_at = null
  returning id into next_invite_id;

  return query
  select workspace_invite_rows.*
  from public.list_workspace_invites(target_workspace_id) as workspace_invite_rows
  where workspace_invite_rows.invite_id = next_invite_id;
end;
$$;

create function public.accept_workspace_invite(invite_uuid uuid)
returns table (
  workspace_id uuid,
  workspace_name text,
  workspace_language text,
  member_role text,
  workspace_created_at timestamptz,
  workspace_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_user_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  target_workspace_id uuid;
  target_member_role text;
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if current_user_email = '' then
    raise exception 'account email unavailable';
  end if;

  select workspace_invites.workspace_id, workspace_invites.member_role
  into target_workspace_id, target_member_role
  from public.workspace_invites
  where workspace_invites.id = invite_uuid
    and lower(workspace_invites.invited_email) = current_user_email
    and workspace_invites.status = 'pending'
    and workspace_invites.expires_at > now()
  limit 1;

  if target_workspace_id is null then
    raise exception 'invite not available';
  end if;

  insert into public.workspace_members (workspace_id, user_id, member_role)
  values (target_workspace_id, current_user_id, target_member_role)
  on conflict on constraint workspace_members_pkey do nothing;

  update public.workspace_invites
  set
    status = 'accepted',
    accepted_at = now(),
    revoked_at = null
  where workspace_invites.id = invite_uuid;

  update public.workspaces
  set updated_at = now()
  where workspaces.id = target_workspace_id;

  return query
  select
    workspaces.id,
    workspaces.name,
    workspaces.language,
    workspace_members.member_role,
    workspaces.created_at,
    workspaces.updated_at
  from public.workspaces
  join public.workspace_members
    on workspace_members.workspace_id = workspaces.id
  where workspaces.id = target_workspace_id
    and workspace_members.user_id = current_user_id
  limit 1;
end;
$$;

create function public.decline_workspace_invite(invite_uuid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if current_user_email = '' then
    raise exception 'account email unavailable';
  end if;

  update public.workspace_invites
  set
    status = 'revoked',
    revoked_at = now()
  where workspace_invites.id = invite_uuid
    and lower(workspace_invites.invited_email) = current_user_email
    and workspace_invites.status = 'pending';

  if not found then
    raise exception 'invite not available';
  end if;
end;
$$;

create function public.revoke_workspace_invite(invite_uuid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_workspace_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select workspace_invites.workspace_id
  into target_workspace_id
  from public.workspace_invites
  where workspace_invites.id = invite_uuid
  limit 1;

  if target_workspace_id is null then
    raise exception 'invite not found';
  end if;

  if not public.is_workspace_owner(target_workspace_id) then
    raise exception 'only workspace owners can revoke invites';
  end if;

  update public.workspace_invites
  set
    status = 'revoked',
    revoked_at = now()
  where workspace_invites.id = invite_uuid
    and workspace_invites.status = 'pending';
end;
$$;

create function public.update_workspace_member_role(
  target_workspace_id uuid,
  target_user_id uuid,
  requested_member_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  next_member_role text := requested_member_role;
  target_current_role text;
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_workspace_owner(target_workspace_id) then
    raise exception 'only workspace owners can change member roles';
  end if;

  if target_user_id = current_user_id then
    raise exception 'workspace owners cannot change their own role here';
  end if;

  if next_member_role not in ('member', 'editor', 'viewer') then
    raise exception 'invalid member role';
  end if;

  select workspace_members.member_role
  into target_current_role
  from public.workspace_members
  where workspace_members.workspace_id = target_workspace_id
    and workspace_members.user_id = target_user_id
  limit 1;

  if target_current_role is null then
    raise exception 'member not found';
  end if;

  if target_current_role = 'owner' then
    raise exception 'workspace owner role cannot be changed here';
  end if;

  update public.workspace_members
  set member_role = next_member_role
  where workspace_members.workspace_id = target_workspace_id
    and workspace_members.user_id = target_user_id;

  update public.workspaces
  set updated_at = now()
  where workspaces.id = target_workspace_id;
end;
$$;

create function public.remove_workspace_member(
  target_workspace_id uuid,
  target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_current_role text;
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_workspace_owner(target_workspace_id) then
    raise exception 'only workspace owners can remove members';
  end if;

  if target_user_id = current_user_id then
    raise exception 'workspace owners cannot remove themselves here';
  end if;

  select workspace_members.member_role
  into target_current_role
  from public.workspace_members
  where workspace_members.workspace_id = target_workspace_id
    and workspace_members.user_id = target_user_id
  limit 1;

  if target_current_role is null then
    raise exception 'member not found';
  end if;

  if target_current_role = 'owner' then
    raise exception 'workspace owner cannot be removed here';
  end if;

  delete from public.workspace_members
  where workspace_members.workspace_id = target_workspace_id
    and workspace_members.user_id = target_user_id;

  update public.workspaces
  set updated_at = now()
  where workspaces.id = target_workspace_id;
end;
$$;

create function public.transfer_workspace_owner(
  target_workspace_id uuid,
  next_owner_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  next_owner_current_role text;
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_workspace_owner(target_workspace_id) then
    raise exception 'only workspace owners can transfer ownership';
  end if;

  if next_owner_user_id = current_user_id then
    raise exception 'you already own this workspace';
  end if;

  select workspace_members.member_role
  into next_owner_current_role
  from public.workspace_members
  where workspace_members.workspace_id = target_workspace_id
    and workspace_members.user_id = next_owner_user_id
  limit 1;

  if next_owner_current_role is null then
    raise exception 'member not found';
  end if;

  update public.workspace_members
  set member_role = case
    when workspace_members.user_id = next_owner_user_id then 'owner'
    when workspace_members.member_role = 'owner' then 'editor'
    else workspace_members.member_role
  end
  where workspace_members.workspace_id = target_workspace_id
    and (
      workspace_members.user_id = next_owner_user_id
      or workspace_members.member_role = 'owner'
    );

  perform set_config('papergraph.allow_owner_transfer', 'on', true);

  update public.workspaces
  set
    owner_id = next_owner_user_id,
    updated_at = now()
  where workspaces.id = target_workspace_id;
end;
$$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.workspace_invites to authenticated;
grant select, insert, update, delete on public.articles to authenticated;
grant select, insert, update, delete on public.article_collaboration_states to authenticated;
grant select, insert, update, delete on public.relations to authenticated;
grant select, insert, update, delete on public.article_positions to authenticated;
grant select, insert, update, delete on public.assets to authenticated;
grant select, insert, update, delete on public.ignored_unlinked_mentions to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;
grant execute on function public.can_edit_workspace(uuid) to authenticated;
grant execute on function public.ensure_user_workspace(text) to authenticated;
grant execute on function public.list_user_workspaces() to authenticated;
grant execute on function public.create_user_workspace(text) to authenticated;
grant execute on function public.rename_user_workspace(uuid, text) to authenticated;
grant execute on function public.delete_user_workspace(uuid) to authenticated;
grant execute on function public.list_workspace_members(uuid) to authenticated;
grant execute on function public.list_workspace_invites(uuid) to authenticated;
grant execute on function public.list_my_pending_workspace_invites() to authenticated;
grant execute on function public.create_workspace_invite(uuid, text, text) to authenticated;
grant execute on function public.accept_workspace_invite(uuid) to authenticated;
grant execute on function public.decline_workspace_invite(uuid) to authenticated;
grant execute on function public.revoke_workspace_invite(uuid) to authenticated;
grant execute on function public.update_workspace_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_workspace_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_workspace_owner(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
