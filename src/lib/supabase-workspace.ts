import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultSnapshot,
  type WorkspaceArticleVersion,
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

export type WorkspaceMemberRole = "owner" | "member" | "editor" | "viewer";

export type AccountWorkspace = {
  id: string;
  name: string;
  language: AppLanguage;
  role: WorkspaceMemberRole;
  createdAt: string | null;
  updatedAt: string | null;
};

export type WorkspaceMember = {
  workspaceId: string;
  userId: string;
  role: WorkspaceMemberRole;
  joinedAt: string | null;
  displayName: string | null;
  email: string | null;
};

export type WorkspaceInvite = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  invitedEmail: string;
  invitedBy: string;
  invitedByName: string | null;
  invitedByEmail: string | null;
  role: WorkspaceMemberRole;
  status: "pending" | "accepted" | "revoked";
  createdAt: string | null;
  expiresAt: string | null;
};

type AccountWorkspaceRpcRow = {
  workspace_id: string;
  workspace_name: string;
  workspace_language: string;
  member_role: string;
  workspace_created_at?: string | null;
  workspace_updated_at?: string | null;
};

type WorkspaceMemberRpcRow = {
  workspace_id: string;
  user_id: string;
  member_role: string;
  member_created_at?: string | null;
  display_name?: string | null;
  member_email?: string | null;
};

type WorkspaceInviteRpcRow = {
  invite_id: string;
  workspace_id: string;
  workspace_name: string;
  invited_email: string;
  invited_by: string;
  invited_by_name?: string | null;
  invited_by_email?: string | null;
  member_role: string;
  invite_status: string;
  invite_created_at?: string | null;
  invite_expires_at?: string | null;
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

type ArticleVersionRow = {
  id: string;
  article_id: string;
  title: string;
  author: string | null;
  status: string;
  source: string | null;
  tags: string[] | null;
  created_at: string | null;
  submitted_by: string | null;
  submitted_by_name: string | null;
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

  return (
    article.source.includes("\\includepdf") ||
    (tags.includes("pdf") && (tags.includes("importado") || tags.includes("imported")))
  );
}

function parseIgnoredMentionKey(mentionKey: string) {
  const [sourceArticleId, targetArticleId] = mentionKey.split("->");

  if (!sourceArticleId || !targetArticleId) {
    return null;
  }

  return { sourceArticleId, targetArticleId };
}

function getStoredNameFromStoragePath(storagePath: string) {
  return storagePath.split("/").filter(Boolean).at(-1) ?? storagePath;
}

function assertSupabaseResult(error: { message: string } | null, fallbackMessage: string) {
  if (error) {
    throw new Error(error.message || fallbackMessage);
  }
}

function normalizeWorkspaceLanguage(value: string): AppLanguage {
  return value === "en" ? "en" : "pt";
}

function normalizeWorkspaceRole(value: string): WorkspaceMemberRole {
  if (value === "owner" || value === "editor" || value === "viewer") {
    return value;
  }

  return "member";
}

function mapAccountWorkspaceRow(row: AccountWorkspaceRpcRow): AccountWorkspace {
  return {
    id: String(row.workspace_id),
    name: String(row.workspace_name),
    language: normalizeWorkspaceLanguage(row.workspace_language),
    role: normalizeWorkspaceRole(String(row.member_role)),
    createdAt: row.workspace_created_at ?? null,
    updatedAt: row.workspace_updated_at ?? null,
  };
}

function normalizeInviteStatus(value: string): WorkspaceInvite["status"] {
  if (value === "accepted" || value === "revoked") {
    return value;
  }

  return "pending";
}

function mapWorkspaceMemberRow(row: WorkspaceMemberRpcRow): WorkspaceMember {
  return {
    workspaceId: String(row.workspace_id),
    userId: String(row.user_id),
    role: normalizeWorkspaceRole(String(row.member_role)),
    joinedAt: row.member_created_at ?? null,
    displayName: row.display_name ?? null,
    email: row.member_email ?? null,
  };
}

function mapWorkspaceInviteRow(row: WorkspaceInviteRpcRow): WorkspaceInvite {
  return {
    id: String(row.invite_id),
    workspaceId: String(row.workspace_id),
    workspaceName: String(row.workspace_name),
    invitedEmail: String(row.invited_email),
    invitedBy: String(row.invited_by),
    invitedByName: row.invited_by_name ?? null,
    invitedByEmail: row.invited_by_email ?? null,
    role: normalizeWorkspaceRole(String(row.member_role)),
    status: normalizeInviteStatus(row.invite_status),
    createdAt: row.invite_created_at ?? null,
    expiresAt: row.invite_expires_at ?? null,
  };
}

export async function ensureUserWorkspace(
  supabase: SupabaseClient,
): Promise<AccountWorkspace | null> {
  const { data, error } = await supabase.rpc("ensure_user_workspace");

  assertSupabaseResult(error, "Could not prepare workspace.");

  const rows = Array.isArray(data) ? (data as AccountWorkspaceRpcRow[]) : [];
  const firstWorkspace = rows[0];

  return firstWorkspace ? mapAccountWorkspaceRow(firstWorkspace) : null;
}

export async function listUserWorkspacesFromSupabase(
  supabase: SupabaseClient,
): Promise<AccountWorkspace[]> {
  const { data, error } = await supabase.rpc("list_user_workspaces");

  assertSupabaseResult(error, "Could not list workspaces.");

  const rows = Array.isArray(data) ? (data as AccountWorkspaceRpcRow[]) : [];

  return rows.map(mapAccountWorkspaceRow);
}

export async function createUserWorkspaceInSupabase(
  supabase: SupabaseClient,
  workspaceName: string,
): Promise<AccountWorkspace> {
  const { data, error } = await supabase.rpc("create_user_workspace", {
    requested_workspace_name: workspaceName,
  });

  assertSupabaseResult(error, "Could not create workspace.");

  const rows = Array.isArray(data) ? (data as AccountWorkspaceRpcRow[]) : [];
  const createdWorkspace = rows[0];

  if (!createdWorkspace) {
    throw new Error("Could not create workspace.");
  }

  return mapAccountWorkspaceRow(createdWorkspace);
}

export async function renameWorkspaceInSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
  workspaceName: string,
): Promise<AccountWorkspace> {
  const { data, error } = await supabase.rpc("rename_user_workspace", {
    requested_workspace_name: workspaceName,
    target_workspace_id: workspaceId,
  });

  assertSupabaseResult(error, "Could not rename workspace.");

  const rows = Array.isArray(data) ? (data as AccountWorkspaceRpcRow[]) : [];
  const renamedWorkspace = rows[0];

  if (!renamedWorkspace) {
    throw new Error("Could not rename workspace.");
  }

  return mapAccountWorkspaceRow(renamedWorkspace);
}

export async function listWorkspaceAssetStoragePathsFromSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("assets")
    .select("storage_path")
    .eq("workspace_id", workspaceId);

  assertSupabaseResult(error, "Could not list workspace assets.");

  return ((data ?? []) as Array<{ storage_path: string | null }>)
    .map((asset) => asset.storage_path)
    .filter((storagePath): storagePath is string => Boolean(storagePath));
}

export async function deleteWorkspaceInSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const { error } = await supabase.rpc("delete_user_workspace", {
    target_workspace_id: workspaceId,
  });

  assertSupabaseResult(error, "Could not delete workspace.");
}

export async function listWorkspaceMembersFromSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  const { data, error } = await supabase.rpc("list_workspace_members", {
    target_workspace_id: workspaceId,
  });

  assertSupabaseResult(error, "Could not list workspace members.");

  const rows = Array.isArray(data) ? (data as WorkspaceMemberRpcRow[]) : [];

  return rows.map(mapWorkspaceMemberRow);
}

export async function listWorkspaceInvitesFromSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceInvite[]> {
  const { data, error } = await supabase.rpc("list_workspace_invites", {
    target_workspace_id: workspaceId,
  });

  assertSupabaseResult(error, "Could not list workspace invites.");

  const rows = Array.isArray(data) ? (data as WorkspaceInviteRpcRow[]) : [];

  return rows.map(mapWorkspaceInviteRow);
}

export async function listMyPendingWorkspaceInvitesFromSupabase(
  supabase: SupabaseClient,
): Promise<WorkspaceInvite[]> {
  const { data, error } = await supabase.rpc("list_my_pending_workspace_invites");

  assertSupabaseResult(error, "Could not list pending workspace invites.");

  const rows = Array.isArray(data) ? (data as WorkspaceInviteRpcRow[]) : [];

  return rows.map(mapWorkspaceInviteRow);
}

export async function createWorkspaceInviteInSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
  invitedEmail: string,
  role: Exclude<WorkspaceMemberRole, "owner"> = "editor",
): Promise<WorkspaceInvite> {
  const { data, error } = await supabase.rpc("create_workspace_invite", {
    requested_member_role: role,
    target_email: invitedEmail,
    target_workspace_id: workspaceId,
  });

  assertSupabaseResult(error, "Could not create workspace invite.");

  const rows = Array.isArray(data) ? (data as WorkspaceInviteRpcRow[]) : [];
  const createdInvite = rows[0];

  if (!createdInvite) {
    throw new Error("Could not create workspace invite.");
  }

  return mapWorkspaceInviteRow(createdInvite);
}

