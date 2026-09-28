import type { ArticlePosition } from "./workspace-data.ts";

// Coordinates match ArticlePosition: 100 units = the 3000px graph world.
export const ZONE_CONFIG = { minWidth: 8, minHeight: 6, maxName: 80, maxNotes: 20000 };
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
