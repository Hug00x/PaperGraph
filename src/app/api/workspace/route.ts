import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import {
  createInitialActivityFeed,
  createInitialAppStats,
  defaultSnapshot,
  type ArticlePosition,
  type WorkspaceArticle,
  type WorkspaceRelation,
  type WorkspaceSnapshot,
} from "@/lib/workspace-data";

const dataDirectory = join(process.cwd(), "data");
const dataFile = join(dataDirectory, "workspace.json");

const legacyActivityTitles = new Set([
  "Imported 3 articles",
  "Semantic link suggestion",
  "Compile pipeline ready",
]);

function normalizeRelationType(value: unknown): WorkspaceRelation["relationType"] {
  if (value === "auto" || value === "explicit" || value === "manual" || value === "suggested") {
    return value;
  }

  return "manual";
}

function clampPositionValue(value: number) {
  return Math.min(98, Math.max(2, Math.round(value * 10) / 10));
}

function normalizeArticlePositions(
  workspaceArticles: WorkspaceArticle[],
  positions: Partial<Record<string, ArticlePosition>> | undefined,
) {
  const articleIds = new Set(workspaceArticles.map((article) => article.id));
  const nextPositions: Record<string, ArticlePosition> = {};

  Object.entries(positions ?? {}).forEach(([articleId, position]) => {
    if (
      !articleIds.has(articleId) ||
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      return;
    }

    nextPositions[articleId] = {
      x: clampPositionValue(position.x),
      y: clampPositionValue(position.y),
    };
  });

  return nextPositions;
}

function normalizeSnapshotForStorage(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...snapshot,
    articlePositions: normalizeArticlePositions(snapshot.articles, snapshot.articlePositions),
  };
}

function normalizeActivityFeed(snapshot: Partial<WorkspaceSnapshot>, workspaceSnapshot: Pick<WorkspaceSnapshot, "articles" | "relations">) {
  const feed = snapshot.activityFeed ?? [];

  if (feed.length === 0) {
    return createInitialActivityFeed(workspaceSnapshot.articles, workspaceSnapshot.relations);
  }

  if (feed.some((item) => legacyActivityTitles.has(item.title) || item.title.includes("automatic relations"))) {
    return createInitialActivityFeed(workspaceSnapshot.articles, workspaceSnapshot.relations);
  }

  return feed;
}

function normalizeAppStats(
  snapshot: Partial<WorkspaceSnapshot>,
  workspaceSnapshot: Pick<WorkspaceSnapshot, "articles" | "relations" | "selectedArticleId">,
) {
  const selectedArticle = workspaceSnapshot.articles.find((article) => article.id === workspaceSnapshot.selectedArticleId) ?? workspaceSnapshot.articles[0];
  const appStats = snapshot.appStats ?? [];

  if (appStats.length === 0) {
    return createInitialAppStats(workspaceSnapshot.articles, workspaceSnapshot.relations, selectedArticle);
  }

  if (appStats.some((item) => item.value === "128" || item.value === "842" || item.value === "8s")) {
    return createInitialAppStats(workspaceSnapshot.articles, workspaceSnapshot.relations, selectedArticle);
  }

  return appStats;
}

async function readSnapshot(): Promise<WorkspaceSnapshot> {
  try {
    const fileContents = await readFile(dataFile, "utf8");
    const parsed = JSON.parse(fileContents) as Partial<WorkspaceSnapshot>;

    const workspaceSnapshot = {
      ...defaultSnapshot,
      ...parsed,
      articles: parsed.articles ?? defaultSnapshot.articles,
      relations: (parsed.relations ?? []).map((relation) => ({
        ...relation,
        relationType: normalizeRelationType(relation.relationType),
      })),
      articlePositions: normalizeArticlePositions(
        parsed.articles ?? defaultSnapshot.articles,
        parsed.articlePositions ?? defaultSnapshot.articlePositions,
      ),
      graphNodes: parsed.graphNodes ?? defaultSnapshot.graphNodes,
      workspaceTags: parsed.workspaceTags ?? defaultSnapshot.workspaceTags,
      activityFeed: parsed.activityFeed ?? defaultSnapshot.activityFeed,
      appStats: parsed.appStats ?? defaultSnapshot.appStats,
      ignoredUnlinkedMentionKeys: parsed.ignoredUnlinkedMentionKeys ?? defaultSnapshot.ignoredUnlinkedMentionKeys,
      imageAssets: parsed.imageAssets ?? defaultSnapshot.imageAssets,
    } satisfies WorkspaceSnapshot;

    return {
      ...workspaceSnapshot,
      activityFeed: normalizeActivityFeed(parsed, workspaceSnapshot),
      appStats: normalizeAppStats(parsed, workspaceSnapshot),
    };
  } catch {
    return defaultSnapshot;
  }
}

async function writeSnapshot(snapshot: WorkspaceSnapshot) {
  const normalizedSnapshot = normalizeSnapshotForStorage(snapshot);

  await mkdir(dataDirectory, { recursive: true });
  await writeFile(dataFile, JSON.stringify(normalizedSnapshot, null, 2), "utf8");

  return normalizedSnapshot;
}

export async function GET() {
  return NextResponse.json(await readSnapshot());
}

export async function PUT(request: Request) {
  const snapshot = (await request.json()) as WorkspaceSnapshot;
  const savedSnapshot = await writeSnapshot(snapshot);

  return NextResponse.json(savedSnapshot);
}
