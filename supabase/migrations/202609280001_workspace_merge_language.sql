-- Expose language in the same consistent snapshot used for collaborative merges.
begin;
create or replace function public.load_workspace_snapshot(p_workspace_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'revision', w.snapshot_revision::text,
    'language', w.language,
    'zones', w.zones,
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

commit;
