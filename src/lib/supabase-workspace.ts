import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createInitialActivityFeed,
  createInitialAppStats,
  defaultSnapshot,
  type WorkspaceImageAsset,
  type WorkspaceRelation,
  type WorkspaceSnapshot,
} from "@/lib/workspace-data";
import type { AppLanguage } from "@/lib/portuguese-labels";

type ArticleStatus = "Draft" | "Review" | "Published";
type RelationType = WorkspaceRelation["relationType"];

type WorkspaceRow = {
  id: string;
  language: AppLanguage;
};

type ArticleRow = {
  id: string;
  title: string;
  author: string | null;
  status: string;
  source: string | null;
  tags: string[] | null;
  updated_at: string | null;
};

type RelationRow = {
  id: string;
  from_article_id: string;
  to_article_id: string;
  relation_type: string;
  note: string | null;
  created_at: string | null;
};

type PositionRow = {
  article_id: string;
  x: number | string;
  y: number | string;
};

type AssetRow = {
  id: string;
  article_id: string | null;
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number | string | null;
  created_at: string | null;
};

type IgnoredMentionRow = {
  mention_key: string;
};

function normalizeStatus(value: string): ArticleStatus {
  if (value === "Draft" || value === "Review" || value === "Published") {
    return value;
  }

  return "Draft";
}

function normalizeRelationType(value: string): RelationType {
  if (value === "manual" || value === "explicit" || value === "auto" || value === "suggested") {
    return value;
  }

  return "manual";
}

