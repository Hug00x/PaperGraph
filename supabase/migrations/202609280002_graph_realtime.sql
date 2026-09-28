-- Private map channels: members may receive/announce presence; only editors
-- may broadcast previews. Durable state always comes from load_workspace_snapshot.
-- See https://supabase.com/docs/guides/realtime/authorization
begin;
drop policy if exists papergraph_map_receive on realtime.messages;
create policy papergraph_map_receive on realtime.messages for select to authenticated
using (
  extension in ('broadcast', 'presence') and exists (
    select 1 from public.workspaces w
    where realtime.topic() = 'papergraph:workspace:' || w.id::text || ':map'
      and public.is_workspace_member(w.id)
  )
);
drop policy if exists papergraph_map_send on realtime.messages;
create policy papergraph_map_send on realtime.messages for insert to authenticated
with check (
  exists (
    select 1 from public.workspaces w
    where realtime.topic() = 'papergraph:workspace:' || w.id::text || ':map'
      and public.is_workspace_member(w.id)
      and (extension = 'presence' or (extension = 'broadcast' and public.can_edit_workspace(w.id)))
  )
);
commit;
