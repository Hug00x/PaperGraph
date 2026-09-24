"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { articleAbstract } from "@/lib/article-presentation";
import { discoveredMetadata, safePublicationUrl } from "@/lib/academic/discovery/identity";
import type { ScientificPaper } from "@/lib/academic/discovery/types";
import { ArticleHistoryPanel } from "@/components/article-history-panel";
import { PdfZoomControls } from "@/components/pdf-zoom-controls";
import { getFriendlyErrorMessage, getFriendlyResponseError } from "@/lib/friendly-errors";
import { getPdfFitScale } from "@/lib/pdf-preview-layout";
import { getArticleStatusLabel, type AppLanguage } from "@/lib/portuguese-labels";
import type { WorkspaceArticle, WorkspaceArticleVersion, WorkspaceImageAsset } from "@/lib/workspace-data";

type SubmittedArticleStatus = Exclude<WorkspaceArticle["status"], "Draft">;

function normalizeTags(value: string) {
  const seenTags = new Set<string>();

  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => {
      const normalizedTag = tag.toLowerCase();

      if (!tag || seenTags.has(normalizedTag)) {
        return false;
      }

      seenTags.add(normalizedTag);
      return true;
    });
}

function getEditableArticleTags(article: WorkspaceArticle) {
  if (!article.source.includes("\\includepdf")) {
    return article.tags;
  }

  return article.tags.filter((tag) => tag.toLowerCase() !== "pdf");
}

type ArticleViewerPaneProps = {
  workspaceId?: string;
  article: WorkspaceArticle;
  articleCollaborators?: Array<{
    mode: "editing" | "viewing" | "browsing" | "settings";
    userId: string;
    userName: string;
  }>;
  authAccessToken?: string | null;
  articleVersions?: WorkspaceArticleVersion[];
  canEditMetadata?: boolean;
  imageAssets: WorkspaceImageAsset[];
  language: AppLanguage;
  onSaveArticleMetadata?: (article: {
    articleId: string;
    status: SubmittedArticleStatus;
    tags: string[];
    title: string;
  }) => void;
};

