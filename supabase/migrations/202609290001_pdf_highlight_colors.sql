begin;

alter table public.pdf_highlights add column color text not null default 'yellow'
  check (color in ('yellow', 'green', 'blue', 'pink', 'purple'));

-- Existing highlights remain yellow. Editors may change only the color.
revoke update on public.pdf_highlights from authenticated;
grant update (color) on public.pdf_highlights to authenticated;
create policy "Editors recolor PDF highlights" on public.pdf_highlights
  for update to authenticated using (public.can_edit_workspace(workspace_id))
  with check (public.can_edit_workspace(workspace_id));

commit;
