import type { WorkspaceRelation } from "./workspace-data.ts";

export const relationVisualOrder: WorkspaceRelation["relationType"][] = [
  "citation",
  "semantic",
  "manual",
  "explicit",
];

export const multiRelationLayoutConfig = {
  collapsedSpacing: 1.2,
  expandedSpacing: 18,
  minFanAmplitude: 12,
  maxFanAmplitude: 72,
};

type Point = { x: number; y: number };

export type MultiRelationLayoutInput = {
  relation: WorkspaceRelation;
  fromPosition: Point;
  toPosition: Point;
};

export type MultiRelationLayout = {
  expanded: boolean;
  laneIndex: number;
  laneCount: number;
  laneOffset: number;
  curvature: number;
  controlPoint: Point;
};

function pairKey(relation: WorkspaceRelation) {
  return [relation.fromArticleId, relation.toArticleId].sort().join("::");
}

function relationOrder(relationType: WorkspaceRelation["relationType"]) {
  return relationVisualOrder.indexOf(relationType);
}

function sortRelations(left: MultiRelationLayoutInput, right: MultiRelationLayoutInput) {
  return relationOrder(left.relation.relationType) - relationOrder(right.relation.relationType)
    || left.relation.id.localeCompare(right.relation.id);
}

function getLaneAmplitude(distance: number, zoomScale: number) {
  return Math.min(
    multiRelationLayoutConfig.maxFanAmplitude * zoomScale,
    Math.max(
      multiRelationLayoutConfig.minFanAmplitude * zoomScale,
      distance * 0.12,
    ),
  );
}

export function computeMultiEdgeLayout(
  entries: MultiRelationLayoutInput[],
  selectedNodeId: string | null,
  zoomScale = 1,
) {
  const groups = new Map<string, MultiRelationLayoutInput[]>();

  for (const entry of entries) {
    const key = pairKey(entry.relation);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  const result = new Map<string, MultiRelationLayout>();

  for (const group of groups.values()) {
    const ordered = [...group].sort(sortRelations);
    const laneCount = ordered.length;
    const isExpanded = laneCount > 1 && selectedNodeId !== null && ordered.some(
      ({ relation }) => relation.fromArticleId === selectedNodeId || relation.toArticleId === selectedNodeId,
    );

    const first = ordered[0];
    const dx = first.toPosition.x - first.fromPosition.x;
    const dy = first.toPosition.y - first.fromPosition.y;
    const distance = Math.hypot(dx, dy);
    const normalLength = distance || 1;
    const normal = { x: -dy / normalLength, y: dx / normalLength };
    const spacing = isExpanded
      ? Math.min(multiRelationLayoutConfig.expandedSpacing * zoomScale, getLaneAmplitude(distance, zoomScale) / Math.max(1, laneCount - 1))
      : multiRelationLayoutConfig.collapsedSpacing * zoomScale;

    ordered.forEach((entry, laneIndex) => {
      const laneOffset = (laneIndex - (laneCount - 1) / 2) * spacing;
      const midpoint = {
        x: (entry.fromPosition.x + entry.toPosition.x) / 2,
        y: (entry.fromPosition.y + entry.toPosition.y) / 2,
      };
      const controlPoint = {
        x: midpoint.x + normal.x * laneOffset * 2,
        y: midpoint.y + normal.y * laneOffset * 2,
      };
      result.set(entry.relation.id, {
        expanded: isExpanded,
        laneIndex,
        laneCount,
        laneOffset,
        curvature: Math.abs(laneOffset) * 2,
        controlPoint,
      });
    });
  }

  return result;
}
