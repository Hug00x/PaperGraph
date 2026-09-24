-- Apply after bootstrap-workspace.sql and 202609230001_semantic_search.sql.
-- Deploy together with the new client: old snapshot writers fail closed.
begin;

alter table public.workspaces add column if not exists snapshot_revision bigint not null default 0;

-- One SQL statement, hence one MVCC snapshot for the revision and all six tables.
create or replace function public.load_workspace_snapshot(p_workspace_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'revision', w.snapshot_revision::text,
    'articles', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'author', a.author, 'status', a.status,
      'source', a.source, 'abstract', a.abstract, 'tags', a.tags, 'updated_at', a.updated_at)
      order by a.created_at, a.id) from public.articles a where a.workspace_id = w.id), '[]'::jsonb),
    'article_versions', coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc, v.id)
      from public.article_versions v where v.workspace_id = w.id), '[]'::jsonb),
    'relations', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at, r.id)
      from public.relations r where r.workspace_id = w.id), '[]'::jsonb),
    'article_positions', coalesce((select jsonb_agg(to_jsonb(p))
      from public.article_positions p where p.workspace_id = w.id), '[]'::jsonb),
    'assets', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc, a.id)
      from public.assets a where a.workspace_id = w.id), '[]'::jsonb),
    'ignored_unlinked_mentions', coalesce((select jsonb_agg(to_jsonb(m))
      from public.ignored_unlinked_mentions m where m.workspace_id = w.id), '[]'::jsonb)
  ) from public.workspaces w where w.id = p_workspace_id
    and auth.uid() is not null and public.is_workspace_member(w.id);
$$;

