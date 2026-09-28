"use client";
// Browser-only test transport. Production hooks, adapter, merge and GraphPane run
// unchanged; BroadcastChannel/localStorage stand in for the remote service.
import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GraphPane } from "@/components/graph-pane";
import { useWorkspaceLive } from "@/lib/use-workspace-live";
import { defaultSnapshot, type WorkspaceSnapshot } from "@/lib/workspace-data";
import { loadWorkspaceSnapshotFromSupabase, saveWorkspaceSnapshotToSupabase } from "@/lib/supabase-workspace";

const workspaceId = "live-browser-workspace";
const initial = { revision: "0", language: "en", zones: [], relations: [], assets: [], article_versions: [], ignored_unlinked_mentions: [],
  articles: ["A", "B", "C"].map(id => ({ id, title: `Paper ${id}`, author: "Test", status: "Published", tags: [], source: "", abstract: "" })),
  article_positions: [{ article_id: "A", x: 46, y: 48 }, { article_id: "B", x: 52, y: 48 }, { article_id: "C", x: 62, y: 60 }],
};
type Handler = (event: { payload: Record<string, unknown> }) => void;
function transport() {
  let offline = false;
  const channels = new Set<{ notify: (status: string) => void; close: () => void }>();
  return {
    setOffline(value: boolean) { offline = value; for (const channel of channels) channel.notify(value ? "CHANNEL_ERROR" : "SUBSCRIBED"); },
    async rpc(name: string, args: Record<string, unknown>) {
      if (offline) throw new Error("Offline fixture");
      const data = JSON.parse(localStorage.getItem("graph-live-fixture") ?? JSON.stringify(initial));
      if (name === "load_workspace_snapshot") return { data, error: null };
      if (data.revision !== args.p_expected_revision) return { data: null, error: { message: "workspace-save-conflict" } };
      const revision = String(Number(data.revision) + 1);
      localStorage.setItem("graph-live-fixture", JSON.stringify({ ...(args.p_snapshot as object), revision }));
      return { data: revision, error: null };
    },
    channel(topic: string) {
      const handlers = new Map<string, Handler>();
      const wire = new BroadcastChannel(topic);
      let status: (value: string) => void = () => undefined;
      wire.onmessage = event => { if (!offline) handlers.get(event.data.event)?.({ payload: event.data.payload }); };
      const channel = {
        on(_type: string, filter: { event: string }, handler: Handler) { handlers.set(filter.event, handler); return channel; },
        subscribe(callback: (value: string) => void) { status = callback; queueMicrotask(() => status(offline ? "CHANNEL_ERROR" : "SUBSCRIBED")); return channel; },
        async send(message: unknown) { if (!offline) wire.postMessage(message); return "ok"; },
        async track() {}, presenceState() { return {}; },
        notify(value: string) { status(value); }, close() { wire.close(); channels.delete(channel); },
      };
      channels.add(channel); return channel;
    },
    async removeChannel(channel: { close: () => void }) { channel.close(); },
  };
}
export default function Fixture() {
  const backend = useMemo(transport, []);
  const client = backend as unknown as SupabaseClient;
  const [name] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(location.search).get("name") ?? "Alice");
  const [clientId] = useState(() => crypto.randomUUID());
  const [snapshot, setSnapshot] = useState(defaultSnapshot);
  const current = useRef(snapshot);
  const pending = useRef(0);
  const [error, setError] = useState("");
  const [selected, select] = useState<string | null>(null);
  const apply = (next: WorkspaceSnapshot) => { current.current = next; setSnapshot(next); };
  useEffect(() => { void loadWorkspaceSnapshotFromSupabase(client, workspaceId).then(apply); }, [client]);
  const live = useWorkspaceLive({ client, workspaceId, clientId, userName: name, language: "en", canEdit: name !== "Viewer",
    read: () => pending.current ? null : current.current, apply });
  const commit = async (next: WorkspaceSnapshot) => {
    next = { ...next, persistenceSession: current.current.persistenceSession };
    pending.current++; apply(next);
    try { await saveWorkspaceSnapshotToSupabase(client, { id: workspaceId, language: "en" }, next); }
    catch (failure) { setError(String(failure)); }
    finally { pending.current--; }
  };
  return <main className="papergraph-app flex h-screen w-screen">
    <output id="fixture-live" hidden>{JSON.stringify({ name, peers: live.peers, connected: live.connected })}</output>
    <output id="fixture-state" hidden>{JSON.stringify(snapshot)}</output><output id="fixture-error" hidden>{error}</output>
    <button id="offline" hidden onClick={() => backend.setOffline(true)}>Offline</button>
    <button id="online" hidden onClick={() => backend.setOffline(false)}>Online</button>
    {snapshot.persistenceSession && <GraphPane workspaceId={workspaceId} accessToken="" articles={snapshot.articles} activeArticle={snapshot.articles.find(a => a.id === selected) ?? null}
      language="en" relations={snapshot.relations} unlinkedMentions={[]} zones={snapshot.zones} articlePositions={snapshot.articlePositions}
      graphPeers={live.peers} onGraphActivity={live.updateActivity}
      onZonesChange={(zones, articlePositions) => { void commit({ ...current.current, zones, articlePositions }); }}
      onArticlePositionsChange={(articlePositions) => { void commit({ ...current.current, articlePositions }); }}
      onSelectArticle={select} canEdit={name !== "Viewer"} onAddRecommendation={async () => {}}
      onCreateRelation={() => {}} onRemoveRelation={() => {}} onCreateWikilinkFromMention={() => {}} onIgnoreUnlinkedMention={() => {}}
      onEditArticle={() => {}} onViewArticle={() => {}} onExportArticlePdf={() => {}} onDeleteArticle={() => {}}
      onImportPdfArticle={async () => { throw new Error("unused"); }} />}
  </main>;
}
