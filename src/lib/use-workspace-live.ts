"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppLanguage } from "./portuguese-labels";
import type { WorkspaceSnapshot } from "./workspace-data";
import { refreshWorkspaceSnapshotFromSupabase } from "./supabase-workspace";
import { observeWorkspaceSaves } from "./workspace-persistence";
import { GRAPH_PEER_TTL, parseGraphLiveMessage, type GraphActivity, type GraphLiveMessage, type GraphPeer } from "./graph-live";

type Options = {
  client: SupabaseClient | null; workspaceId: string | null; clientId: string;
  userName: string; language: AppLanguage; canEdit: boolean;
  read: () => WorkspaceSnapshot | null; apply: (snapshot: WorkspaceSnapshot) => void;
};

export function useWorkspaceLive(options: Options) {
  const latest = useRef(options);
  useEffect(() => { latest.current = options; }, [options]);
  const [peerState, setPeers] = useState<{ workspaceId: string; peers: GraphPeer[] } | null>(null);
  const [connection, setConnected] = useState<{ workspaceId: string; connected: boolean } | null>(null);
  const activity = useRef<GraphActivity | null>(null);
  const sequence = useRef(0);
  const send = useRef<(phase: GraphLiveMessage["phase"]) => void>(() => undefined);
  const requestRefresh = useRef<() => void>(() => undefined);
  const updateActivity = useCallback((next: GraphActivity | null, committed = false) => {
    if (next) { activity.current = next; send.current("active"); }
    else {
      send.current(committed ? "commit" : "cancel");
      activity.current = null;
      requestRefresh.current();
    }
  }, []);

  const { client, workspaceId, clientId } = options;
  useEffect(() => {
    if (!client || !workspaceId) return;
    let disposed = false, ready = false, running = false, pending = false;
    let lastSent = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let previewTimer: ReturnType<typeof setTimeout> | undefined;
    const remote = new Map<string, GraphPeer>();
    const seen = new Map<string, number>();
    const publish = () => { if (!disposed) setPeers({ workspaceId, peers: [...remote.values()] }); };
    const channel = client.channel(`papergraph:workspace:${workspaceId}:map`, {
      config: { private: true, broadcast: { self: false }, presence: { key: clientId } },
    });
    const refresh = async () => {
      if (disposed || running || activity.current) { pending = true; return; }
      running = true; pending = false;
      try {
        let displayed: WorkspaceSnapshot | undefined;
        const refreshed = await refreshWorkspaceSnapshotFromSupabase(client, { id: workspaceId, language: latest.current.language },
          () => disposed || activity.current ? null : latest.current.read(),
          (snapshot) => { if (!disposed) { displayed = snapshot; latest.current.apply(snapshot); } });
        if (refreshed && displayed) {
          for (const [id, peer] of remote) {
            if (peer.phase !== "commit" || !peer.activity) continue;
            const positionsMatch = Object.entries(peer.activity.positions ?? {}).every(([articleId, position]) =>
              displayed?.articlePositions[articleId]?.x === position.x && displayed?.articlePositions[articleId]?.y === position.y);
            const zone = peer.activity.zone;
            const savedZone = zone && displayed.zones.find((item) => item.id === zone.id);
            const zoneMatches = !zone || (savedZone && (["x", "y", "width", "height"] as const).every((key) =>
              savedZone[key] === zone[key]));
            if (positionsMatch && zoneMatches) remote.delete(id);
          }
          publish();
        }
      } catch {
        // Keep local drafts and retry on reconnect/poll. Persistence handles
        // actual save conflicts through the existing recovery UI.
      } finally {
        running = false;
        if (pending && !disposed && !activity.current) schedule();
      }
    };
    function schedule() {
      if (disposed) return;
      if (running) { pending = true; return; }
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { refreshTimer = undefined; void refresh(); }, 80);
    }
    requestRefresh.current = schedule;
    const transmit = (phase: GraphLiveMessage["phase"]) => {
      if (!ready || !latest.current.canEdit) return;
      const message: GraphLiveMessage = { clientId, userName: latest.current.userName.slice(0, 200), sequence: ++sequence.current, phase, activity: activity.current };
      if (phase !== "cancel" && !message.activity) return;
      lastSent = Date.now();
      void channel.send({ type: "broadcast", event: "graph-activity", payload: message });
    };
    send.current = (phase) => {
      if (previewTimer) { clearTimeout(previewTimer); previewTimer = undefined; }
      const wait = 50 - (Date.now() - lastSent);
      if (phase === "active" && wait > 0) previewTimer = setTimeout(() => { previewTimer = undefined; transmit("active"); }, wait);
      else transmit(phase);
    };
    channel.on("broadcast", { event: "graph-activity" }, ({ payload }) => {
      const message = parseGraphLiveMessage(payload);
      if (!message || message.clientId === clientId || message.sequence <= (seen.get(message.clientId) ?? -1)) return;
      seen.set(message.clientId, message.sequence);
      if (message.phase === "cancel") remote.delete(message.clientId);
      else remote.set(message.clientId, { ...message, receivedAt: Date.now() });
      publish();
    }).on("broadcast", { event: "workspace-saved" }, schedule).on("presence", { event: "sync" }, () => {
      const online = new Set(Object.keys(channel.presenceState()));
      for (const id of remote.keys()) if (!online.has(id)) remote.delete(id);
      publish();
    }).subscribe((status) => {
      if (disposed) return;
      ready = status === "SUBSCRIBED"; setConnected({ workspaceId, connected: ready });
      if (ready) {
        void channel.track({ clientId });
        if (activity.current) transmit("active");
        schedule();
      } else { remote.clear(); publish(); }
    });
    const stopObserving = observeWorkspaceSaves(client, workspaceId, () => {
      if (ready) void channel.send({ type: "broadcast", event: "workspace-saved", payload: { clientId } });
      schedule();
    });
    const poll = setInterval(schedule, 5000);
    const heartbeat = setInterval(() => {
      if (activity.current) transmit("active");
      for (const [id, peer] of remote) if (Date.now() - peer.receivedAt > GRAPH_PEER_TTL) remote.delete(id);
      publish();
    }, 2000);
    window.addEventListener("online", schedule);
    window.addEventListener("focus", schedule);
    schedule();
    return () => {
      disposed = true; activity.current = null; send.current = () => undefined; requestRefresh.current = () => undefined;
      clearTimeout(refreshTimer); clearTimeout(previewTimer); clearInterval(poll); clearInterval(heartbeat);
      window.removeEventListener("online", schedule); window.removeEventListener("focus", schedule);
      stopObserving(); void client.removeChannel(channel);
    };
  }, [client, workspaceId, clientId]);

  return { peers: peerState?.workspaceId === workspaceId ? peerState.peers : [], connected: connection?.workspaceId === workspaceId && connection.connected, updateActivity };
}