function toRelativeTimeLabel(value: string | null) {
  if (!value) {
    return "agora";
  }

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return "agora";
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (elapsedSeconds < 60) {
    return "agora";
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  return `${Math.floor(elapsedHours / 24)}d ago`;
}

function isImportedPdfAsset(article: WorkspaceSnapshot["articles"][number]) {
  const tags = article.tags.map((tag) => tag.toLowerCase());

  return tags.includes("pdf") && (tags.includes("importado") || tags.includes("imported"));
}

function parseIgnoredMentionKey(mentionKey: string) {
  const [sourceArticleId, targetArticleId] = mentionKey.split("->");

  if (!sourceArticleId || !targetArticleId) {
    return null;
  }

  return { sourceArticleId, targetArticleId };
}

function collectWorkspaceTags(snapshot: WorkspaceSnapshot) {
  return [...new Set(snapshot.articles.flatMap((article) => article.tags))];
}

function getStoredNameFromStoragePath(storagePath: string) {
  return storagePath.split("/").filter(Boolean).at(-1) ?? storagePath;
}

function assertSupabaseResult(error: { message: string } | null, fallbackMessage: string) {
  if (error) {
    throw new Error(error.message || fallbackMessage);
  }
}

export async function loadWorkspaceSnapshotFromSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceSnapshot> {
  const [articlesResult, relationsResult, positionsResult, assetsResult, ignoredMentionsResult] =
    await Promise.all([
      supabase
        .from("articles")
        .select("id,title,author,status,source,tags,updated_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true }),
      supabase
        .from("relations")
        .select("id,from_article_id,to_article_id,relation_type,note,created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true }),
      supabase
        .from("article_positions")
        .select("article_id,x,y")
        .eq("workspace_id", workspaceId),
      supabase
        .from("assets")
        .select("id,article_id,storage_path,original_name,mime_type,size_bytes,created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }),
      supabase
        .from("ignored_unlinked_mentions")
        .select("mention_key")
        .eq("workspace_id", workspaceId),
    ]);

  assertSupabaseResult(articlesResult.error, "Could not load articles.");
  assertSupabaseResult(relationsResult.error, "Could not load relations.");
  assertSupabaseResult(positionsResult.error, "Could not load graph positions.");
  assertSupabaseResult(assetsResult.error, "Could not load assets.");
  assertSupabaseResult(ignoredMentionsResult.error, "Could not load ignored mentions.");

  const articles = ((articlesResult.data ?? []) as ArticleRow[]).map((article) => ({
    id: article.id,
    title: article.title,
    author: article.author ?? "PaperGraph",
    status: normalizeStatus(article.status),
    updatedAt: toRelativeTimeLabel(article.updated_at),
    tags: article.tags ?? [],
    source: article.source ?? "",
  }));
  const articleIds = new Set(articles.map((article) => article.id));
  const relations = ((relationsResult.data ?? []) as RelationRow[])
    .filter(
      (relation) =>
        articleIds.has(relation.from_article_id) &&
        articleIds.has(relation.to_article_id),
    )
    .map((relation) => ({
      id: relation.id,
      fromArticleId: relation.from_article_id,
      toArticleId: relation.to_article_id,
      note: relation.note ?? "",
      createdAt: toRelativeTimeLabel(relation.created_at),
      relationType: normalizeRelationType(relation.relation_type),
    }));
  const articlePositions = Object.fromEntries(
    ((positionsResult.data ?? []) as PositionRow[])
      .filter((position) => articleIds.has(position.article_id))
      .map((position) => [
        position.article_id,
        {
          x: Number(position.x),
          y: Number(position.y),
        },
      ]),
  );
  const imageAssets: WorkspaceImageAsset[] = ((assetsResult.data ?? []) as AssetRow[]).map((asset) => ({
    id: asset.id,
    articleId: asset.article_id ?? undefined,
    originalName: asset.original_name,
    storedName: getStoredNameFromStoragePath(asset.storage_path),
    storagePath: asset.storage_path,
    mimeType: asset.mime_type,
    size: Number(asset.size_bytes ?? 0),
    uploadedAt: toRelativeTimeLabel(asset.created_at),
  }));
  const ignoredUnlinkedMentionKeys = ((ignoredMentionsResult.data ?? []) as IgnoredMentionRow[]).map(
    (mention) => mention.mention_key,
  );
  const selectedArticle = articles[0] ?? null;

  return {
    ...defaultSnapshot,
    selectedArticleId: selectedArticle?.id ?? "",
    articles,
    relations,
    articlePositions,
    graphNodes: [],
    workspaceTags: collectWorkspaceTags({
      ...defaultSnapshot,
      articles,
    }),
    activityFeed: createInitialActivityFeed(articles, relations),
    appStats: createInitialAppStats(articles, relations, selectedArticle ?? undefined),
    ignoredUnlinkedMentionKeys,
    imageAssets,
  };
}

export async function saveWorkspaceSnapshotToSupabase(
  supabase: SupabaseClient,
  workspace: WorkspaceRow,
  snapshot: WorkspaceSnapshot,
) {
  const articleRows = snapshot.articles.map((article) => ({
    id: article.id,
    workspace_id: workspace.id,
    title: article.title,
    author: article.author,
    status: article.status,
    source_type: isImportedPdfAsset(article) ? "pdf" : "latex",
    source: article.source,
    tags: article.tags,
    updated_at: new Date().toISOString(),
  }));
  const articleIds = new Set(snapshot.articles.map((article) => article.id));
  const positionRows = Object.entries(snapshot.articlePositions)
    .filter(([articleId]) => articleIds.has(articleId))
    .map(([articleId, position]) => ({
      workspace_id: workspace.id,
      article_id: articleId,
      x: position.x,
      y: position.y,
      updated_at: new Date().toISOString(),
    }));
  const relationRows = snapshot.relations
    .filter(
      (relation) =>
        articleIds.has(relation.fromArticleId) &&
        articleIds.has(relation.toArticleId),
    )
    .map((relation) => ({
      workspace_id: workspace.id,
      from_article_id: relation.fromArticleId,
      to_article_id: relation.toArticleId,
      relation_type: relation.relationType,
      note: relation.note,
      created_at: new Date().toISOString(),
    }));
  const assetRows = snapshot.imageAssets
    .filter((asset) => !asset.articleId || articleIds.has(asset.articleId))
    .map((asset) => ({
      id: asset.id,
      workspace_id: workspace.id,
      article_id: asset.articleId ?? null,
      bucket: "papergraph-assets",
      storage_path: asset.storagePath ?? asset.storedName,
      original_name: asset.originalName,
      mime_type: asset.mimeType,
      size_bytes: asset.size,
      created_at: new Date().toISOString(),
    }));
  const ignoredMentionRows = snapshot.ignoredUnlinkedMentionKeys
    .map((mentionKey) => {
      const parsedMentionKey = parseIgnoredMentionKey(mentionKey);

      if (!parsedMentionKey) {
        return null;
      }

      if (!articleIds.has(parsedMentionKey.sourceArticleId) || !articleIds.has(parsedMentionKey.targetArticleId)) {
        return null;
      }

      return {
        workspace_id: workspace.id,
        source_article_id: parsedMentionKey.sourceArticleId,
        target_article_id: parsedMentionKey.targetArticleId,
        mention_key: mentionKey,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const workspaceUpdate = await supabase
    .from("workspaces")
    .update({ language: workspace.language, updated_at: new Date().toISOString() })
    .eq("id", workspace.id);

  assertSupabaseResult(workspaceUpdate.error, "Could not update workspace.");

  for (const table of ["ignored_unlinked_mentions", "relations", "article_positions", "assets", "articles"]) {
    const result = await supabase.from(table).delete().eq("workspace_id", workspace.id);
    assertSupabaseResult(result.error, `Could not clear ${table}.`);
  }

  if (articleRows.length > 0) {
    const result = await supabase.from("articles").insert(articleRows);
    assertSupabaseResult(result.error, "Could not save articles.");
  }

  if (positionRows.length > 0) {
    const result = await supabase.from("article_positions").insert(positionRows);
    assertSupabaseResult(result.error, "Could not save graph positions.");
  }

  if (relationRows.length > 0) {
    const result = await supabase.from("relations").insert(relationRows);
    assertSupabaseResult(result.error, "Could not save relations.");
  }

  if (assetRows.length > 0) {
    const result = await supabase.from("assets").insert(assetRows);
    assertSupabaseResult(result.error, "Could not save assets.");
  }

  if (ignoredMentionRows.length > 0) {
    const result = await supabase.from("ignored_unlinked_mentions").insert(ignoredMentionRows);
    assertSupabaseResult(result.error, "Could not save ignored mentions.");
  }
}
