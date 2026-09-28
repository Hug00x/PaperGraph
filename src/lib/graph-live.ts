import type { ArticlePosition } from "./workspace-data.ts";
import { isValidZoneBounds, ZONE_COLORS, type GraphZone } from "./graph-zones.ts";

export type GraphActivity = {
  target: { kind: "article" | "zone"; id: string };
  action: "move" | "resize" | "edit";
  positions?: Record<string, ArticlePosition>;
  zone?: GraphZone;
};
export type GraphLiveMessage = {
  clientId: string; userName: string; sequence: number;
  phase: "active" | "commit" | "cancel";
  activity: GraphActivity | null;
};
export type GraphPeer = GraphLiveMessage & { receivedAt: number };
export const GRAPH_PEER_TTL = 10000;

export function parseGraphLiveMessage(input: unknown): GraphLiveMessage | null {
  if (!input || typeof input !== "object") return null;
  const m = input as GraphLiveMessage;
  if (typeof m.clientId !== "string" || m.clientId.length > 100 || !m.clientId ||
      typeof m.userName !== "string" || m.userName.length > 200 ||
      !Number.isSafeInteger(m.sequence) || m.sequence < 0 || !["active", "commit", "cancel"].includes(m.phase)) return null;
  if (m.phase === "cancel" && m.activity === null) return m;
  const a = m.activity;
  if (!a || !a.target || !["article", "zone"].includes(a.target.kind) ||
      typeof a.target.id !== "string" || !a.target.id || a.target.id.length > 200 || !["move", "resize", "edit"].includes(a.action)) return null;
  if (a.positions) {
    if (typeof a.positions !== "object" || Array.isArray(a.positions) || Object.keys(a.positions).length > 5000) return null;
    for (const [id, p] of Object.entries(a.positions)) {
      if (id.length > 200 || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100) return null;
      if (a.target.kind === "article" && id !== a.target.id) return null;
    }
  }
  if (a.zone && (a.target.kind !== "zone" || a.zone.id !== a.target.id ||
      typeof a.zone.name !== "string" || a.zone.name.length > 80 ||
      !ZONE_COLORS.includes(a.zone.color) || !isValidZoneBounds(a.zone))) return null;
  return m;
}

export function graphActivityLabel(peer: GraphLiveMessage, english: boolean) {
  const action = peer.phase === "commit" ? (english ? "saving" : "a guardar")
    : peer.activity?.action === "move" ? (english ? "moving" : "a mover")
    : peer.activity?.action === "resize" ? (english ? "resizing" : "a redimensionar")
    : (english ? "editing" : "a editar");
  return `${peer.userName} · ${action}`;
}

// These are visual previews only: never feed another client's preview into a save.
export function graphPreview(positions: Record<string, ArticlePosition>, zones: GraphZone[], peers: GraphPeer[]) {
  const nextPositions = { ...positions };
  const nextZones = new Map(zones.map((zone) => [zone.id, zone]));
  for (const peer of peers) {
    if (!peer.activity) continue;
    for (const [id, position] of Object.entries(peer.activity.positions ?? {})) {
      if (Object.hasOwn(nextPositions, id)) nextPositions[id] = position;
    }
    const zone = peer.activity.zone;
    if (zone && nextZones.has(zone.id)) nextZones.set(zone.id, { ...nextZones.get(zone.id)!, x: zone.x, y: zone.y, width: zone.width, height: zone.height });
  }
  return { positions: nextPositions, zones: [...nextZones.values()] };
}
