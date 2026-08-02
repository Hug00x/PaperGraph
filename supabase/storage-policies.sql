drop policy if exists "papergraph assets visible to owner" on storage.objects;
drop policy if exists "papergraph assets insertable by owner" on storage.objects;
drop policy if exists "papergraph assets updatable by owner" on storage.objects;
drop policy if exists "papergraph assets deletable by owner" on storage.objects;
drop policy if exists "papergraph assets visible to workspace members" on storage.objects;
drop policy if exists "papergraph assets insertable by workspace editors" on storage.objects;
drop policy if exists "papergraph assets updatable by workspace editors" on storage.objects;
drop policy if exists "papergraph assets deletable by workspace editors" on storage.objects;

create policy "papergraph assets visible to workspace members"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'papergraph-assets'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (
      (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
    )
  )
);

create policy "papergraph assets insertable by workspace editors"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'papergraph-assets'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (
      (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.can_edit_workspace(((storage.foldername(name))[1])::uuid)
    )
  )
);

create policy "papergraph assets updatable by workspace editors"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'papergraph-assets'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (
      (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.can_edit_workspace(((storage.foldername(name))[1])::uuid)
    )
  )
)
with check (
  bucket_id = 'papergraph-assets'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (
      (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.can_edit_workspace(((storage.foldername(name))[1])::uuid)
    )
  )
);

create policy "papergraph assets deletable by workspace editors"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'papergraph-assets'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (
      (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.can_edit_workspace(((storage.foldername(name))[1])::uuid)
    )
  )
);