export async function acceptWorkspaceInviteInSupabase(
  supabase: SupabaseClient,
  inviteId: string,
): Promise<AccountWorkspace> {
  const { data, error } = await supabase.rpc("accept_workspace_invite", {
    invite_uuid: inviteId,
  });

  assertSupabaseResult(error, "Could not accept workspace invite.");

  const rows = Array.isArray(data) ? (data as AccountWorkspaceRpcRow[]) : [];
  const acceptedWorkspace = rows[0];

  if (!acceptedWorkspace) {
    throw new Error("Could not accept workspace invite.");
  }

  return mapAccountWorkspaceRow(acceptedWorkspace);
}

export async function declineWorkspaceInviteInSupabase(
  supabase: SupabaseClient,
  inviteId: string,
) {
  const { error } = await supabase.rpc("decline_workspace_invite", {
    invite_uuid: inviteId,
  });

  assertSupabaseResult(error, "Could not decline workspace invite.");
}

export async function revokeWorkspaceInviteInSupabase(
  supabase: SupabaseClient,
  inviteId: string,
) {
  const { error } = await supabase.rpc("revoke_workspace_invite", {
    invite_uuid: inviteId,
  });

  assertSupabaseResult(error, "Could not revoke workspace invite.");
}

export async function updateWorkspaceMemberRoleInSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  role: Exclude<WorkspaceMemberRole, "owner">,
) {
  const { error } = await supabase.rpc("update_workspace_member_role", {
    requested_member_role: role,
    target_user_id: userId,
    target_workspace_id: workspaceId,
  });

  assertSupabaseResult(error, "Could not update workspace member role.");
}

export async function removeWorkspaceMemberFromSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
) {
  const { error } = await supabase.rpc("remove_workspace_member", {
    target_user_id: userId,
    target_workspace_id: workspaceId,
  });

  assertSupabaseResult(error, "Could not remove workspace member.");
}

export async function transferWorkspaceOwnerInSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
  nextOwnerUserId: string,
) {
  const { error } = await supabase.rpc("transfer_workspace_owner", {
    next_owner_user_id: nextOwnerUserId,
    target_workspace_id: workspaceId,
  });

  assertSupabaseResult(error, "Could not transfer workspace ownership.");
}

export async function loadWorkspaceSnapshotFromSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceSnapshot> {
  const [
    articlesResult,
    articleVersionsResult,
    relationsResult,
    positionsResult,
    assetsResult,
    ignoredMentionsResult,
  ] =
    await Promise.all([
      supabase
        .from("articles")
        .select("id,title,author,status,source,tags,updated_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true }),
      supabase
        .from("article_versions")
        .select("id,article_id,title,author,status,source,tags,created_at,submitted_by,submitted_by_name")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }),
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
  assertSupabaseResult(articleVersionsResult.error, "Could not load article history.");
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
  const articleVersions: WorkspaceArticleVersion[] = ((articleVersionsResult.data ?? []) as ArticleVersionRow[])
    .filter((version) => articleIds.has(version.article_id))
    .map((version) => ({
      id: version.id,
      articleId: version.article_id,
      title: version.title,
      author: version.author ?? "PaperGraph",
      status: normalizeStatus(version.status) === "Published" ? "Published" : "Review",
      source: version.source ?? "",
      tags: version.tags ?? [],
      createdAt: version.created_at ?? new Date().toISOString(),
      submittedBy: version.submitted_by,
      submittedByName: version.submitted_by_name,
    }));
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
  return {
    ...defaultSnapshot,
    selectedArticleId: "",
    articles,
    relations,
    articlePositions,
    ignoredUnlinkedMentionKeys,
    imageAssets,
    articleVersions,
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
  const articleVersionRows = snapshot.articleVersions
    .filter((version) => articleIds.has(version.articleId))
    .map((version) => ({
      id: version.id,
      workspace_id: workspace.id,
      article_id: version.articleId,
      title: version.title,
      author: version.author,
      status: version.status,
      source: version.source,
      tags: version.tags,
      created_at: version.createdAt,
      submitted_by: version.submittedBy ?? null,
      submitted_by_name: version.submittedByName ?? null,
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

  for (const table of ["ignored_unlinked_mentions", "relations", "article_positions", "assets", "article_versions", "articles"]) {
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

  if (articleVersionRows.length > 0) {
    const result = await supabase.from("article_versions").insert(articleVersionRows);
    assertSupabaseResult(result.error, "Could not save article history.");
  }

  if (ignoredMentionRows.length > 0) {
    const result = await supabase.from("ignored_unlinked_mentions").insert(ignoredMentionRows);
    assertSupabaseResult(result.error, "Could not save ignored mentions.");
  }
}
