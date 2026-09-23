"use client";

import { type ChangeEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  getArticleStatusLabel,
  getArticleTagLabel,
  getRelationNoteLabel,
  type AppLanguage,
} from "@/lib/portuguese-labels";
import Image from "next/image";
import darkFilterIcon from "@/imagens/dark_filter.png";
import lightFilterIcon from "@/imagens/white_filter.png";
import { getFriendlyErrorMessage } from "@/lib/friendly-errors";
import type { ArticlePosition, UnlinkedMention, WorkspaceArticle, WorkspaceRelation } from "@/lib/workspace-data";
import { RecommendationsPanel } from "@/components/recommendations-panel";
import type { RecommendedPaper } from "@/lib/academic/discovery/types";

type GraphPaneProps = {
  workspaceId: string;
  accessToken: string;
  onAddRecommendation: (paper: RecommendedPaper, signal: AbortSignal) => Promise<void>;
  activeArticle: WorkspaceArticle | null;
  articles: WorkspaceArticle[];
  language: AppLanguage;
  relations: WorkspaceRelation[];
  unlinkedMentions: UnlinkedMention[];
  articlePositions: Record<string, ArticlePosition>;
  articlePresenceByArticleId?: Record<
    string,
    Array<{
      mode: "editing" | "viewing" | "browsing" | "settings";
      userId: string;
      userName: string;
    }>
  >;
  canEdit: boolean;
  academicRelationStatus?: string | null;
  isAcademicRelationsRunning?: boolean;
  onSelectArticle: (articleId: string | null) => void;
  onArticlePositionsChange: (positions: Record<string, ArticlePosition>) => void;
  onCreateRelation: (fromArticleId: string, toArticleId: string) => void;
  onRemoveRelation: (
    fromArticleId: string,
    toArticleId: string,
    relationType: WorkspaceRelation["relationType"],
  ) => void;
  onCreateWikilinkFromMention: (mentionId: string) => void;
  onIgnoreUnlinkedMention: (mentionId: string) => void;
  onEditArticle: (articleId: string) => void;
  onViewArticle: (articleId: string) => void;
  onExportArticlePdf: (articleId: string) => void | Promise<void>;
  onImportPdfArticle: (file: File) => void | Promise<void>;
  onDeleteArticle: (articleId: string) => void | Promise<void>;
  onRefreshAcademicRelations?: () => void | Promise<void>;
};

type ArticleRelationEntry = {
  relation: WorkspaceRelation;
  article: WorkspaceArticle;
};

const graphRelationFilterTypes = ["manual", "explicit", "citation", "semantic"] as const;
type GraphRelationFilterType = (typeof graphRelationFilterTypes)[number];

