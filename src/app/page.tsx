"use client";

import { ArticleLibrary } from "@/components/article-library";
import { ArticleViewerPane } from "@/components/article-viewer-pane";
import { AuthLanding } from "@/components/auth-landing";
import { EditorPane } from "@/components/editor-pane";
import { GraphPane } from "@/components/graph-pane";
import paperGraphLogoText from "@/imagens/PapergraghTexto.png";
import type { AppLanguage } from "@/lib/portuguese-labels";
import {
  createInitialAppStats,
  defaultSnapshot,
  type ArticlePosition,
  type UnlinkedMention,
  type WorkspaceSnapshot,
  type WorkspaceArticle,
  type WorkspaceImageAsset,
  type WorkspaceRelation,
} from "@/lib/workspace-data";
import {
  acceptWorkspaceInviteInSupabase,
  createUserWorkspaceInSupabase,
  createWorkspaceInviteInSupabase,
  ensureUserWorkspace,
  listMyPendingWorkspaceInvitesFromSupabase,
  listUserWorkspacesFromSupabase,
  listWorkspaceInvitesFromSupabase,
  listWorkspaceMembersFromSupabase,
  loadWorkspaceSnapshotFromSupabase,
  removeWorkspaceMemberFromSupabase,
  revokeWorkspaceInviteInSupabase,
  saveWorkspaceSnapshotToSupabase,
  updateWorkspaceMemberRoleInSupabase,
  type AccountWorkspace,
  type WorkspaceInvite,
  type WorkspaceMember,
  type WorkspaceMemberRole,
} from "@/lib/supabase-workspace";
import { deleteArticleCollaborationStateFromSupabase } from "@/lib/supabase-collaboration";
import { getSupabaseBrowserClient } from "@/lib/supabase-client";
import { paperGraphAssetBucket, uploadWorkspaceAssetToSupabase } from "@/lib/supabase-storage";
import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";

const apiPath = "/api/workspace";
const activeWorkspaceStorageKey = "papergraph-active-workspace-id";
const localWorkspaceUiStorageId = "local";
const workspaceUiStorageKeyPrefix = "papergraph-workspace-ui";
const tabs = ["drafts", "editor", "graph", "settings"] as const;
const settingsSections = ["general", "workspaces", "help", "account", "data"] as const;
const editableWorkspaceMemberRoles = ["editor", "viewer"] as const;
type WorkspaceTab = (typeof tabs)[number];
type SettingsSection = (typeof settingsSections)[number];
type EditableWorkspaceMemberRole = (typeof editableWorkspaceMemberRoles)[number];
type PendingEditorResubmission = { articleId: string; title: string; source: string };
type PendingEditorNavigation = { type: "tab"; tab: WorkspaceTab };
type ArticleSubmission = { articleId?: string; title: string; source: string };
type AuthMode = "sign-in" | "sign-up";
type AppTheme = "dark" | "light";
type UserProfileRow = {
  display_name: string | null;
};
type WorkspacePresenceMode = "editing" | "viewing" | "browsing" | "settings";
type WorkspacePresence = {
  articleId: string | null;
  articleTitle: string | null;
  clientId: string;
  enteredAt: string;
  email: string | null;
  mode: WorkspacePresenceMode;
  selectionEnd?: number | null;
  selectionStart?: number | null;
  tab: WorkspaceTab;
  updatedAt: string;
  userId: string;
  userName: string;
};

type WorkspaceUiState = {
  activeTab?: WorkspaceTab;
  graphSelectedArticleId?: string | null;
  selectedArticleId?: string;
};
function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function getAuthUserFallbackDisplayName(user: User | null) {
  if (!user) {
    return null;
  }

  const userMetadata = user.user_metadata as Record<string, unknown>;
  const metadataName =
    typeof userMetadata.display_name === "string"
      ? userMetadata.display_name
      : typeof userMetadata.full_name === "string"
        ? userMetadata.full_name
        : typeof userMetadata.name === "string"
          ? userMetadata.name
          : "";
  const normalizedMetadataName = normalizeDisplayName(metadataName);

  if (normalizedMetadataName) {
    return normalizedMetadataName;
  }

  return user.email?.split("@")[0] ?? null;
}

function getStoredActiveWorkspaceId() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(activeWorkspaceStorageKey);
}

function rememberActiveWorkspaceId(workspaceId: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (workspaceId) {
    window.localStorage.setItem(activeWorkspaceStorageKey, workspaceId);
    return;
  }

  window.localStorage.removeItem(activeWorkspaceStorageKey);
}

function isWorkspaceTab(value: string | null): value is WorkspaceTab {
  return tabs.some((tab) => tab === value);
}

function getWorkspaceUiStorageKey(workspaceId: string | null) {
  return `${workspaceUiStorageKeyPrefix}:${workspaceId ?? localWorkspaceUiStorageId}`;
}

function getStoredWorkspaceUiState(workspaceId: string | null): WorkspaceUiState {
  if (typeof window === "undefined") {
    return {};
  }

  const rawState = window.localStorage.getItem(getWorkspaceUiStorageKey(workspaceId));

  if (!rawState) {
    return {};
  }

  try {
    const parsedState = JSON.parse(rawState) as Partial<WorkspaceUiState>;

    return {
      activeTab: isWorkspaceTab(parsedState.activeTab ?? null) ? parsedState.activeTab : undefined,
      graphSelectedArticleId:
        typeof parsedState.graphSelectedArticleId === "string"
          ? parsedState.graphSelectedArticleId
          : parsedState.graphSelectedArticleId === null
            ? null
            : undefined,
      selectedArticleId:
        typeof parsedState.selectedArticleId === "string" && parsedState.selectedArticleId
          ? parsedState.selectedArticleId
          : undefined,
    };
  } catch {
    return {};
  }
}

function rememberWorkspaceUiState(workspaceId: string | null, updates: WorkspaceUiState) {
  if (typeof window === "undefined") {
    return;
  }

  const currentState = getStoredWorkspaceUiState(workspaceId);
  const nextState = { ...currentState, ...updates };

  window.localStorage.setItem(getWorkspaceUiStorageKey(workspaceId), JSON.stringify(nextState));
}

function normalizeWorkspaceName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function formatWorkspaceDate(value: string | null, language: AppLanguage) {
  if (!value) {
    return language === "en" ? "No date yet" : "Sem data";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return language === "en" ? "No date yet" : "Sem data";
  }

  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "pt-PT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatWorkspaceRole(role: string, language: AppLanguage) {
  if (role === "owner") {
    return language === "en" ? "Owner" : "Dono";
  }

  if (role === "editor" || role === "member") {
    return language === "en" ? "Editor" : "Editor";
  }

  if (role === "viewer") {
    return language === "en" ? "Viewer" : "Visualizador";
  }

  return language === "en" ? "Member" : "Membro";
}

function getEditableWorkspaceMemberRole(role: WorkspaceMemberRole): EditableWorkspaceMemberRole {
  return role === "viewer" ? "viewer" : "editor";
}

function formatInviteStatus(status: WorkspaceInvite["status"], language: AppLanguage) {
  if (status === "accepted") {
    return language === "en" ? "Accepted" : "Aceite";
  }

  if (status === "revoked") {
    return language === "en" ? "Revoked" : "Revogado";
  }

  return language === "en" ? "Pending" : "Pendente";
}

function getDisplayInitials(value: string | null | undefined) {
  const normalizedValue = normalizeDisplayName(value ?? "");

  if (!normalizedValue) {
    return "PG";
  }

  const initials = normalizedValue
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return initials.toUpperCase();
}

function isWorkspacePresence(value: unknown): value is WorkspacePresence {
  if (!value || typeof value !== "object") {
    return false;
  }

  const presence = value as Partial<WorkspacePresence>;

  return (
    typeof presence.clientId === "string" &&
    typeof presence.userId === "string" &&
    typeof presence.userName === "string" &&
    typeof presence.tab === "string" &&
    typeof presence.mode === "string"
  );
}

function flattenPresenceState(presenceState: Record<string, unknown>, currentClientId: string) {
  const presenceByClientId = new Map<string, WorkspacePresence>();

  Object.values(presenceState).forEach((presenceItems) => {
    if (!Array.isArray(presenceItems)) {
      return;
    }

    presenceItems.forEach((presenceItem) => {
      if (!isWorkspacePresence(presenceItem) || presenceItem.clientId === currentClientId) {
        return;
      }

      presenceByClientId.set(presenceItem.clientId, presenceItem);
    });
  });

  return [...presenceByClientId.values()].sort((firstPresence, secondPresence) =>
    firstPresence.userName.localeCompare(secondPresence.userName),
  );
}

function getPresenceModeLabel(mode: WorkspacePresenceMode, language: AppLanguage) {
  switch (mode) {
    case "editing":
      return language === "en" ? "Editing" : "A editar";
    case "viewing":
      return language === "en" ? "Viewing" : "A visualizar";
    case "settings":
      return language === "en" ? "Settings" : "Definições";
    case "browsing":
      return language === "en" ? "Browsing" : "A navegar";
  }
}

function createPresenceClientId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function relationPairKey(fromArticleId: string, toArticleId: string) {
  return [fromArticleId, toArticleId].sort().join("::");
}

function unlinkedMentionKey(sourceArticleId: string, targetArticleId: string) {
  return `${sourceArticleId}->${targetArticleId}`;
}

