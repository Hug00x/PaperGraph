import type { ArticlePosition, WorkspaceArticle } from "./workspace-data.ts";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function createFallbackPositions(workspaceArticles: WorkspaceArticle[]) {
  const fallbackPositions: Record<string, ArticlePosition> = {};
  const totalArticles = Math.max(workspaceArticles.length, 1);

  workspaceArticles.forEach((article, index) => {
    const angle = (index / totalArticles) * Math.PI * 2;
    const radius = 18 + index * 5;

    fallbackPositions[article.id] = {
      x: clamp(50 + Math.cos(angle) * radius, 10, 90),
      y: clamp(50 + Math.sin(angle) * radius, 10, 90),
    };
  });

  return fallbackPositions;
}

function spreadOverlappingPositions(
  workspaceArticles: WorkspaceArticle[],
  positions: Record<string, ArticlePosition>,
) {
  const nextPositions: Record<string, ArticlePosition> = { ...positions };
  const buckets = new Map<string, WorkspaceArticle[]>();

  workspaceArticles.forEach((article) => {
    const position = nextPositions[article.id];

    if (!position) {
      return;
    }

    const key = `${position.x.toFixed(1)}::${position.y.toFixed(1)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), article]);
  });

  buckets.forEach((bucket) => {
    if (bucket.length < 2) {
      return;
    }

    const basePosition = nextPositions[bucket[0].id];
    const centerX = clamp(basePosition.x, 28, 72);
    const centerY = clamp(basePosition.y, 28, 72);
    const radius = 18 + bucket.length * 3;

    bucket.forEach((article, index) => {
      const angle = (index / bucket.length) * Math.PI * 2;

      nextPositions[article.id] = {
        x: clamp(centerX + Math.cos(angle) * radius, 8, 92),
        y: clamp(centerY + Math.sin(angle) * radius, 8, 92),
      };
    });
  });

  return nextPositions;
}

export function calculateNextArticlePosition(workspaceArticles: WorkspaceArticle[]) {
  const totalArticles = workspaceArticles.length + 1;
  const angle = (totalArticles / Math.max(totalArticles, 6)) * Math.PI * 2;
  const radius = 18 + totalArticles * 4;

  return {
    x: clamp(50 + Math.cos(angle) * radius, 10, 90),
    y: clamp(50 + Math.sin(angle) * radius, 10, 90),
  };
}

function clampArticlePosition(value: number) {
  return clamp(value, 2, 98);
}

export function normalizeArticlePositionsForArticles(
  workspaceArticles: WorkspaceArticle[],
  positions: Record<string, ArticlePosition>,
) {
  const articleIds = new Set(workspaceArticles.map((article) => article.id));
  const nextPositions: Record<string, ArticlePosition> = {};

  Object.entries(positions).forEach(([articleId, position]) => {
    if (
      !articleIds.has(articleId) ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      return;
    }

    nextPositions[articleId] = {
      x: clampArticlePosition(position.x),
      y: clampArticlePosition(position.y),
    };
  });

  return nextPositions;
}

export function mergeArticlePositions(
  workspaceArticles: WorkspaceArticle[],
  currentPositions: Record<string, ArticlePosition> | undefined,
  nextArticleId?: string,
) {
  const basePositions = currentPositions ?? {};
  const mergedPositions: Record<string, ArticlePosition> = { ...basePositions };
  const fallbackPositions = createFallbackPositions(workspaceArticles);

  workspaceArticles.forEach((article) => {
    if (!mergedPositions[article.id]) {
      mergedPositions[article.id] = fallbackPositions[article.id];
    }
  });

  if (nextArticleId && !mergedPositions[nextArticleId]) {
    mergedPositions[nextArticleId] = calculateNextArticlePosition(workspaceArticles);
  }

  // Layout only missing positions. Saved positions define spatial Zone membership.
  const generated = workspaceArticles.some((article) => !basePositions[article.id])
    ? spreadOverlappingPositions(workspaceArticles, mergedPositions)
    : mergedPositions;
  return normalizeArticlePositionsForArticles(
    workspaceArticles,
    Object.fromEntries(Object.entries(generated).map(([id, point]) => [id, basePositions[id] ?? point])),
  );
}
