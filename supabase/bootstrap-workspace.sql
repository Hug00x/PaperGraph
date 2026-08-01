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
alter table public.articles enable row level security;
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

drop policy if exists "profiles visible to owner" on public.profiles;
drop policy if exists "profiles insertable by owner" on public.profiles;
drop policy if exists "profiles editable by owner" on public.profiles;
drop policy if exists "workspaces visible to members" on public.workspaces;
drop policy if exists "workspaces insertable by owner" on public.workspaces;
drop policy if exists "workspaces editable by members" on public.workspaces;
drop policy if exists "workspace members visible to members" on public.workspace_members;
drop policy if exists "workspace members insertable by self" on public.workspace_members;
drop policy if exists "articles visible to members" on public.articles;
drop policy if exists "articles insertable by members" on public.articles;
drop policy if exists "articles editable by members" on public.articles;
drop policy if exists "articles deletable by members" on public.articles;
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
using (public.is_workspace_member(id))
with check (public.is_workspace_member(id));

create policy "workspace members visible to members"
on public.workspace_members for select
to authenticated
using (public.is_workspace_member(workspace_id) or user_id = auth.uid());

create policy "workspace members insertable by self"
on public.workspace_members for insert
to authenticated
with check (user_id = auth.uid());

create policy "articles visible to members"
on public.articles for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "articles insertable by members"
on public.articles for insert
to authenticated
with check (public.is_workspace_member(workspace_id));

create policy "articles editable by members"
on public.articles for update
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "articles deletable by members"
on public.articles for delete
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "relations visible to members"
on public.relations for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "relations insertable by members"
on public.relations for insert
to authenticated
with check (public.is_workspace_member(workspace_id));

create policy "relations editable by members"
on public.relations for update
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "relations deletable by members"
on public.relations for delete
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "positions visible to members"
on public.article_positions for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "positions insertable by members"
on public.article_positions for insert
to authenticated
with check (public.is_workspace_member(workspace_id));

create policy "positions editable by members"
on public.article_positions for update
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "positions deletable by members"
on public.article_positions for delete
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "assets visible to members"
on public.assets for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "assets insertable by members"
on public.assets for insert
to authenticated
with check (public.is_workspace_member(workspace_id));

create policy "assets editable by members"
on public.assets for update
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "assets deletable by members"
on public.assets for delete
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "ignored mentions visible to members"
on public.ignored_unlinked_mentions for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "ignored mentions insertable by members"
on public.ignored_unlinked_mentions for insert
to authenticated
with check (public.is_workspace_member(workspace_id));

create policy "ignored mentions editable by members"
on public.ignored_unlinked_mentions for update
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "ignored mentions deletable by members"
on public.ignored_unlinked_mentions for delete
to authenticated
using (public.is_workspace_member(workspace_id));

drop function if exists public.ensure_user_workspace(text);

create function public.ensure_user_workspace(requested_workspace_name text default 'PaperGraph')
returns table (
  workspace_id uuid,
  workspace_name text,
  workspace_language text,
  member_role text
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
    nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), '')
  )
  on conflict (id) do nothing;

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
    workspace_members.member_role
  from public.workspaces
  join public.workspace_members
    on workspace_members.workspace_id = workspaces.id
  where workspaces.id = current_workspace_id
    and workspace_members.user_id = current_user_id
  limit 1;
end;
$$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.articles to authenticated;
grant select, insert, update, delete on public.relations to authenticated;
grant select, insert, update, delete on public.article_positions to authenticated;
grant select, insert, update, delete on public.assets to authenticated;
grant select, insert, update, delete on public.ignored_unlinked_mentions to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.ensure_user_workspace(text) to authenticated;

notify pgrst, 'reload schema';