function normalizeLinkTarget(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.(md|tex)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseWikilinkTarget(value: string) {
  return value.split("|")[0].split("#")[0].trim();
}

function extractExplicitLinkTargets(source: string) {
  const targets = new Set<string>();
  const wikilinkPattern = /\[\[([^\]\r\n]+)\]\]/g;

  for (const match of source.matchAll(wikilinkPattern)) {
    const target = parseWikilinkTarget(match[1]);

    if (target) {
      targets.add(target);
    }
  }

  return [...targets];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getWikilinkRanges(source: string) {
  const ranges: Array<{ start: number; end: number }> = [];
  const wikilinkPattern = /\[\[[^\]\r\n]+\]\]/g;

  for (const match of source.matchAll(wikilinkPattern)) {
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return ranges;
}

function isIndexInsideRanges(index: number, ranges: Array<{ start: number; end: number }>) {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function createMentionPreview(source: string, index: number, mentionLength: number) {
  const previewStart = Math.max(index - 58, 0);
  const previewEnd = Math.min(index + mentionLength + 58, source.length);
  const prefix = previewStart > 0 ? "..." : "";
  const suffix = previewEnd < source.length ? "..." : "";

  return `${prefix}${source.slice(previewStart, previewEnd).replace(/\s+/g, " ").trim()}${suffix}`;
}

function findUnlinkedTitleMentions(source: string, targetTitle: string) {
  if (normalizeLinkTarget(targetTitle).length < 3) {
    return [];
  }

  const wikilinkRanges = getWikilinkRanges(source);
  const titlePattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRegExp(targetTitle)}(?![\\p{L}\\p{N}_])`,
    "giu",
  );

  return [...source.matchAll(titlePattern)].filter(
    (match) => !isIndexInsideRanges(match.index, wikilinkRanges),
  );
}

function findUnlinkedMentions(
  workspaceArticles: WorkspaceArticle[],
  relations: WorkspaceRelation[],
  ignoredMentionKeys: string[],
): UnlinkedMention[] {
  const relationPairs = new Set(
    relations.map((relation) => relationPairKey(relation.fromArticleId, relation.toArticleId)),
  );
  const ignoredMentionKeySet = new Set(ignoredMentionKeys);
  const mentions: UnlinkedMention[] = [];

  workspaceArticles.forEach((sourceArticle) => {
    workspaceArticles.forEach((targetArticle) => {
      if (sourceArticle.id === targetArticle.id) {
        return;
      }

      const mentionKey = unlinkedMentionKey(sourceArticle.id, targetArticle.id);

      if (
        ignoredMentionKeySet.has(mentionKey) ||
        relationPairs.has(relationPairKey(sourceArticle.id, targetArticle.id))
      ) {
        return;
      }

      const matches = findUnlinkedTitleMentions(sourceArticle.source, targetArticle.title);

      if (matches.length === 0) {
        return;
      }

      mentions.push({
        id: mentionKey,
        sourceArticleId: sourceArticle.id,
        targetArticleId: targetArticle.id,
        targetTitle: targetArticle.title,
        occurrenceCount: matches.length,
        preview: createMentionPreview(sourceArticle.source, matches[0].index, targetArticle.title.length),
      });
    });
  });

  return mentions;
}

function replaceFirstUnlinkedTitleMention(source: string, targetTitle: string) {
  const firstMention = findUnlinkedTitleMentions(source, targetTitle)[0];

  if (!firstMention) {
    return source;
  }

  return `${source.slice(0, firstMention.index)}[[${targetTitle}]]${source.slice(
    firstMention.index + firstMention[0].length,
  )}`;
}

function stripExplicitWikilinksToTarget(source: string, targetTitle: string) {
  const wikilinkPattern = /\[\[([^\]\r\n]+)\]\]/g;

  return source.replace(wikilinkPattern, (fullMatch, rawTarget: string) => {
    const linkedTarget = parseWikilinkTarget(rawTarget);

    if (normalizeLinkTarget(linkedTarget) !== normalizeLinkTarget(targetTitle)) {
      return fullMatch;
    }

    const alias = rawTarget.includes("|")
      ? rawTarget.split("|").slice(1).join("|").trim()
      : "";

    return alias || linkedTarget || targetTitle;
  });
}

function createArticleTitleIndex(workspaceArticles: WorkspaceArticle[]) {
  const articleTitleIndex = new Map<string, WorkspaceArticle>();

  workspaceArticles.forEach((article) => {
    articleTitleIndex.set(normalizeLinkTarget(article.title), article);
  });

  return articleTitleIndex;
}

function validateExplicitLinkTargets(workspaceArticles: WorkspaceArticle[], language: AppLanguage = "pt") {
  const articleTitleIndex = new Map<string, WorkspaceArticle[]>();
  const validationIssues: string[] = [];
  const isEnglish = language === "en";

  workspaceArticles.forEach((article) => {
    const titleKey = normalizeLinkTarget(article.title);
    articleTitleIndex.set(titleKey, [...(articleTitleIndex.get(titleKey) ?? []), article]);
  });

  articleTitleIndex.forEach((matchingArticles) => {
    if (matchingArticles.length < 2) {
      return;
    }

    validationIssues.push(
      isEnglish
        ? `The title "${matchingArticles[0].title}" is duplicated and makes wikilinks ambiguous.`
        : `O título "${matchingArticles[0].title}" está duplicado e torna os wikilinks ambíguos.`,
    );
  });

  workspaceArticles.forEach((sourceArticle) => {
    extractExplicitLinkTargets(sourceArticle.source).forEach((targetTitle) => {
      const matchingArticles = articleTitleIndex.get(normalizeLinkTarget(targetTitle)) ?? [];

      if (matchingArticles.length === 0) {
        validationIssues.push(
          isEnglish
            ? `${sourceArticle.title} links to a missing article: [[${targetTitle}]].`
            : `${sourceArticle.title} liga para um artigo inexistente: [[${targetTitle}]].`,
        );
        return;
      }

      if (matchingArticles.length > 1) {
        validationIssues.push(
          isEnglish
            ? `${sourceArticle.title} links to an ambiguous article: [[${targetTitle}]].`
            : `${sourceArticle.title} liga para um artigo ambíguo: [[${targetTitle}]].`,
        );
        return;
      }

      if (matchingArticles[0].id === sourceArticle.id) {
        validationIssues.push(
          isEnglish
            ? `${sourceArticle.title} links to itself with [[${targetTitle}]].`
            : `${sourceArticle.title} liga para si próprio com [[${targetTitle}]].`,
        );
      }
    });
  });

  return validationIssues;
}

function countRelationsByType(relations: WorkspaceRelation[], relationType: WorkspaceRelation["relationType"]) {
  return relations.filter((relation) => relation.relationType === relationType).length;
}

function isSubmittedArticle(article: WorkspaceArticle) {
  return article.status !== "Draft";
}

function isImportedPdfArticle(article: { tags: string[] }) {
  const normalizedTags = article.tags.map((tag) => tag.toLowerCase());

  return normalizedTags.includes("pdf") && (normalizedTags.includes("importado") || normalizedTags.includes("imported"));
}

function articleUsesImageAsset(article: WorkspaceArticle, imageAsset: WorkspaceImageAsset) {
  return article.source.includes(imageAsset.storedName) || article.source.includes(imageAsset.originalName);
}

function getTitleFromPdfFileName(fileName: string, language: AppLanguage = "pt") {
  return fileName
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || (language === "en" ? "Imported PDF" : "PDF importado");
}

function getSafePdfDownloadName(title: string) {
  const safeName =
    title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "papergraph-artigo";

  return `${safeName}.pdf`;
}

function createImportedPdfSource(pdfAsset: WorkspaceImageAsset) {
  return [
    "\\documentclass[12pt]{article}",
    "\\usepackage{pdfpages}",
    "\\begin{document}",
    "\\includepdf[",
    "    pages=-,",
    "    pagecommand={\\thispagestyle{empty}}",
    `]{papergraph-images/${pdfAsset.storedName}}`,
    "\\end{document}",
  ].join("\n");
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

function calculateNextArticlePosition(workspaceArticles: WorkspaceArticle[]) {
  const totalArticles = workspaceArticles.length + 1;
  const angle = (totalArticles / Math.max(totalArticles, 6)) * Math.PI * 2;
  const radius = 18 + totalArticles * 4;

  return {
    x: clamp(50 + Math.cos(angle) * radius, 10, 90),
    y: clamp(50 + Math.sin(angle) * radius, 10, 90),
  };
}

function roundPositionValue(value: number) {
  return Math.round(clamp(value, 2, 98) * 10) / 10;
}

function normalizeArticlePositionsForArticles(
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
      x: roundPositionValue(position.x),
      y: roundPositionValue(position.y),
    };
  });

  return nextPositions;
}

function rebuildExplicitRelations(
  workspaceArticles: WorkspaceArticle[],
  relations: WorkspaceRelation[],
) {
  const manualRelations = relations.filter((relation) => relation.relationType === "manual");
  const manualPairs = new Set(
    manualRelations.map((relation) => relationPairKey(relation.fromArticleId, relation.toArticleId)),
  );
  const explicitPairs = new Set<string>();
  const articleTitleIndex = createArticleTitleIndex(workspaceArticles);
  const explicitRelations: WorkspaceRelation[] = [];

  workspaceArticles.forEach((sourceArticle) => {
    extractExplicitLinkTargets(sourceArticle.source).forEach((targetTitle) => {
      const targetArticle = articleTitleIndex.get(normalizeLinkTarget(targetTitle));

      if (!targetArticle || targetArticle.id === sourceArticle.id) {
        return;
      }

      const pairKey = relationPairKey(sourceArticle.id, targetArticle.id);

      if (manualPairs.has(pairKey) || explicitPairs.has(pairKey)) {
        return;
      }

      explicitPairs.add(pairKey);
      explicitRelations.push({
        id: `explicit-${pairKey}`,
        fromArticleId: sourceArticle.id,
        toArticleId: targetArticle.id,
        note: `Wikilink explícito em ${sourceArticle.title}: [[${targetArticle.title}]]`,
        createdAt: "source",
        relationType: "explicit",
      });
    });
  });

  return [...manualRelations, ...explicitRelations];
}

function mergeArticlePositions(
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

  return normalizeArticlePositionsForArticles(
    workspaceArticles,
    spreadOverlappingPositions(workspaceArticles, mergedPositions),
  );
}

export default function Home() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(defaultSnapshot);
  const [selectedArticleId, setSelectedArticleId] = useState(defaultSnapshot.selectedArticleId);
  const [graphSelectedArticleId, setGraphSelectedArticleId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(() => getStoredWorkspaceUiState(null).activeTab ?? "graph");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [appLanguage, setAppLanguage] = useState<AppLanguage>(() => {
    if (typeof window === "undefined") {
      return "pt";
    }

    const savedLanguage = window.localStorage.getItem("papergraph-language");

    return savedLanguage === "pt" || savedLanguage === "en" ? savedLanguage : "pt";
  });
  const [appTheme, setAppTheme] = useState<AppTheme>(() => {
    if (typeof window === "undefined") {
      return "dark";
    }

    const savedTheme = window.localStorage.getItem("papergraph-theme");

    return savedTheme === "light" ? "light" : "dark";
  });
  const [pendingEditorResubmission, setPendingEditorResubmission] = useState<PendingEditorResubmission | null>(null);
  const [pendingEditorNavigation, setPendingEditorNavigation] = useState<PendingEditorNavigation | null>(null);
  const [connectionValidationError, setConnectionValidationError] = useState<string | null>(null);
  const [dismissedUnlinkedToastKey, setDismissedUnlinkedToastKey] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("sign-in");
  const [authName, setAuthName] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState<string | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authAccessToken, setAuthAccessToken] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [accountWorkspace, setAccountWorkspace] = useState<AccountWorkspace | null>(null);
  const [accountWorkspaces, setAccountWorkspaces] = useState<AccountWorkspace[]>([]);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [isWorkspaceActionRunning, setIsWorkspaceActionRunning] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [workspaceInvites, setWorkspaceInvites] = useState<WorkspaceInvite[]>([]);
  const [pendingWorkspaceInvites, setPendingWorkspaceInvites] = useState<WorkspaceInvite[]>([]);
  const [workspaceInviteEmail, setWorkspaceInviteEmail] = useState("");
  const [workspaceInviteRole, setWorkspaceInviteRole] = useState<EditableWorkspaceMemberRole>("editor");
  const [isInviteActionRunning, setIsInviteActionRunning] = useState(false);
  const [memberActionUserId, setMemberActionUserId] = useState<string | null>(null);
  const [workspacePresence, setWorkspacePresence] = useState<WorkspacePresence[]>([]);
  const [editorSelection, setEditorSelection] = useState<{ articleId: string; end: number; start: number } | null>(
    null,
  );
  const saveRequestIdRef = useRef(0);
  const saveQueueRef = useRef(Promise.resolve());
  const isEnglish = appLanguage === "en";
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [presenceClientId] = useState(createPresenceClientId);
  const presenceChannelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const currentPresencePayloadRef = useRef<WorkspacePresence | null>(null);
  const presenceLocationKeyRef = useRef<string | null>(null);
  const presenceEnteredAtRef = useRef<string>(new Date().toISOString());

  useEffect(() => {
    window.localStorage.setItem("papergraph-language", appLanguage);
  }, [appLanguage]);

  useEffect(() => {
    window.localStorage.setItem("papergraph-theme", appTheme);
    document.documentElement.dataset.papergraphTheme = appTheme;

    return () => {
      delete document.documentElement.dataset.papergraphTheme;
    };
  }, [appTheme]);

  const applyWorkspaceSnapshot = useCallback((
    snapshot: WorkspaceSnapshot,
    workspaceId: string | null = null,
    restoreUiState = true,
  ) => {
    const storedUiState = restoreUiState ? getStoredWorkspaceUiState(workspaceId) : {};
    const storedSelectedArticle = storedUiState.selectedArticleId
      ? snapshot.articles.find((article) => article.id === storedUiState.selectedArticleId) ?? null
      : null;
    const snapshotSelectedArticle = snapshot.selectedArticleId
      ? snapshot.articles.find((article) => article.id === snapshot.selectedArticleId) ?? null
      : null;
    const selectedArticle = storedSelectedArticle ?? snapshotSelectedArticle;
    const storedGraphSelectedArticle =
      storedUiState.graphSelectedArticleId === undefined || storedUiState.graphSelectedArticleId === null
        ? null
        : snapshot.articles.find(
            (article) => article.id === storedUiState.graphSelectedArticleId && isSubmittedArticle(article),
          ) ?? null;
    const normalizedSnapshot = {
      ...snapshot,
      selectedArticleId: selectedArticle?.id ?? "",
    };

    setWorkspace(normalizedSnapshot);
    setSelectedArticleId(normalizedSnapshot.selectedArticleId);
    setGraphSelectedArticleId(storedGraphSelectedArticle?.id ?? null);
    setEditorSelection(null);

    if (restoreUiState && storedUiState.activeTab) {
      setActiveTab(storedUiState.activeTab);
    }
  }, []);

  const mirrorWorkspaceLocally = useCallback(async (snapshot: WorkspaceSnapshot) => {
    await fetch(apiPath, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(snapshot),
    });
  }, []);

  const loadCloudWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!supabase) {
        return;
      }

      setLoadError(null);

      try {
        const snapshot = await loadWorkspaceSnapshotFromSupabase(supabase, workspaceId);
        applyWorkspaceSnapshot(snapshot, workspaceId);
        await mirrorWorkspaceLocally(snapshot);
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : isEnglish
              ? "Could not load the cloud workspace."
              : "Não foi possível carregar a workspace cloud.",
        );
      }
    },
    [applyWorkspaceSnapshot, isEnglish, mirrorWorkspaceLocally, supabase],
  );

  const loadAuthProfile = useCallback(
    async (currentUser: User | null) => {
      if (!supabase || !currentUser) {
        setAuthDisplayName(null);
        return;
      }

      const fallbackDisplayName = getAuthUserFallbackDisplayName(currentUser);
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", currentUser.id)
        .maybeSingle();
      const profile = data as UserProfileRow | null;

      if (error) {
        setAuthDisplayName(fallbackDisplayName);
        setProfileNameDraft(fallbackDisplayName ?? "");
        return;
      }

      const nextDisplayName = normalizeDisplayName(profile?.display_name ?? "") || fallbackDisplayName;
      setAuthDisplayName(nextDisplayName);
      setProfileNameDraft(nextDisplayName ?? "");
    },
    [supabase],
  );

  const saveAuthProfileDisplayName = useCallback(
    async (currentUser: User, displayName: string) => {
      if (!supabase) {
        return;
      }

      const normalizedDisplayName = normalizeDisplayName(displayName);

      if (!normalizedDisplayName) {
        return;
      }

      const { error } = await supabase.from("profiles").upsert(
        {
          id: currentUser.id,
          display_name: normalizedDisplayName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

      if (error) {
        throw error;
      }

      setAuthDisplayName(normalizedDisplayName);
      setProfileNameDraft(normalizedDisplayName);
    },
    [supabase],
  );

  const loadWorkspaceCollaboration = useCallback(
    async (currentWorkspace: AccountWorkspace | null) => {
      if (!supabase) {
        setWorkspaceMembers([]);
        setWorkspaceInvites([]);
        setPendingWorkspaceInvites([]);
        setWorkspacePresence([]);
        setEditorSelection(null);
        return;
      }

      try {
        const [pendingInvites, members, invites] = await Promise.all([
          listMyPendingWorkspaceInvitesFromSupabase(supabase),
          currentWorkspace
            ? listWorkspaceMembersFromSupabase(supabase, currentWorkspace.id)
            : Promise.resolve([]),
          currentWorkspace?.role === "owner"
            ? listWorkspaceInvitesFromSupabase(supabase, currentWorkspace.id)
            : Promise.resolve([]),
        ]);

        setPendingWorkspaceInvites(pendingInvites);
        setWorkspaceMembers(members);
        setWorkspaceInvites(invites);
      } catch (error) {
        setWorkspaceMembers([]);
        setWorkspaceInvites([]);
        setPendingWorkspaceInvites([]);
        setAuthError(
          error instanceof Error
            ? error.message
            : isEnglish
              ? "Could not load workspace collaboration data."
              : "Não foi possível carregar os dados de colaboração da workspace.",
        );
      }
    },
    [isEnglish, supabase],
  );

  const syncAccountWorkspace = useCallback(
    async (currentUser: User | null, preferredWorkspaceId?: string | null) => {
      if (!supabase || !currentUser) {
        setAccountWorkspace(null);
        setAccountWorkspaces([]);
        setWorkspaceMembers([]);
        setWorkspaceInvites([]);
        setPendingWorkspaceInvites([]);
        setWorkspacePresence([]);
        setEditorSelection(null);
        return;
      }

      setAuthStatus(isEnglish ? "Preparing cloud workspace..." : "A preparar workspace cloud...");
      setAuthError(null);

      try {
        const ensuredWorkspace = await ensureUserWorkspace(supabase);
        const loadedWorkspaces = await listUserWorkspacesFromSupabase(supabase);
        const nextWorkspaces =
          ensuredWorkspace && !loadedWorkspaces.some((workspaceItem) => workspaceItem.id === ensuredWorkspace.id)
            ? [ensuredWorkspace, ...loadedWorkspaces]
            : loadedWorkspaces;
        const storedWorkspaceId = preferredWorkspaceId ?? getStoredActiveWorkspaceId();
        const nextAccountWorkspace =
          nextWorkspaces.find((workspaceItem) => workspaceItem.id === storedWorkspaceId) ??
          nextWorkspaces[0] ??
          ensuredWorkspace;

        if (!nextAccountWorkspace) {
          setAccountWorkspace(null);
          setAccountWorkspaces([]);
          await loadAuthProfile(currentUser);
          await loadWorkspaceCollaboration(null);
          setAuthStatus(isEnglish ? "Account connected." : "Conta ligada.");
          return;
        }

        setAccountWorkspaces(nextWorkspaces);
        setAccountWorkspace(nextAccountWorkspace);
        rememberActiveWorkspaceId(nextAccountWorkspace.id);
        await loadAuthProfile(currentUser);
        await loadCloudWorkspace(nextAccountWorkspace.id);
        await loadWorkspaceCollaboration(nextAccountWorkspace);
        setAuthStatus(isEnglish ? "Cloud workspace ready." : "Workspace cloud pronta.");
      } catch (error) {
        setAccountWorkspace(null);
        setAccountWorkspaces([]);
        setAuthStatus(null);
        setAuthError(
          isEnglish
            ? `Account connected, but the cloud workspace could not be prepared: ${
                error instanceof Error ? error.message : "unknown error"
              }. Run supabase/bootstrap-workspace.sql in the SQL Editor.`
            : `Conta ligada, mas não foi possível preparar a workspace cloud: ${
                error instanceof Error ? error.message : "erro desconhecido"
              }. Corre supabase/bootstrap-workspace.sql no SQL Editor.`,
        );
      }
    },
    [isEnglish, loadAuthProfile, loadCloudWorkspace, loadWorkspaceCollaboration, supabase],
  );

  useEffect(() => {
    if (!supabase) {
      return undefined;
    }

    let isMounted = true;
    const sessionCheckTimeout = window.setTimeout(() => {
      if (isMounted) {
        setIsAuthLoading(false);
      }
    }, 1800);

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!isMounted) {
          return;
        }

        window.clearTimeout(sessionCheckTimeout);
        const currentUser = data.session?.user ?? null;
        setAuthUser(currentUser);
        setAuthAccessToken(data.session?.access_token ?? null);
        setIsAuthLoading(false);

        if (currentUser) {
          void syncAccountWorkspace(currentUser);
        }
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        window.clearTimeout(sessionCheckTimeout);
        setIsAuthLoading(false);
        setAuthError(
          error instanceof Error
            ? error.message
            : isEnglish
              ? "Could not check the saved session."
              : "Não foi possível confirmar a sessão guardada.",
        );
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null;

      setAuthUser(currentUser);
      setAuthAccessToken(session?.access_token ?? null);
      setIsAuthLoading(false);

      if (currentUser) {
        void syncAccountWorkspace(currentUser);
        return;
      }

      setAccountWorkspace(null);
      setAccountWorkspaces([]);
      setWorkspaceMembers([]);
      setWorkspaceInvites([]);
      setPendingWorkspaceInvites([]);
      setWorkspacePresence([]);
      setEditorSelection(null);
      setWorkspaceInviteEmail("");
      setWorkspaceInviteRole("editor");
      rememberActiveWorkspaceId(null);
      setAuthDisplayName(null);
      setNewWorkspaceName("");
      setProfileNameDraft("");
      setAuthStatus(null);
    });

    return () => {
      isMounted = false;
      window.clearTimeout(sessionCheckTimeout);
      listener.subscription.unsubscribe();
    };
  }, [isEnglish, supabase, syncAccountWorkspace]);

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setAuthError(
        isEnglish
          ? "Supabase is not configured. Check .env.local."
          : "O Supabase não está configurado. Confirma o .env.local.",
      );
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);
    setAuthStatus(null);

    try {
      const normalizedAuthName = normalizeDisplayName(authName);

      if (authMode === "sign-up" && normalizedAuthName.length < 2) {
        throw new Error(isEnglish ? "Write your name to create the account." : "Escreve o teu nome para criar a conta.");
      }

      const credentials = {
        email: authEmail.trim(),
        password: authPassword,
      };
      const result =
        authMode === "sign-in"
          ? await supabase.auth.signInWithPassword(credentials)
          : await supabase.auth.signUp({
              ...credentials,
              options: {
                data: {
                  display_name: normalizedAuthName,
                  full_name: normalizedAuthName,
                  name: normalizedAuthName,
                },
                emailRedirectTo: window.location.origin,
              },
            });

      if (result.error) {
        throw result.error;
      }

      const nextUser = result.data.session?.user ?? null;
      setAuthUser(nextUser);
      setAuthAccessToken(result.data.session?.access_token ?? null);
      setAuthPassword("");

      if (nextUser) {
        await syncAccountWorkspace(nextUser);

        if (authMode === "sign-up") {
          await saveAuthProfileDisplayName(nextUser, normalizedAuthName);
          setAuthName("");
        }
      }

      if (authMode === "sign-up" && !result.data.session) {
        setAuthName("");
        setAuthStatus(
          isEnglish
            ? "Account created. Check your email to confirm the login."
            : "Conta criada. Confirma o login no teu email.",
        );
      }
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : isEnglish
            ? "Authentication failed."
            : "A autenticação falhou.",
      );
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleProfileNameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!authUser) {
      return;
    }

    const normalizedProfileName = normalizeDisplayName(profileNameDraft);

    if (normalizedProfileName.length < 2) {
      setAuthError(isEnglish ? "Write a display name." : "Escreve um nome visível.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);
    setAuthStatus(null);

    try {
      await saveAuthProfileDisplayName(authUser, normalizedProfileName);
      setAuthStatus(isEnglish ? "Profile name saved." : "Nome de perfil guardado.");
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : isEnglish
            ? "Could not save the profile name."
            : "Não foi possível guardar o nome de perfil.",
      );
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleSignOut() {
    if (!supabase) {
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);

    const { error } = await supabase.auth.signOut();

    if (error) {
      setAuthError(error.message);
    } else {
      setAuthUser(null);
      setAuthAccessToken(null);
      setAuthDisplayName(null);
      setAuthName("");
      setProfileNameDraft("");
      setAccountWorkspace(null);
      setAccountWorkspaces([]);
      setNewWorkspaceName("");
      setWorkspaceMembers([]);
      setWorkspaceInvites([]);
      setPendingWorkspaceInvites([]);
      setWorkspacePresence([]);
      setEditorSelection(null);
      setWorkspaceInviteEmail("");
      rememberActiveWorkspaceId(null);
      applyWorkspaceSnapshot(defaultSnapshot, null, false);
      setAuthStatus(isEnglish ? "Signed out." : "Sessão terminada.");
    }

    setIsAuthSubmitting(false);
  }

  useEffect(() => {
    if (supabase) {
      return undefined;
    }

    const controller = new AbortController();

    async function loadWorkspace() {
      try {
        const response = await fetch(apiPath, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`Workspace request failed: ${response.status}`);
        }

        const snapshot = (await response.json()) as WorkspaceSnapshot;
        applyWorkspaceSnapshot(snapshot, null);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          const savedLanguage = window.localStorage.getItem("papergraph-language");
          setLoadError(
            savedLanguage === "en"
              ? "Could not load the workspace state from the API."
              : "Não foi possível carregar o estado da área de trabalho a partir da API.",
          );
        }
      }
    }

    void loadWorkspace();

    return () => controller.abort();
  }, [applyWorkspaceSnapshot, supabase]);

  const selectedArticle = useMemo(
    () =>
      workspace.articles.find(
        (article) => article.id === selectedArticleId,
      ) ?? null,
    [selectedArticleId, workspace.articles],
  );

  const currentWorkspaceTags = workspace.workspaceTags;
  const currentGraphNodes = workspace.graphNodes;
  const currentArticles = workspace.articles;
  const canEditCurrentWorkspace =
    !accountWorkspace || accountWorkspace.role === "owner" || accountWorkspace.role === "editor" || accountWorkspace.role === "member";
  const isWorkspaceOwner = accountWorkspace?.role === "owner";
  const currentIgnoredUnlinkedMentionKeys = useMemo(
    () => workspace.ignoredUnlinkedMentionKeys,
    [workspace.ignoredUnlinkedMentionKeys],
  );
  const currentImageAssets = useMemo(
    () => workspace.imageAssets,
    [workspace.imageAssets],
  );
  const selectedArticleImageAssets = useMemo(
    () =>
      selectedArticle
        ? currentImageAssets.filter(
            (imageAsset) =>
              imageAsset.articleId === selectedArticle.id ||
              (!imageAsset.articleId && articleUsesImageAsset(selectedArticle, imageAsset)),
          )
        : [],
    [currentImageAssets, selectedArticle],
  );
  const draftArticles = useMemo(
    () => currentArticles.filter((article) => !isSubmittedArticle(article)),
    [currentArticles],
  );
  const submittedArticles = useMemo(
    () => currentArticles.filter(isSubmittedArticle),
    [currentArticles],
  );
  const selectedDraftArticle =
    draftArticles.find((article) => article.id === selectedArticleId) ?? draftArticles[0] ?? null;
  const activeGraphArticle =
    submittedArticles.find((article) => article.id === graphSelectedArticleId) ?? null;
  const currentRelations = useMemo(
    () => rebuildExplicitRelations(submittedArticles, workspace.relations),
    [submittedArticles, workspace.relations],
  );
  const currentUnlinkedMentions = useMemo(
    () => findUnlinkedMentions(submittedArticles, currentRelations, currentIgnoredUnlinkedMentionKeys),
    [currentIgnoredUnlinkedMentionKeys, currentRelations, submittedArticles],
  );
  const activeArticleUnlinkedMentions = useMemo(
    () =>
      activeGraphArticle
        ? currentUnlinkedMentions.filter((mention) => mention.sourceArticleId === activeGraphArticle.id)
        : [],
    [activeGraphArticle, currentUnlinkedMentions],
  );
  const activeUnlinkedToastKey = activeGraphArticle
    ? `${activeGraphArticle.id}:${activeArticleUnlinkedMentions.map((mention) => mention.id).join("|")}`
    : "";
  const shouldShowUnlinkedToast =
    activeTab === "graph" &&
    canEditCurrentWorkspace &&
    Boolean(activeGraphArticle) &&
    activeArticleUnlinkedMentions.length > 0 &&
    dismissedUnlinkedToastKey !== activeUnlinkedToastKey;
  const currentActivityFeed = workspace.activityFeed;
  const currentAppStats = createInitialAppStats(currentArticles, currentRelations, selectedArticle ?? undefined);
  const currentArticlePositions = useMemo(
    () => mergeArticlePositions(currentArticles, workspace.articlePositions),
    [currentArticles, workspace.articlePositions],
  );
  const hasPendingEditorResubmission =
    activeTab === "editor" && pendingEditorResubmission?.articleId === selectedArticleId;
  const selectedArticleIsImportedPdf = selectedArticle ? isImportedPdfArticle(selectedArticle) : false;
  const selectedArticleCanBeEdited =
    canEditCurrentWorkspace && selectedArticle ? !selectedArticleIsImportedPdf : false;
  const shouldUseArticleViewer = !canEditCurrentWorkspace || selectedArticleIsImportedPdf;
  const canOpenArticleWorkArea = Boolean(selectedArticle) && (shouldUseArticleViewer || selectedArticleCanBeEdited);
  const visibleAccountName = authDisplayName ?? getAuthUserFallbackDisplayName(authUser);
  const authUserId = authUser?.id ?? null;
  const authUserEmail = authUser?.email ?? null;
  const accountWorkspaceId = accountWorkspace?.id ?? null;
  const currentPresenceArticle = activeTab === "editor" && !shouldUseArticleViewer ? selectedArticle : null;
  const currentEditorSelection =
    currentPresenceArticle && editorSelection?.articleId === currentPresenceArticle.id ? editorSelection : null;
  const currentPresenceMode: WorkspacePresenceMode =
    activeTab === "editor"
      ? shouldUseArticleViewer
        ? "viewing"
        : "editing"
      : activeTab === "settings"
        ? "settings"
        : "browsing";
  const articlePresence = useMemo(
    () =>
      selectedArticle
        ? workspacePresence.filter(
            (presence) => presence.mode === "editing" && presence.articleId === selectedArticle.id,
          )
        : [],
    [selectedArticle, workspacePresence],
  );
  const workspacePresenceByUserId = useMemo(() => {
    const presenceByUserId = new Map<string, WorkspacePresence>();

    workspacePresence.forEach((presence) => {
      presenceByUserId.set(presence.userId, presence);
    });

    return presenceByUserId;
  }, [workspacePresence]);
  const workspacePresenceByArticleId = useMemo(() => {
    const presenceByArticleId: Record<string, WorkspacePresence[]> = {};

    workspacePresence.forEach((presence) => {
      if (presence.mode !== "editing" || !presence.articleId) {
        return;
      }

      presenceByArticleId[presence.articleId] = [
        ...(presenceByArticleId[presence.articleId] ?? []),
        presence,
      ];
    });

    return presenceByArticleId;
  }, [workspacePresence]);
  const onlinePresenceCount = workspacePresence.length + (authUserId && accountWorkspaceId ? 1 : 0);

  const getPresenceClientId = useCallback(() => {
    return presenceClientId;
  }, [presenceClientId]);
  const collaborationClientId = authUserId && accountWorkspaceId ? presenceClientId : undefined;
  const collaborationUserName = visibleAccountName ?? authUserEmail ?? (isEnglish ? "Collaborator" : "Colaborador");

  useEffect(() => {
    if (!supabase || !authUserId || !accountWorkspaceId) {
      presenceChannelRef.current = null;
      currentPresencePayloadRef.current = null;
      return undefined;
    }

    const clientId = getPresenceClientId();
    const channel = supabase.channel(`papergraph:workspace:${accountWorkspaceId}:presence`, {
      config: {
        presence: {
          key: clientId,
        },
      },
    });
    const syncPresence = () => {
      setWorkspacePresence(flattenPresenceState(channel.presenceState() as Record<string, unknown>, clientId));
    };

    presenceChannelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, syncPresence)
      .on("presence", { event: "join" }, syncPresence)
      .on("presence", { event: "leave" }, syncPresence)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (currentPresencePayloadRef.current) {
            void channel.track(currentPresencePayloadRef.current);
          }

          syncPresence();
        }
      });

    return () => {
      if (presenceChannelRef.current === channel) {
        presenceChannelRef.current = null;
      }

      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [accountWorkspaceId, authUserId, getPresenceClientId, supabase]);

  useEffect(() => {
    if (!authUserId || !accountWorkspaceId) {
      currentPresencePayloadRef.current = null;
      return;
    }

    const presenceLocationKey = [
      accountWorkspaceId,
      activeTab,
      currentPresenceMode,
      currentPresenceArticle?.id ?? "workspace",
    ].join(":");
    const now = new Date().toISOString();

    if (presenceLocationKeyRef.current !== presenceLocationKey) {
      presenceLocationKeyRef.current = presenceLocationKey;
      presenceEnteredAtRef.current = now;
    }

    const payload: WorkspacePresence = {
      articleId: currentPresenceArticle?.id ?? null,
      articleTitle: currentPresenceArticle?.title ?? null,
      clientId: getPresenceClientId(),
      enteredAt: presenceEnteredAtRef.current,
      email: authUserEmail,
      mode: currentPresenceMode,
      selectionEnd: currentEditorSelection?.end ?? null,
      selectionStart: currentEditorSelection?.start ?? null,
      tab: activeTab,
      updatedAt: now,
      userId: authUserId,
      userName: collaborationUserName,
    };

    currentPresencePayloadRef.current = payload;

    if (presenceChannelRef.current) {
      void presenceChannelRef.current.track(payload);
    }
  }, [
    accountWorkspaceId,
    activeTab,
    authUserEmail,
    authUserId,
    currentPresenceArticle?.id,
    currentPresenceArticle?.title,
    editorSelection?.articleId,
    currentEditorSelection?.end,
    currentEditorSelection?.start,
    currentPresenceMode,
    getPresenceClientId,
    collaborationUserName,
  ]);

  useEffect(() => {
    if (!hasPendingEditorResubmission) {
      return undefined;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasPendingEditorResubmission]);

  function getTabLabel(tab: WorkspaceTab) {
    if (appLanguage === "en") {
      switch (tab) {
        case "drafts":
          return "Drafts";
        case "editor":
          return shouldUseArticleViewer ? "View" : "Editor";
        case "graph":
          return "Graph";
        case "settings":
          return "Settings";
      }
    }

    switch (tab) {
      case "drafts":
        return "Rascunhos";
      case "editor":
        return shouldUseArticleViewer ? "Visualização" : "Editor";
      case "graph":
        return "Mapa";
      case "settings":
        return "Definições";
    }
  }

  function getTabDescription(tab: WorkspaceTab) {
    if (appLanguage === "en") {
      switch (tab) {
        case "drafts":
          return "Review drafts before submitting";
        case "editor":
          return shouldUseArticleViewer ? "Read the article PDF" : "Write LaTeX with autosave";
        case "graph":
          return "See how ideas connect";
        case "settings":
          return "Language, help and account";
      }
    }

    switch (tab) {
      case "drafts":
        return "Rever rascunhos por submeter";
      case "editor":
        return shouldUseArticleViewer ? "Ver o PDF do artigo" : "Escrever LaTeX com autosave";
      case "graph":
        return "Ver como as ideias se ligam";
      case "settings":
        return "Idioma, ajuda e conta";
    }
  }

  function getSettingsSectionLabel(section: SettingsSection) {
    if (appLanguage === "en") {
      switch (section) {
        case "general":
          return "General";
        case "workspaces":
          return "Workspaces";
        case "help":
          return "Help";
        case "account":
          return "Account";
        case "data":
          return "Data";
      }
    }

    switch (section) {
      case "general":
        return "Geral";
      case "workspaces":
        return "Workspaces";
      case "help":
        return "Ajuda";
      case "account":
        return "Conta";
      case "data":
        return "Dados";
    }
  }

  function getSettingsSectionDescription(section: SettingsSection) {
    if (appLanguage === "en") {
      switch (section) {
        case "general":
          return "Interface preferences";
        case "workspaces":
          return "Maps and collaboration";
        case "help":
          return "How PaperGraph works";
        case "account":
          return "Session and future sync";
        case "data":
          return "Workspace portability";
      }
    }

    switch (section) {
      case "general":
        return "Preferências da interface";
      case "workspaces":
        return "Mapas e colaboração";
      case "help":
        return "Como o PaperGraph funciona";
      case "account":
        return "Sessão e sincronização futura";
      case "data":
        return "Portabilidade da workspace";
    }
  }

  function getReadOnlyWorkspaceMessage() {
    return isEnglish
      ? "This workspace is read-only for your account."
      : "Esta workspace está em modo só leitura para a tua conta.";
  }

  function showReadOnlyWorkspaceError() {
    setLoadError(getReadOnlyWorkspaceMessage());
  }

  function saveWorkspace(snapshot: WorkspaceSnapshot) {
    if (!canEditCurrentWorkspace) {
      setWorkspace(snapshot);
      setLoadError(null);
      return Promise.resolve();
    }

    const saveRequestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = saveRequestId;

    const runSave = async () => {
      try {
        await mirrorWorkspaceLocally(snapshot);

        if (supabase && accountWorkspace) {
          await saveWorkspaceSnapshotToSupabase(
            supabase,
            {
              id: accountWorkspace.id,
              language: appLanguage,
            },
            snapshot,
          );
        }

        if (saveRequestId === saveRequestIdRef.current) {
          setWorkspace(snapshot);
          setLoadError(null);
        }
      } catch (error) {
        if (saveRequestId === saveRequestIdRef.current) {
          setLoadError(
            error instanceof Error
              ? error.message
              : isEnglish
                ? "Could not save the workspace."
                : "Não foi possível guardar a workspace.",
          );
        }
      }
    };

    saveQueueRef.current = saveQueueRef.current.catch(() => undefined).then(runSave);

    return saveQueueRef.current;
  }

  function completePendingEditorNavigation(navigation: PendingEditorNavigation | null) {
    if (navigation?.type === "tab") {
      activateTab(navigation.tab);
    }
  }

  function activateTab(tab: WorkspaceTab) {
    setActiveTab(tab);
    rememberWorkspaceUiState(accountWorkspaceId, { activeTab: tab });
  }

  function rememberSelectedArticle(articleId: string) {
    if (!articleId) {
      return;
    }

    rememberWorkspaceUiState(accountWorkspaceId, { selectedArticleId: articleId });
  }

  function selectGraphArticle(articleId: string | null) {
    setGraphSelectedArticleId(articleId);
    rememberWorkspaceUiState(accountWorkspaceId, { graphSelectedArticleId: articleId });
  }

  function requestTabChange(tab: WorkspaceTab) {
    if (tab === activeTab) {
      return;
    }

    if (tab === "editor" && !canOpenArticleWorkArea) {
      return;
    }

    if (hasPendingEditorResubmission) {
      setPendingEditorNavigation({ type: "tab", tab });
      return;
    }

    setConnectionValidationError(null);
    activateTab(tab);
  }

  function confirmWorkspaceChange() {
    if (!hasPendingEditorResubmission) {
      return true;
    }

    return window.confirm(
      isEnglish
        ? "You have article edits waiting to be resubmitted. Switch workspace anyway?"
        : "Tens alterações à espera de resubmissão no editor. Queres mudar de workspace na mesma?",
    );
  }

  async function switchAccountWorkspace(nextWorkspace: AccountWorkspace) {
    if (!authUser || !supabase || nextWorkspace.id === accountWorkspace?.id) {
      return;
    }

    if (!confirmWorkspaceChange()) {
      return;
    }

    setIsWorkspaceActionRunning(true);
    setAuthError(null);
    setAuthStatus(isEnglish ? "Opening workspace..." : "A abrir workspace...");

    try {
      await saveQueueRef.current.catch(() => undefined);
      setPendingEditorResubmission(null);
      setPendingEditorNavigation(null);
      setConnectionValidationError(null);
      setAccountWorkspace(nextWorkspace);
      rememberActiveWorkspaceId(nextWorkspace.id);
      await loadCloudWorkspace(nextWorkspace.id);
      await loadWorkspaceCollaboration(nextWorkspace);
      activateTab("graph");
      setAuthStatus(
        isEnglish
          ? `Workspace "${nextWorkspace.name}" opened.`
          : `Workspace "${nextWorkspace.name}" aberta.`,
      );
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : isEnglish
            ? "Could not open the workspace."
            : "Não foi possível abrir a workspace.",
      );
    } finally {
      setIsWorkspaceActionRunning(false);
    }
  }

  async function handleCreateAccountWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!authUser || !supabase) {
      setAuthError(isEnglish ? "Sign in before creating a workspace." : "Inicia sessão antes de criar uma workspace.");
      return;
    }

    if (!confirmWorkspaceChange()) {
      return;
    }

    const workspaceName = normalizeWorkspaceName(newWorkspaceName);

    if (workspaceName.length < 2) {
      setAuthError(isEnglish ? "Write a workspace name." : "Escreve um nome para a workspace.");
      return;
    }

    setIsWorkspaceActionRunning(true);
    setAuthError(null);
    setAuthStatus(isEnglish ? "Creating workspace..." : "A criar workspace...");

    try {
      await saveQueueRef.current.catch(() => undefined);
      const createdWorkspace = await createUserWorkspaceInSupabase(supabase, workspaceName);
      const refreshedWorkspaces = await listUserWorkspacesFromSupabase(supabase);
      const nextWorkspaces = refreshedWorkspaces.some((workspaceItem) => workspaceItem.id === createdWorkspace.id)
        ? refreshedWorkspaces
        : [createdWorkspace, ...refreshedWorkspaces];

      setAccountWorkspaces(nextWorkspaces);
      setAccountWorkspace(createdWorkspace);
      rememberActiveWorkspaceId(createdWorkspace.id);
      setNewWorkspaceName("");
      setPendingEditorResubmission(null);
      setPendingEditorNavigation(null);
      setConnectionValidationError(null);
      await loadCloudWorkspace(createdWorkspace.id);
      await loadWorkspaceCollaboration(createdWorkspace);
      activateTab("graph");
      setAuthStatus(
        isEnglish
          ? `Workspace "${createdWorkspace.name}" created.`
          : `Workspace "${createdWorkspace.name}" criada.`,
      );
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : isEnglish
            ? "Could not create the workspace."
            : "Não foi possível criar a workspace.",
      );
    } finally {
      setIsWorkspaceActionRunning(false);
    }
  }

  async function handleCreateWorkspaceInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!authUser || !supabase || !accountWorkspace) {
      setAuthError(isEnglish ? "Open a workspace before inviting members." : "Abre uma workspace antes de convidar membros.");
      return;
    }

    if (accountWorkspace.role !== "owner") {
      setAuthError(isEnglish ? "Only workspace owners can invite members." : "Só o dono da workspace pode convidar membros.");
      return;
    }

    const invitedEmail = workspaceInviteEmail.trim().toLowerCase();

    if (!invitedEmail) {
      setAuthError(isEnglish ? "Write the email to invite." : "Escreve o email a convidar.");
      return;
    }

    setIsInviteActionRunning(true);
    setAuthError(null);
    setAuthStatus(isEnglish ? "Sending invite..." : "A enviar convite...");

    try {
      await createWorkspaceInviteInSupabase(supabase, accountWorkspace.id, invitedEmail, workspaceInviteRole);
      setWorkspaceInviteEmail("");
      await loadWorkspaceCollaboration(accountWorkspace);
      setAuthStatus(
        isEnglish
          ? `Invite created for ${invitedEmail} as ${formatWorkspaceRole(workspaceInviteRole, appLanguage)}.`
          : `Convite criado para ${invitedEmail} como ${formatWorkspaceRole(workspaceInviteRole, appLanguage)}.`,
      );
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : isEnglish
            ? "Could not create the invite."
            : "Não foi possível criar o convite.",
      );
      setAuthStatus(null);
    } finally {
      setIsInviteActionRunning(false);
    }
  }

  async function handleWorkspaceMemberRoleChange(
    member: WorkspaceMember,
    nextRole: EditableWorkspaceMemberRole,
  ) {
    if (!supabase || !accountWorkspace || accountWorkspace.role !== "owner" || member.role === "owner") {
      return;
    }

    setMemberActionUserId(member.userId);
    setAuthError(null);
    setAuthStatus(isEnglish ? "Updating member role..." : "A atualizar cargo do membro...");

    try {
      await updateWorkspaceMemberRoleInSupabase(supabase, accountWorkspace.id, member.userId, nextRole);
      await loadWorkspaceCollaboration(accountWorkspace);
      setAuthStatus(
        isEnglish
          ? `${member.displayName ?? member.email ?? "Member"} is now ${formatWorkspaceRole(nextRole, appLanguage)}.`
          : `${member.displayName ?? member.email ?? "Membro"} agora é ${formatWorkspaceRole(nextRole, appLanguage)}.`,
      );
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : isEnglish
            ? "Could not update the member role."
            : "Não foi possível atualizar o cargo do membro.",
      );
      setAuthStatus(null);
    } finally {
      setMemberActionUserId(null);
    }
  }

  async function handleRemoveWorkspaceMember(member: WorkspaceMember) {
    if (!supabase || !accountWorkspace || accountWorkspace.role !== "owner" || member.role === "owner") {
      return;
    }

    const memberName = member.displayName ?? member.email ?? (isEnglish ? "this member" : "este membro");
    const confirmed = window.confirm(
      isEnglish
        ? `Remove ${memberName} from this workspace? They will lose access to this map.`
        : `Remover ${memberName} desta workspace? Essa pessoa perde acesso a este mapa.`,
    );

    if (!confirmed) {
      return;
    }

    setMemberActionUserId(member.userId);
    setAuthError(null);
    setAuthStatus(isEnglish ? "Removing member..." : "A remover membro...");

    try {
      await removeWorkspaceMemberFromSupabase(supabase, accountWorkspace.id, member.userId);
      await loadWorkspaceCollaboration(accountWorkspace);
      setAuthStatus(
        isEnglish
          ? `${memberName} was removed from the workspace.`
          : `${memberName} foi removido da workspace.`,
      );
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : isEnglish
            ? "Could not remove the member."
            : "Não foi possível remover o membro.",
      );
      setAuthStatus(null);
    } finally {
      setMemberActionUserId(null);
    }
  }

  async function handleAcceptWorkspaceInvite(invite: WorkspaceInvite) {
    if (!authUser || !supabase) {
      return;
    }

    if (!confirmWorkspaceChange()) {
      return;
    }

    setIsInviteActionRunning(true);
    setAuthError(null);
    setAuthStatus(isEnglish ? "Accepting invite..." : "A aceitar convite...");

    try {
      await saveQueueRef.current.catch(() => undefined);
      const acceptedWorkspace = await acceptWorkspaceInviteInSupabase(supabase, invite.id);
      await syncAccountWorkspace(authUser, acceptedWorkspace.id);
      setPendingEditorResubmission(null);
      setPendingEditorNavigation(null);
      setConnectionValidationError(null);
      activateTab("graph");
      setAuthStatus(
        isEnglish
          ? `Invite accepted. Workspace "${acceptedWorkspace.name}" opened.`
          : `Convite aceite. Workspace "${acceptedWorkspace.name}" aberta.`,
      );
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : isEnglish
            ? "Could not accept the invite."
            : "Não foi possível aceitar o convite.",
      );
      setAuthStatus(null);
    } finally {
      setIsInviteActionRunning(false);
    }
  }

  async function handleRevokeWorkspaceInvite(invite: WorkspaceInvite) {
    if (!supabase || !accountWorkspace) {
      return;
    }

    setIsInviteActionRunning(true);
    setAuthError(null);
    setAuthStatus(isEnglish ? "Revoking invite..." : "A revogar convite...");

    try {
      await revokeWorkspaceInviteInSupabase(supabase, invite.id);
      await loadWorkspaceCollaboration(accountWorkspace);
      setAuthStatus(
        isEnglish
          ? `Invite to ${invite.invitedEmail} revoked.`
          : `Convite para ${invite.invitedEmail} revogado.`,
      );
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : isEnglish
            ? "Could not revoke the invite."
            : "Não foi possível revogar o convite.",
      );
      setAuthStatus(null);
    } finally {
      setIsInviteActionRunning(false);
    }
  }

  function leaveEditorWithoutResubmitting() {
    const navigation = pendingEditorNavigation;

    setPendingEditorResubmission(null);
    setPendingEditorNavigation(null);
    setConnectionValidationError(null);
    completePendingEditorNavigation(navigation);
  }

  function resubmitEditorAndContinue() {
    if (!pendingEditorResubmission) {
      setPendingEditorNavigation(null);
      return;
    }

    const navigation = pendingEditorNavigation;
    const nextTab = navigation?.type === "tab" ? navigation.tab : "graph";

    setPendingEditorNavigation(null);
    submitArticle(pendingEditorResubmission, nextTab);
  }

  const updatePendingEditorResubmission = useCallback((nextPendingResubmission: PendingEditorResubmission | null) => {
    setPendingEditorResubmission(nextPendingResubmission);

    if (nextPendingResubmission) {
      setConnectionValidationError(null);
    }
  }, []);

  function updateSelectedArticle(articleId: string) {
    setConnectionValidationError(null);
    setPendingEditorNavigation(null);
    setSelectedArticleId(articleId);
    rememberSelectedArticle(articleId);

    void saveWorkspace({
      selectedArticleId: articleId,
      articles: currentArticles,
      relations: currentRelations,
      articlePositions: currentArticlePositions,
      graphNodes: currentGraphNodes,
      workspaceTags: currentWorkspaceTags,
      activityFeed: currentActivityFeed,
      appStats: currentAppStats,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
    });
  }

  function updateGraphSelectedArticle(articleId: string | null) {
    setConnectionValidationError(null);
    setPendingEditorNavigation(null);
    selectGraphArticle(articleId);

    if (articleId) {
      updateSelectedArticle(articleId);
    }
  }

  function createNewArticle() {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    const workspaceArticles = currentArticles;
    const nextIndex = workspaceArticles.length + 1;
    const nextArticleTitle = isEnglish
      ? `Untitled research note ${nextIndex}`
      : `Nota de investigação sem título ${nextIndex}`;
    const nextArticle: WorkspaceArticle = {
      id: crypto.randomUUID(),
      title: nextArticleTitle,
      author: "PaperGraph",
      status: "Draft",
      updatedAt: "agora",
      tags: isEnglish ? ["new", "draft"] : ["novo", "rascunho"],
      source: [
        "\\documentclass[12pt]{article}",
        "\\usepackage{amsmath, amssymb}",
        "\\begin{document}",
        `\\section{${nextArticleTitle}}`,
        isEnglish ? "Start writing your idea here." : "Começa a escrever a tua ideia aqui.",
        "\\begin{equation}",
        "x = y",
        "\\end{equation}",
        "\\end{document}",
      ].join("\n"),
    };
    const nextArticles = [...workspaceArticles, nextArticle];
    const nextArticlePositions = {
      ...currentArticlePositions,
      [nextArticle.id]: calculateNextArticlePosition(workspaceArticles),
    };

    const snapshot: WorkspaceSnapshot = {
      selectedArticleId: nextArticle.id,
      articles: nextArticles,
      relations: currentRelations,
      articlePositions: nextArticlePositions,
      graphNodes: currentGraphNodes,
      workspaceTags: currentWorkspaceTags,
      activityFeed: [
        {
          title: `${isEnglish ? "Created" : "Criado"}: ${nextArticle.title}`,
          description: isEnglish
            ? "A new draft was added to the workspace library."
            : "Foi adicionado um novo rascunho à biblioteca da área de trabalho.",
          time: "agora",
        },
        ...currentActivityFeed,
      ],
      appStats: currentAppStats,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
    };

    setWorkspace(snapshot);
    setConnectionValidationError(null);
    setPendingEditorNavigation(null);
    setSelectedArticleId(nextArticle.id);
    rememberSelectedArticle(nextArticle.id);
    selectGraphArticle(null);
    activateTab("editor");
    void saveWorkspace(snapshot);
  }

  function updateArticleDetails(nextArticle: { title: string; source: string }) {
    if (!selectedArticle) return;

    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    const updatedArticle: WorkspaceArticle = {
      ...selectedArticle,
      title: nextArticle.title,
      source: nextArticle.source,
      updatedAt: "agora",
    };

    const nextArticles = currentArticles.map((article) =>
      article.id === updatedArticle.id ? updatedArticle : article,
    );
    const nextRelations = rebuildExplicitRelations(nextArticles, currentRelations);
    const nextArticlePositions = currentArticlePositions;
    const currentExplicitLinkCount = countRelationsByType(currentRelations, "explicit");
    const nextExplicitLinkCount = countRelationsByType(nextRelations, "explicit");

    const snapshot: WorkspaceSnapshot = {
      selectedArticleId,
      articles: nextArticles,
      relations: nextRelations,
      articlePositions: nextArticlePositions,
      graphNodes: currentGraphNodes,
      workspaceTags: currentWorkspaceTags,
      activityFeed: [
        ...(nextExplicitLinkCount > currentExplicitLinkCount
          ? [
              {
                title: `${isEnglish ? "Linked from source" : "Ligado a partir do código"}: ${updatedArticle.title}`,
                description: isEnglish
                  ? "PaperGraph updated explicit wikilinks after saving the article."
                  : "O PaperGraph atualizou os wikilinks explícitos depois de guardar o artigo.",
                time: "agora",
              },
            ]
          : []),
        ...currentActivityFeed,
      ],
      appStats: currentAppStats,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
    };

    setWorkspace(snapshot);
    void saveWorkspace(snapshot);
  }

  function submitArticle(nextArticle: ArticleSubmission, nextActiveTab: WorkspaceTab = "graph") {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    const articleToSubmit = nextArticle.articleId
      ? currentArticles.find((article) => article.id === nextArticle.articleId)
      : selectedArticle;

    if (!articleToSubmit) return;

    const wasDraft = articleToSubmit.status === "Draft";
    const submittedArticle: WorkspaceArticle = {
      ...articleToSubmit,
      title: nextArticle.title,
      source: nextArticle.source,
      status: wasDraft ? "Review" : articleToSubmit.status,
      updatedAt: "agora",
    };

    const nextArticles = currentArticles.map((article) =>
      article.id === submittedArticle.id ? submittedArticle : article,
    );
    const nextSubmittedArticles = nextArticles.filter(isSubmittedArticle);
    const nextArticlePositions = {
      ...currentArticlePositions,
      [submittedArticle.id]: currentArticlePositions[submittedArticle.id] ?? calculateNextArticlePosition(nextSubmittedArticles),
    };
    const validationIssues = validateExplicitLinkTargets(nextSubmittedArticles, appLanguage);

    if (validationIssues.length > 0) {
      setConnectionValidationError(validationIssues.join(" "));
      setPendingEditorNavigation(null);
      setSelectedArticleId(submittedArticle.id);
      rememberSelectedArticle(submittedArticle.id);
      activateTab("editor");
      return;
    }

    const nextRelations = rebuildExplicitRelations(nextSubmittedArticles, currentRelations);
    const currentExplicitLinkCount = countRelationsByType(currentRelations, "explicit");
    const nextExplicitLinkCount = countRelationsByType(nextRelations, "explicit");

    const snapshot: WorkspaceSnapshot = {
      selectedArticleId: submittedArticle.id,
      articles: nextArticles,
      relations: nextRelations,
      articlePositions: nextArticlePositions,
      graphNodes: currentGraphNodes,
      workspaceTags: currentWorkspaceTags,
      activityFeed: [
        {
          title: `${wasDraft
            ? isEnglish
              ? "Submitted"
              : "Submetido"
            : isEnglish
              ? "Resubmitted"
              : "Resubmetido"}: ${submittedArticle.title}`,
          description: wasDraft
            ? isEnglish
              ? "The draft is now visible on the graph."
              : "O rascunho já está visível no mapa."
            : isEnglish
              ? "The updated article is now reflected on the graph."
              : "O artigo atualizado já está refletido no mapa.",
          time: "agora",
        },
        ...(nextExplicitLinkCount > currentExplicitLinkCount
          ? [
              {
                title: `${isEnglish ? "Linked from source" : "Ligado a partir do código"}: ${submittedArticle.title}`,
                description: isEnglish
                  ? "PaperGraph found wikilinks while indexing the submitted article."
                  : "O PaperGraph encontrou wikilinks ao indexar o artigo submetido.",
                time: "agora",
              },
            ]
          : []),
        ...currentActivityFeed,
      ],
      appStats: currentAppStats,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
    };

    setWorkspace(snapshot);
    setConnectionValidationError(null);
    setPendingEditorResubmission(null);
    setSelectedArticleId(submittedArticle.id);
    rememberSelectedArticle(submittedArticle.id);
    selectGraphArticle(submittedArticle.id);
    activateTab(nextActiveTab);
    void saveWorkspace(snapshot);
  }

  function createRelationBetweenArticles(fromArticleId: string, toArticleId: string, note?: string) {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    if (fromArticleId === toArticleId) {
      return;
    }

    const fromArticle = currentArticles.find((article) => article.id === fromArticleId);
    const targetArticle = currentArticles.find((article) => article.id === toArticleId);

    if (!fromArticle || !targetArticle) {
      return;
    }

    const relation: WorkspaceRelation = {
      id: crypto.randomUUID(),
      fromArticleId,
      toArticleId,
      note:
        note?.trim() ||
        (isEnglish
          ? `Related by shared theme: ${fromArticle.tags[0] ?? "idea"}`
          : `Relacionado por tema partilhado: ${fromArticle.tags[0] ?? "ideia"}`),
      createdAt: "agora",
      relationType: "manual",
    };

    const nextPairKey = relationPairKey(fromArticleId, toArticleId);
    const nextRelations = currentRelations.filter(
      (existingRelation) => relationPairKey(existingRelation.fromArticleId, existingRelation.toArticleId) !== nextPairKey,
    );
    const nextArticles = currentArticles;
    const nextArticlePositions = currentArticlePositions;

    const snapshot: WorkspaceSnapshot = {
      selectedArticleId: fromArticleId,
      articles: nextArticles,
      relations: [relation, ...nextRelations],
      articlePositions: nextArticlePositions,
      graphNodes: currentGraphNodes,
      workspaceTags: currentWorkspaceTags,
      activityFeed: [
        {
          title: `${isEnglish ? "Link created" : "Ligação criada"}: ${fromArticle.title} -> ${targetArticle.title}`,
          description: relation.note,
          time: "agora",
        },
        ...currentActivityFeed,
      ],
      appStats: currentAppStats,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
    };

    setWorkspace(snapshot);
    selectGraphArticle(fromArticleId);
    void saveWorkspace(snapshot);
  }

  function createWikilinkFromUnlinkedMention(mentionId: string) {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    const mention = currentUnlinkedMentions.find((currentMention) => currentMention.id === mentionId);

    if (!mention) {
      return;
    }

    const sourceArticle = currentArticles.find((article) => article.id === mention.sourceArticleId);

    if (!sourceArticle) {
      return;
    }

    const nextSource = replaceFirstUnlinkedTitleMention(sourceArticle.source, mention.targetTitle);

    if (nextSource === sourceArticle.source) {
      return;
    }

    const updatedArticle: WorkspaceArticle = {
      ...sourceArticle,
      source: nextSource,
      updatedAt: "agora",
    };
    const nextArticles = currentArticles.map((article) =>
      article.id === updatedArticle.id ? updatedArticle : article,
    );
    const nextSubmittedArticles = nextArticles.filter(isSubmittedArticle);
    const validationIssues = validateExplicitLinkTargets(nextSubmittedArticles, appLanguage);

    if (validationIssues.length > 0) {
      setConnectionValidationError(validationIssues.join(" "));
      setSelectedArticleId(updatedArticle.id);
      rememberSelectedArticle(updatedArticle.id);
      selectGraphArticle(updatedArticle.id);
      activateTab("editor");
      return;
    }

    const nextRelations = rebuildExplicitRelations(nextSubmittedArticles, currentRelations);
    const nextIgnoredUnlinkedMentionKeys = currentIgnoredUnlinkedMentionKeys.filter(
      (ignoredKey) => ignoredKey !== mention.id,
    );
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId: updatedArticle.id,
      articles: nextArticles,
      relations: nextRelations,
      articlePositions: currentArticlePositions,
      graphNodes: currentGraphNodes,
      workspaceTags: currentWorkspaceTags,
      activityFeed: [
        {
          title: `${isEnglish ? "Link created" : "Ligação criada"}: ${updatedArticle.title} -> ${mention.targetTitle}`,
          description: isEnglish
            ? "An unlinked mention was converted into a wikilink in the source."
            : "Uma menção não ligada foi convertida num wikilink no código.",
          time: "agora",
        },
        ...currentActivityFeed,
      ],
      appStats: createInitialAppStats(nextArticles, nextRelations, updatedArticle),
      ignoredUnlinkedMentionKeys: nextIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
    };

    setWorkspace(snapshot);
    setConnectionValidationError(null);
    setSelectedArticleId(updatedArticle.id);
    rememberSelectedArticle(updatedArticle.id);
    selectGraphArticle(updatedArticle.id);
    activateTab("graph");
    void saveWorkspace(snapshot);
  }

  function ignoreUnlinkedMention(mentionId: string) {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    if (currentIgnoredUnlinkedMentionKeys.includes(mentionId)) {
      return;
    }

    const nextIgnoredUnlinkedMentionKeys = [...currentIgnoredUnlinkedMentionKeys, mentionId];
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId,
      articles: currentArticles,
      relations: currentRelations,
      articlePositions: currentArticlePositions,
      graphNodes: currentGraphNodes,
      workspaceTags: currentWorkspaceTags,
      activityFeed: currentActivityFeed,
      appStats: currentAppStats,
      ignoredUnlinkedMentionKeys: nextIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
    };

    setWorkspace(snapshot);
    void saveWorkspace(snapshot);
  }

  function removeRelationBetweenArticles(
    fromArticleId: string,
    toArticleId: string,
    relationType: WorkspaceRelation["relationType"] = "manual",
  ) {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    if (fromArticleId === toArticleId) {
      return;
    }

    if (relationType === "explicit") {
      const sourceArticle = currentArticles.find((article) => article.id === fromArticleId);
      const targetArticle = currentArticles.find((article) => article.id === toArticleId);

      if (!sourceArticle || !targetArticle) {
        return;
      }

      const nextSource = stripExplicitWikilinksToTarget(sourceArticle.source, targetArticle.title);

      if (nextSource === sourceArticle.source) {
        return;
      }

      const updatedArticle: WorkspaceArticle = {
        ...sourceArticle,
        source: nextSource,
        updatedAt: "agora",
      };
      const nextArticles = currentArticles.map((article) =>
        article.id === updatedArticle.id ? updatedArticle : article,
      );
      const nextSubmittedArticles = nextArticles.filter(isSubmittedArticle);
      const nextRelations = rebuildExplicitRelations(nextSubmittedArticles, currentRelations);
      const mentionKey = unlinkedMentionKey(sourceArticle.id, targetArticle.id);
      const nextIgnoredUnlinkedMentionKeys = currentIgnoredUnlinkedMentionKeys.includes(mentionKey)
        ? currentIgnoredUnlinkedMentionKeys
        : [...currentIgnoredUnlinkedMentionKeys, mentionKey];
      const snapshot: WorkspaceSnapshot = {
        selectedArticleId: updatedArticle.id,
        articles: nextArticles,
        relations: nextRelations,
        articlePositions: currentArticlePositions,
        graphNodes: currentGraphNodes,
        workspaceTags: currentWorkspaceTags,
        activityFeed: [
          {
            title: `${isEnglish ? "Wikilink removed" : "Wikilink removido"}: ${sourceArticle.title} -> ${targetArticle.title}`,
            description: isEnglish
              ? `The wikilink [[${targetArticle.title}]] was converted back into plain text.`
              : `O wikilink [[${targetArticle.title}]] foi convertido novamente em texto simples.`,
            time: "agora",
          },
          ...currentActivityFeed,
        ],
        appStats: createInitialAppStats(nextArticles, nextRelations, updatedArticle),
        ignoredUnlinkedMentionKeys: nextIgnoredUnlinkedMentionKeys,
        imageAssets: currentImageAssets,
      };

      setWorkspace(snapshot);
      setSelectedArticleId(updatedArticle.id);
      rememberSelectedArticle(updatedArticle.id);
      selectGraphArticle(updatedArticle.id);
      void saveWorkspace(snapshot);
      return;
    }

    const relationPair = relationPairKey(fromArticleId, toArticleId);
    const removedRelation = currentRelations.find(
      (relation) =>
        relation.relationType === "manual" &&
        relationPairKey(relation.fromArticleId, relation.toArticleId) === relationPair,
    );

    if (!removedRelation) {
      return;
    }

    const fromArticle = currentArticles.find((article) => article.id === removedRelation.fromArticleId);
    const targetArticle = currentArticles.find((article) => article.id === removedRelation.toArticleId);
    const nextRelations = currentRelations.filter(
      (relation) =>
        relation.relationType !== "manual" ||
        relationPairKey(relation.fromArticleId, relation.toArticleId) !== relationPair,
    );

    const snapshot: WorkspaceSnapshot = {
      selectedArticleId,
      articles: currentArticles,
      relations: nextRelations,
      articlePositions: currentArticlePositions,
      graphNodes: currentGraphNodes,
      workspaceTags: currentWorkspaceTags,
      activityFeed: [
        {
          title: `${isEnglish ? "Link removed" : "Ligação removida"}: ${
            fromArticle?.title ?? (isEnglish ? "article" : "artigo")
          } <-> ${targetArticle?.title ?? (isEnglish ? "article" : "artigo")}`,
          description: removedRelation.note,
          time: "agora",
        },
        ...currentActivityFeed,
      ],
      appStats: currentAppStats,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
    };

    setWorkspace(snapshot);
    void saveWorkspace(snapshot);
  }

  function openArticleEditor(articleId: string) {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    const articleToEdit = currentArticles.find((article) => article.id === articleId);

    if (!articleToEdit || isImportedPdfArticle(articleToEdit)) {
      return;
    }

    selectGraphArticle(articleId);
    updateSelectedArticle(articleId);
    activateTab("editor");
  }

  function openArticleViewer(articleId: string) {
    const articleToView = currentArticles.find((article) => article.id === articleId);

    if (!articleToView) {
      return;
    }

    selectGraphArticle(articleId);
    updateSelectedArticle(articleId);
    activateTab("editor");
  }

  async function exportArticlePdf(articleId: string) {
    const articleToExport = currentArticles.find((article) => article.id === articleId);

    if (!articleToExport) {
      window.alert(
        isEnglish
          ? "Could not find the article to export."
          : "Não foi possível encontrar o artigo para exportar.",
      );
      return;
    }

    try {
      const articleImageAssets = currentImageAssets.filter(
        (imageAsset) =>
          imageAsset.articleId === articleToExport.id ||
          (!imageAsset.articleId && articleUsesImageAsset(articleToExport, imageAsset)),
      );
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authAccessToken ? { Authorization: `Bearer ${authAccessToken}` } : {}),
        },
        body: JSON.stringify({
          articleId: articleToExport.id,
          imageAssets: articleImageAssets,
          title: articleToExport.title,
          source: articleToExport.source,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          payload?.error ??
            (isEnglish
              ? `Export failed with status ${response.status}.`
              : `A exportação falhou com o estado ${response.status}.`),
        );
      }

      const pdfBlob = await response.blob();
      const downloadUrl = URL.createObjectURL(pdfBlob);
      const downloadLink = document.createElement("a");

      downloadLink.href = downloadUrl;
      downloadLink.download = getSafePdfDownloadName(articleToExport.title);
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : isEnglish
            ? "Could not export the PDF."
            : "Não foi possível exportar o PDF.",
      );
    }
  }

  async function importPdfArticle(pdfFile: File) {
    if (!canEditCurrentWorkspace) {
      throw new Error(getReadOnlyWorkspaceMessage());
    }

    const importedArticleId = crypto.randomUUID();
    const importedArticleTitle = getTitleFromPdfFileName(pdfFile.name, appLanguage);
    const formData = new FormData();

    formData.append("asset", pdfFile);
    formData.append("articleId", importedArticleId);

    const response = await fetch("/api/images", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? (isEnglish ? "Could not import the PDF." : "Não foi possível importar o PDF."));
    }

    let uploadedPdfAsset: WorkspaceImageAsset = {
      ...((await response.json()) as WorkspaceImageAsset),
      articleId: importedArticleId,
    };

    if (supabase && authUser && accountWorkspace) {
      uploadedPdfAsset = await uploadWorkspaceAssetToSupabase(supabase, accountWorkspace.id, uploadedPdfAsset, pdfFile);
    }

    const importedArticle: WorkspaceArticle = {
      id: importedArticleId,
      title: importedArticleTitle,
      author: "PaperGraph",
      status: "Published",
      updatedAt: "agora",
      tags: isEnglish ? ["pdf", "imported"] : ["pdf", "importado"],
      source: createImportedPdfSource(uploadedPdfAsset),
    };
    const nextArticles = [...currentArticles, importedArticle];
    const nextImageAssets = [
      uploadedPdfAsset,
      ...currentImageAssets.filter((imageAsset) => imageAsset.id !== uploadedPdfAsset.id),
    ];
    const nextArticlePositions = {
      ...currentArticlePositions,
      [importedArticle.id]: calculateNextArticlePosition(currentArticles),
    };
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId: importedArticle.id,
      articles: nextArticles,
      relations: currentRelations,
      articlePositions: nextArticlePositions,
      graphNodes: currentGraphNodes,
      workspaceTags: currentWorkspaceTags,
      activityFeed: [
        {
          title: `${isEnglish ? "Imported PDF" : "PDF importado"}: ${importedArticle.title}`,
          description: isEnglish
            ? "The PDF was added to the graph as a submitted article."
            : "O PDF foi adicionado ao mapa como artigo submetido.",
          time: "agora",
        },
        ...currentActivityFeed,
      ],
      appStats: currentAppStats,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: nextImageAssets,
    };

    setWorkspace(snapshot);
    setConnectionValidationError(null);
    setPendingEditorNavigation(null);
    setSelectedArticleId(importedArticle.id);
    rememberSelectedArticle(importedArticle.id);
    selectGraphArticle(importedArticle.id);
    activateTab("graph");
    void saveWorkspace(snapshot);
  }

  function addImageAsset(imageAsset: WorkspaceImageAsset) {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    const scopedImageAsset = {
      ...imageAsset,
      articleId: imageAsset.articleId ?? selectedArticleId,
    };
    const nextImageAssets = [
      scopedImageAsset,
      ...currentImageAssets.filter((currentImageAsset) => currentImageAsset.id !== scopedImageAsset.id),
    ];
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId,
      articles: currentArticles,
      relations: currentRelations,
      articlePositions: currentArticlePositions,
      graphNodes: currentGraphNodes,
      workspaceTags: currentWorkspaceTags,
      activityFeed: [
        {
          title: `${isEnglish ? "File uploaded" : "Ficheiro carregado"}: ${scopedImageAsset.originalName}`,
          description: isEnglish
            ? "The file is now available in the LaTeX editor."
            : "O ficheiro já está disponível no editor LaTeX.",
          time: "agora",
        },
        ...currentActivityFeed,
      ],
      appStats: currentAppStats,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: nextImageAssets,
    };

    setWorkspace(snapshot);
    void saveWorkspace(snapshot);
  }

  async function deleteStoredImageAssetFile(imageAsset: WorkspaceImageAsset) {
    if (imageAsset.storagePath && supabase && authUser) {
      const { error } = await supabase.storage.from(paperGraphAssetBucket).remove([imageAsset.storagePath]);

      if (error) {
        throw new Error(error.message);
      }
    }

    const storagePath = imageAsset.storagePath ?? imageAsset.storedName;
    const response = await fetch(
      `/api/images/${encodeURIComponent(imageAsset.storedName)}?path=${encodeURIComponent(storagePath)}`,
      {
      method: "DELETE",
      headers: authAccessToken
        ? {
            Authorization: `Bearer ${authAccessToken}`,
          }
        : undefined,
      },
    );

    if (!response.ok && response.status !== 404) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? (isEnglish ? "Could not remove the file." : "Não foi possível remover o ficheiro."));
    }
  }

  async function deleteImageAsset(imageAsset: WorkspaceImageAsset) {
    if (!canEditCurrentWorkspace) {
      throw new Error(getReadOnlyWorkspaceMessage());
    }

    await deleteStoredImageAssetFile(imageAsset);

    const nextImageAssets = currentImageAssets.filter((currentImageAsset) => currentImageAsset.id !== imageAsset.id);
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId,
      articles: currentArticles,
      relations: currentRelations,
      articlePositions: currentArticlePositions,
      graphNodes: currentGraphNodes,
      workspaceTags: currentWorkspaceTags,
      activityFeed: [
        {
          title: `${isEnglish ? "File removed" : "Ficheiro removido"}: ${imageAsset.originalName}`,
          description: isEnglish
            ? "The file is no longer available in this article library."
            : "O ficheiro deixou de estar disponível na biblioteca deste artigo.",
          time: "agora",
        },
        ...currentActivityFeed,
      ],
      appStats: currentAppStats,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: nextImageAssets,
    };

    setWorkspace(snapshot);
    void saveWorkspace(snapshot);
  }

  async function deleteArticle(articleId: string) {
    if (!canEditCurrentWorkspace) {
      throw new Error(getReadOnlyWorkspaceMessage());
    }

    const articleToDelete = currentArticles.find((article) => article.id === articleId);

    if (!articleToDelete) {
      throw new Error(
        isEnglish
          ? "Could not find the article to remove."
          : "Não foi possível encontrar o artigo para remover.",
      );
    }

    const articleImageAssets = currentImageAssets.filter(
      (imageAsset) =>
        imageAsset.articleId === articleId ||
        (!imageAsset.articleId && articleUsesImageAsset(articleToDelete, imageAsset)),
    );

    await Promise.all(articleImageAssets.map(deleteStoredImageAssetFile));

    const nextArticles = currentArticles.filter((article) => article.id !== articleId);
    const nextSubmittedArticles = nextArticles.filter(isSubmittedArticle);
    const nextManualRelations = currentRelations.filter(
      (relation) =>
        relation.relationType === "manual" &&
        relation.fromArticleId !== articleId &&
        relation.toArticleId !== articleId,
    );
    const nextRelations = rebuildExplicitRelations(nextSubmittedArticles, nextManualRelations);
    const nextArticlePositions = Object.fromEntries(
      Object.entries(currentArticlePositions).filter(([currentArticleId]) => currentArticleId !== articleId),
    ) as Record<string, ArticlePosition>;
    const nextIgnoredUnlinkedMentionKeys = currentIgnoredUnlinkedMentionKeys.filter((ignoredKey) => {
      const [sourceArticleId, targetArticleId] = ignoredKey.split("->");

      return sourceArticleId !== articleId && targetArticleId !== articleId;
    });
    const nextSelectedArticleId =
      selectedArticleId === articleId
        ? nextSubmittedArticles[0]?.id ?? nextArticles[0]?.id ?? ""
        : selectedArticleId;
    const nextGraphSelectedArticleId =
      graphSelectedArticleId === articleId
        ? null
        : graphSelectedArticleId;
    const nextSelectedArticle =
      nextArticles.find((article) => article.id === nextSelectedArticleId) ?? nextArticles[0] ?? undefined;
    const nextImageAssets = currentImageAssets.filter((imageAsset) => imageAsset.articleId !== articleId);
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId: nextSelectedArticleId,
      articles: nextArticles,
      relations: nextRelations,
      articlePositions: nextArticlePositions,
      graphNodes: currentGraphNodes,
      workspaceTags: currentWorkspaceTags,
      activityFeed: [
        {
          title: `${isEnglish ? "Article removed" : "Artigo removido"}: ${articleToDelete.title}`,
          description: isEnglish
            ? "The article was removed from the graph, along with its links and files."
            : "O artigo foi removido do mapa, juntamente com as ligações e ficheiros associados.",
          time: "agora",
        },
        ...currentActivityFeed,
      ],
      appStats: createInitialAppStats(nextArticles, nextRelations, nextSelectedArticle),
      ignoredUnlinkedMentionKeys: nextIgnoredUnlinkedMentionKeys,
      imageAssets: nextImageAssets,
    };

    setWorkspace(snapshot);
    setConnectionValidationError(null);
    setPendingEditorNavigation(null);
    setPendingEditorResubmission(null);
    setEditorSelection((currentSelection) =>
      currentSelection?.articleId === articleId ? null : currentSelection,
    );
    setSelectedArticleId(nextSelectedArticleId);
    rememberSelectedArticle(nextSelectedArticleId);
    selectGraphArticle(nextGraphSelectedArticleId);
    if (supabase && accountWorkspaceId) {
      void deleteArticleCollaborationStateFromSupabase(supabase, accountWorkspaceId, articleId).catch(() => undefined);
    }
    void saveWorkspace(snapshot);
  }

  function exportWorkspaceData() {
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId,
      articles: currentArticles,
      relations: currentRelations,
      articlePositions: currentArticlePositions,
      graphNodes: currentGraphNodes,
      workspaceTags: currentWorkspaceTags,
      activityFeed: currentActivityFeed,
      appStats: currentAppStats,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
    };
    const exportBlob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json",
    });
    const downloadUrl = URL.createObjectURL(exportBlob);
    const downloadLink = document.createElement("a");

    downloadLink.href = downloadUrl;
    downloadLink.download = "papergraph-workspace.json";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }

  function updateArticlePositions(nextPositions: Record<string, ArticlePosition>) {
    if (!canEditCurrentWorkspace) {
      return;
    }

    const normalizedPositions = normalizeArticlePositionsForArticles(currentArticles, nextPositions);
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId,
      articles: currentArticles,
      relations: currentRelations,
      articlePositions: normalizedPositions,
      graphNodes: currentGraphNodes,
      workspaceTags: currentWorkspaceTags,
      activityFeed: currentActivityFeed,
      appStats: currentAppStats,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
    };

    setWorkspace(snapshot);
    void saveWorkspace(snapshot);
  }

  if (!authUser) {
    return (
      <AuthLanding
        authMode={authMode}
        email={authEmail}
        name={authName}
        password={authPassword}
        error={authError}
        isLoading={isAuthLoading}
        isSubmitting={isAuthSubmitting}
        language={appLanguage}
        status={authStatus}
        supabaseConfigured={Boolean(supabase)}
        onEmailChange={setAuthEmail}
        onLanguageChange={setAppLanguage}
        onModeChange={(mode) => {
          setAuthMode(mode);
          setAuthError(null);
          setAuthStatus(null);
        }}
        onNameChange={setAuthName}
        onPasswordChange={setAuthPassword}
        onSubmit={handleAuthSubmit}
      />
    );
  }

  return (
    <div data-theme={appTheme} className="papergraph-app h-screen overflow-hidden text-[var(--foreground)]">
      <main className="flex h-full min-h-0 w-full flex-col overflow-hidden border border-transparent bg-[var(--surface)] shadow-[var(--shadow)] backdrop-blur-xl">
        <header className="flex flex-col gap-4 border-b border-[var(--border)] px-6 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="relative h-[4.4rem] w-[17rem] overflow-hidden" aria-label="PaperGraph">
            <Image
              src={paperGraphLogoText}
              alt="PaperGraph"
              priority
              className="absolute left-[-5.95rem] top-[-6.28rem] h-auto w-[28rem] max-w-none"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setSettingsSection("workspaces");
              requestTabChange("settings");
            }}
            className="w-full rounded-[18px] border border-[var(--border)] bg-white/5 px-4 py-3 text-left transition-colors hover:bg-white/10 sm:w-auto sm:min-w-[16rem]"
          >
            <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
              {isEnglish ? "Active workspace" : "Workspace ativa"}
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-white">
              {accountWorkspace?.name ?? (isEnglish ? "Local workspace" : "Workspace local")}
            </p>
            {accountWorkspace ? (
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                {onlinePresenceCount <= 1
                  ? isEnglish
                    ? "Only you online"
                    : "Só tu online"
                  : isEnglish
                    ? `${onlinePresenceCount} online now`
                    : `${onlinePresenceCount} online agora`}
              </p>
            ) : null}
          </button>
        </header>

        <div className="border-b border-[var(--border)] px-4 py-4 lg:px-5">
          <div className="grid gap-3 md:grid-cols-4">
            {tabs.map((tab) => {
              const isActive = activeTab === tab;
              const isDisabled = tab === "editor" && !canOpenArticleWorkArea;
              const disabledTitle =
                tab === "editor" && !selectedArticle
                  ? isEnglish
                    ? "Select an article first."
                    : "Seleciona primeiro um artigo."
                  : undefined;

              return (
                <button
                  key={tab}
                  type="button"
                  disabled={isDisabled}
                  title={
                    isDisabled
                      ? isEnglish
                        ? "Imported PDFs are not editable."
                        : "PDFs importados não são editáveis."
                      : undefined
                  }
                  data-disabled-title={disabledTitle}
                  onClick={() => requestTabChange(tab)}
                  className={`rounded-[24px] border px-4 py-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                    isActive
                      ? "border-[var(--accent)] bg-[rgba(142,231,255,0.14)]"
                      : "border-[var(--border)] bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                    {getTabLabel(tab)}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {getTabDescription(tab)}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {loadError ? (
          <div className="border-b border-[var(--border)] bg-red-500/10 px-6 py-3 text-sm text-red-200 lg:px-8">
            {loadError}
          </div>
        ) : null}

        <section
          className={`flex min-h-0 flex-1 flex-col ${
            activeTab === "graph" ? "p-0" : "gap-5 px-4 py-4 lg:px-6 lg:py-6"
          }`}
        >
          {activeTab === "drafts" ? (
            <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
              <aside className="flex flex-col gap-5 rounded-[28px] border border-[var(--border)] bg-[var(--surface-strong)] p-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                    {isEnglish ? "Drafts" : "Rascunhos"}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <h2 className="text-xl font-semibold text-white">
                      {isEnglish ? "Articles to submit" : "Artigos por submeter"}
                    </h2>
                    <button
                      type="button"
                      disabled={!canEditCurrentWorkspace}
                      onClick={createNewArticle}
                      className="rounded-full border border-[var(--border)] bg-white/5 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {isEnglish ? "New article" : "Novo artigo"}
                    </button>
                  </div>
                </div>

                {draftArticles.length > 0 ? (
                  <ArticleLibrary
                    articles={draftArticles}
                    language={appLanguage}
                    selectedArticleId={selectedDraftArticle?.id ?? ""}
                    onSelectArticle={updateSelectedArticle}
                  />
                ) : (
                  <div className="rounded-[24px] border border-[var(--border)] bg-black/15 p-5 text-sm leading-6 text-[var(--muted)]">
                    {isEnglish
                      ? "No drafts are waiting for submission."
                      : "Não há rascunhos à espera de submissão."}
                  </div>
                )}
              </aside>

              <aside className="flex flex-col gap-5 rounded-[28px] border border-[var(--border)] bg-[var(--surface-strong)] p-5">
                {selectedDraftArticle ? (
                  <div className="rounded-[24px] border border-[var(--border)] bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                      {isEnglish ? "Selected draft" : "Rascunho selecionado"}
                    </p>
                    <p className="mt-2 text-lg font-semibold text-white">{selectedDraftArticle.title}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{selectedDraftArticle.author}</p>
                    <button
                      type="button"
                      disabled={!canEditCurrentWorkspace}
                      onClick={() => openArticleEditor(selectedDraftArticle.id)}
                      className="mt-4 rounded-full border border-[var(--border)] bg-[var(--accent)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isEnglish ? "Edit draft" : "Editar rascunho"}
                    </button>
                  </div>
                ) : (
                  <div className="rounded-[24px] border border-[var(--border)] bg-white/5 p-4 text-sm leading-6 text-[var(--muted)]">
                    {isEnglish
                      ? "Create a new draft to start writing."
                      : "Cria um novo rascunho para começar a escrever."}
                  </div>
                )}
              </aside>
            </div>
          ) : null}

          {activeTab === "editor" ? (
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {selectedArticle && shouldUseArticleViewer ? (
                <ArticleViewerPane
                  key={`viewer-${selectedArticle.id}`}
                  article={selectedArticle}
                  articleCollaborators={articlePresence}
                  authAccessToken={authAccessToken}
                  imageAssets={selectedArticleImageAssets}
                  language={appLanguage}
                />
              ) : selectedArticle ? (
                <EditorPane
                  key={selectedArticle.id}
                  article={selectedArticle}
                  articleCollaborators={articlePresence}
                  collaborationClientId={collaborationClientId}
                  collaborationUserName={collaborationUserName}
                  onSaveArticle={updateArticleDetails}
                  onSubmitArticle={submitArticle}
                  submissionIssue={connectionValidationError}
                  language={appLanguage}
                  onSubmissionIssueClear={() => setConnectionValidationError(null)}
                  onPendingResubmissionChange={updatePendingEditorResubmission}
                  imageAssets={selectedArticleImageAssets}
                  onImageUploaded={addImageAsset}
                  onImageDeleted={deleteImageAsset}
                  onEditorSelectionChange={setEditorSelection}
                  authAccessToken={authAccessToken}
                  workspaceId={accountWorkspace?.id ?? null}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center rounded-[28px] border border-[var(--border)] bg-[var(--surface-strong)] p-6 text-center">
                  <div className="max-w-md">
                    <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                      {isEnglish ? "Editor" : "Editor"}
                    </p>
                    <h2 className="mt-2 text-xl font-semibold text-white">
                      {isEnglish ? "No article selected" : "Nenhum artigo selecionado"}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                      {isEnglish
                        ? "Create a draft to start writing in the workspace."
                        : "Cria um rascunho para começar a escrever na workspace."}
                    </p>
                    <button
                      type="button"
                      disabled={!canEditCurrentWorkspace}
                      onClick={createNewArticle}
                      className="mt-5 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isEnglish ? "New article" : "Novo artigo"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {activeTab === "graph" ? (
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
              {submittedArticles.length > 0 ? (
                <GraphPane
                  key={submittedArticles.map((article) => article.id).join("|")}
                  activeArticle={activeGraphArticle}
                  articles={submittedArticles}
                  language={appLanguage}
                  relations={currentRelations}
                  unlinkedMentions={activeArticleUnlinkedMentions}
                  articlePositions={currentArticlePositions}
                  articlePresenceByArticleId={workspacePresenceByArticleId}
                  canEdit={canEditCurrentWorkspace}
                  onSelectArticle={updateGraphSelectedArticle}
                  onArticlePositionsChange={updateArticlePositions}
                  onCreateRelation={(fromArticleId, toArticleId) => {
                    createRelationBetweenArticles(fromArticleId, toArticleId);
                  }}
                  onRemoveRelation={removeRelationBetweenArticles}
                  onCreateWikilinkFromMention={createWikilinkFromUnlinkedMention}
                  onIgnoreUnlinkedMention={ignoreUnlinkedMention}
                  onEditArticle={openArticleEditor}
                  onViewArticle={openArticleViewer}
                  onExportArticlePdf={exportArticlePdf}
                  onImportPdfArticle={importPdfArticle}
                  onDeleteArticle={deleteArticle}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center bg-[linear-gradient(180deg,rgba(4,10,16,0.95),rgba(9,19,29,0.98))] text-sm text-[var(--muted)]">
                  <div className="rounded-[24px] border border-[var(--border)] bg-black/30 p-5">
                    {isEnglish
                      ? "Submit a draft to place it on the graph."
                      : "Submete um rascunho para o colocar no mapa."}
                  </div>
                </div>
              )}

            </div>
          ) : null}

          {activeTab === "settings" ? (
            <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto lg:grid-cols-[20rem_minmax(0,1fr)]">
              <aside className="flex flex-col gap-5 rounded-[28px] border border-[var(--border)] bg-[var(--surface-strong)] p-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                    {isEnglish ? "Settings" : "Definições"}
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-white">PaperGraph</h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                    {isEnglish
                      ? "Control the local workspace, interface language and future account sync."
                      : "Controla a workspace local, o idioma da interface e a futura sincronização de conta."}
                  </p>
                </div>

                <div className="space-y-2">
                  {settingsSections.map((section) => {
                    const isActiveSection = settingsSection === section;

                    return (
                      <button
                        key={section}
                        type="button"
                        onClick={() => setSettingsSection(section)}
                        className={`w-full rounded-[18px] border p-3 text-left transition-colors ${
                          isActiveSection
                            ? "border-[var(--accent)] bg-[rgba(142,231,255,0.14)]"
                            : "border-[var(--border)] bg-black/15 hover:bg-white/8"
                        }`}
                      >
                        <p className="text-sm font-semibold text-white">{getSettingsSectionLabel(section)}</p>
                        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                          {getSettingsSectionDescription(section)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="min-h-0 overflow-y-auto rounded-[28px] border border-[var(--border)] bg-[var(--surface-strong)] p-5">
                {settingsSection === "general" ? (
                  <div className="space-y-5">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                        {isEnglish ? "General" : "Geral"}
                      </p>
                      <h2 className="mt-2 text-xl font-semibold text-white">
                        {isEnglish ? "Interface language" : "Idioma da interface"}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                        {isEnglish
                          ? "The setting is saved in this browser and updates the workspace interface."
                          : "A escolha fica guardada neste browser e atualiza a interface da workspace."}
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {(["pt", "en"] as const).map((language) => {
                        const isActiveLanguage = appLanguage === language;

                        return (
                          <button
                            key={language}
                            type="button"
                            onClick={() => setAppLanguage(language)}
                            className={`rounded-[20px] border p-4 text-left transition-colors ${
                              isActiveLanguage
                                ? "border-[var(--accent)] bg-[rgba(142,231,255,0.14)]"
                                : "border-[var(--border)] bg-black/15 hover:bg-white/8"
                            }`}
                          >
                            <p className="text-sm font-semibold text-white">
                              {language === "pt" ? "Português" : "English"}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                              {language === "pt"
                                ? "Interface principal em português."
                                : "Main interface in English."}
                            </p>
                          </button>
                        );
                      })}
                    </div>

                    <section className="space-y-3 rounded-[22px] border border-[var(--border)] bg-black/15 p-4">
                      <div>
                        <h3 className="text-base font-semibold text-white">
                          {isEnglish ? "Theme" : "Tema"}
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                          {isEnglish
                            ? "Dark is the default PaperGraph look. Light keeps the academic workspace brighter."
                            : "O escuro e o visual padrao do PaperGraph. O claro deixa a workspace academica mais luminosa."}
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        {(["dark", "light"] as const).map((theme) => {
                          const isActiveTheme = appTheme === theme;

                          return (
                            <button
                              key={theme}
                              type="button"
                              onClick={() => setAppTheme(theme)}
                              className={`rounded-[20px] border p-4 text-left transition-colors ${
                                isActiveTheme
                                  ? "border-[var(--accent)] bg-[rgba(142,231,255,0.14)]"
                                  : "border-[var(--border)] bg-white/5 hover:bg-white/8"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold text-white">
                                  {theme === "dark"
                                    ? isEnglish
                                      ? "Dark"
                                      : "Escuro"
                                    : isEnglish
                                      ? "Light"
                                      : "Claro"}
                                </p>
                                <span
                                  className={`h-4 w-4 rounded-full border ${
                                    theme === "dark"
                                      ? "border-slate-400 bg-[#0a0f14]"
                                      : "border-sky-300 bg-[#edf5fb]"
                                  }`}
                                />
                              </div>
                              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                                {theme === "dark"
                                  ? isEnglish
                                    ? "Current default theme for graph-heavy work."
                                    : "Tema padrao atual para trabalho focado no mapa."
                                  : isEnglish
                                    ? "Brighter theme for reading and review."
                                    : "Tema mais claro para leitura e revisao."}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  </div>
                ) : null}

                {settingsSection === "workspaces" ? (
                  <div className="space-y-5">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                        {isEnglish ? "Workspaces" : "Workspaces"}
                      </p>
                      <h2 className="mt-2 text-xl font-semibold text-white">
                        {isEnglish ? "Your article maps" : "Os teus mapas de artigos"}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                        {isEnglish
                          ? "Each workspace has its own articles, files, relations and graph layout. Later, invites will give access to the whole workspace."
                          : "Cada workspace tem os seus próprios artigos, ficheiros, ligações e layout do mapa. Depois, os convites vão dar acesso ao workspace inteiro."}
                      </p>
                    </div>

                    {!supabase ? (
                      <div className="rounded-[20px] border border-red-300/30 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
                        {isEnglish
                          ? "Supabase is not configured, so cloud workspaces are not available."
                          : "O Supabase não está configurado, por isso as workspaces cloud não estão disponíveis."}
                      </div>
                    ) : null}

                    {!authUser ? (
                      <div className="rounded-[20px] border border-[var(--border)] bg-black/15 p-4 text-sm leading-6 text-[var(--muted)]">
                        {isEnglish
                          ? "Sign in to create and switch between cloud workspaces."
                          : "Inicia sessão para criar e alternar entre workspaces cloud."}
                      </div>
                    ) : (
                      <>
                        <section className="rounded-[22px] border border-[var(--accent)] bg-[rgba(142,231,255,0.1)] p-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                            {isEnglish ? "Active workspace" : "Workspace ativa"}
                          </p>
                          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                            <div>
                              <h3 className="text-2xl font-semibold text-white">
                                {accountWorkspace?.name ?? "PaperGraph"}
                              </h3>
                              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                                {accountWorkspace
                                  ? isEnglish
                                    ? `Role: ${formatWorkspaceRole(accountWorkspace.role, appLanguage)}. Last update: ${formatWorkspaceDate(
                                        accountWorkspace.updatedAt,
                                        appLanguage,
                                      )}.`
                                    : `Cargo: ${formatWorkspaceRole(accountWorkspace.role, appLanguage)}. Última atualização: ${formatWorkspaceDate(
                                        accountWorkspace.updatedAt,
                                        appLanguage,
                                      )}.`
                                  : isEnglish
                                    ? "No cloud workspace is active yet."
                                    : "Ainda não há uma workspace cloud ativa."}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={isWorkspaceActionRunning || !authUser}
                              onClick={() => {
                                if (authUser) {
                                  void syncAccountWorkspace(authUser);
                                }
                              }}
                              className="rounded-full border border-[var(--border)] bg-white/10 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isEnglish ? "Refresh list" : "Atualizar lista"}
                            </button>
                          </div>
                        </section>

                        {pendingWorkspaceInvites.length > 0 ? (
                          <section className="space-y-3 rounded-[22px] border border-[var(--accent)] bg-[rgba(142,231,255,0.08)] p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                                  {isEnglish ? "Received invites" : "Convites recebidos"}
                                </p>
                                <h3 className="mt-2 text-lg font-semibold text-white">
                                  {isEnglish ? "Workspaces waiting for you" : "Workspaces à tua espera"}
                                </h3>
                              </div>
                              <span className="rounded-full border border-[var(--border)] bg-black/20 px-3 py-1 text-xs text-[var(--muted)]">
                                {pendingWorkspaceInvites.length}
                              </span>
                            </div>

                            <div className="grid gap-3 xl:grid-cols-2">
                              {pendingWorkspaceInvites.map((invite) => (
                                <article
                                  key={invite.id}
                                  className="rounded-[18px] border border-[var(--border)] bg-black/15 p-4"
                                >
                                  <p className="text-base font-semibold text-white">{invite.workspaceName}</p>
                                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                                    {isEnglish ? "Invited by" : "Convite de"}{" "}
                                    {invite.invitedByName ?? invite.invitedByEmail ?? "PaperGraph"}
                                  </p>
                                  <p className="mt-1 text-xs text-[var(--muted)]">
                                    {isEnglish ? "Expires" : "Expira"}: {formatWorkspaceDate(invite.expiresAt, appLanguage)}
                                  </p>
                                  <button
                                    type="button"
                                    disabled={isInviteActionRunning}
                                    onClick={() => {
                                      void handleAcceptWorkspaceInvite(invite);
                                    }}
                                    className="mt-4 w-full rounded-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {isEnglish ? "Accept invite" : "Aceitar convite"}
                                  </button>
                                </article>
                              ))}
                            </div>
                          </section>
                        ) : null}

                        {accountWorkspace ? (
                          <div className="grid gap-3 xl:grid-cols-2">
                            <section className="space-y-3 rounded-[22px] border border-[var(--border)] bg-black/15 p-4">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                                    {isEnglish ? "Members" : "Membros"}
                                  </p>
                                  <h3 className="mt-2 text-lg font-semibold text-white">
                                    {isEnglish ? "Current workspace" : "Workspace ativa"}
                                  </h3>
                                </div>
                                <span className="rounded-full border border-[var(--border)] bg-black/20 px-3 py-1 text-xs text-[var(--muted)]">
                                  {workspaceMembers.length}
                                </span>
                              </div>

                              {workspaceMembers.length > 0 ? (
                                <div className="max-h-[18rem] space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                  {workspaceMembers.map((member) => {
                                    const canManageMember =
                                      isWorkspaceOwner && member.role !== "owner" && member.userId !== authUser?.id;
                                    const isMemberActionRunning = memberActionUserId === member.userId;
                                    const memberPresence = workspacePresenceByUserId.get(member.userId);
                                    const isMemberOnline = member.userId === authUser?.id || Boolean(memberPresence);

                                    return (
                                      <article
                                        key={member.userId}
                                        className="rounded-[18px] border border-white/10 bg-white/[0.04] p-3.5 shadow-[0_12px_30px_rgba(0,0,0,0.12)]"
                                      >
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                          <div className="flex min-w-0 items-center gap-3">
                                            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[rgba(142,231,255,0.28)] bg-[rgba(142,231,255,0.12)] text-sm font-semibold text-[var(--accent)]">
                                              {getDisplayInitials(member.displayName ?? member.email ?? member.userId)}
                                            </div>
                                            <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-white">
                                              {member.displayName ?? member.email ?? member.userId}
                                            </p>
                                            {member.email ? (
                                              <p className="mt-1 truncate text-xs text-[var(--muted)]">{member.email}</p>
                                            ) : null}
                                            <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
                                              <span
                                                className={`inline-flex h-2 w-2 rounded-full ${
                                                  isMemberOnline ? "bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.65)]" : "bg-white/20"
                                                }`}
                                              />
                                              <span>
                                                {isMemberOnline
                                                  ? isEnglish
                                                    ? "Online"
                                                    : "Online"
                                                  : isEnglish
                                                    ? "Offline"
                                                    : "Offline"}
                                              </span>
                                              {memberPresence ? (
                                                <span className="truncate">
                                                  · {getPresenceModeLabel(memberPresence.mode, appLanguage)}
                                                  {memberPresence.articleTitle ? `: ${memberPresence.articleTitle}` : ""}
                                                </span>
                                              ) : null}
                                            </p>
                                            </div>
                                          </div>

                                          {canManageMember ? (
                                            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                                              <div className="inline-grid grid-cols-2 rounded-full border border-white/10 bg-black/20 p-1">
                                                {editableWorkspaceMemberRoles.map((role) => {
                                                  const isSelectedRole = getEditableWorkspaceMemberRole(member.role) === role;

                                                  return (
                                                    <button
                                                      key={role}
                                                      type="button"
                                                      disabled={Boolean(memberActionUserId) || isSelectedRole}
                                                      onClick={() => {
                                                        void handleWorkspaceMemberRoleChange(member, role);
                                                      }}
                                                      className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed ${
                                                        isSelectedRole
                                                          ? "bg-[var(--accent)] text-[#041016]"
                                                          : "text-[var(--muted)] hover:bg-white/8 hover:text-white disabled:opacity-60"
                                                      }`}
                                                    >
                                                      {formatWorkspaceRole(role, appLanguage)}
                                                    </button>
                                                  );
                                                })}
                                              </div>
                                              <button
                                                type="button"
                                                disabled={Boolean(memberActionUserId)}
                                                onClick={() => {
                                                  void handleRemoveWorkspaceMember(member);
                                                }}
                                                className="rounded-full border border-red-300/30 bg-red-500/15 px-3.5 py-2 text-[11px] font-semibold text-red-100 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                                              >
                                                {isMemberActionRunning
                                                  ? isEnglish
                                                    ? "Removing..."
                                                    : "A remover..."
                                                  : isEnglish
                                                    ? "Remove"
                                                    : "Remover"}
                                              </button>
                                            </div>
                                          ) : (
                                            <span className="shrink-0 rounded-full border border-[var(--border)] bg-white/5 px-3 py-1 text-[11px] font-semibold text-[var(--muted)]">
                                              {formatWorkspaceRole(member.role, appLanguage)}
                                            </span>
                                          )}
                                        </div>
                                      </article>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="rounded-[16px] border border-[var(--border)] bg-white/[0.03] p-3 text-sm leading-6 text-[var(--muted)]">
                                  {isEnglish ? "No members loaded yet." : "Ainda não há membros carregados."}
                                </p>
                              )}
                            </section>

                            <section className="space-y-3 rounded-[22px] border border-[var(--border)] bg-black/15 p-4">
                              <div>
                                <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                                  {isEnglish ? "Invites" : "Convites"}
                                </p>
                                <h3 className="mt-2 text-lg font-semibold text-white">
                                  {isEnglish ? "Invite by email" : "Convidar por email"}
                                </h3>
                                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                                  {accountWorkspace.role === "owner"
                                    ? isEnglish
                                      ? "The invite appears when that person signs in with the same email."
                                      : "O convite aparece quando essa pessoa entrar com o mesmo email."
                                    : isEnglish
                                      ? "Only the workspace owner can invite new members."
                                      : "Só o dono da workspace pode convidar novos membros."}
                                </p>
                              </div>

                              {accountWorkspace.role === "owner" ? (
                                <>
                                  <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end" onSubmit={handleCreateWorkspaceInvite}>
                                    <label className="min-w-0">
                                      <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                                        Email
                                      </span>
                                      <input
                                        type="email"
                                        value={workspaceInviteEmail}
                                        onChange={(event) => setWorkspaceInviteEmail(event.target.value)}
                                        placeholder={isEnglish ? "friend@example.com" : "amigo@example.com"}
                                        className="mt-2 w-full rounded-[16px] border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
                                      />
                                    </label>
                                    <fieldset className="min-w-0 lg:col-span-2">
                                      <legend className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                                        {isEnglish ? "Role" : "Cargo"}
                                      </legend>
                                      <div className="mt-2 inline-grid w-full grid-cols-2 rounded-full border border-white/10 bg-black/20 p-1 sm:w-auto">
                                        {editableWorkspaceMemberRoles.map((role) => {
                                          const isSelectedRole = workspaceInviteRole === role;

                                          return (
                                            <button
                                              key={role}
                                              type="button"
                                              aria-pressed={isSelectedRole}
                                              onClick={() => setWorkspaceInviteRole(role)}
                                              className={`rounded-full px-5 py-2.5 text-sm font-semibold transition-colors ${
                                                isSelectedRole
                                                  ? "bg-[var(--accent)] text-[#041016]"
                                                  : "text-[var(--muted)] hover:bg-white/8 hover:text-white"
                                              }`}
                                            >
                                              {formatWorkspaceRole(role, appLanguage)}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </fieldset>
                                    <button
                                      type="submit"
                                      disabled={isInviteActionRunning}
                                      className="self-end rounded-full border border-[var(--accent)] bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 lg:col-start-2 lg:row-start-1"
                                    >
                                      {isInviteActionRunning
                                        ? isEnglish
                                          ? "Sending..."
                                          : "A enviar..."
                                        : isEnglish
                                          ? "Invite"
                                          : "Convidar"}
                                    </button>
                                  </form>

                                  {workspaceInvites.length > 0 ? (
                                    <div className="max-h-[16rem] space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                      {workspaceInvites.map((invite) => (
                                        <article
                                          key={invite.id}
                                          className="rounded-[18px] border border-white/10 bg-white/[0.04] p-3.5 shadow-[0_12px_30px_rgba(0,0,0,0.12)]"
                                        >
                                          <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                              <p className="truncate text-sm font-semibold text-white">{invite.invitedEmail}</p>
                                              <p className="mt-1 text-xs text-[var(--muted)]">
                                                {formatInviteStatus(invite.status, appLanguage)} ·{" "}
                                                {isEnglish ? "expires" : "expira"}{" "}
                                                {formatWorkspaceDate(invite.expiresAt, appLanguage)}
                                              </p>
                                              <p className="mt-1 text-xs text-[var(--muted)]">
                                                {isEnglish ? "Role" : "Cargo"}: {formatWorkspaceRole(invite.role, appLanguage)}
                                              </p>
                                            </div>
                                            {invite.status === "pending" ? (
                                              <button
                                                type="button"
                                                disabled={isInviteActionRunning}
                                                onClick={() => {
                                                  void handleRevokeWorkspaceInvite(invite);
                                                }}
                                                className="shrink-0 rounded-full border border-red-300/30 bg-red-500/15 px-3 py-1 text-[11px] font-semibold text-red-100 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                                              >
                                                {isEnglish ? "Revoke" : "Revogar"}
                                              </button>
                                            ) : null}
                                          </div>
                                        </article>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="rounded-[16px] border border-[var(--border)] bg-white/[0.03] p-3 text-sm leading-6 text-[var(--muted)]">
                                      {isEnglish ? "No invites yet." : "Ainda não há convites."}
                                    </p>
                                  )}
                                </>
                              ) : null}
                            </section>
                          </div>
                        ) : null}

                        <form
                          className="grid gap-3 rounded-[22px] border border-[var(--border)] bg-black/15 p-4 md:grid-cols-[minmax(0,1fr)_auto]"
                          onSubmit={handleCreateAccountWorkspace}
                        >
                          <label className="min-w-0">
                            <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                              {isEnglish ? "New workspace" : "Nova workspace"}
                            </span>
                            <input
                              type="text"
                              value={newWorkspaceName}
                              onChange={(event) => setNewWorkspaceName(event.target.value)}
                              placeholder={isEnglish ? "e.g. Dissertation papers" : "ex. Artigos da dissertação"}
                              className="mt-2 w-full rounded-[16px] border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
                            />
                          </label>
                          <button
                            type="submit"
                            disabled={isWorkspaceActionRunning}
                            className="self-end rounded-full border border-[var(--accent)] bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isWorkspaceActionRunning
                              ? isEnglish
                                ? "Working..."
                                : "A processar..."
                              : isEnglish
                                ? "Create workspace"
                                : "Criar workspace"}
                          </button>
                        </form>

                        <section className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                              {isEnglish ? "Available maps" : "Mapas disponíveis"}
                            </p>
                            <span className="rounded-full border border-[var(--border)] bg-black/20 px-3 py-1 text-xs text-[var(--muted)]">
                              {accountWorkspaces.length}
                            </span>
                          </div>

                          {accountWorkspaces.length > 0 ? (
                            <div className="grid gap-3 xl:grid-cols-2">
                              {accountWorkspaces.map((workspaceItem) => {
                                const isActiveWorkspace = workspaceItem.id === accountWorkspace?.id;

                                return (
                                  <article
                                    key={workspaceItem.id}
                                    className={`rounded-[22px] border p-4 transition-colors ${
                                      isActiveWorkspace
                                        ? "border-[var(--accent)] bg-[rgba(142,231,255,0.1)]"
                                        : "border-[var(--border)] bg-black/15"
                                    }`}
                                  >
                                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                      <div className="min-w-0">
                                        <p className="truncate text-lg font-semibold text-white">{workspaceItem.name}</p>
                                        <p className="mt-2 text-sm text-[var(--muted)]">
                                          {isEnglish ? "Role" : "Cargo"}: {formatWorkspaceRole(workspaceItem.role, appLanguage)}
                                        </p>
                                        <p className="mt-1 text-xs text-[var(--muted)]">
                                          {isEnglish ? "Updated" : "Atualizada"}:{" "}
                                          {formatWorkspaceDate(workspaceItem.updatedAt, appLanguage)}
                                        </p>
                                        <p className="mt-1 truncate text-xs text-[var(--muted)]">ID: {workspaceItem.id}</p>
                                      </div>
                                      <button
                                        type="button"
                                        disabled={isWorkspaceActionRunning || isActiveWorkspace}
                                        onClick={() => {
                                          void switchAccountWorkspace(workspaceItem);
                                        }}
                                        className={`rounded-full border px-4 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                                          isActiveWorkspace
                                            ? "border-[var(--accent)] bg-[rgba(142,231,255,0.12)] text-[var(--accent)]"
                                            : "border-[var(--border)] bg-white/5 text-white hover:bg-white/10"
                                        }`}
                                      >
                                        {isActiveWorkspace
                                          ? isEnglish
                                            ? "Current"
                                            : "Atual"
                                          : isEnglish
                                            ? "Open"
                                            : "Abrir"}
                                      </button>
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="rounded-[20px] border border-[var(--border)] bg-black/15 p-4 text-sm leading-6 text-[var(--muted)]">
                              {isEnglish
                                ? "No workspaces were returned by Supabase yet. Refresh after running the bootstrap SQL."
                                : "O Supabase ainda não devolveu workspaces. Atualiza depois de correr o SQL de bootstrap."}
                            </div>
                          )}
                        </section>
                      </>
                    )}

                    {authStatus ? (
                      <p className="rounded-[18px] border border-[rgba(142,231,255,0.25)] bg-[rgba(142,231,255,0.08)] px-4 py-3 text-sm leading-6 text-[var(--accent)]">
                        {authStatus}
                      </p>
                    ) : null}

                    {authError ? (
                      <p className="rounded-[18px] border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100">
                        {authError}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {settingsSection === "help" ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                        {isEnglish ? "Help" : "Ajuda"}
                      </p>
                      <h2 className="mt-2 text-xl font-semibold text-white">
                        {isEnglish ? "Core concepts" : "Conceitos principais"}
                      </h2>
                    </div>

                    {(isEnglish
                      ? [
                          {
                            title: "Wikilinks",
                            body: "Use [[Article B]] inside LaTeX to create an explicit graph connection. Use [[Article B|visible text]] when the PDF should show only the readable alias.",
                          },
                          {
                            title: "Unlinked mentions",
                            body: "If an article mentions another article title without a wikilink, PaperGraph suggests converting that mention into a real connection.",
                          },
                          {
                            title: "Manual links",
                            body: "Manual links are graph-only relations. Select an article, click Manual link, then click the target article.",
                          },
                          {
                            title: "Uploads and imported PDFs",
                            body: "Uploads belong to the article where they were added. Imported PDFs appear on the graph, can be connected and exported, but are not editable.",
                          },
                          {
                            title: "Right click actions",
                            body: "Right click an article node to edit, export, remove relations or remove the article after confirmation.",
                          },
                        ]
                      : [
                          {
                            title: "Wikilinks",
                            body: "Usa [[Artigo B]] dentro do LaTeX para criar uma ligação explícita no mapa. Usa [[Artigo B|texto visível]] quando o PDF deve mostrar só o alias legível.",
                          },
                          {
                            title: "Menções não ligadas",
                            body: "Se um artigo mencionar o título de outro artigo sem wikilink, o PaperGraph sugere converter essa menção numa ligação real.",
                          },
                          {
                            title: "Ligações manuais",
                            body: "As ligações manuais existem só no mapa. Seleciona um artigo, clica em Ligação manual e depois clica no artigo de destino.",
                          },
                          {
                            title: "Uploads e PDFs importados",
                            body: "Os uploads pertencem ao artigo onde foram adicionados. PDFs importados aparecem no mapa, podem ser ligados e exportados, mas não são editáveis.",
                          },
                          {
                            title: "Ações com right click",
                            body: "Clica com o botão direito num node para editar, exportar, remover relações ou remover o artigo depois de confirmação.",
                          },
                        ]).map((item) => (
                      <article key={item.title} className="rounded-[20px] border border-[var(--border)] bg-black/15 p-4">
                        <h3 className="text-base font-semibold text-white">{item.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{item.body}</p>
                      </article>
                    ))}
                  </div>
                ) : null}

                {settingsSection === "account" ? (
                  <div className="space-y-5">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                        {isEnglish ? "Account" : "Conta"}
                      </p>
                      <h2 className="mt-2 text-xl font-semibold text-white">
                        {isEnglish ? "Supabase account" : "Conta Supabase"}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                        {isEnglish
                          ? "Sign in to prepare cloud workspaces backed by the Supabase database."
                          : "Inicia sessão para preparar workspaces cloud guardadas na base de dados Supabase."}
                      </p>
                    </div>

                    {!supabase ? (
                      <div className="rounded-[20px] border border-red-300/30 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
                        {isEnglish
                          ? "Supabase is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local."
                          : "O Supabase não está configurado. Confirma NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY no .env.local."}
                      </div>
                    ) : null}

                    <div className="grid gap-3 md:grid-cols-2">
                      <section className="rounded-[20px] border border-[var(--border)] bg-black/15 p-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                          {isEnglish ? "Current session" : "Sessão atual"}
                        </p>

                        {isAuthLoading ? (
                          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                            {isEnglish ? "Checking session..." : "A confirmar sessão..."}
                          </p>
                        ) : authUser ? (
                          <div className="mt-3 space-y-3">
                            <div>
                              <p className="text-base font-semibold text-white">
                                {visibleAccountName ?? (isEnglish ? "Connected account" : "Conta ligada")}
                              </p>
                              {authUser.email ? (
                                <p className="mt-1 truncate text-sm text-[var(--muted)]">{authUser.email}</p>
                              ) : null}
                              <p className="mt-1 truncate text-xs text-[var(--muted)]">{authUser.id}</p>
                            </div>

                            <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={handleProfileNameSubmit}>
                              <label className="min-w-0">
                                <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                                  {isEnglish ? "Display name" : "Nome visível"}
                                </span>
                                <input
                                  type="text"
                                  value={profileNameDraft}
                                  onChange={(event) => setProfileNameDraft(event.target.value)}
                                  minLength={2}
                                  className="mt-2 w-full rounded-[16px] border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
                                />
                              </label>
                              <button
                                type="submit"
                                disabled={isAuthSubmitting}
                                className="self-end rounded-full border border-[var(--border)] bg-white/5 px-4 py-3 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isEnglish ? "Save name" : "Guardar nome"}
                              </button>
                            </form>

                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={isAuthSubmitting || isWorkspaceActionRunning}
                                onClick={() => {
                                  if (authUser) {
                                    void syncAccountWorkspace(authUser);
                                  }
                                }}
                                className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isEnglish ? "Refresh workspace" : "Atualizar workspace"}
                              </button>
                              <button
                                type="button"
                                disabled={isAuthSubmitting}
                                onClick={() => {
                                  void handleSignOut();
                                }}
                                className="rounded-full border border-red-300/30 bg-red-500/15 px-4 py-2 text-xs font-semibold text-red-100 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isAuthSubmitting
                                  ? isEnglish
                                    ? "Signing out..."
                                    : "A sair..."
                                  : isEnglish
                                    ? "Sign out"
                                    : "Terminar sessão"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <form className="mt-3 space-y-3" onSubmit={handleAuthSubmit}>
                            <div className="grid grid-cols-2 gap-2">
                              {(["sign-in", "sign-up"] as const).map((mode) => {
                                const isActiveMode = authMode === mode;

                                return (
                                  <button
                                    key={mode}
                                    type="button"
                                    onClick={() => {
                                      setAuthMode(mode);
                                      setAuthError(null);
                                      setAuthStatus(null);
                                    }}
                                    className={`rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
                                      isActiveMode
                                        ? "border-[var(--accent)] bg-[rgba(142,231,255,0.14)] text-white"
                                        : "border-[var(--border)] bg-white/5 text-[var(--muted)] hover:bg-white/10 hover:text-white"
                                    }`}
                                  >
                                    {mode === "sign-in"
                                      ? isEnglish
                                        ? "Sign in"
                                        : "Entrar"
                                      : isEnglish
                                        ? "Create account"
                                        : "Criar conta"}
                                  </button>
                                );
                              })}
                            </div>

                            <label className="block">
                              <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                                Email
                              </span>
                              <input
                                type="email"
                                value={authEmail}
                                onChange={(event) => setAuthEmail(event.target.value)}
                                required
                                placeholder={isEnglish ? "you@example.com" : "tu@example.com"}
                                className="mt-2 w-full rounded-[16px] border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
                              />
                            </label>

                            <label className="block">
                              <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                                {isEnglish ? "Password" : "Password"}
                              </span>
                              <input
                                type="password"
                                value={authPassword}
                                onChange={(event) => setAuthPassword(event.target.value)}
                                required
                                minLength={6}
                                placeholder={isEnglish ? "At least 6 characters" : "Pelo menos 6 caracteres"}
                                className="mt-2 w-full rounded-[16px] border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
                              />
                            </label>

                            <button
                              type="submit"
                              disabled={isAuthSubmitting || !supabase}
                              className="w-full rounded-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isAuthSubmitting
                                ? isEnglish
                                  ? "Working..."
                                  : "A processar..."
                                : authMode === "sign-in"
                                  ? isEnglish
                                    ? "Sign in"
                                    : "Entrar"
                                  : isEnglish
                                    ? "Create account"
                                    : "Criar conta"}
                            </button>
                          </form>
                        )}
                      </section>

                      <section className="rounded-[20px] border border-[var(--border)] bg-black/15 p-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                          {isEnglish ? "Cloud workspace" : "Workspace cloud"}
                        </p>
                        <p className="mt-2 text-base font-semibold text-white">
                          {accountWorkspace?.name ?? "PaperGraph"}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                          {accountWorkspace
                            ? isEnglish
                              ? `Connected as ${formatWorkspaceRole(accountWorkspace.role, appLanguage)}.`
                              : `Ligada como ${formatWorkspaceRole(accountWorkspace.role, appLanguage)}.`
                            : authUser
                              ? isEnglish
                                ? "The account is connected. The cloud workspace will appear here after bootstrap."
                                : "A conta está ligada. A workspace cloud aparece aqui depois do bootstrap."
                              : isEnglish
                                ? "Sign in to create or load your cloud workspace."
                                : "Inicia sessão para criar ou carregar a tua workspace cloud."}
                        </p>

                        {accountWorkspace ? (
                          <div className="mt-4 space-y-2 text-xs text-[var(--muted)]">
                            <p>
                              <span className="font-semibold text-white">ID:</span> {accountWorkspace.id}
                            </p>
                            <p>
                              <span className="font-semibold text-white">
                                {isEnglish ? "Language" : "Idioma"}:
                              </span>{" "}
                              {accountWorkspace.language.toUpperCase()}
                            </p>
                          </div>
                        ) : null}
                      </section>
                    </div>

                    {authStatus ? (
                      <p className="rounded-[18px] border border-[rgba(142,231,255,0.25)] bg-[rgba(142,231,255,0.08)] px-4 py-3 text-sm leading-6 text-[var(--accent)]">
                        {authStatus}
                      </p>
                    ) : null}

                    {authError ? (
                      <p className="rounded-[18px] border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100">
                        {authError}
                      </p>
                    ) : null}

                    <p className="rounded-[18px] border border-[var(--border)] bg-white/[0.03] px-4 py-3 text-sm leading-6 text-[var(--muted)]">
                      {isEnglish
                        ? "When this account is connected, articles, relations, graph layout and uploaded files are synced to Supabase. Files are also mirrored locally for compilation."
                        : "Quando esta conta está ligada, artigos, relações, layout do mapa e ficheiros carregados sincronizam com o Supabase. Os ficheiros também ficam espelhados localmente para a compilação."}
                    </p>
                  </div>
                ) : null}

                {settingsSection === "data" ? (
                  <div className="space-y-5">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                        {isEnglish ? "Data" : "Dados"}
                      </p>
                      <h2 className="mt-2 text-xl font-semibold text-white">
                        {isEnglish ? "Workspace snapshot" : "Snapshot da workspace"}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                        {isEnglish
                          ? "Export a JSON backup while the account system is not connected."
                          : "Exporta um backup JSON enquanto o sistema de contas ainda não está ligado."}
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        { label: isEnglish ? "Articles" : "Artigos", value: currentArticles.length },
                        { label: isEnglish ? "Submitted" : "Submetidos", value: submittedArticles.length },
                        { label: isEnglish ? "Relations" : "Ligações", value: currentRelations.length },
                        { label: isEnglish ? "Files" : "Ficheiros", value: currentImageAssets.length },
                      ].map((item) => (
                        <div key={item.label} className="rounded-[18px] border border-[var(--border)] bg-black/15 p-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{item.label}</p>
                          <p className="mt-2 text-2xl font-semibold text-white">{item.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={exportWorkspaceData}
                        className="rounded-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[#041016] transition-transform hover:-translate-y-0.5"
                      >
                        {isEnglish ? "Export workspace" : "Exportar workspace"}
                      </button>
                      <button
                        type="button"
                        disabled
                        className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-3 text-sm font-semibold text-white opacity-50"
                      >
                        {isEnglish ? "Import workspace soon" : "Importar workspace em breve"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}
        </section>
      </main>

      {shouldShowUnlinkedToast && activeGraphArticle ? (
        <div className="fixed right-6 top-6 z-[120] flex w-[min(24rem,calc(100%_-_3rem))] items-stretch overflow-hidden rounded-[22px] border border-[rgba(142,231,255,0.36)] bg-[rgba(9,19,29,0.92)] shadow-[0_20px_55px_rgba(0,0,0,0.35)] backdrop-blur-xl [animation:papergraph-toast-in_220ms_ease-out]">
          <button
            type="button"
            onClick={() => {
              activateTab("graph");
              selectGraphArticle(activeGraphArticle.id);
              setDismissedUnlinkedToastKey(activeUnlinkedToastKey);
            }}
            className="min-w-0 flex-1 px-4 py-3 text-left"
          >
            <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--accent)]">
              {isEnglish ? "Unlinked mentions" : "Menções não ligadas"}
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              {activeArticleUnlinkedMentions.length}{" "}
              {activeArticleUnlinkedMentions.length === 1
                ? isEnglish
                  ? "possible connection found"
                  : "possível conexão encontrada"
                : isEnglish
                  ? "possible connections found"
                  : "possíveis conexões encontradas"}
            </p>
            <p className="mt-1 truncate text-xs text-[var(--muted)]">
              {isEnglish ? "In" : "Em"} {activeGraphArticle.title}
            </p>
          </button>
          <button
            type="button"
            aria-label={isEnglish ? "Close unlinked mentions notification" : "Fechar notificação de menções não ligadas"}
            onClick={() => setDismissedUnlinkedToastKey(activeUnlinkedToastKey)}
            className="border-l border-[var(--border)] px-3 text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-white/8 hover:text-white"
          >
            ×
          </button>
        </div>
      ) : null}

      {pendingEditorNavigation && pendingEditorResubmission ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pending-resubmission-title"
            className="w-full max-w-md rounded-[24px] border border-[var(--border)] bg-[rgba(9,19,29,0.96)] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.45)]"
          >
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
              {isEnglish ? "Pending changes" : "Alterações pendentes"}
            </p>
            <h2 id="pending-resubmission-title" className="mt-2 text-xl font-semibold text-white">
              {isEnglish ? "Leave without resubmitting?" : "Sair sem resubmeter?"}
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              {isEnglish
                ? "The changes made to this article have not been applied to the graph yet."
                : "As mudanças feitas neste artigo ainda não foram aplicadas ao mapa."}
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={leaveEditorWithoutResubmitting}
                className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                {isEnglish ? "Leave without resubmitting" : "Sair sem resubmeter"}
              </button>
              <button
                type="button"
                onClick={resubmitEditorAndContinue}
                className="rounded-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[#041016] transition-transform hover:-translate-y-0.5"
              >
                {isEnglish ? "Resubmit article" : "Resubmeter artigo"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