create or replace function public.save_workspace_snapshot(
  p_workspace_id uuid, p_expected_revision bigint, p_snapshot jsonb,
  p_articles_only boolean default false
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_revision bigint;
  item jsonb;
  existing jsonb;
  article public.articles%rowtype;
  table_name text;
begin
  if auth.uid() is null or not public.can_edit_workspace(p_workspace_id) then
    raise exception 'workspace-write-forbidden' using errcode = '42501';
  end if;
  -- All supported content writers take this lock before reading the revision.
  select snapshot_revision into current_revision from public.workspaces
    where id = p_workspace_id for update;
  if not found then raise exception 'workspace-not-found'; end if;
  if p_expected_revision is null or current_revision <> p_expected_revision then
    -- Business conflict, not a transient serialization failure: PostgREST may
    -- automatically retry 40001 indefinitely. PT409 returns HTTP 409 immediately.
    raise exception 'workspace-save-conflict' using errcode = 'PT409';
  end if;
  if p_articles_only is null or jsonb_typeof(p_snapshot) is distinct from 'object'
    or jsonb_typeof(p_snapshot->'articles') is distinct from 'array' then
    raise exception 'invalid-workspace-snapshot' using errcode = '22023';
  end if;
  if not p_articles_only then
    foreach table_name in array array['article_versions', 'relations', 'article_positions', 'assets', 'ignored_unlinked_mentions'] loop
      if jsonb_typeof(p_snapshot->table_name) is distinct from 'array' then
        raise exception 'invalid-workspace-snapshot: %', table_name using errcode = '22023';
      end if;
    end loop;
  end if;
  if exists (select 1 from jsonb_array_elements(p_snapshot->'articles') a
      where jsonb_typeof(a) <> 'object' or nullif(a->>'id', '') is null)
    or (select count(*) <> count(distinct a->>'id') from jsonb_array_elements(p_snapshot->'articles') a) then
    raise exception 'invalid-workspace-articles' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_snapshot->'articles') loop
    select to_jsonb(a) into existing from public.articles a
      where a.workspace_id = p_workspace_id and a.id::text = item->>'id';
    -- Populate the actual row type: compatible with both legacy UUID IDs and text IDs.
    -- Existing scientific fields survive normal saves; embeddings are never supplied by the client.
    select * into article from jsonb_populate_record(null::public.articles,
      jsonb_build_object('author', 'PaperGraph', 'status', 'Draft', 'source_type', 'latex',
        'tags', '[]'::jsonb, 'authors', '[]'::jsonb, 'topics', '[]'::jsonb,
        'referenced_work_ids', '[]'::jsonb, 'created_at', now(), 'updated_at', now())
      || coalesce(existing, '{}'::jsonb) || item || jsonb_build_object('workspace_id', p_workspace_id));
    insert into public.articles (id, workspace_id, title, author, status, source_type, source,
      tags, abstract, openalex_id, openalex_title, doi, authors, publication_year,
      cited_by_count, topics, referenced_work_ids)
    values (article.id, p_workspace_id, article.title, article.author, article.status,
      article.source_type, article.source, article.tags, article.abstract,
      article.openalex_id, article.openalex_title, article.doi, article.authors,
      article.publication_year, article.cited_by_count, article.topics, article.referenced_work_ids)
    on conflict (workspace_id, id) do update set
      title = excluded.title, author = excluded.author, status = excluded.status,
      source_type = excluded.source_type, source = excluded.source, tags = excluded.tags,
      abstract = excluded.abstract, openalex_id = excluded.openalex_id,
      openalex_title = excluded.openalex_title, doi = excluded.doi, authors = excluded.authors,
      publication_year = excluded.publication_year, cited_by_count = excluded.cited_by_count,
      topics = excluded.topics, referenced_work_ids = excluded.referenced_work_ids, updated_at = now();
  end loop;

  if not p_articles_only then
    -- Every delete and insert is in this same transaction. Any failure rolls it all back.
    foreach table_name in array array['ignored_unlinked_mentions', 'relations', 'article_positions', 'assets', 'article_versions'] loop
      execute format('delete from public.%I where workspace_id = $1', table_name) using p_workspace_id;
      for item in select value from jsonb_array_elements(p_snapshot->table_name) loop
        if table_name = 'relations' then
          item := item || jsonb_build_object('id', gen_random_uuid());
        end if;
        item := jsonb_build_object('created_at', now(), 'updated_at', now()) || item
          || jsonb_build_object('workspace_id', p_workspace_id);
        execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', table_name, table_name) using item;
      end loop;
    end loop;
    delete from public.article_collaboration_states c where c.workspace_id = p_workspace_id
      and not exists (select 1 from jsonb_array_elements(p_snapshot->'articles') a where a->>'id' = c.article_id::text);
    delete from public.articles a where a.workspace_id = p_workspace_id
      and not exists (select 1 from jsonb_array_elements(p_snapshot->'articles') j where j->>'id' = a.id::text);
    update public.workspaces set language = p_snapshot->>'language' where id = p_workspace_id;
  end if;
  update public.workspaces set snapshot_revision = current_revision + 1, updated_at = now()
    where id = p_workspace_id;
  return (current_revision + 1)::text;
end;
$$;

revoke all on function public.load_workspace_snapshot(uuid) from public, anon;
revoke all on function public.save_workspace_snapshot(uuid, bigint, jsonb, boolean) from public, anon;
grant execute on function public.load_workspace_snapshot(uuid) to authenticated;
grant execute on function public.save_workspace_snapshot(uuid, bigint, jsonb, boolean) to authenticated;

-- Old clients must not bypass the revision check. Server-side metadata enrichment
-- remains permitted through RLS; it cannot insert/delete articles or change their source.
revoke insert, update, delete on public.articles, public.article_versions, public.relations,
  public.article_positions, public.assets, public.ignored_unlinked_mentions from authenticated, anon, public;
grant update (abstract, openalex_id, openalex_title, doi, authors, publication_year, cited_by_count,
  topics, referenced_work_ids, academic_input_hash, embedding, embedding_model, embedding_input_hash)
  on public.articles to authenticated;
revoke insert, update on public.workspaces from authenticated, anon, public;
grant update (name, language, updated_at) on public.workspaces to authenticated;
commit;
