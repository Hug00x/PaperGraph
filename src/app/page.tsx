"use client";

import { ArticleLibrary } from "@/components/article-library";
import { EditorPane } from "@/components/editor-pane";
import { GraphPane } from "@/components/graph-pane";
import paperGraphLogoText from "@/imagens/PapergraghTexto.png";
import type { AppLanguage } from "@/lib/portuguese-labels";
import {
  createInitialActivityFeed,
  createInitialAppStats,
  articles,
  articlePositions as seedArticlePositions,
  type ArticlePosition,
  graphNodes,
  type UnlinkedMention,
  type WorkspaceSnapshot,
  type WorkspaceArticle,
  type WorkspaceImageAsset,
  type WorkspaceRelation,
  workspaceTags,
} from "@/lib/workspace-data";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

const apiPath = "/api/workspace";
const tabs = ["drafts", "editor", "graph", "settings"] as const;
const settingsSections = ["general", "help", "account", "data"] as const;
type WorkspaceTab = (typeof tabs)[number];
type SettingsSection = (typeof settingsSections)[number];
type PendingEditorResubmission = { articleId: string; title: string; source: string };
type PendingEditorNavigation = { type: "tab"; tab: WorkspaceTab };
type ArticleSubmission = { articleId?: string; title: string; source: string };

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
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
    const existingPosition = seedArticlePositions[article.id];

    if (existingPosition) {
      fallbackPositions[article.id] = existingPosition;
      return;
    }

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
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState(articles[0].id);
  const [graphSelectedArticleId, setGraphSelectedArticleId] = useState<string | null>(articles[0].id);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("graph");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [appLanguage, setAppLanguage] = useState<AppLanguage>(() => {
    if (typeof window === "undefined") {
      return "pt";
    }

    const savedLanguage = window.localStorage.getItem("papergraph-language");

    return savedLanguage === "pt" || savedLanguage === "en" ? savedLanguage : "pt";
  });
  const [pendingEditorResubmission, setPendingEditorResubmission] = useState<PendingEditorResubmission | null>(null);
  const [pendingEditorNavigation, setPendingEditorNavigation] = useState<PendingEditorNavigation | null>(null);
  const [connectionValidationError, setConnectionValidationError] = useState<string | null>(null);
  const [dismissedUnlinkedToastKey, setDismissedUnlinkedToastKey] = useState<string | null>(null);
  const saveRequestIdRef = useRef(0);
  const saveQueueRef = useRef(Promise.resolve());
  const isEnglish = appLanguage === "en";

  useEffect(() => {
    window.localStorage.setItem("papergraph-language", appLanguage);
  }, [appLanguage]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadWorkspace() {
      try {
        const response = await fetch(apiPath, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`Workspace request failed: ${response.status}`);
        }

        const snapshot = (await response.json()) as WorkspaceSnapshot;
        setWorkspace(snapshot);
        setSelectedArticleId(snapshot.selectedArticleId);
        setGraphSelectedArticleId(snapshot.selectedArticleId);
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
  }, []);

  const selectedArticle = useMemo(
    () =>
      (workspace?.articles ?? articles).find(
        (article) => article.id === selectedArticleId,
      ) ?? (workspace?.articles ?? articles)[0],
    [selectedArticleId, workspace],
  );

  const currentWorkspaceTags = workspace?.workspaceTags ?? workspaceTags;
  const currentGraphNodes = workspace?.graphNodes ?? graphNodes;
  const currentArticles = workspace?.articles ?? articles;
  const currentIgnoredUnlinkedMentionKeys = useMemo(
    () => workspace?.ignoredUnlinkedMentionKeys ?? [],
    [workspace?.ignoredUnlinkedMentionKeys],
  );
  const currentImageAssets = useMemo(
    () => workspace?.imageAssets ?? [],
    [workspace?.imageAssets],
  );
  const selectedArticleImageAssets = useMemo(
    () =>
      currentImageAssets.filter(
        (imageAsset) =>
          imageAsset.articleId === selectedArticle.id ||
          (!imageAsset.articleId && articleUsesImageAsset(selectedArticle, imageAsset)),
      ),
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
    () => rebuildExplicitRelations(submittedArticles, workspace?.relations ?? []),
    [submittedArticles, workspace?.relations],
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
    Boolean(activeGraphArticle) &&
    activeArticleUnlinkedMentions.length > 0 &&
    dismissedUnlinkedToastKey !== activeUnlinkedToastKey;
  const currentActivityFeed = workspace?.activityFeed ?? createInitialActivityFeed(currentArticles, currentRelations);
  const currentAppStats = createInitialAppStats(currentArticles, currentRelations, selectedArticle);
  const currentArticlePositions = useMemo(
    () => mergeArticlePositions(currentArticles, workspace?.articlePositions),
    [currentArticles, workspace?.articlePositions],
  );
  const hasPendingEditorResubmission =
    activeTab === "editor" && pendingEditorResubmission?.articleId === selectedArticleId;
  const selectedArticleCanBeEdited = !isImportedPdfArticle(selectedArticle);
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
          return "Editor";
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
        return "Editor";
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
          return "Write LaTeX with autosave";
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
        return "Escrever LaTeX com autosave";
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
      case "help":
        return "Como o PaperGraph funciona";
      case "account":
        return "Sessão e sincronização futura";
      case "data":
        return "Portabilidade da workspace";
    }
  }

  function saveWorkspace(snapshot: WorkspaceSnapshot) {
    const saveRequestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = saveRequestId;

    const runSave = async () => {
      try {
        const response = await fetch(apiPath, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(snapshot),
        });

        if (!response.ok) {
          throw new Error(`Workspace save failed: ${response.status}`);
        }

        const savedSnapshot = (await response.json()) as WorkspaceSnapshot;

        if (saveRequestId === saveRequestIdRef.current) {
          setWorkspace(savedSnapshot);
          setLoadError(null);
        }
      } catch {
        if (saveRequestId === saveRequestIdRef.current) {
          setLoadError(
            isEnglish
              ? "Could not save the workspace state through the API."
              : "Não foi possível guardar o estado da área de trabalho na API.",
          );
        }
      }
    };

    saveQueueRef.current = saveQueueRef.current.catch(() => undefined).then(runSave);

    return saveQueueRef.current;
  }

  function completePendingEditorNavigation(navigation: PendingEditorNavigation | null) {
    if (navigation?.type === "tab") {
      setActiveTab(navigation.tab);
    }
  }

  function requestTabChange(tab: WorkspaceTab) {
    if (tab === activeTab) {
      return;
    }

    if (tab === "editor" && !selectedArticleCanBeEdited) {
      return;
    }

    if (hasPendingEditorResubmission) {
      setPendingEditorNavigation({ type: "tab", tab });
      return;
    }

    setConnectionValidationError(null);
    setActiveTab(tab);
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

  function updatePendingEditorResubmission(nextPendingResubmission: PendingEditorResubmission | null) {
    setPendingEditorResubmission(nextPendingResubmission);

    if (nextPendingResubmission) {
      setConnectionValidationError(null);
    }
  }

  function updateSelectedArticle(articleId: string) {
    setConnectionValidationError(null);
    setPendingEditorNavigation(null);
    setSelectedArticleId(articleId);

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
    setGraphSelectedArticleId(articleId);

    if (articleId) {
      updateSelectedArticle(articleId);
    }
  }

  function createNewArticle() {
    const workspaceArticles = currentArticles;
    const nextIndex = workspaceArticles.length + 1;
    const nextArticleTitle = isEnglish
      ? `Untitled research note ${nextIndex}`
      : `Nota de investigação sem título ${nextIndex}`;
    const nextArticle: WorkspaceArticle = {
      id: `art-${String(nextIndex).padStart(3, "0")}`,
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
    setGraphSelectedArticleId(null);
    setActiveTab("editor");
    void saveWorkspace(snapshot);
  }

  function updateArticleDetails(nextArticle: { title: string; source: string }) {
    if (!selectedArticle) return;

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
      setActiveTab("editor");
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
    setGraphSelectedArticleId(submittedArticle.id);
    setActiveTab(nextActiveTab);
    void saveWorkspace(snapshot);
  }

  function createRelationBetweenArticles(fromArticleId: string, toArticleId: string, note?: string) {
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
    setGraphSelectedArticleId(fromArticleId);
    void saveWorkspace(snapshot);
  }

  function createWikilinkFromUnlinkedMention(mentionId: string) {
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
      setGraphSelectedArticleId(updatedArticle.id);
      setActiveTab("editor");
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
    setGraphSelectedArticleId(updatedArticle.id);
    setActiveTab("graph");
    void saveWorkspace(snapshot);
  }

  function ignoreUnlinkedMention(mentionId: string) {
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
      setGraphSelectedArticleId(updatedArticle.id);
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
    const articleToEdit = currentArticles.find((article) => article.id === articleId);

    if (!articleToEdit || isImportedPdfArticle(articleToEdit)) {
      return;
    }

    setGraphSelectedArticleId(articleId);
    updateSelectedArticle(articleId);
    setActiveTab("editor");
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
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          articleId: articleToExport.id,
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
    const importedArticleId = `art-${crypto.randomUUID()}`;
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

    const uploadedPdfAsset = {
      ...((await response.json()) as WorkspaceImageAsset),
      articleId: importedArticleId,
    };
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
    setGraphSelectedArticleId(importedArticle.id);
    setActiveTab("graph");
    void saveWorkspace(snapshot);
  }

  function addImageAsset(imageAsset: WorkspaceImageAsset) {
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
    const response = await fetch(`/api/images/${encodeURIComponent(imageAsset.storedName)}`, {
      method: "DELETE",
    });

    if (!response.ok && response.status !== 404) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? (isEnglish ? "Could not remove the file." : "Não foi possível remover o ficheiro."));
    }
  }

  async function deleteImageAsset(imageAsset: WorkspaceImageAsset) {
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
    const articleToDelete = currentArticles.find((article) => article.id === articleId);

    if (!articleToDelete) {
      throw new Error(
        isEnglish
          ? "Could not find the article to remove."
          : "Não foi possível encontrar o artigo para remover.",
      );
    }

    if (currentArticles.length <= 1) {
      throw new Error(
        isEnglish
          ? "You cannot remove the last article in the workspace."
          : "Não podes remover o último artigo da área de trabalho.",
      );
    }

    const articleImageAssets = currentImageAssets.filter((imageAsset) => imageAsset.articleId === articleId);

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
        ? nextSubmittedArticles[0]?.id ?? nextArticles[0].id
        : selectedArticleId;
    const nextGraphSelectedArticleId =
      graphSelectedArticleId === articleId
        ? nextSubmittedArticles[0]?.id ?? null
        : graphSelectedArticleId;
    const nextSelectedArticle =
      nextArticles.find((article) => article.id === nextSelectedArticleId) ?? nextArticles[0];
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
    setSelectedArticleId(nextSelectedArticleId);
    setGraphSelectedArticleId(nextGraphSelectedArticleId);
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

  return (
    <div className="h-screen overflow-hidden text-[var(--foreground)]">
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
        </header>

        <div className="border-b border-[var(--border)] px-4 py-4 lg:px-5">
          <div className="grid gap-3 md:grid-cols-4">
            {tabs.map((tab) => {
              const isActive = activeTab === tab;
              const isDisabled = tab === "editor" && !selectedArticleCanBeEdited;

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
                      onClick={createNewArticle}
                      className="rounded-full border border-[var(--border)] bg-white/5 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/10"
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
                      onClick={() => openArticleEditor(selectedDraftArticle.id)}
                      className="mt-4 rounded-full border border-[var(--border)] bg-[var(--accent)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#041016] transition-transform hover:-translate-y-0.5"
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
              <EditorPane
                key={selectedArticle.id}
                article={selectedArticle}
                onSaveArticle={updateArticleDetails}
                onSubmitArticle={submitArticle}
                submissionIssue={connectionValidationError}
                language={appLanguage}
                onSubmissionIssueClear={() => setConnectionValidationError(null)}
                onPendingResubmissionChange={updatePendingEditorResubmission}
                imageAssets={selectedArticleImageAssets}
                onImageUploaded={addImageAsset}
                onImageDeleted={deleteImageAsset}
              />
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
                  onSelectArticle={updateGraphSelectedArticle}
                  onArticlePositionsChange={updateArticlePositions}
                  onCreateRelation={(fromArticleId, toArticleId) => {
                    createRelationBetweenArticles(fromArticleId, toArticleId);
                  }}
                  onRemoveRelation={removeRelationBetweenArticles}
                  onCreateWikilinkFromMention={createWikilinkFromUnlinkedMention}
                  onIgnoreUnlinkedMention={ignoreUnlinkedMention}
                  onEditArticle={openArticleEditor}
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
                        {isEnglish ? "Local session for now" : "Sessão local por agora"}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                        {isEnglish
                          ? "The current workspace runs locally. This area is ready for external auth and database-backed sync."
                          : "A workspace atual corre localmente. Esta zona fica preparada para autenticação externa e sincronização com base de dados."}
                      </p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-[20px] border border-[var(--border)] bg-black/15 p-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                          {isEnglish ? "Current session" : "Sessão atual"}
                        </p>
                        <p className="mt-2 text-base font-semibold text-white">
                          {isEnglish ? "Local workspace" : "Workspace local"}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                          {isEnglish
                            ? "No account is connected yet."
                            : "Ainda não há conta ligada."}
                        </p>
                      </div>

                      <div className="rounded-[20px] border border-[var(--border)] bg-black/15 p-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                          {isEnglish ? "Future backend" : "Backend futuro"}
                        </p>
                        <p className="mt-2 text-base font-semibold text-white">
                          {isEnglish ? "External database sync" : "Sincronização com base de dados externa"}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                          {isEnglish
                            ? "Later, articles, assets and relations can be scoped by account/workspace id."
                            : "Mais tarde, artigos, ficheiros e relações podem ficar associados a um user/workspace id."}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled
                        className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-3 text-sm font-semibold text-white opacity-50"
                      >
                        {isEnglish ? "Switch account soon" : "Trocar conta em breve"}
                      </button>
                      <button
                        type="button"
                        disabled
                        className="rounded-full border border-[var(--accent)] bg-[rgba(142,231,255,0.14)] px-4 py-3 text-sm font-semibold text-[var(--accent)] opacity-50"
                      >
                        {isEnglish ? "Connect backend soon" : "Ligar backend em breve"}
                      </button>
                    </div>
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
              setActiveTab("graph");
              setGraphSelectedArticleId(activeGraphArticle.id);
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
