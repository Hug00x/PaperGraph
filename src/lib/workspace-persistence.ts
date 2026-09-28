import type { SupabaseClient } from "@supabase/supabase-js";
import { advanceLocalBaseline, mergeWorkspace, type CloudSnapshot } from "./workspace-merge.ts";

type Session = { identity: string; revision: string; blocked: boolean; writes: number; tail: Promise<unknown>; local?: CloudSnapshot; remote?: CloudSnapshot };
const sessions = new WeakMap<SupabaseClient, Map<string, Session>>();
const observers = new WeakMap<SupabaseClient, Map<string, Set<() => void>>>();

export function observeWorkspaceSaves(client: SupabaseClient, workspaceId: string, listener: () => void) {
  let workspaces = observers.get(client);
  if (!workspaces) { workspaces = new Map(); observers.set(client, workspaces); }
  let listeners = workspaces.get(workspaceId);
  if (!listeners) { listeners = new Set(); workspaces.set(workspaceId, listeners); }
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// A live refresh shares the write queue. The caller must still be displaying the
// exact local snapshot read before the request; otherwise retry on the next tick.
export function refreshWorkspace(client: SupabaseClient, workspaceId: string,
  read: () => { identity: string | null | undefined; payload: CloudSnapshot; isCurrent: () => boolean } | null,
  apply: (snapshot: CloudSnapshot) => void) {
  const session = sessions.get(client)?.get(workspaceId);
  if (!session || session.blocked) return Promise.resolve(false);
  const refresh = session.tail.catch(() => undefined).then(async () => {
    if (session.blocked || !session.local || sessions.get(client)?.get(workspaceId) !== session) return false;
    const current = read();
    if (!current || current.identity !== session.identity) return false;
    const writes = session.writes;
    const { data, error } = await client.rpc("load_workspace_snapshot", { p_workspace_id: workspaceId });
    if (error) throw new Error(error.message);
    if (!data || typeof data.revision !== "string" || !/^\d+$/.test(data.revision)) throw new Error("workspace-reload-required");
    if (session.writes !== writes || !current.isCurrent() || sessions.get(client)?.get(workspaceId) !== session) return false;
    const merged = mergeWorkspace(session.local, current.payload, data);
    // Keep the server baseline, so unsaved local edits still remain edits.
    session.local = structuredClone(data);
    session.remote = structuredClone(data);
    session.revision = data.revision;
    apply(merged);
    return true;
  });
  session.tail = refresh;
  return refresh;
}

export function rememberWorkspaceRevision(client: SupabaseClient, workspaceId: string, revision: string, snapshot?: CloudSnapshot) {
  let workspaces = sessions.get(client);
  if (!workspaces) { workspaces = new Map(); sessions.set(client, workspaces); }
  const identity = crypto.randomUUID();
  workspaces.set(workspaceId, { identity, revision, blocked: false, writes: 0, tail: Promise.resolve(), local: snapshot && structuredClone(snapshot), remote: snapshot && structuredClone(snapshot) });
  return identity;
}

// Only a definite revision conflict can be retried, after a three-way merge.
// An uncertain network outcome still freezes writes to prevent duplicate work.
export function persistWorkspace(client: SupabaseClient, workspaceId: string, payload: unknown, articlesOnly = false, identity?: string | null) {
  const session = sessions.get(client)?.get(workspaceId);
  if (!session || (identity !== undefined && identity !== session.identity)) return Promise.reject(new Error("workspace-reload-required"));
  session.writes++;
  const write = session.tail.catch(() => undefined).then(async () => {
    if (session.blocked || sessions.get(client)?.get(workspaceId) !== session) throw new Error("workspace-reload-required");
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (sessions.get(client)?.get(workspaceId) !== session) throw new Error("workspace-reload-required");
        const merged = session.local && session.remote
          ? mergeWorkspace(session.local, payload as CloudSnapshot, session.remote, articlesOnly)
          : payload;
        const { data, error } = await client.rpc("save_workspace_snapshot", {
          p_workspace_id: workspaceId, p_expected_revision: session.revision,
          p_snapshot: merged, p_articles_only: articlesOnly,
        });
        if (error) {
          if (error.message === "workspace-save-conflict" && session.local && attempt < 3) {
            const latest = await client.rpc("load_workspace_snapshot", { p_workspace_id: workspaceId });
            if (latest.error) throw new Error(latest.error.message);
            if (!latest.data || typeof latest.data.revision !== "string" || !/^\d+$/.test(latest.data.revision)) throw new Error("workspace-reload-required");
            session.remote = latest.data;
            session.revision = latest.data.revision;
            continue;
          }
          if (error.message === "workspace-save-conflict" && session.local) throw new Error("workspace-reload-required");
          throw new Error(error.message);
        }
        if (typeof data !== "string" || !/^\d+$/.test(data)) throw new Error("workspace-reload-required");
        session.revision = data;
        if (session.local) {
          session.local = advanceLocalBaseline(session.local, payload as CloudSnapshot, articlesOnly);
          session.remote = structuredClone(merged as CloudSnapshot);
        }
        for (const listener of observers.get(client)?.get(workspaceId) ?? []) {
          try { listener(); } catch { /* A UI notification cannot invalidate a committed write. */ }
        }
        return;
      }
    } catch (error) { session.blocked = true; throw error; }
  });
  session.tail = write;
  return write;
}
