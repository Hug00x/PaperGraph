begin;

create function public.valid_pdf_highlight_rects(rects jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare r jsonb;
begin
  if jsonb_typeof(rects) <> 'array' then return false; end if;
  if jsonb_array_length(rects) not between 1 and 500 then return false; end if;
  for r in select value from jsonb_array_elements(rects) loop
    if jsonb_typeof(r->'x') is distinct from 'number' or jsonb_typeof(r->'y') is distinct from 'number'
      or jsonb_typeof(r->'width') is distinct from 'number' or jsonb_typeof(r->'height') is distinct from 'number'
      then return false; end if;
    if (r->>'x')::numeric < 0 or (r->>'y')::numeric < 0
      or (r->>'width')::numeric <= 0 or (r->>'height')::numeric <= 0
      or (r->>'x')::numeric + (r->>'width')::numeric > 1.000001
      or (r->>'y')::numeric + (r->>'height')::numeric > 1.000001 then return false; end if;
  end loop;
  return true;
end;
$$;

create table public.pdf_highlights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  article_id text not null,
  document_key text not null check (document_key ~ '^[a-f0-9]{64}$'),
  page_number integer not null check (page_number > 0),
  selected_text text not null check (char_length(selected_text) between 1 and 20000),
  rects jsonb not null check (public.valid_pdf_highlight_rects(rects)),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Older deployments use uuid article IDs; match the existing primary key type.
do $$
declare article_id_type text;
begin
  select format_type(atttypid, atttypmod) into article_id_type from pg_attribute
    where attrelid = 'public.articles'::regclass and attname = 'id';
  execute format('alter table public.pdf_highlights alter column article_id type %s using article_id::%s', article_id_type, article_id_type);
  alter table public.pdf_highlights add foreign key (workspace_id, article_id)
    references public.articles(workspace_id, id) on delete cascade;
end;
$$;

create index pdf_highlights_document on public.pdf_highlights(workspace_id, article_id, document_key);
alter table public.pdf_highlights enable row level security;
grant select, insert, delete on public.pdf_highlights to authenticated;

create policy "Members read PDF highlights" on public.pdf_highlights
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "Editors create PDF highlights" on public.pdf_highlights
  for insert to authenticated with check (public.can_edit_workspace(workspace_id) and created_by = auth.uid());
create policy "Editors delete PDF highlights" on public.pdf_highlights
  for delete to authenticated using (public.can_edit_workspace(workspace_id));

commit;
