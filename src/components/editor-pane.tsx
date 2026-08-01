"use client";

import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import deleteButtonImage from "@/imagens/Delete_button.png";
import { getArticleStatusLabel, type AppLanguage } from "@/lib/portuguese-labels";
import type { WorkspaceArticle, WorkspaceImageAsset } from "@/lib/workspace-data";

type EditorPaneProps = {
  article: WorkspaceArticle;
  onSaveArticle: (article: { title: string; source: string }) => void;
  onSubmitArticle: (article: { articleId: string; title: string; source: string }) => void;
  submissionIssue: string | null;
  onSubmissionIssueClear: () => void;
  onPendingResubmissionChange: (article: { articleId: string; title: string; source: string } | null) => void;
  imageAssets: WorkspaceImageAsset[];
  onImageUploaded: (imageAsset: WorkspaceImageAsset) => void;
  onImageDeleted: (imageAsset: WorkspaceImageAsset) => void | Promise<void>;
  language: AppLanguage;
};

const latexImageDirectory = "papergraph-images";

function formatBytes(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeLatexText(value: string) {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");
}

function getImageUrl(imageAsset: WorkspaceImageAsset) {
  return `/api/images/${encodeURIComponent(imageAsset.storedName)}`;
}

function isPdfAsset(imageAsset: WorkspaceImageAsset) {
  return imageAsset.mimeType === "application/pdf" || imageAsset.storedName.toLowerCase().endsWith(".pdf");
}

function getAssetKindLabel(imageAsset: WorkspaceImageAsset) {
  return isPdfAsset(imageAsset) ? "PDF" : "IMG";
}

function getImageCaption(imageAsset: WorkspaceImageAsset) {
  return imageAsset.originalName.replace(/\.[^/.]+$/, "");
}

function createImageLatexSnippet(imageAsset: WorkspaceImageAsset) {
  return [
    "",
    "\\begin{figure}[htbp]",
    "  \\centering",
    `  \\includegraphics[width=0.85\\linewidth]{${latexImageDirectory}/${imageAsset.storedName}}`,
    `  \\caption{${escapeLatexText(getImageCaption(imageAsset))}}`,
    "\\end{figure}",
    "",
  ].join("\n");
}

function createPdfLatexSnippet(imageAsset: WorkspaceImageAsset) {
  return [
    "",
    "\\includepdf[",
    "    pages=-,",
    "    pagecommand={\\thispagestyle{empty}}",
    `]{${latexImageDirectory}/${imageAsset.storedName}}`,
    "",
  ].join("\n");
}

function createAssetLatexSnippet(imageAsset: WorkspaceImageAsset) {
  return isPdfAsset(imageAsset) ? createPdfLatexSnippet(imageAsset) : createImageLatexSnippet(imageAsset);
}

function ensureLatexPackage(documentSource: string, packageName: string) {
  const packagePattern = new RegExp(`\\\\usepackage(?:\\[[^\\]]+\\])?\\{${packageName}\\}`);

  if (packagePattern.test(documentSource)) {
    return documentSource;
  }

  const packageLine = `\\usepackage{${packageName}}\n`;
  const beginDocumentIndex = documentSource.search(/\\begin\{document\}/);

  if (beginDocumentIndex === -1) {
    return `${packageLine}${documentSource}`;
  }

  return `${documentSource.slice(0, beginDocumentIndex).trimEnd()}\n${packageLine}\n${documentSource.slice(
    beginDocumentIndex,
  )}`;
}

function ensureAssetPackages(documentSource: string, imageAsset: WorkspaceImageAsset) {
  return ensureLatexPackage(documentSource, isPdfAsset(imageAsset) ? "pdfpages" : "graphicx");
}

function getDefaultImageInsertionIndex(documentSource: string) {
  const endDocumentIndex = documentSource.lastIndexOf("\\end{document}");

  return endDocumentIndex === -1 ? documentSource.length : endDocumentIndex;
}

export function EditorPane({
  article,
  onSaveArticle,
  onSubmitArticle,
  submissionIssue,
  onSubmissionIssueClear,
  onPendingResubmissionChange,
  imageAssets,
  onImageUploaded,
  onImageDeleted,
  language,
}: EditorPaneProps) {
  const [title, setTitle] = useState(article.title);
  const [source, setSource] = useState(article.source);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [imagePanelOpen, setImagePanelOpen] = useState(false);
  const [imageUploadState, setImageUploadState] = useState<"idle" | "uploading">("idle");
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [deletingImageAssetId, setDeletingImageAssetId] = useState<string | null>(null);
  const [compileState, setCompileState] = useState<"idle" | "rendering" | "ready" | "error">(
    article.source.trim() ? "rendering" : "idle",
  );
  const [compileError, setCompileError] = useState<string | null>(null);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  const didMountRef = useRef(false);
  const autoCompileStartedRef = useRef(false);
  const onSaveArticleRef = useRef(onSaveArticle);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastTextSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const previewScrollerRef = useRef<HTMLDivElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const isEnglish = language === "en";
  const isSubmittedArticle = article.status !== "Draft";
  const hasPendingResubmission = isSubmittedArticle && (title !== article.title || source !== article.source);

  useEffect(() => {
    onSaveArticleRef.current = onSaveArticle;
  }, [onSaveArticle]);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    if (isSubmittedArticle) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      onSaveArticleRef.current({ title, source });
      setSaveState("saved");
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [hasPendingResubmission, isSubmittedArticle, source, title]);

  useEffect(() => {
    if (!isSubmittedArticle || !hasPendingResubmission) {
      onPendingResubmissionChange(null);
      return;
    }

    onPendingResubmissionChange({ articleId: article.id, title, source });
  }, [article.id, hasPendingResubmission, isSubmittedArticle, onPendingResubmissionChange, source, title]);

  useEffect(
    () => () => {
      onPendingResubmissionChange(null);
    },
    [onPendingResubmissionChange],
  );

  const compileDocument = useCallback(async (documentTitle: string, documentSource: string) => {
    if (!documentSource.trim()) {
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
        },
        body: JSON.stringify({ articleId: article.id, title: documentTitle, source: documentSource }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          payload?.error ??
            (isEnglish
              ? `Compilation failed with status ${response.status}.`
              : `A compilação falhou com o estado ${response.status}.`),
        );
      }

      const pdfBlob = await response.blob();
      setPdfBuffer(await pdfBlob.arrayBuffer());
    } catch (error) {
      setCompileState("error");
      setCompileError((error as Error).message);
    }
  }, [article.id, isEnglish]);

  useEffect(() => {
    if (autoCompileStartedRef.current) {
      return;
    }

    autoCompileStartedRef.current = true;
    void compileDocument(title, source);
  }, [compileDocument, source, title]);

  useEffect(() => {
    let cancelled = false;

    async function renderPreview() {
      const previewContainer = previewContainerRef.current;

      if (!pdfBuffer || !previewContainer) {
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

      const previewWidth = Math.max(previewContainer.clientWidth - 32, 640);

      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = previewWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context || cancelled) {
          return;
        }

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.className = "rounded-lg bg-[#f7fbff] shadow-[0_14px_34px_rgba(0,0,0,0.28)] ring-1 ring-[rgba(142,231,255,0.18)]";
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        previewContainer.appendChild(canvas);

        await page.render({ canvas, canvasContext: context, viewport }).promise;

        if (pageNumber < pdfDocument.numPages) {
          const spacer = document.createElement("div");
          spacer.style.height = "20px";
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
          error instanceof Error
            ? error.message
            : isEnglish
              ? "Could not render the PDF preview."
              : "Não foi possível renderizar a preview do PDF.",
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isEnglish, pdfBuffer]);

  function handleTitleChange(value: string) {
    onSubmissionIssueClear();

    if (!isSubmittedArticle) {
      setSaveState("saving");
    }

    setTitle(value);
    setSource((currentSource) => {
      const sourceLines = currentSource.split("\n");
      const sectionLineIndex = sourceLines.findIndex((line) => line.startsWith("\\section{"));

      if (sectionLineIndex === -1) {
        return currentSource;
      }

      sourceLines[sectionLineIndex] = `\\section{${value}}`;
      return sourceLines.join("\n");
    });
  }

  function handleSourceChange(value: string) {
    onSubmissionIssueClear();

    if (!isSubmittedArticle) {
      setSaveState("saving");
    }

    setSource(value);
  }

  function updateLastTextSelection() {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    lastTextSelectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
  }

  function insertImageSnippet(imageAsset: WorkspaceImageAsset) {
    onSubmissionIssueClear();
    setImageUploadError(null);

    const fallbackInsertionIndex = getDefaultImageInsertionIndex(source);
    const savedSelection = lastTextSelectionRef.current ?? {
      start: fallbackInsertionIndex,
      end: fallbackInsertionIndex,
    };
    const selectionStart = Math.min(savedSelection.start, source.length);
    const selectionEnd = Math.min(savedSelection.end, source.length);
    const sourceWithPackages = ensureAssetPackages(source, imageAsset);
    const insertedPackageLength = sourceWithPackages.length - source.length;
    const beginDocumentIndex = source.search(/\\begin\{document\}/);
    const shouldShiftSelection =
      insertedPackageLength > 0 && (beginDocumentIndex === -1 || selectionStart >= beginDocumentIndex);
    const insertionStart = selectionStart + (shouldShiftSelection ? insertedPackageLength : 0);
    const insertionEnd = selectionEnd + (shouldShiftSelection ? insertedPackageLength : 0);
    const assetSnippet = createAssetLatexSnippet(imageAsset);
    const nextSource = `${sourceWithPackages.slice(0, insertionStart)}${assetSnippet}${sourceWithPackages.slice(
      insertionEnd,
    )}`;
    const nextCursorPosition = insertionStart + assetSnippet.length;

    if (!isSubmittedArticle) {
      setSaveState("saving");
    }

    setSource(nextSource);
    lastTextSelectionRef.current = {
      start: nextCursorPosition,
      end: nextCursorPosition,
    };

    window.requestAnimationFrame(() => {
      const currentTextarea = textareaRef.current;

      if (!currentTextarea) {
        return;
      }

      currentTextarea.focus();
      currentTextarea.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }

  async function handleImageUploadChange(event: ChangeEvent<HTMLInputElement>) {
    const uploadedFile = event.target.files?.[0];

    if (!uploadedFile) {
      return;
    }

    setImageUploadState("uploading");
    setImageUploadError(null);
    setImagePanelOpen(true);

    try {
      const formData = new FormData();
      formData.append("asset", uploadedFile);
      formData.append("articleId", article.id);

      const response = await fetch("/api/images", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? (isEnglish ? "Could not upload the file." : "Não foi possível carregar o ficheiro."));
      }

      const imageAsset = (await response.json()) as WorkspaceImageAsset;
      onImageUploaded(imageAsset);
      insertImageSnippet(imageAsset);
    } catch (error) {
      setImageUploadError(
        error instanceof Error
          ? error.message
          : isEnglish
            ? "Could not upload the file."
            : "Não foi possível carregar o ficheiro.",
      );
    } finally {
      setImageUploadState("idle");
      event.target.value = "";
    }
  }

  async function handleImageDeleteClick(imageAsset: WorkspaceImageAsset) {
    setDeletingImageAssetId(imageAsset.id);
    setImageUploadError(null);

    try {
      await onImageDeleted(imageAsset);
    } catch (error) {
      setImageUploadError(
        error instanceof Error
          ? error.message
          : isEnglish
            ? "Could not remove the file."
            : "Não foi possível remover o ficheiro.",
      );
    } finally {
      setDeletingImageAssetId(null);
    }
  }

  function handleCompileClick() {
    void compileDocument(title, source);
  }

  function handleSubmitClick() {
    onSubmitArticle({ articleId: article.id, title, source });
    setSaveState("saved");
  }

  const submitButtonLabel =
    article.status === "Draft"
      ? isEnglish
        ? "Submit article"
        : "Submeter artigo"
      : isEnglish
        ? "Resubmit article"
        : "Resubmeter artigo";
  const saveStatusLabel = isSubmittedArticle
    ? hasPendingResubmission
      ? isEnglish
        ? "resubmission pending"
        : "resubmissão pendente"
      : isEnglish
        ? "published version"
        : "versão publicada"
    : `${saveState === "saving" ? (isEnglish ? "saving" : "a guardar") : isEnglish ? "saved" : "guardado"} • ${
        isEnglish ? "autosave enabled" : "autosave ativo"
      }`;

  return (
    <section className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <div className="flex flex-col gap-4 border-b border-[var(--border)] px-0 py-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Editor</p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            {isEnglish ? "LaTeX workspace" : "Área de trabalho LaTeX"}
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {isEnglish
              ? "Edit the source on the left and compile the PDF whenever you need."
              : "Edita o código à esquerda e compila o PDF quando precisares."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,application/pdf,.pdf"
            className="hidden"
            onChange={handleImageUploadChange}
          />

          <div className="flex overflow-hidden rounded-full border border-[var(--border)] bg-white/5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={imageUploadState === "uploading"}
              className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {imageUploadState === "uploading" ? (isEnglish ? "Uploading..." : "A carregar...") : "Upload"}
            </button>
            <button
              type="button"
              aria-label={isEnglish ? "Open file library" : "Abrir biblioteca de ficheiros"}
              aria-expanded={imagePanelOpen}
              title={isEnglish ? "Open file library" : "Abrir biblioteca de ficheiros"}
              onClick={() => setImagePanelOpen((currentValue) => !currentValue)}
              className={`border-l border-[var(--border)] px-3 py-2 text-base font-semibold transition-colors ${
                imagePanelOpen ? "bg-[rgba(142,231,255,0.16)] text-[var(--accent)]" : "text-white hover:bg-white/10"
              }`}
            >
              ›
            </button>
          </div>

          <button
            type="button"
            onClick={handleSubmitClick}
            disabled={isSubmittedArticle && !hasPendingResubmission}
            className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitButtonLabel}
          </button>

          <button
            type="button"
            onClick={handleCompileClick}
            disabled={compileState === "rendering"}
            className="rounded-full border border-[var(--border)] bg-[var(--accent)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {compileState === "rendering"
              ? isEnglish
                ? "Compiling..."
                : "A compilar..."
              : isEnglish
                ? "Compile PDF"
                : "Compilar PDF"}
          </button>
        </div>
      </div>

      {imagePanelOpen ? (
        <aside className="absolute right-4 top-[6.4rem] z-40 flex w-[min(24rem,calc(100%_-_2rem))] max-h-[calc(100%_-_7.5rem)] flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[#17202b] shadow-[0_18px_50px_rgba(0,0,0,0.38)]">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
              {isEnglish ? "Files" : "Ficheiros"}
            </p>
            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-[var(--muted)]">
              {imageAssets.length}
            </span>
          </div>

          {imageUploadError ? (
            <p className="mx-2 mt-2 rounded-[10px] border border-red-300/30 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100">
              {imageUploadError}
            </p>
          ) : null}

          <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
            {imageAssets.length === 0 ? (
              <div className="m-2 rounded-[10px] border border-white/10 bg-black/18 p-3 text-sm leading-6 text-[var(--muted)]">
                {isEnglish ? "There are no uploaded files yet." : "Ainda não há ficheiros carregados."}
              </div>
            ) : null}

            {imageAssets.map((imageAsset) => (
              <article
                key={imageAsset.id}
                className="group flex min-h-11 items-center gap-2 px-2 py-1 text-white transition-colors hover:bg-[#2d3a4d]"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <div
                    role="img"
                    aria-label={imageAsset.originalName}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border border-white/80 bg-cover bg-center bg-no-repeat text-[8px] font-bold leading-none text-white"
                    style={isPdfAsset(imageAsset) ? undefined : { backgroundImage: `url(${getImageUrl(imageAsset)})` }}
                  >
                    {getAssetKindLabel(imageAsset)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium leading-5 text-white">{imageAsset.originalName}</p>
                    <p className="truncate text-[11px] leading-4 text-slate-400">
                      {formatBytes(imageAsset.size)} • {imageAsset.uploadedAt}
                    </p>
                    <p className="hidden">
                      {latexImageDirectory}/{imageAsset.storedName}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => insertImageSnippet(imageAsset)}
                  className="shrink-0 rounded-[8px] border border-white/10 bg-white/8 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-[var(--accent)] hover:text-[#041016]"
                >
                  {isEnglish ? "Insert" : "Inserir"}
                </button>
                <button
                  type="button"
                  aria-label={`${isEnglish ? "Remove" : "Remover"} ${imageAsset.originalName}`}
                  title={isEnglish ? "Remove file" : "Remover ficheiro"}
                  disabled={deletingImageAssetId === imageAsset.id}
                  onClick={() => {
                    void handleImageDeleteClick(imageAsset);
                  }}
                  className="flex h-8 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-red-300/30 bg-red-500/15 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="relative h-6 w-6 overflow-hidden">
                    <Image
                      src={deleteButtonImage}
                      alt=""
                      aria-hidden
                      className="absolute left-1/2 top-1/2 h-[3.2rem] w-[4.8rem] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain"
                    />
                  </span>
                </button>
              </article>
            ))}
          </div>
        </aside>
      ) : null}

      {submissionIssue ? (
        <div className="mt-4 rounded-[18px] border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100">
          <p className="font-semibold text-red-50">
            {isEnglish ? "Invalid connections" : "Conexões inválidas"}
          </p>
          <p className="mt-1">{submissionIssue}</p>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 items-stretch gap-5 overflow-y-auto px-0 py-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:gap-6 xl:overflow-hidden">
        <div className="flex min-h-[24rem] flex-col gap-4 overflow-hidden xl:min-h-0 xl:border-r xl:border-[var(--border)] xl:pr-4">
          <label className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
              {isEnglish ? "Article title" : "Título do artigo"}
            </p>
            <input
              value={title}
              onChange={(event) => handleTitleChange(event.target.value)}
              className="w-full border-0 border-b border-[var(--border)] bg-transparent py-3 text-lg font-medium text-white outline-none placeholder:text-white/30 focus:border-[var(--accent)]"
              placeholder={isEnglish ? "Untitled article" : "Artigo sem título"}
            />
          </label>

          <label className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <span>article.tex</span>
              <span>
                {getArticleStatusLabel(article.status, language).toLowerCase()} • {saveStatusLabel}
              </span>
            </div>
            <textarea
              ref={textareaRef}
              value={source}
              onChange={(event) => handleSourceChange(event.target.value)}
              onClick={updateLastTextSelection}
              onKeyUp={updateLastTextSelection}
              onSelect={updateLastTextSelection}
              className="min-h-[18rem] w-full flex-1 resize-none overflow-y-auto overscroll-contain rounded-[24px] border border-[var(--border)] bg-[#f7fbff] p-5 font-mono text-sm leading-7 text-slate-900 shadow-inner outline-none placeholder:text-slate-400 xl:min-h-0"
              spellCheck={false}
            />
          </label>
        </div>

        <div className="flex min-h-[24rem] flex-col gap-4 overflow-hidden xl:min-h-0 xl:pl-4">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-[var(--border)] bg-[#23272d] shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
            <div className="absolute right-4 top-4 z-10 rounded-full border border-white/10 bg-black/45 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-white/60 backdrop-blur-xl">
              {compileState === "rendering"
                ? isEnglish
                  ? "updating"
                  : "a atualizar"
                : compileState === "error"
                  ? isEnglish
                    ? "error"
                    : "erro"
                  : isEnglish
                    ? "ready"
                    : "pronto"}
            </div>

            <div className="relative flex min-h-0 flex-1 flex-col bg-[linear-gradient(180deg,rgba(142,231,255,0.08),rgba(7,16,24,0.72))]">
              {pdfBuffer ? (
                <div ref={previewScrollerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[linear-gradient(180deg,rgba(142,231,255,0.08),rgba(7,16,24,0.72))] p-6">
                  <div ref={previewContainerRef} className="flex w-full min-w-0 flex-col items-center" />
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center px-8 text-center text-sm leading-6 text-[var(--muted)]">
                  <div>
                    <p className="text-base font-medium text-white">
                      {isEnglish ? "No compiled PDF yet" : "Ainda não há PDF compilado"}
                    </p>
                    <p className="mt-2">
                      {isEnglish
                        ? "Click Compile PDF to generate the document preview."
                        : "Clica em Compilar PDF para gerar a preview do documento."}
                    </p>
                  </div>
                </div>
              )}

              {compileState === "rendering" ? (
                <div className="absolute inset-0 flex items-center justify-center bg-white/20 backdrop-blur-[1px]">
                  <div className="rounded-full border border-slate-300 bg-white/90 px-4 py-2 text-xs uppercase tracking-[0.24em] text-slate-700 shadow-lg">
                    {isEnglish ? "compiling PDF" : "a compilar PDF"}
                  </div>
                </div>
              ) : null}
            </div>

            {compileState === "error" ? (
              <div className="border-t border-white/10 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                {compileError ?? (isEnglish ? "Compilation failed." : "A compilação falhou.")}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