function isGraphRelationFilterType(
  relationType: WorkspaceRelation["relationType"],
): relationType is GraphRelationFilterType {
  return graphRelationFilterTypes.includes(relationType as GraphRelationFilterType);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function relationPairKey(fromArticleId: string, toArticleId: string) {
  return [fromArticleId, toArticleId].sort().join("::");
}

function defaultArticlePosition(articleIndex: number) {
  const angle = (articleIndex / 8) * Math.PI * 2;
  const radius = 28;

  return {
    x: clamp(50 + Math.cos(angle) * radius, 8, 92),
    y: clamp(50 + Math.sin(angle) * radius, 8, 92),
  };
}

function getArticleInitials(title: string) {
  const words = title
    .replace(/[^a-zA-Z0-9À-ÿ\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase() || "PG";
}

function getRelationTypeLabel(relationType: WorkspaceRelation["relationType"], language: AppLanguage) {
  switch (relationType) {
    case "manual":
      return "Manual";
    case "explicit":
      return "Wikilink";
    case "citation":
      return language === "en" ? "Citation" : "Cita\u00e7\u00e3o";
    case "semantic":
      return language === "en" ? "Semantic" : "Sem\u00e2ntica";
  }
}

function getRelationBadgeClass(relationType: WorkspaceRelation["relationType"]) {
  if (relationType === "manual") {
    return "border-[rgba(142,231,255,0.5)] bg-[rgba(142,231,255,0.16)] text-[var(--accent)]";
  }

  if (relationType === "explicit") {
    return "border-white/20 bg-white/10 text-white/80";
  }

  if (relationType === "citation") {
    return "border-emerald-200/30 bg-emerald-300/10 text-emerald-100";
  }

  if (relationType === "semantic") {
    return "border-violet-200/30 bg-violet-300/10 text-violet-100";
  }

  return "border-amber-200/25 bg-amber-300/10 text-amber-100";
}

function getPresenceModeLabel(
  mode: "editing" | "viewing" | "browsing" | "settings",
  language: AppLanguage,
) {
  switch (mode) {
    case "editing":
      return language === "en" ? "editing" : "a editar";
    case "viewing":
      return language === "en" ? "viewing" : "a visualizar";
    case "settings":
      return language === "en" ? "in settings" : "nas definições";
    case "browsing":
      return language === "en" ? "browsing" : "a navegar";
  }
}

function isImportedPdfArticle(article: WorkspaceArticle) {
  const normalizedTags = article.tags.map((tag) => tag.toLowerCase());

  return (
    article.source.includes("\\includepdf") ||
    (normalizedTags.includes("pdf") && (normalizedTags.includes("importado") || normalizedTags.includes("imported")))
  );
}

function getVisibleArticleTags(article: WorkspaceArticle) {
  if (!isImportedPdfArticle(article)) {
    return article.tags;
  }

  return article.tags.filter((tag) => tag.toLowerCase() !== "pdf");
}

export function GraphPane({
  activeArticle,
  articles,
  language,
  relations,
  unlinkedMentions,
  articlePositions,
  articlePresenceByArticleId = {},
  canEdit,
  academicRelationStatus = null,
  isAcademicRelationsRunning = false,
  onSelectArticle,
  onArticlePositionsChange,
  onCreateRelation,
  onRemoveRelation,
  onCreateWikilinkFromMention,
  onIgnoreUnlinkedMention,
  onEditArticle,
  onViewArticle,
  onExportArticlePdf,
  onImportPdfArticle,
  onDeleteArticle,
  onRefreshAcademicRelations,
  workspaceId, accessToken, onAddRecommendation,
}: GraphPaneProps) {
  const isEnglish = language === "en";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pdfImportInputRef = useRef<HTMLInputElement | null>(null);
  const [draftPositions, setDraftPositions] = useState<Record<string, ArticlePosition> | null>(null);
  const [draggingArticleId, setDraggingArticleId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [activeRelationFilters, setActiveRelationFilters] = useState<Set<GraphRelationFilterType>>(
    () => new Set(graphRelationFilterTypes),
  );
  const [appTheme, setAppTheme] = useState<"dark" | "light">(() =>
    typeof document !== "undefined" && document.documentElement.dataset.papergraphTheme === "light"
      ? "light"
      : "dark",
  );
  const [manualConnectionSourceId, setManualConnectionSourceId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ articleId: string; x: number; y: number } | null>(null);
  const [librarySearch, setLibrarySearch] = useState("");
  const [isImportingPdf, setIsImportingPdf] = useState(false);
  const [importPdfError, setImportPdfError] = useState<string | null>(null);
  const [deleteCandidateArticleId, setDeleteCandidateArticleId] = useState<string | null>(null);
  const [isDeletingArticle, setIsDeletingArticle] = useState(false);
  const [deleteArticleError, setDeleteArticleError] = useState<string | null>(null);
  const positionsRef = useRef(articlePositions);
  const viewportRef = useRef(viewport);
  const hasAutoCenteredRef = useRef(false);
  const onArticlePositionsChangeRef = useRef(onArticlePositionsChange);
  const panStartRef = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ clientX: number; clientY: number; started: boolean } | null>(null);
  const viewportAnimationRef = useRef<number | null>(null);

  useEffect(() => {
    positionsRef.current = articlePositions;
  }, [articlePositions]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    onArticlePositionsChangeRef.current = onArticlePositionsChange;
  }, [onArticlePositionsChange]);

  const worldSize = 3000;

  useEffect(() => {
    if (typeof document === "undefined") return;

    const el = document.documentElement;
    const update = () => setAppTheme(el.dataset.papergraphTheme === "light" ? "light" : "dark");

    // initial
    update();

    const obs = new MutationObserver(() => update());
    obs.observe(el, { attributes: true, attributeFilter: ["data-papergraph-theme"] });

    return () => obs.disconnect();
  }, []);

  const stopViewportAnimation = useCallback(() => {
    if (viewportAnimationRef.current === null) {
      return;
    }

    window.cancelAnimationFrame(viewportAnimationRef.current);
    viewportAnimationRef.current = null;
  }, []);

  const animateViewportTo = useCallback((targetViewport: { x: number; y: number; scale: number }) => {
    stopViewportAnimation();

    const startViewport = viewportRef.current;
    const startedAt = performance.now();
    const durationMs = 680;

    const animate = (timestamp: number) => {
      const progress = clamp((timestamp - startedAt) / durationMs, 0, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const nextViewport = {
        x: startViewport.x + (targetViewport.x - startViewport.x) * easedProgress,
        y: startViewport.y + (targetViewport.y - startViewport.y) * easedProgress,
        scale: startViewport.scale + (targetViewport.scale - startViewport.scale) * easedProgress,
      };

      viewportRef.current = nextViewport;
      setViewport(nextViewport);

      if (progress < 1) {
        viewportAnimationRef.current = window.requestAnimationFrame(animate);
        return;
      }

      viewportAnimationRef.current = null;
    };

    viewportAnimationRef.current = window.requestAnimationFrame(animate);
  }, [stopViewportAnimation]);

  useEffect(() => stopViewportAnimation, [stopViewportAnimation]);

  const displayedPositions = useMemo(() => {
    const nextPositions: Record<string, ArticlePosition> = {
      ...(draftPositions ?? articlePositions),
    };

    articles.forEach((article, index) => {
      if (!nextPositions[article.id]) {
        nextPositions[article.id] = defaultArticlePosition(index);
      }
    });

    return nextPositions;
  }, [articlePositions, articles, draftPositions]);

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    const updateContainerSize = () => {
      setContainerSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    updateContainerSize();

    const observer = new ResizeObserver(updateContainerSize);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  const centerViewportOnNodes = useCallback((positions: Record<string, ArticlePosition>) => {
    const container = containerRef.current;
    const containerBounds = container?.getBoundingClientRect();
    const entries = articles
      .map((article) => positions[article.id])
      .filter((position): position is ArticlePosition => Boolean(position))
      .map((position) => ({
        x: (position.x / 100) * worldSize,
        y: (position.y / 100) * worldSize,
      }));

    if (entries.length === 0) {
      return { x: 0, y: 0, scale: 1 };
    }

    const minX = Math.min(...entries.map((position) => position.x));
    const maxX = Math.max(...entries.map((position) => position.x));
    const minY = Math.min(...entries.map((position) => position.y));
    const maxY = Math.max(...entries.map((position) => position.y));
    const graphWidth = Math.max(maxX - minX, 520);
    const graphHeight = Math.max(maxY - minY, 360);
    const availableWidth = Math.max((containerBounds?.width ?? 960) - 560, 420);
    const availableHeight = Math.max((containerBounds?.height ?? 640) - 260, 360);
    const nextScale = clamp(
      Math.min(availableWidth / graphWidth, availableHeight / graphHeight, 1),
      0.16,
      1,
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const inspectorOffset = (containerBounds?.width ?? 0) > 960 ? 120 : 0;

    return {
      x: -(centerX - worldSize / 2) * nextScale + inspectorOffset,
      y: -(centerY - worldSize / 2) * nextScale,
      scale: nextScale,
    };
  }, [articles, worldSize]);

  const centerViewportOnArticle = useCallback((articleId: string) => {
    const position = displayedPositions[articleId];

    if (!position) {
      return;
    }

    const worldX = (position.x / 100) * worldSize;
    const worldY = (position.y / 100) * worldSize;
    const currentViewport = viewportRef.current;

    animateViewportTo({
      ...currentViewport,
      x: -(worldX - worldSize / 2) * currentViewport.scale,
      y: -(worldY - worldSize / 2) * currentViewport.scale,
    });
  }, [animateViewportTo, displayedPositions, worldSize]);

  useLayoutEffect(() => {
    if (hasAutoCenteredRef.current) {
      return;
    }

    if (articles.length === 0) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      setViewport(centerViewportOnNodes(displayedPositions));
      hasAutoCenteredRef.current = true;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [articles.length, centerViewportOnNodes, displayedPositions]);

  const manualConnectionSource = articles.find((article) => article.id === manualConnectionSourceId) ?? null;
  const activeManualConnectionSourceId = manualConnectionSource?.id ?? null;
  const articleById = useMemo(
    () => new Map(articles.map((article) => [article.id, article])),
    [articles],
  );
  const visibleRelations = useMemo(
    () =>
      relations.filter((relation) =>
        isGraphRelationFilterType(relation.relationType) &&
        activeRelationFilters.has(relation.relationType),
      ),
    [activeRelationFilters, relations],
  );
  const filteredLibraryArticles = useMemo(() => {
    const normalizedSearch = librarySearch.trim().toLowerCase();

    return articles.filter((article) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        [article.title, article.author, article.status, getArticleStatusLabel(article.status, language), ...article.tags]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);

      return matchesSearch;
    });
  }, [articles, language, librarySearch]);
  const activeOutgoingRelations = useMemo(
    () => {
      if (!activeArticle) {
        return [];
      }

      return visibleRelations
        .filter((relation) => relation.fromArticleId === activeArticle.id)
        .map((relation) => ({
          relation,
          article: articleById.get(relation.toArticleId),
        }))
        .filter(
          (entry): entry is ArticleRelationEntry =>
            Boolean(entry.article),
        );
    },
    [activeArticle, articleById, visibleRelations],
  );
  const activeIncomingRelations = useMemo(
    () => {
      if (!activeArticle) {
        return [];
      }

      return visibleRelations
        .filter(
          (relation) =>
            relation.toArticleId === activeArticle.id &&
            relation.fromArticleId !== activeArticle.id,
        )
        .map((relation) => ({
          relation,
          article: articleById.get(relation.fromArticleId),
        }))
        .filter(
          (entry): entry is ArticleRelationEntry =>
            Boolean(entry.article),
        );
    },
    [activeArticle, articleById, visibleRelations],
  );
  const activeRelationCount = activeIncomingRelations.length + activeOutgoingRelations.length;
  const activeArticlePresence = activeArticle ? articlePresenceByArticleId[activeArticle.id] ?? [] : [];

  const screenPositions = useMemo(() => {
    const nextScreenPositions: Record<string, { x: number; y: number }> = {};

    articles.forEach((article) => {
      const position = displayedPositions[article.id];

      if (!position) {
        return;
      }

      nextScreenPositions[article.id] = {
        x: containerSize.width / 2 + viewport.x + ((position.x / 100) * worldSize - worldSize / 2) * viewport.scale,
        y: containerSize.height / 2 + viewport.y + ((position.y / 100) * worldSize - worldSize / 2) * viewport.scale,
      };
    });

    return nextScreenPositions;
  }, [articles, containerSize.height, containerSize.width, displayedPositions, viewport, worldSize]);

  const relationEntries = useMemo(
    () =>
      visibleRelations
        .map((relation) => {
          const fromPosition = screenPositions[relation.fromArticleId];
          const toPosition = screenPositions[relation.toArticleId];

          if (!fromPosition || !toPosition) {
            return null;
          }

          return {
            relation,
            key: `${relation.id}-${relationPairKey(relation.fromArticleId, relation.toArticleId)}`,
            fromPosition,
            toPosition,
          };
        })
        .filter(
          (
            entry,
          ): entry is {
            relation: WorkspaceRelation;
            key: string;
            fromPosition: { x: number; y: number };
            toPosition: { x: number; y: number };
          } => Boolean(entry),
        ),
    [screenPositions, visibleRelations],
  );

  const contextMenuRemovableRelations = useMemo(() => {
    if (!contextMenu || !canEdit) {
      return [];
    }

    const removableRelations = visibleRelations.filter(
      (relation) =>
        relation.relationType === "manual" ||
        relation.relationType === "explicit" ||
        relation.relationType === "citation" ||
        relation.relationType === "semantic",
    );

    if (activeArticle && contextMenu.articleId !== activeArticle.id) {
      const contextPairKey = relationPairKey(activeArticle.id, contextMenu.articleId);
      const activePairRelation = removableRelations.find(
        (relation) => relationPairKey(relation.fromArticleId, relation.toArticleId) === contextPairKey,
      );

      return activePairRelation ? [activePairRelation] : [];
    }

    return removableRelations.filter(
      (relation) =>
        relation.fromArticleId === contextMenu.articleId ||
        relation.toArticleId === contextMenu.articleId,
    );
  }, [activeArticle, canEdit, contextMenu, visibleRelations]);
  const contextMenuArticle = contextMenu ? articleById.get(contextMenu.articleId) ?? null : null;
  const canEditContextMenuArticle = canEdit && contextMenuArticle ? !isImportedPdfArticle(contextMenuArticle) : false;
  const canEditActiveArticle = canEdit && activeArticle ? !isImportedPdfArticle(activeArticle) : false;
  const deleteCandidateArticle = deleteCandidateArticleId
    ? articleById.get(deleteCandidateArticleId) ?? null
    : null;

  async function confirmArticleDelete() {
    if (!deleteCandidateArticleId) {
      return;
    }

    if (!canEdit) {
      setDeleteArticleError(
        isEnglish
          ? "This workspace is read-only for your account."
          : "Esta workspace está em modo só leitura para a tua conta.",
      );
      return;
    }

    setIsDeletingArticle(true);
    setDeleteArticleError(null);

    try {
      await onDeleteArticle(deleteCandidateArticleId);

      if (manualConnectionSourceId === deleteCandidateArticleId) {
        setManualConnectionSourceId(null);
      }

      setDeleteCandidateArticleId(null);
    } catch (error) {
      setDeleteArticleError(
        getFriendlyErrorMessage(error, language, {
          context: "delete",
          fallback: isEnglish ? "Could not remove the article." : "Não foi possível remover o artigo.",
        }),
      );
    } finally {
      setIsDeletingArticle(false);
    }
  }

  function updatePositionFromClientPoint(clientX: number, clientY: number, articleId: string) {
    const container = containerRef.current;

    if (!container) {
      return positionsRef.current;
    }

    const bounds = container.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const worldX = ((clientX - centerX - viewportRef.current.x) / viewportRef.current.scale) + worldSize / 2;
    const worldY = ((clientY - centerY - viewportRef.current.y) / viewportRef.current.scale) + worldSize / 2;
    const nextPosition = {
      x: clamp((worldX / worldSize) * 100, 2, 98),
      y: clamp((worldY / worldSize) * 100, 2, 98),
    };

    const nextPositions = {
      ...positionsRef.current,
      [articleId]: nextPosition,
    };

    positionsRef.current = nextPositions;
    setDraftPositions(nextPositions);

    return nextPositions;
  }

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      stopViewportAnimation();

      const bounds = container.getBoundingClientRect();
      const cursorX = event.clientX - bounds.left - bounds.width / 2;
      const cursorY = event.clientY - bounds.top - bounds.height / 2;
      const zoomStep = event.deltaY > 0 ? 0.92 : 1.08;
      const currentViewport = viewportRef.current;
      const nextScale = clamp(currentViewport.scale * zoomStep, 0.55, 2.1);
      const scaleRatio = nextScale / currentViewport.scale;
      const nextViewport = {
        x: cursorX - (cursorX - currentViewport.x) * scaleRatio,
        y: cursorY - (cursorY - currentViewport.y) * scaleRatio,
        scale: nextScale,
      };

      viewportRef.current = nextViewport;
      setViewport(nextViewport);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [stopViewportAnimation]);

  useEffect(() => {
    if (!draggingArticleId) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const dragStart = dragStartRef.current;

      if (dragStart && !dragStart.started) {
        const distance = Math.hypot(event.clientX - dragStart.clientX, event.clientY - dragStart.clientY);

        if (distance < 6) {
          return;
        }

        dragStart.started = true;
        stopViewportAnimation();
      }

      updatePositionFromClientPoint(event.clientX, event.clientY, draggingArticleId);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const dragStart = dragStartRef.current;
      const clickedArticleId = draggingArticleId;

      if (!dragStart?.started) {
        setDraggingArticleId(null);
        setDraftPositions(null);
        dragStartRef.current = null;

        if (clickedArticleId) {
          const nextArticleId = activeArticle?.id === clickedArticleId ? null : clickedArticleId;

          if (nextArticleId === null) {
            setManualConnectionSourceId(null);
          }

          onSelectArticle(nextArticleId);
        }

        return;
      }

      const nextPositions = updatePositionFromClientPoint(event.clientX, event.clientY, draggingArticleId);
      setDraggingArticleId(null);
      setDraftPositions(null);
      onArticlePositionsChangeRef.current(nextPositions);
      dragStartRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activeArticle?.id, draggingArticleId, onSelectArticle, stopViewportAnimation]);

  useEffect(() => {
    if (!isPanning) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const panStart = panStartRef.current;

      if (!panStart) {
        return;
      }

      const deltaX = event.clientX - panStart.clientX;
      const deltaY = event.clientY - panStart.clientY;

      setViewport({
        ...viewportRef.current,
        x: panStart.x + deltaX,
        y: panStart.y + deltaY,
      });
    };

    const handlePointerUp = () => {
      setIsPanning(false);
      panStartRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isPanning]);

  const renderRelationGroup = (
    title: string,
    entries: ArticleRelationEntry[],
    emptyText: string,
  ) => (
    <section className="rounded-[18px] border border-[var(--border)] bg-black/15 p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">{title}</h3>
        <span className="rounded-full border border-[var(--border)] bg-black/20 px-2 py-0.5 text-[10px] text-[var(--muted)]">
          {entries.length}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {entries.map(({ relation, article }) => {
          const isManualRelation = relation.relationType === "manual";
          const isRemovableRelation =
            isManualRelation ||
            relation.relationType === "explicit" ||
            relation.relationType === "citation" ||
            relation.relationType === "semantic";

          return (
            <article
              key={`${title}-${relation.id}-${article.id}`}
              className="rounded-[14px] border border-white/10 bg-white/[0.04] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{article.title}</p>
                  <p className="mt-1 truncate text-xs text-[var(--muted)]">
                    {getRelationNoteLabel(relation.note, language)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getRelationBadgeClass(
                    relation.relationType,
                  )}`}
                >
                  {getRelationTypeLabel(relation.relationType, language)}
                </span>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onSelectArticle(article.id);
                    centerViewportOnArticle(article.id);
                  }}
                  className="flex-1 rounded-full border border-[var(--border)] bg-white/5 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10"
                >
                  {isEnglish ? "Focus" : "Focar"}
                </button>

                {canEdit && isRemovableRelation ? (
                  <button
                    type="button"
                    onClick={() =>
                      onRemoveRelation(relation.fromArticleId, relation.toArticleId, relation.relationType)
                    }
                    className="flex-1 rounded-full border border-red-300/30 bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-100 transition-colors hover:bg-red-500/25"
                  >
                    {isManualRelation
                      ? isEnglish
                        ? "Remove"
                        : "Remover"
                      : relation.relationType === "explicit"
                        ? isEnglish
                          ? "Remove wikilink"
                          : "Remover wikilink"
                        : isEnglish
                          ? "Remove"
                          : "Remover"}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}

        {entries.length === 0 ? (
          <p className="rounded-[14px] border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-[var(--muted)]">
            {emptyText}
          </p>
        ) : null}
      </div>
    </section>
  );

  const renderUnlinkedMentionGroup = () => {
    if (!canEdit || unlinkedMentions.length === 0) {
      return null;
    }

    return (
      <section className="rounded-[18px] border border-[rgba(142,231,255,0.28)] bg-[rgba(142,231,255,0.08)] p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
            {isEnglish ? "Unlinked mentions" : "Menções não ligadas"}
          </h3>
          <span className="rounded-full border border-[rgba(142,231,255,0.28)] bg-black/20 px-2 py-0.5 text-[10px] text-[var(--accent)]">
            {unlinkedMentions.length}
          </span>
        </div>

        <div className="mt-3 space-y-2">
          {unlinkedMentions.map((mention) => (
            <article
              key={mention.id}
              className="rounded-[14px] border border-[rgba(142,231,255,0.18)] bg-black/15 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{mention.targetTitle}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{mention.preview}</p>
                </div>
                <span className="shrink-0 rounded-full border border-[rgba(142,231,255,0.3)] bg-[rgba(142,231,255,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                  {mention.occurrenceCount}x
                </span>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => onCreateWikilinkFromMention(mention.id)}
                  className="flex-1 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-[#041016] transition-transform hover:-translate-y-0.5"
                >
                  {isEnglish ? "Create wikilink" : "Criar wikilink"}
                </button>
                <button
                  type="button"
                  onClick={() => onIgnoreUnlinkedMention(mention.id)}
                  className="flex-1 rounded-full border border-[var(--border)] bg-white/5 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10"
                >
                  {isEnglish ? "Ignore" : "Ignorar"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  };

  async function handlePdfImportChange(event: ChangeEvent<HTMLInputElement>) {
    if (!canEdit) {
      event.target.value = "";
      setImportPdfError(
        isEnglish
          ? "This workspace is read-only for your account."
          : "Esta workspace está em modo só leitura para a tua conta.",
      );
      return;
    }

    const pdfFile = event.target.files?.[0];

    if (!pdfFile) {
      return;
    }

    if (pdfFile.type !== "application/pdf" && !pdfFile.name.toLowerCase().endsWith(".pdf")) {
      setImportPdfError(isEnglish ? "Choose a PDF file." : "Escolhe um ficheiro PDF.");
      event.target.value = "";
      return;
    }

    setIsImportingPdf(true);
    setImportPdfError(null);

    try {
      await onImportPdfArticle(pdfFile);
    } catch (error) {
      setImportPdfError(
        getFriendlyErrorMessage(error, language, {
          context: "import",
          fallback: isEnglish ? "Could not import the PDF." : "Não foi possível importar o PDF.",
        }),
      );
    } finally {
      setIsImportingPdf(false);
      event.target.value = "";
    }
  }

  const graphVisualScale = clamp(viewport.scale, 0.52, 1.38);
  const relationStrokeScale = clamp(viewport.scale, 0.58, 1.28);

  return (
    <section className="papergraph-graph-pane relative isolate min-h-0 w-full flex-1 overflow-hidden">
      <aside className="papergraph-graph-panel absolute bottom-5 left-5 top-5 z-50 flex max-h-[calc(100%_-_2.5rem)] w-[20rem] flex-col overflow-hidden rounded-[24px] border border-[var(--border)] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
              {isEnglish ? "Library" : "Biblioteca"}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">
              {isEnglish ? "Submitted articles" : "Artigos submetidos"}
            </h2>
          </div>
          <span className="rounded-full border border-[var(--border)] bg-black/20 px-2.5 py-1 text-[11px] text-[var(--muted)]">
            {articles.length}
          </span>
        </div>

        <button
          type="button"
          disabled={!canEdit || articles.length < 2 || !activeArticle}
          onClick={() => {
            if (!activeArticle) {
              return;
            }

            setManualConnectionSourceId((currentSourceId) => {
              setContextMenu(null);
              return currentSourceId ? null : activeArticle.id;
            });
          }}
          className={`mt-4 rounded-full border px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
            manualConnectionSource
              ? "border-[var(--accent)] bg-[rgba(142,231,255,0.18)] text-white"
              : "border-[var(--border)] bg-[var(--accent)] text-[#041016]"
          }`}
        >
          {manualConnectionSource
            ? isEnglish
              ? "Cancel manual link"
              : "Cancelar ligação manual"
            : isEnglish
              ? "Manual link"
              : "Ligação manual"}
        </button>

        {!canEdit ? (
          <p className="mt-3 rounded-[14px] border border-[var(--border)] bg-black/20 px-3 py-2 text-xs leading-5 text-[var(--muted)]">
            {isEnglish
              ? "Read-only access. You can browse and export, but not change this workspace."
              : "Acesso só leitura. Podes navegar e exportar, mas não alterar esta workspace."}
          </p>
        ) : null}

        <input
          ref={pdfImportInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={handlePdfImportChange}
        />
        <button
          type="button"
          disabled={!canEdit || isImportingPdf}
          onClick={() => pdfImportInputRef.current?.click()}
          className="mt-2 rounded-full border border-[var(--border)] bg-white/5 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isImportingPdf
            ? isEnglish
              ? "Importing PDF..."
              : "A importar PDF..."
            : isEnglish
              ? "Import PDF"
              : "Importar PDF"}
        </button>

        {importPdfError ? (
          <p className="mt-2 rounded-[14px] border border-red-300/30 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100">
            {importPdfError}
          </p>
        ) : null}

        {manualConnectionSource ? (
          <p className="mt-3 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            {isEnglish ? "From" : "A partir de"} {manualConnectionSource.title}
          </p>
        ) : null}

        <label className="mt-4 block">
          <span className="sr-only">
            {isEnglish ? "Search submitted articles" : "Pesquisar artigos submetidos"}
          </span>
          <input
            value={librarySearch}
            onChange={(event) => setLibrarySearch(event.target.value)}
            placeholder={isEnglish ? "Search articles, tags, status" : "Pesquisar artigos, tags, estado"}
            className="w-full rounded-[18px] border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
          />
        </label>

        <div className="scrollbar-hidden mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
          {filteredLibraryArticles.map((article) => {
            const isActive = article.id === activeArticle?.id;
            const articleKeywordLabel = getVisibleArticleTags(article)
              .slice(0, 2)
              .map((tag) => getArticleTagLabel(tag, language))
              .join(" • ");

            return (
              <button
                key={article.id}
                type="button"
                onClick={() => {
                  const nextArticleId = isActive ? null : article.id;

                  setContextMenu(null);

                  if (nextArticleId === null) {
                    setManualConnectionSourceId(null);
                    onSelectArticle(null);
                    return;
                  }

                  onSelectArticle(nextArticleId);
                  centerViewportOnArticle(nextArticleId);
                }}
                className={`w-full rounded-[18px] border p-3 text-left transition-colors ${
                  isActive
                    ? "border-[var(--accent)] bg-[rgba(142,231,255,0.14)]"
                    : "border-[var(--border)] bg-black/15 hover:bg-white/8"
                }`}
              >
                <p className="text-sm font-medium leading-5 text-white">{article.title}</p>
                <p className="mt-2 text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                  {getArticleStatusLabel(article.status, language)}
                  {articleKeywordLabel ? ` • ${articleKeywordLabel}` : ""}
                </p>
              </button>
            );
          })}

          {filteredLibraryArticles.length === 0 ? (
            <div className="rounded-[18px] border border-[var(--border)] bg-black/15 p-4 text-sm leading-6 text-[var(--muted)]">
              {articles.length === 0
                ? isEnglish
                  ? "No articles on the map yet. Import a PDF or submit a draft to start."
                  : "Ainda não há artigos no mapa. Importa um PDF ou submete um rascunho para começar."
                : isEnglish
                  ? "No submitted article matches the current search."
                  : "Nenhum artigo submetido corresponde à pesquisa atual."}
            </div>
          ) : null}
        </div>
      </aside>

      <div
        ref={containerRef}
        className="absolute inset-0 z-0"
        style={{ touchAction: "none" }}
        onPointerDown={(event) => {
          const target = event.target as HTMLElement | null;

          if (target?.closest("[data-graph-node]") || target?.closest("button")) {
            return;
          }

          setContextMenu(null);
          stopViewportAnimation();
          setIsPanning(true);
          panStartRef.current = {
            clientX: event.clientX,
            clientY: event.clientY,
            x: viewportRef.current.x,
            y: viewportRef.current.y,
          };
          containerRef.current?.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          if (isPanning) {
            setIsPanning(false);
          }

          try {
            containerRef.current?.releasePointerCapture(event.pointerId);
          } catch {
            // Ignora erros de captura quando o ponteiro não foi capturado.
          }
        }}
      >
        <div className="papergraph-graph-backdrop absolute inset-0 z-0" />

        {isAcademicRelationsRunning ? (
          <div className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full border border-[var(--accent)]/40 bg-black/35 px-4 py-2 text-xs font-semibold text-[var(--accent)] shadow-[0_14px_34px_rgba(0,0,0,0.22)] backdrop-blur-md">
            {isEnglish ? "Updating academic links..." : "A atualizar ligações académicas..."}
          </div>
        ) : null}

        {/* Filter button (top-right) */}
        <div className="absolute right-4 top-4 z-30">
          <button
            type="button"
            onClick={() => setFilterPanelOpen((s) => !s)}
            className="rounded-full border border-[var(--border)] bg-black/20 p-[5.333px] transition-transform hover:scale-105"
            aria-label={isEnglish ? "Filters" : "Filtros"}
          >
            <Image
              src={appTheme === "light" ? lightFilterIcon : darkFilterIcon}
              alt={isEnglish ? "Filters" : "Filtros"}
              width={70}
              height={70}
            />
          </button>
        </div>

        {filterPanelOpen ? (
          <aside className="papergraph-file-panel absolute right-4 top-[4.75rem] z-40 flex w-[min(20rem,calc(100%_-_2rem))] max-h-[calc(100%_-_5.75rem)] flex-col overflow-hidden rounded-[14px] border border-[var(--border)] shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--file-panel-divider)] px-3 py-2">
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{isEnglish ? "Filters" : "Filtros"}</p>
              <button
                type="button"
                onClick={() => setFilterPanelOpen(false)}
                className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-[var(--muted)]"
              >
                ✕
              </button>
            </div>

            <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
              {graphRelationFilterTypes.map((relationType) => {
                const relationCount = relations.filter((relation) => relation.relationType === relationType).length;
                const isEnabled = activeRelationFilters.has(relationType);
                const relationColor = relationType === "manual"
                  ? "var(--graph-link-manual)"
                  : relationType === "explicit"
                    ? "var(--graph-link-explicit)"
                    : relationType === "citation"
                      ? "var(--graph-link-citation)"
                      : "var(--graph-link-semantic)";

                return (
                  <button
                    key={relationType}
                    type="button"
                    onClick={() => {
                      setActiveRelationFilters((currentFilters) => {
                        const nextFilters = new Set(currentFilters);

                        if (nextFilters.has(relationType)) {
                          nextFilters.delete(relationType);
                        } else {
                          nextFilters.add(relationType);
                        }

                        return nextFilters;
                      });
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--file-panel-row-hover)]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${isEnabled ? "" : "opacity-35"}`}
                        style={{ backgroundColor: relationColor }}
                      />
                      <span className="truncate text-sm font-semibold text-[var(--foreground)]">
                        {getRelationTypeLabel(relationType, language)}
                      </span>
                    </span>
                    <span className="rounded-full border border-[var(--border)] bg-black/20 px-2 py-0.5 text-[11px] text-[var(--muted)]">
                      {relationCount}
                    </span>
                  </button>
                );
              })}
            </div>

            {onRefreshAcademicRelations ? (
              <div className="border-t border-[var(--file-panel-divider)] p-3">
                {academicRelationStatus ? (
                  <p className="mb-3 rounded-[12px] border border-[var(--border)] bg-black/15 px-3 py-2 text-xs leading-5 text-[var(--muted)]">
                    {academicRelationStatus}
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={isAcademicRelationsRunning || articles.length < 2}
                  onClick={() => {
                    void onRefreshAcademicRelations();
                  }}
                  className="w-full rounded-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isAcademicRelationsRunning
                    ? isEnglish
                      ? "Updating..."
                      : "A atualizar..."
                    : isEnglish
                      ? "Refresh academic links"
                      : "Recalcular ligações"}
                </button>
              </div>
            ) : null}
          </aside>
        ) : null}

        <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full">
          <defs>
            <filter id="glow">
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {relationEntries.map((entry) => {
            const isManualRelation = entry.relation.relationType === "manual";
            const isExplicitRelation = entry.relation.relationType === "explicit";
            const isCitationRelation = entry.relation.relationType === "citation";
            const isSemanticRelation = entry.relation.relationType === "semantic";
            const isActiveRelation =
              activeArticle !== null &&
              (entry.relation.fromArticleId === activeArticle.id ||
                entry.relation.toArticleId === activeArticle.id);
            const strokeColor = isManualRelation
              ? "var(--graph-link-manual)"
              : isExplicitRelation
                ? "var(--graph-link-explicit)"
                : isCitationRelation
                  ? "var(--graph-link-citation)"
                  : isSemanticRelation
                    ? "var(--graph-link-semantic)"
                    : "var(--graph-link-muted)";
            const baseStrokeWidth = isActiveRelation
              ? 2.4
              : isManualRelation
                ? 2.1
                : isExplicitRelation
                  ? 1.55
                  : isCitationRelation || isSemanticRelation
                    ? 1.75
                    : 1.15;

            return (
              <line
                key={entry.key}
                x1={entry.fromPosition.x}
                y1={entry.fromPosition.y}
                x2={entry.toPosition.x}
                y2={entry.toPosition.y}
                stroke={strokeColor}
                strokeOpacity={activeArticle === null ? 0.7 : isActiveRelation ? 1 : 0.38}
                strokeWidth={baseStrokeWidth * relationStrokeScale}
                strokeLinecap="round"
                filter={isManualRelation || isActiveRelation ? "url(#glow)" : undefined}
              />
            );
          })}
        </svg>

        {articles.map((article, index) => {
            const fallbackPosition = displayedPositions[article.id] ?? defaultArticlePosition(index);
            const position = screenPositions[article.id] ?? {
              x: containerSize.width / 2 + viewport.x + ((fallbackPosition.x / 100) * worldSize - worldSize / 2) * viewport.scale,
              y: containerSize.height / 2 + viewport.y + ((fallbackPosition.y / 100) * worldSize - worldSize / 2) * viewport.scale,
            };
            const isActive = article.id === activeArticle?.id;
            const isDragging = draggingArticleId === article.id;
            const nodeVisualScale = graphVisualScale * (isActive ? 1.1 : 1);
            const nodePresence = articlePresenceByArticleId[article.id] ?? [];

            return (
              <button
                key={article.id}
                data-graph-node
                data-article-id={article.id}
                type="button"
                title={
                  nodePresence.length > 0
                    ? nodePresence
                        .map((presence) => `${presence.userName} ${getPresenceModeLabel(presence.mode, language)}`)
                        .join(", ")
                    : article.title
                }
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }

                  event.preventDefault();
                  stopViewportAnimation();
                  setContextMenu(null);

                  if (!canEdit) {
                    const nextArticleId = activeArticle?.id === article.id ? null : article.id;

                    onSelectArticle(nextArticleId);

                    if (nextArticleId) {
                      centerViewportOnArticle(nextArticleId);
                    }

                    return;
                  }

                  if (activeManualConnectionSourceId) {
                    if (activeManualConnectionSourceId !== article.id) {
                      onCreateRelation(activeManualConnectionSourceId, article.id);
                      setManualConnectionSourceId(null);
                      centerViewportOnArticle(article.id);
                    }

                    return;
                  }

                  dragStartRef.current = {
                    clientX: event.clientX,
                    clientY: event.clientY,
                    started: false,
                  };
                  setDraggingArticleId(article.id);
                  setIsPanning(false);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({
                    articleId: article.id,
                    x: clamp(position.x + 128, 12, Math.max(containerSize.width - 180, 12)),
                    y: clamp(position.y - 32, 12, Math.max(containerSize.height - 88, 12)),
                  });
                }}
                className={`group absolute z-40 flex w-[9rem] flex-col items-center gap-2 text-center transition-transform ${
                  !canEdit
                    ? "cursor-pointer"
                    : activeManualConnectionSourceId
                      ? "cursor-crosshair"
                      : isDragging
                        ? "cursor-grabbing"
                        : "cursor-grab"
                }`}
                style={{
                  left: `${position.x}px`,
                  top: `${position.y}px`,
                  touchAction: "none",
                  transform: `translate(-50%, -50%) scale(${nodeVisualScale})`,
                  transformOrigin: "center",
                }}
              >
                <span
                  className={`papergraph-graph-node-core relative flex h-16 w-16 items-center justify-center rounded-full border text-lg font-semibold shadow-[0_18px_38px_rgba(0,0,0,0.24)] transition-colors ${
                    isActive
                      ? "is-active border-[var(--accent)] text-white shadow-[0_0_32px_rgba(142,231,255,0.2)]"
                      : "border-[var(--border)] text-white/90 group-hover:border-[var(--accent)]"
                  } ${
                    activeManualConnectionSourceId === article.id
                      ? "ring-2 ring-[rgba(142,231,255,0.45)]"
                      : ""
                  }`}
                >
                  {getArticleInitials(article.title)}
                  <span
                    aria-label={getArticleStatusLabel(article.status, language)}
                    className={`absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-[var(--graph-node-ring)] ${
                      article.status === "Published" ? "bg-emerald-300" : "bg-amber-300"
                    }`}
                  />
                  {nodePresence.length > 0 ? (
                    <span className="absolute -left-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[var(--graph-node-ring)] bg-emerald-300 px-1 text-[10px] font-bold text-[#041016]">
                      {nodePresence.length}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`papergraph-graph-node-label max-w-[8.5rem] truncate rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                    isActive
                      ? "is-active border-[rgba(142,231,255,0.45)] text-white"
                      : "border-[var(--border)] text-white/70"
                  }`}
                >
                  {article.title}
                </span>
              </button>
            );
          })}

        {contextMenu ? (
          <div
            className="papergraph-graph-menu absolute z-50 w-[11.5rem] rounded-[18px] border border-[var(--border)] p-2 shadow-[0_16px_40px_rgba(0,0,0,0.24)] backdrop-blur-xl"
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          >
            {canEditContextMenuArticle ? (
              <button
                type="button"
                onClick={() => {
                  onEditArticle(contextMenu.articleId);
                  setContextMenu(null);
                }}
                className="w-full rounded-[14px] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[#041016] transition-transform hover:-translate-y-0.5"
              >
                {isEnglish ? "Edit article" : "Editar artigo"}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => {
                void onExportArticlePdf(contextMenu.articleId);
                setContextMenu(null);
              }}
              className={`${canEditContextMenuArticle ? "mt-2 " : ""}w-full rounded-[14px] border border-[var(--border)] bg-white/5 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10`}
            >
              {isEnglish ? "Export PDF" : "Exportar PDF"}
            </button>

            {canEdit ? (
              <button
                type="button"
                onClick={() => {
                  setDeleteCandidateArticleId(contextMenu.articleId);
                  setDeleteArticleError(null);
                  setContextMenu(null);
                }}
                className="mt-2 w-full rounded-[14px] border border-red-300/30 bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-100 transition-colors hover:bg-red-500/25"
              >
                {isEnglish ? "Remove article" : "Remover artigo"}
              </button>
            ) : null}

            {contextMenuRemovableRelations.map((relation) => {
              const otherArticleId =
                relation.fromArticleId === contextMenu.articleId
                  ? relation.toArticleId
                  : relation.fromArticleId;
              const otherArticle = articleById.get(otherArticleId);
              const removeLabel =
                contextMenuRemovableRelations.length === 1
                  ? relation.relationType === "explicit"
                    ? isEnglish
                      ? "Remove wikilink"
                      : "Remover wikilink"
                    : isEnglish
                      ? "Remove connection"
                      : "Remover conexão"
                  : `${isEnglish ? "Remove" : "Remover"} ${
                      getRelationTypeLabel(relation.relationType, language).toLowerCase()
                    } ${isEnglish ? "with" : "com"} ${
                      otherArticle?.title ?? (isEnglish ? "article" : "artigo")
                    }`;

              return (
                <button
                  key={relation.id}
                  type="button"
                  onClick={() => {
                    onRemoveRelation(relation.fromArticleId, relation.toArticleId, relation.relationType);
                    setContextMenu(null);
                  }}
                  className="mt-2 w-full rounded-[14px] border border-red-300/30 bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-100 transition-colors hover:bg-red-500/25"
                >
                  {removeLabel}
                </button>
              );
            })}
          </div>
        ) : null}

      </div>

      {activeArticle ? (
        <aside
          data-graph-control
          className="papergraph-graph-panel absolute bottom-5 right-5 z-50 w-[min(23rem,calc(100%_-_2.5rem))] max-h-[calc(100%_-_2.5rem)] overflow-hidden rounded-[24px] border border-[var(--border)] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.2)] backdrop-blur-xl"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                {isEnglish ? "Details" : "Detalhes"}
              </p>
              <h2 className="mt-1 truncate text-lg font-semibold text-white">{activeArticle.title}</h2>
            </div>
            <span className="shrink-0 rounded-full border border-[var(--border)] bg-black/20 px-2.5 py-1 text-[11px] text-[var(--muted)]">
              {activeRelationCount === 1
                ? isEnglish
                  ? "1 link"
                  : "1 ligação"
                : isEnglish
                  ? `${activeRelationCount} links`
                  : `${activeRelationCount} ligações`}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white/80">
              {getArticleStatusLabel(activeArticle.status, language)}
            </span>
            {getVisibleArticleTags(activeArticle).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-[var(--muted)]"
              >
                {getArticleTagLabel(tag, language)}
              </span>
            ))}
          </div>

          {activeArticlePresence.length > 0 ? (
            <div className="mt-3 rounded-[14px] border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs leading-5 text-[var(--muted)]">
              <p className="font-semibold text-white">
                {activeArticlePresence.map((presence) => presence.userName).join(", ")}
              </p>
              <p>
                {activeArticlePresence
                  .map((presence) => getPresenceModeLabel(presence.mode, language))
                  .join(", ")}
                {isEnglish ? " here." : " aqui."}
              </p>
            </div>
          ) : null}

          <div className={`mt-4 grid gap-2 ${canEditActiveArticle ? "grid-cols-3" : "grid-cols-2"}`}>
            <button
              type="button"
              onClick={() => centerViewportOnArticle(activeArticle.id)}
              className="rounded-full border border-[var(--border)] bg-white/5 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10"
            >
              {isEnglish ? "Focus" : "Focar"}
            </button>
            {canEditActiveArticle ? (
              <button
                type="button"
                onClick={() => onEditArticle(activeArticle.id)}
                className="rounded-full border border-[var(--border)] bg-white/5 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10"
              >
                {isEnglish ? "Edit" : "Editar"}
              </button>
            ) : null}
            <button
              type="button"
              disabled={!canEdit || articles.length < 2}
              onClick={() => {
                setContextMenu(null);
                setManualConnectionSourceId((currentSourceId) =>
                  currentSourceId === activeArticle.id ? null : activeArticle.id,
                );
              }}
              className={`rounded-full border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                activeManualConnectionSourceId === activeArticle.id
                  ? "border-[var(--accent)] bg-[rgba(142,231,255,0.18)] text-white"
                  : "border-[var(--accent)] bg-[var(--accent)] text-[#041016]"
              }`}
            >
              {activeManualConnectionSourceId === activeArticle.id
                ? isEnglish
                  ? "Cancel"
                  : "Cancelar"
                : isEnglish
                  ? "Link"
                : "Ligar"}
            </button>
          </div>

          {!canEditActiveArticle ? (
            <button
              type="button"
              onClick={() => onViewArticle(activeArticle.id)}
              className="mt-2 w-full rounded-full border border-[var(--border)] bg-white/5 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10"
            >
              {isEnglish ? "View article" : "Visualizar artigo"}
            </button>
          ) : null}

          {manualConnectionSource ? (
            <p className="mt-3 rounded-[14px] border border-[rgba(142,231,255,0.28)] bg-[rgba(142,231,255,0.1)] px-3 py-2 text-xs leading-5 text-[var(--muted)]">
              {isEnglish ? "Linking from" : "A ligar de"}{" "}
              <span className="font-semibold text-white">{manualConnectionSource.title}</span>.
              {isEnglish
                ? " Click another article to create the link."
                : " Clica noutro artigo para criar a ligação."}
            </p>
          ) : null}

          <div className="scrollbar-hidden mt-4 max-h-[22rem] space-y-3 overflow-y-auto overscroll-contain pr-1">
            <RecommendationsPanel key={`${workspaceId}:${activeArticle.id}`} article={activeArticle}
              workspaceId={workspaceId} accessToken={accessToken} language={language} articles={articles}
              canEdit={canEdit} onAdd={onAddRecommendation} />
            {renderUnlinkedMentionGroup()}
            {renderRelationGroup(
              isEnglish ? "Outgoing" : "Saída",
              activeOutgoingRelations,
              isEnglish
                ? "This article does not point to other articles yet."
                : "Este artigo ainda não aponta para outros artigos.",
            )}
            {renderRelationGroup(
              isEnglish ? "Incoming" : "Entrada",
              activeIncomingRelations,
              isEnglish
                ? "No articles point to this one yet."
                : "Ainda não há artigos a apontar para este.",
            )}
          </div>
        </aside>
      ) : null}

      {canEdit && deleteCandidateArticle ? (
        <div
          data-graph-control
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-article-title"
            className="papergraph-graph-dialog w-full max-w-md rounded-[24px] border border-[var(--border)] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.26)]"
          >
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
              {isEnglish ? "Confirm removal" : "Confirmar remoção"}
            </p>
            <h2 id="delete-article-title" className="mt-2 text-xl font-semibold text-white">
              {isEnglish ? "Remove article?" : "Remover artigo?"}
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              {isEnglish ? "You are about to remove" : "Vais remover"}{" "}
              <span className="font-semibold text-white">{deleteCandidateArticle.title}</span>
              {isEnglish
                ? " from the graph, including its links and uploaded files."
                : " do mapa, incluindo as ligações e os ficheiros carregados para este artigo."}
            </p>

            {deleteArticleError ? (
              <p className="mt-4 rounded-[14px] border border-red-300/30 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100">
                {deleteArticleError}
              </p>
            ) : null}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={isDeletingArticle}
                onClick={() => {
                  setDeleteCandidateArticleId(null);
                  setDeleteArticleError(null);
                }}
                className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isEnglish ? "Cancel" : "Cancelar"}
              </button>
              <button
                type="button"
                disabled={isDeletingArticle}
                onClick={() => {
                  void confirmArticleDelete();
                }}
                className="rounded-full border border-red-300/30 bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-100 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDeletingArticle
                  ? isEnglish
                    ? "Removing..."
                    : "A remover..."
                  : isEnglish
                    ? "Remove article"
                    : "Remover artigo"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
