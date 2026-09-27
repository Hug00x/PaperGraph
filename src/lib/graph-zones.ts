import type { ArticlePosition } from "./workspace-data.ts";

// Coordinates match ArticlePosition: 100 units = the 3000px graph world.
export const ZONE_CONFIG = { minWidth: 8, minHeight: 6, paddingX: 3, paddingY: 3, maxName: 80, maxNotes: 20000, gap: 1 };
export const ZONE_COLORS = ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"] as const;
export type ZoneColor = (typeof ZONE_COLORS)[number];
export type GraphZone = { id: string; name: string; color: ZoneColor; notes?: string; x: number; y: number; width: number; height: number };
export type ZoneBounds = Pick<GraphZone, "x" | "y" | "width" | "height">;
export type Positions = Record<string, ArticlePosition>;
const zoneColorValues: Record<ZoneColor, [number, number, number]> = {
  red: [248, 113, 113], orange: [251, 146, 60], amber: [251, 191, 36], green: [74, 222, 128],
  teal: [45, 212, 191], blue: [96, 165, 250], violet: [196, 181, 253], pink: [244, 114, 182],
};

export function isPointInsideZone(point: ArticlePosition, zone: ZoneBounds) {
  // Half-open bounds remove ambiguity where two zones share an edge.
  return point.x >= zone.x && point.x < zone.x + zone.width && point.y >= zone.y && point.y < zone.y + zone.height;
}
export function getZoneForNodePosition(point: ArticlePosition | undefined, zones: readonly GraphZone[]) {
  return getZonesForNodePosition(point, zones)[0] ?? null;
}
export function getZonesForNodePosition(point: ArticlePosition | undefined, zones: readonly GraphZone[]) {
  if (!point) return [];
  return zones.filter((zone) => isPointInsideZone(point, zone)).sort((a, b) => a.id.localeCompare(b.id));
}
export function getBlendedZoneColor(zones: readonly GraphZone[]) {
  if (!zones.length) return undefined;
  const channels = zones.reduce((sum, zone) => {
    const color = zoneColorValues[zone.color];
    return [sum[0] + color[0], sum[1] + color[1], sum[2] + color[2]];
  }, [0, 0, 0]);
  const count = zones.length;
  return `rgb(${Math.round(channels[0] / count)} ${Math.round(channels[1] / count)} ${Math.round(channels[2] / count)})`;
}
export function zonesOverlap(a: ZoneBounds, b: ZoneBounds) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
export function isValidZoneBounds(zone: ZoneBounds) {
  return [zone.x, zone.y, zone.width, zone.height].every(Number.isFinite) && zone.x >= 0 && zone.y >= 0 &&
    zone.width >= ZONE_CONFIG.minWidth && zone.height >= ZONE_CONFIG.minHeight && zone.x + zone.width <= 100 && zone.y + zone.height <= 100;
}
export function normalizeZones(value: unknown): GraphZone[] {
  if (!Array.isArray(value)) return [];
  const result: GraphZone[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const zone = candidate as GraphZone;
    if (typeof zone.id !== "string" || !zone.id || typeof zone.name !== "string" || !zone.name.trim() ||
      !ZONE_COLORS.includes(zone.color) || !isValidZoneBounds(zone) || result.some((other) => other.id === zone.id)) continue;
    result.push({ id: zone.id, name: zone.name.trim().slice(0, ZONE_CONFIG.maxName), color: zone.color,
      ...(typeof zone.notes === "string" ? { notes: zone.notes.slice(0, ZONE_CONFIG.maxNotes) } : {}),
      x: zone.x, y: zone.y, width: zone.width, height: zone.height });
  }
  return result;
}
export function getSelectionBounds(ids: readonly string[], positions: Positions): ZoneBounds | null {
  const points = ids.map((id) => positions[id]).filter(Boolean);
  if (!points.length) return null;
  const left = Math.min(...points.map((p) => p.x)), right = Math.max(...points.map((p) => p.x));
  const top = Math.min(...points.map((p) => p.y)), bottom = Math.max(...points.map((p) => p.y));
  const width = Math.min(100, Math.max(ZONE_CONFIG.minWidth, right - left + 2 * ZONE_CONFIG.paddingX));
  const height = Math.min(100, Math.max(ZONE_CONFIG.minHeight, bottom - top + 2 * ZONE_CONFIG.paddingY));
  return { x: Math.max(0, Math.min(100 - width, (left + right - width) / 2)),
    y: Math.max(0, Math.min(100 - height, (top + bottom - height) / 2)), width, height };
}
export function findFreeZoneBounds(bounds: ZoneBounds, zones: readonly GraphZone[]): ZoneBounds | null {
  const xs = [bounds.x, 0, 100 - bounds.width, ...zones.flatMap((z) => [z.x + z.width + ZONE_CONFIG.gap, z.x - bounds.width - ZONE_CONFIG.gap])];
  const ys = [bounds.y, 0, 100 - bounds.height, ...zones.flatMap((z) => [z.y + z.height + ZONE_CONFIG.gap, z.y - bounds.height - ZONE_CONFIG.gap])];
  return xs.flatMap((x) => ys.map((y) => ({ ...bounds, x, y })))
    .filter((b) => isValidZoneBounds(b) && !zones.some((z) => zonesOverlap(z, b)))
    .sort((a, b) => Math.hypot(a.x - bounds.x, a.y - bounds.y) - Math.hypot(b.x - bounds.x, b.y - bounds.y) || a.x - b.x || a.y - b.y)[0] ?? null;
}
export function moveZoneMembers(zone: GraphZone, zones: readonly GraphZone[], positions: Positions, dx: number, dy: number): Positions {
  return Object.fromEntries(Object.entries(positions).map(([id, point]) => [id,
    zones.some((candidate) => candidate.id === zone.id && isPointInsideZone(point, candidate))
      ? { x: point.x + dx, y: point.y + dy } : point]));
}
export function resizeZone(zone: ZoneBounds, corner: string, dx: number, dy: number): ZoneBounds {
  const left = corner.includes("w") ? Math.max(0, Math.min(zone.x + zone.width - ZONE_CONFIG.minWidth, zone.x + dx)) : zone.x;
  const top = corner.includes("n") ? Math.max(0, Math.min(zone.y + zone.height - ZONE_CONFIG.minHeight, zone.y + dy)) : zone.y;
  const right = corner.includes("e") ? Math.min(100, Math.max(zone.x + ZONE_CONFIG.minWidth, zone.x + zone.width + dx)) : zone.x + zone.width;
  const bottom = corner.includes("s") ? Math.min(100, Math.max(zone.y + ZONE_CONFIG.minHeight, zone.y + zone.height + dy)) : zone.y + zone.height;
  return { x: left, y: top, width: Math.max(ZONE_CONFIG.minWidth, right - left), height: Math.max(ZONE_CONFIG.minHeight, bottom - top) };
}

export function getDrawnZoneBounds(start: ArticlePosition, end: ArticlePosition): ZoneBounds {
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  const x = Math.min(clamp(start.x), clamp(end.x)), y = Math.min(clamp(start.y), clamp(end.y));
  return { x, y, width: Math.max(clamp(start.x), clamp(end.x)) - x, height: Math.max(clamp(start.y), clamp(end.y)) - y };
}
