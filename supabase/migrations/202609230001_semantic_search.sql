-- Run after bootstrap-workspace.sql. Existing article content and RLS are preserved.
begin;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema extensions to authenticated, service_role;
-- The administrative CLI backfill reads metadata and updates stored vectors.
grant select, update on public.articles to service_role;
set local search_path = public, extensions;

-- Older deployed schemas use a UUID primary key on id alone; newer ones
-- use text IDs with a composite primary key. Support both without changing IDs.
create unique index if not exists articles_workspace_id_id_semantic_idx
  on public.articles (workspace_id, id);

alter table public.articles
  add column if not exists abstract text,
  add column if not exists openalex_id text,
  add column if not exists openalex_title text,
  add column if not exists doi text,
  add column if not exists authors jsonb not null default '[]',
  add column if not exists publication_year integer,
  add column if not exists cited_by_count integer,
  add column if not exists topics jsonb not null default '[]',
  add column if not exists referenced_work_ids text[] not null default '{}',
  add column if not exists academic_input_hash text,
  add column if not exists embedding vector(1024),
  add column if not exists embedding_model text,
  add column if not exists embedding_input_hash text;

update public.articles set authors = '[]'::jsonb where authors is null;
alter table public.articles alter column authors set default '[]'::jsonb;
alter table public.articles alter column authors set not null;
update public.articles set topics = '[]'::jsonb where topics is null;
alter table public.articles alter column topics set default '[]'::jsonb;
alter table public.articles alter column topics set not null;
update public.articles set referenced_work_ids = '{}'::text[] where referenced_work_ids is null;
alter table public.articles alter column referenced_work_ids set default '{}'::text[];
alter table public.articles alter column referenced_work_ids set not null;

alter table public.articles drop constraint if exists articles_embedding_state_check;
alter table public.articles add constraint articles_embedding_state_check check (
  (embedding is null and embedding_model is null and embedding_input_hash is null) or
  (embedding is not null and embedding_model is not null and embedding_input_hash is not null)
);

create index if not exists articles_embedding_hnsw_idx
  on public.articles using hnsw (embedding vector_cosine_ops);

-- Invalidate vectors even for edits made outside the application.
create or replace function public.invalidate_article_embedding()
returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if new.title is distinct from old.title or new.abstract is distinct from old.abstract then
    new.embedding := null;
    new.embedding_model := null;
    new.embedding_input_hash := null;
  end if;
  if new.title is distinct from old.title or new.source is distinct from old.source
     or new.tags is distinct from old.tags then
    new.academic_input_hash := null;
  end if;
  return new;
end;
$$;
drop trigger if exists articles_invalidate_embedding on public.articles;
create trigger articles_invalidate_embedding before update on public.articles
  for each row execute function public.invalidate_article_embedding();

-- Security invoker deliberately preserves the caller's workspace RLS policies.
-- No vectors are returned to Node or the browser.
create or replace function public.get_similar_papers(
  p_workspace_id uuid, p_article_id text, p_limit integer default 3,
  p_model text default 'bge-m3'
) returns table (paper jsonb, similarity double precision)
language plpgsql stable security invoker
set search_path = public, extensions
as $$
declare
  query_embedding vector(1024);
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Similarity limit must be between 1 and 100';
  end if;
  select a.embedding into query_embedding from public.articles a
  where a.workspace_id = p_workspace_id and a.id::text = p_article_id
    and a.embedding_model = p_model
    and a.embedding_input_hash = md5(a.title || E'\n\n' || coalesce(a.abstract, ''));
  if query_embedding is null then return; end if;
  return query
    select jsonb_build_object('id', a.id, 'title', a.title, 'abstract', a.abstract,
                             'doi', a.doi, 'openalex_id', a.openalex_id),
           1 - (a.embedding <=> query_embedding)
    from public.articles a
    where a.workspace_id = p_workspace_id and a.id::text <> p_article_id
      and a.status in ('Review', 'Published')
      and a.embedding is not null and a.embedding_model = p_model
      and a.embedding_input_hash = md5(a.title || E'\n\n' || coalesce(a.abstract, ''))
    order by a.embedding <=> query_embedding
    limit p_limit;
end;
$$;
revoke all on function public.get_similar_papers(uuid, text, integer, text) from public, anon;
grant execute on function public.get_similar_papers(uuid, text, integer, text) to authenticated, service_role;
notify pgrst, 'reload schema';
commit;
