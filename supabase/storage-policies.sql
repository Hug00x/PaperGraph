drop policy if exists "papergraph assets visible to owner" on storage.objects;
drop policy if exists "papergraph assets insertable by owner" on storage.objects;
drop policy if exists "papergraph assets updatable by owner" on storage.objects;
drop policy if exists "papergraph assets deletable by owner" on storage.objects;

create policy "papergraph assets visible to owner"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'papergraph-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "papergraph assets insertable by owner"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'papergraph-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "papergraph assets updatable by owner"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'papergraph-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'papergraph-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "papergraph assets deletable by owner"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'papergraph-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);
