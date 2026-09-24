import type { SupabaseClient } from "@supabase/supabase-js";

type Session = { identity: string; revision: string; blocked: boolean; tail: Promise<unknown> };
const sessions = new WeakMap<SupabaseClient, Map<string, Session>>();

export function rememberWorkspaceRevision(client: SupabaseClient, workspaceId: string, revision: string) {
  let workspaces = sessions.get(client);
  if (!workspaces) { workspaces = new Map(); sessions.set(client, workspaces); }
  const identity = crypto.randomUUID();
  workspaces.set(workspaceId, { identity, revision, blocked: false, tail: Promise.resolve() });
  return identity;
}

// A failed/uncertain write freezes this baseline. Never silently fetch a new
// revision and retry an old snapshot: that would overwrite another device.
export function persistWorkspace(client: SupabaseClient, workspaceId: string, payload: unknown, articlesOnly = false, identity?: string | null) {
  const session = sessions.get(client)?.get(workspaceId);
  if (!session || (identity !== undefined && identity !== session.identity)) return Promise.reject(new Error("workspace-reload-required"));
  const write = session.tail.catch(() => undefined).then(async () => {
    if (session.blocked || sessions.get(client)?.get(workspaceId) !== session) throw new Error("workspace-reload-required");
    try {
      const { data, error } = await client.rpc("save_workspace_snapshot", {
        p_workspace_id: workspaceId, p_expected_revision: session.revision,
        p_snapshot: payload, p_articles_only: articlesOnly,
      });
      if (error) throw new Error(error.message);
      if (typeof data !== "string" || !/^\d+$/.test(data)) throw new Error("workspace-reload-required");
      session.revision = data;
    } catch (error) { session.blocked = true; throw error; }
  });
  session.tail = write;
  return write;
}
