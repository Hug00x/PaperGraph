"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { articleAbstract, getVisibleArticleTags, isImportedPdfArticle } from "@/lib/article-presentation";
import { discoveredMetadata, safePublicationUrl } from "@/lib/academic/discovery/identity";
import type { ScientificPaper } from "@/lib/academic/discovery/types";
import { ArticleHistoryPanel } from "@/components/article-history-panel";
import { AnnotatedPdfViewer } from "@/components/annotated-pdf-viewer";
import { getFriendlyErrorMessage, getFriendlyResponseError } from "@/lib/friendly-errors";
import { type AppLanguage } from "@/lib/portuguese-labels";
import type { WorkspaceArticle, WorkspaceArticleVersion, WorkspaceImageAsset } from "@/lib/workspace-data";

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
  canAnnotate?: boolean;
  imageAssets: WorkspaceImageAsset[];
  language: AppLanguage;
};

export function ArticleViewerPane({
  workspaceId,
  article,
  articleCollaborators = [],
  authAccessToken,
  articleVersions = [],
  canAnnotate = false,
  imageAssets,
  language,
}: ArticleViewerPaneProps) {
  const discovered = useMemo(() => discoveredMetadata(article.source), [article.source]);
  const [resolvedPublication, setResolvedPublication] = useState<{ source: string; attempt: number; paper: ScientificPaper | null; failed?: boolean } | null>(null);
  const publication = resolvedPublication?.source === article.source ? resolvedPublication.paper ?? discovered : discovered;

  const abstract = articleAbstract(article) || publication?.abstract || "";
  const publicationPdfUrl = safePublicationUrl(publication?.pdfUrl) || safePublicationUrl(discovered?.pdfUrl);

  const [publicationAttempt, setPublicationAttempt] = useState(0);
  const [embeddedPdfFailureUrl, setEmbeddedPdfFailureUrl] = useState<string | null>(null);
  const [embeddedPdf, setEmbeddedPdf] = useState<{ key: string; buffer: ArrayBuffer } | null>(null);
  const publicationLoading = Boolean(discovered && workspaceId && authAccessToken && (resolvedPublication?.source !== article.source || resolvedPublication.attempt !== publicationAttempt));
  const publicationFailed = !publicationLoading && resolvedPublication?.source === article.source && resolvedPublication.failed;
  const keywords = [...new Set([...getVisibleArticleTags(article).filter((tag) => !/^(openalex|importado|imported|pdf)$/i.test(tag) && !/^10\.\d{4,9}\//.test(tag)), ...(publication?.topics.map((topic) => topic.name) ?? [])])];
  const publicationUrl = safePublicationUrl(publication?.url);
  const embeddedPdfKey = publicationPdfUrl ? `${article.id}:${publicationAttempt}:${publicationPdfUrl}` : null;
  const embeddedPdfBuffer = embeddedPdf?.key === embeddedPdfKey ? embeddedPdf.buffer : null;

  useEffect(() => {
    if (!embeddedPdfKey || !workspaceId || !authAccessToken) {
      return;
    }

    const controller = new AbortController();
    void fetch("/api/recommendations", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authAccessToken}` },
      body: JSON.stringify({ action: "publication-pdf", workspaceId, articleId: article.id }),
    }).then(async (response) => {
      if (!response.ok) throw new Error("PDF unavailable");
      const buffer = await response.arrayBuffer();
      if (!controller.signal.aborted) {
        setEmbeddedPdf({ key: embeddedPdfKey, buffer });
        setEmbeddedPdfFailureUrl(null);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setEmbeddedPdfFailureUrl(embeddedPdfKey);
    });

    return () => {
      controller.abort();
    };
  }, [article.id, authAccessToken, embeddedPdfKey, workspaceId]);

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

  const [compileState, setCompileState] = useState<"idle" | "rendering" | "ready" | "error">(
    article.source.trim() ? "rendering" : "idle",
  );
  const [compileError, setCompileError] = useState<string | null>(null);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  const [pdfSourceIdentity, setPdfSourceIdentity] = useState<string | undefined>();
  const compileControllerRef = useRef<AbortController | null>(null);
  const isEnglish = language === "en";
  const isImportedPdf = isImportedPdfArticle(article);
  const editingCollaborators = articleCollaborators.filter((collaborator) => collaborator.mode === "editing");
  const collaboratorNames = articleCollaborators.map((collaborator) => collaborator.userName).join(", ");

  // Live snapshots recreate asset objects every poll. Depend on the PDF request's
  // values, not those object identities, so reading and selections remain intact.
  const importedPdf = isImportedPdf
    ? imageAssets.find((asset) => asset.mimeType === "application/pdf" && article.source.includes(asset.storedName))
    : undefined;
  const importedPdfUrl = importedPdf
    ? `/api/images/${encodeURIComponent(importedPdf.storedName)}?path=${encodeURIComponent(importedPdf.storagePath ?? importedPdf.storedName)}`
    : null;
  const compileAssets = imageAssets.map((asset) => ({
    id: asset.id, articleId: asset.articleId, originalName: asset.originalName,
    storedName: asset.storedName, storagePath: asset.storagePath, mimeType: asset.mimeType,
    size: asset.size, uploadedAt: asset.uploadedAt,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const requestBody = importedPdfUrl ? undefined : JSON.stringify({
    articleId: article.id, imageAssets: compileAssets, title: article.title, source: article.source,
  });
  const sourceIdentity = importedPdfUrl ? undefined : JSON.stringify([article.source, compileAssets.map((asset) => asset.storagePath ?? asset.storedName)]);
  const hasPdfSource = !discovered && Boolean(article.source.trim());

  const compileDocument = useCallback(async () => {
    compileControllerRef.current?.abort();
    const controller = new AbortController();
    compileControllerRef.current = controller;
    if (!hasPdfSource) {
      setPdfBuffer(null);
      setCompileError(null);
      setCompileState("idle");
      return;
    }

    setCompileState("rendering");
    setCompileError(null);

    try {
      const response = importedPdfUrl
        ? await fetch(importedPdfUrl, {
            signal: controller.signal,
            headers: authAccessToken ? { Authorization: `Bearer ${authAccessToken}` } : {},
          })
        : await fetch("/api/compile", {
            signal: controller.signal,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(authAccessToken ? { Authorization: `Bearer ${authAccessToken}` } : {}),
            },
            body: requestBody,
          });

      if (!response.ok) {
        throw new Error(
          await getFriendlyResponseError(response, language, {
            context: "preview",
            fallback: isEnglish ? "Could not prepare the article PDF." : "Não foi possível preparar o PDF do artigo.",
          }),
        );
      }

      const buffer = await response.arrayBuffer();
      if (controller.signal.aborted) return;
      setPdfSourceIdentity(sourceIdentity);
      setPdfBuffer(buffer);
      setCompileState("ready");
    } catch (error) {
      if (controller.signal.aborted) return;
      setCompileState("error");
      setCompileError(
        getFriendlyErrorMessage(error, language, {
          context: "preview",
          fallback: isEnglish ? "Could not prepare the article PDF." : "Não foi possível preparar o PDF do artigo.",
        }),
      );
    }
  }, [hasPdfSource, importedPdfUrl, requestBody, sourceIdentity, authAccessToken, isEnglish, language]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void compileDocument();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      compileControllerRef.current?.abort();
    };
  }, [compileDocument]);


  return (
    <section className="grid h-full min-h-0 flex-1 gap-5 overflow-y-auto pb-5 pt-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:gap-6 xl:overflow-hidden">
      <aside className="min-w-0 xl:min-h-0 xl:overflow-y-auto xl:border-r xl:border-[var(--border)] xl:pr-5">
      <div className="flex flex-col gap-4 border-b border-[var(--border)] px-0 py-4 ">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
            {isEnglish ? "Article view" : "Visualização do artigo"}
          </p>
          <h2 className="mt-2 break-words text-xl font-semibold leading-8 text-[var(--foreground)]">{article.title}</h2>

        </div>

        {!discovered && !isImportedPdf ? <div className="flex flex-wrap items-center gap-2">
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
        </div> : null}
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

        <section className="mt-5">
          <h3 className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">{isEnglish ? "Keywords" : "Palavras-chave"}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {keywords.length ? keywords.map((keyword) => <span key={keyword} className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--foreground)]">{keyword}</span>) : <p className="text-sm text-[var(--muted)]">{isEnglish ? "No keywords available." : "Sem palavras-chave dispon\u00edveis."}</p>}
          </div>
        </section>
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
          {embeddedPdfBuffer && embeddedPdfFailureUrl !== embeddedPdfKey ? (
            <AnnotatedPdfViewer buffer={embeddedPdfBuffer} workspaceId={workspaceId} articleId={article.id} canEdit={canAnnotate} language={language} />
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        {isImportedPdf ? <div className="border-b border-[var(--border)] p-4"><h3 className="text-sm font-semibold text-[var(--foreground)]">{isEnglish ? "Full article" : "Artigo completo"}</h3></div> : null}
        {compileState === "error" ? <p role="alert" className="p-4 text-sm text-red-400">{compileError}</p> : null}
        {compileState === "rendering" ? <p role="status" className="p-4 text-sm text-[var(--muted)]">{isEnglish ? "Preparing PDF…" : "A preparar PDF…"}</p> : null}
        {pdfBuffer && compileState === "ready" ? <AnnotatedPdfViewer
          buffer={pdfBuffer} workspaceId={workspaceId} articleId={article.id} canEdit={canAnnotate} language={language}
          sourceIdentity={pdfSourceIdentity}
        /> : null}
      </div>
      )}
      </div>
    </section>
  );
}