export function ArticleViewerPane({
  workspaceId,
  article,
  articleCollaborators = [],
  authAccessToken,
  articleVersions = [],
  canEditMetadata = false,
  imageAssets,
  language,
  onSaveArticleMetadata,
}: ArticleViewerPaneProps) {
  const discovered = useMemo(() => discoveredMetadata(article.source), [article.source]);
  const [resolvedPublication, setResolvedPublication] = useState<{ source: string; attempt: number; paper: ScientificPaper | null; failed?: boolean } | null>(null);
  const publication = resolvedPublication?.source === article.source ? resolvedPublication.paper ?? discovered : discovered;

  const abstract = articleAbstract(article) || publication?.abstract || "";
  const publicationPdfUrl = safePublicationUrl(publication?.pdfUrl) || safePublicationUrl(discovered?.pdfUrl);

  const [publicationAttempt, setPublicationAttempt] = useState(0);
  const publicationLoading = Boolean(discovered && workspaceId && authAccessToken && (resolvedPublication?.source !== article.source || resolvedPublication.attempt !== publicationAttempt));
  const publicationFailed = !publicationLoading && resolvedPublication?.source === article.source && resolvedPublication.failed;
  const keywords = [...new Set([...getEditableArticleTags(article).filter((tag) => !/^(openalex|importado|imported|pdf)$/i.test(tag) && !/^10\.\d{4,9}\//.test(tag)), ...(publication?.topics.map((topic) => topic.name) ?? [])])];
  const publicationUrl = safePublicationUrl(publication?.url);

  useEffect(() => {
    if (!discovered || !workspaceId || !authAccessToken) return;
    const controller = new AbortController();
    void fetch("/api/recommendations", {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authAccessToken}` },
      body: JSON.stringify({ action: "publication", workspaceId, articleId: article.id }),
    }).then(async (response) => {
      if (!response.ok) throw new Error("Publication lookup failed");
      const payload = await response.json() as { paper?: ScientificPaper };
      if (!controller.signal.aborted) setResolvedPublication({ source: article.source, attempt: publicationAttempt, paper: payload.paper ?? null });
    }).catch(() => {
      if (!controller.signal.aborted) setResolvedPublication({ source: article.source, attempt: publicationAttempt, paper: null, failed: true });
    });
    return () => controller.abort();
  }, [article.id, article.source, authAccessToken, discovered, workspaceId, publicationAttempt]);

  const [metadataTitle, setMetadataTitle] = useState(article.title);
  const [metadataTagsInput, setMetadataTagsInput] = useState(getEditableArticleTags(article).join(", "));
  const [metadataStatus, setMetadataStatus] = useState<SubmittedArticleStatus>(
    article.status === "Published" ? "Published" : "Review",
  );
  const [compileState, setCompileState] = useState<"idle" | "rendering" | "ready" | "error">(
    article.source.trim() ? "rendering" : "idle",
  );
  const [compileError, setCompileError] = useState<string | null>(null);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  const [pdfZoom, setPdfZoom] = useState(100);
  const previewScrollerRef = useRef<HTMLDivElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const isEnglish = language === "en";
  const metadataTags = normalizeTags(metadataTagsInput);
  const editableArticleTags = getEditableArticleTags(article);
  const hasMetadataChanges =
    metadataTitle.trim() !== article.title ||
    metadataStatus !== article.status ||
    metadataTags.join("\u0001") !== editableArticleTags.join("\u0001");
  const editingCollaborators = articleCollaborators.filter((collaborator) => collaborator.mode === "editing");
  const collaboratorNames = articleCollaborators.map((collaborator) => collaborator.userName).join(", ");

  const compileDocument = useCallback(async () => {
    if (discovered || !article.source.trim()) {
      setPdfBuffer(null);
      setCompileError(null);
      setCompileState("idle");
      return;
    }

    setCompileState("rendering");
    setCompileError(null);

    try {
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authAccessToken ? { Authorization: `Bearer ${authAccessToken}` } : {}),
        },
        body: JSON.stringify({
          articleId: article.id,
          imageAssets,
          title: article.title,
          source: article.source,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await getFriendlyResponseError(response, language, {
            context: "preview",
            fallback: isEnglish ? "Could not prepare the article PDF." : "Não foi possível preparar o PDF do artigo.",
          }),
        );
      }

      const pdfBlob = await response.blob();
      setPdfBuffer(await pdfBlob.arrayBuffer());
    } catch (error) {
      setCompileState("error");
      setCompileError(
        getFriendlyErrorMessage(error, language, {
          context: "preview",
          fallback: isEnglish ? "Could not prepare the article PDF." : "Não foi possível preparar o PDF do artigo.",
        }),
      );
    }
  }, [article.id, article.source, article.title, authAccessToken, discovered, imageAssets, isEnglish, language]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void compileDocument();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [compileDocument]);

  useEffect(() => {
    let cancelled = false;

    async function renderPreview() {
      const previewContainer = previewContainerRef.current;
      const previewScroller = previewScrollerRef.current;

      if (!pdfBuffer || !previewContainer || !previewScroller) {
        return;
      }

      setCompileState("rendering");

      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();

      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBuffer.slice(0)) });
      const pdfDocument = await loadingTask.promise;
      previewContainer.innerHTML = "";
      previewScrollerRef.current?.scrollTo({ top: 0, left: 0 });

      if (cancelled) {
        return;
      }

      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        const unscaledViewport = page.getViewport({ scale: 1 });
        const fitScale = getPdfFitScale(previewScroller, unscaledViewport, { maxWidth: 880 });
        const scale = fitScale * (pdfZoom / 100);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context || cancelled) {
          return;
        }

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.className = "papergraph-pdf-page rounded-lg bg-[#f7fbff] shadow-[0_14px_34px_rgba(0,0,0,0.28)] ring-1 ring-[rgba(142,231,255,0.18)]";
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        previewContainer.appendChild(canvas);

        await page.render({ canvas, canvasContext: context, viewport }).promise;

        if (pageNumber < pdfDocument.numPages) {
          const spacer = document.createElement("div");
          spacer.style.height = "32px";
          previewContainer.appendChild(spacer);
        }
      }

      if (!cancelled) {
        setCompileState("ready");
      }
    }

    void renderPreview().catch((error) => {
      if (!cancelled) {
        setCompileState("error");
        setCompileError(
          getFriendlyErrorMessage(error, language, {
            context: "preview",
            fallback: isEnglish ? "Could not render the article PDF." : "Não foi possível renderizar o PDF do artigo.",
          }),
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isEnglish, language, pdfBuffer, pdfZoom]);

  function saveMetadata() {
    if (!canEditMetadata || !onSaveArticleMetadata) {
      return;
    }

    const nextTitle = metadataTitle.trim();

    if (!nextTitle) {
      return;
    }

    onSaveArticleMetadata({
      articleId: article.id,
      status: metadataStatus,
      tags: metadataTags,
      title: nextTitle,
    });
  }

  return (
    <section className="grid h-full min-h-0 flex-1 gap-5 overflow-y-auto pb-5 pt-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:gap-6 xl:overflow-hidden">
      <aside className="min-w-0 xl:min-h-0 xl:overflow-y-auto xl:border-r xl:border-[var(--border)] xl:pr-5">
      <div className="flex flex-col gap-4 border-b border-[var(--border)] px-0 py-4 ">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
            {isEnglish ? "Article view" : "Visualização do artigo"}
          </p>
          {canEditMetadata ? <input aria-label={isEnglish ? "Article title" : "T\u00edtulo do artigo"} value={metadataTitle} onChange={(event) => setMetadataTitle(event.target.value)} className="mt-2 w-full border-b border-[var(--border)] bg-transparent py-3 text-lg font-medium text-[var(--foreground)] outline-none focus:border-[var(--accent)]" /> : <h2 className="mt-2 break-words text-xl font-semibold leading-8 text-[var(--foreground)]">{article.title}</h2>}

        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!discovered ? <>
          <ArticleHistoryPanel
            articleTitle={article.title}
            language={language}
            versions={articleVersions}
          />

          <button
            type="button"
            disabled={compileState === "rendering"}
            onClick={() => {
              void compileDocument();
            }}
            className="rounded-full border border-[var(--border)] bg-[var(--accent)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {compileState === "rendering"
              ? isEnglish
                ? "Loading..."
                : "A carregar..."
              : isEnglish
                ? "Refresh PDF"
                : "Atualizar PDF"}
          </button>
          </> : null}
        </div>
      </div>

      {articleCollaborators.length > 0 ? (
        <div className="mt-4 rounded-[18px] border border-[rgba(142,231,255,0.26)] bg-[rgba(142,231,255,0.08)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">
          <p className="font-semibold text-white">
            {editingCollaborators.length > 0
              ? isEnglish
                ? "This article is being edited"
                : "Este artigo está a ser editado"
              : isEnglish
                ? "Someone else is viewing this article"
                : "Mais alguém está a visualizar este artigo"}
          </p>
          <p className="mt-1">
            {collaboratorNames}
            {editingCollaborators.length > 0
              ? isEnglish
                ? " is changing the source right now."
                : " está a alterar o código agora."
              : isEnglish
                ? " is here too."
                : " também está aqui."}
          </p>
        </div>
      ) : null}

      <details open className="mt-5 shrink-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--foreground)]">{isEnglish ? "Abstract" : "Resumo"}</summary>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">
          {abstract || (publicationLoading ? (isEnglish ? "Loading abstract..." : "A carregar resumo...") : publicationFailed ? (isEnglish ? "Could not retrieve the abstract." : "N\u00e3o foi poss\u00edvel obter o resumo.") : (isEnglish ? "No abstract available for this article." : "Não há resumo disponível para este artigo."))}
        </p>
      </details>

      {canEditMetadata ? (
        <section className="mt-4 rounded-[20px] border border-[var(--border)] bg-black/15 p-4">
          <div className="grid gap-4">
            <fieldset>
              <legend className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                {isEnglish ? "State" : "Estado"}
              </legend>
              <div className="mt-2 grid grid-cols-2 rounded-full border border-[var(--border)] bg-black/20 p-1">
                {(["Review", "Published"] as const).map((statusOption) => {
                  const isSelectedStatus = metadataStatus === statusOption;

                  return (
                    <button
                      key={statusOption}
                      type="button"
                      aria-pressed={isSelectedStatus}
                      onClick={() => setMetadataStatus(statusOption)}
                      className={`rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                        isSelectedStatus
                          ? "bg-[var(--accent)] text-[#041016]"
                          : "text-[var(--muted)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {getArticleStatusLabel(statusOption, language)}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <button
              type="button"
              disabled={!hasMetadataChanges || !metadataTitle.trim()}
              onClick={saveMetadata}
              className="rounded-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isEnglish ? "Save" : "Guardar"}
            </button>
          </div>

          <label className="mt-3 block">
            <span className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
              {isEnglish ? "Keywords" : "Palavras-chave"}
            </span>
            <input
              value={metadataTagsInput}
              onChange={(event) => setMetadataTagsInput(event.target.value)}
              className="mt-2 w-full rounded-[18px] border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
              placeholder={isEnglish ? "e.g. imported, archive" : "ex. importado, arquivo"}
            />
          </label>
        </section>
      ) : null}

      {!canEditMetadata ? (
        <section className="mt-5">
          <h3 className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">{isEnglish ? "Keywords" : "Palavras-chave"}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {keywords.length ? keywords.map((keyword) => <span key={keyword} className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--foreground)]">{keyword}</span>) : <p className="text-sm text-[var(--muted)]">{isEnglish ? "No keywords available." : "Sem palavras-chave dispon\u00edveis."}</p>}
          </div>
        </section>
      ) : null}
      </aside>
      <div className="flex min-h-[30rem] min-w-0 flex-col xl:min-h-0">
      {discovered ? (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">{isEnglish ? "Full article" : "Artigo completo"}</h3>
            <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--accent)]">
              {publicationFailed ? <button type="button" onClick={() => setPublicationAttempt((attempt) => attempt + 1)} className="hover:underline">{isEnglish ? "Try again" : "Tentar novamente"}</button> : null}
              {publicationPdfUrl ? <a href={publicationPdfUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{isEnglish ? "Open original PDF" : "Abrir PDF original"}</a> : null}
              {publicationPdfUrl && publicationUrl ? <a href={publicationUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{isEnglish ? "View publication" : "Ver publicação"}</a> : null}
            </div>
          </div>
          {publicationPdfUrl ? (
            <iframe src={publicationPdfUrl} title={article.title} referrerPolicy="no-referrer" className="min-h-0 w-full flex-1 border-0" />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
              <p role="status" className="max-w-sm text-sm leading-6 text-[var(--muted)]">
                {publicationLoading
                  ? (isEnglish ? "Looking for the original PDF..." : "A procurar o PDF original...")
                  : (isEnglish ? "This article could not be displayed inside the app. Open the publication to read it." : "N\u00e3o foi poss\u00edvel visualizar este artigo dentro da app. Abre a publica\u00e7\u00e3o para o consultar.")}
              </p>
              {!publicationLoading && publicationUrl ? (
                <a href={publicationUrl} target="_blank" rel="noopener noreferrer"
                  style={{ color: "#08212b" }}
                  className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]">
                  {isEnglish ? "View publication" : "Ver publica\u00e7\u00e3o"}
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 3h7v7m0-7L10 14" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                  </svg>
                </a>
              ) : null}
            </div>
          )}
        </section>
      ) : (
      <div className="flex min-h-0 flex-1 justify-center">
        <div className="papergraph-pdf-preview-shell relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[24px] border border-[var(--border)] shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
          {pdfBuffer ? (
            <PdfZoomControls
              className="absolute left-4 top-4 z-10"
              language={language}
              onChange={setPdfZoom}
              value={pdfZoom}
            />
          ) : null}
          <div className="papergraph-pdf-preview-status absolute right-4 top-4 z-10 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.3em] backdrop-blur-xl">
            {compileState === "rendering"
              ? isEnglish
                ? "loading"
                : "a carregar"
              : compileState === "error"
                ? isEnglish
                  ? "error"
                  : "erro"
                : isEnglish
                  ? "ready"
                  : "pronto"}
          </div>

          <div className="papergraph-pdf-preview-stage relative flex min-h-0 flex-1 flex-col">
            {pdfBuffer ? (
              <div ref={previewScrollerRef} className="min-h-0 flex-1 overflow-auto overscroll-contain px-8 py-10 lg:px-14 lg:py-12">
                <div ref={previewContainerRef} className="flex w-max min-w-full flex-col items-center" />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center px-8 text-center text-sm leading-6 text-[var(--muted)]">
                <div>
                  <p className="text-base font-medium text-white">
                    {isEnglish ? "No PDF loaded yet" : "Ainda não há PDF carregado"}
                  </p>
                  <p className="mt-2">
                    {isEnglish
                      ? "The article PDF will appear here after it is prepared."
                      : "O PDF do artigo aparece aqui depois de ser preparado."}
                  </p>
                </div>
              </div>
            )}

            {compileState === "rendering" ? (
              <div className="absolute inset-0 flex items-center justify-center bg-white/20 backdrop-blur-[1px]">
                <div className="rounded-full border border-slate-300 bg-white/90 px-4 py-2 text-xs uppercase tracking-[0.24em] text-slate-700 shadow-lg">
                  {isEnglish ? "preparing PDF" : "a preparar PDF"}
                </div>
              </div>
            ) : null}
          </div>

          {compileState === "error" ? (
            <div className="border-t border-white/10 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {compileError ?? (isEnglish ? "Preview failed." : "A visualização falhou.")}
            </div>
          ) : null}
        </div>
      </div>
      )}
      </div>
    </section>
  );
}
