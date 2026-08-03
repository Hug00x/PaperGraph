"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  CollaborativeLatexEditor,
  type CollaborativeLatexEditorHandle,
} from "@/components/collaborative-latex-editor";
import { PdfZoomControls } from "@/components/pdf-zoom-controls";
import deleteButtonImage from "@/imagens/Delete_button.png";
import deleteButtonImageInverted from "@/imagens/Delete_button_inverted.png";
import { getPdfFitScale } from "@/lib/pdf-preview-layout";
import { getArticleStatusLabel, type AppLanguage } from "@/lib/portuguese-labels";
import { getSupabaseBrowserClient } from "@/lib/supabase-client";
import { uploadWorkspaceAssetToSupabase } from "@/lib/supabase-storage";
import type { WorkspaceArticle, WorkspaceImageAsset } from "@/lib/workspace-data";

type SubmittedArticleStatus = Exclude<WorkspaceArticle["status"], "Draft">;

type EditorPaneProps = {
  article: WorkspaceArticle;
  articleCollaborators?: Array<{
    clientId?: string;
    mode: "editing" | "viewing" | "browsing" | "settings";
    selectionEnd?: number | null;
    selectionStart?: number | null;
    userId: string;
    userName: string;
  }>;
  collaborationClientId?: string;
  collaborationUserName?: string;
  onSaveArticle: (article: { source: string; tags: string[]; title: string }) => void;
  onSubmitArticle: (article: {
    articleId: string;
    source: string;
    status: SubmittedArticleStatus;
    tags: string[];
    title: string;
  }) => Promise<{
    cancelled?: boolean;
    issue?: string;
    pdfBuffer?: ArrayBuffer;
    submitted: boolean;
  }>;
  isSubmissionRunning?: boolean;
  submissionIssue: string | null;
  onSubmissionIssueClear: () => void;
  onPendingResubmissionChange: (article: {
    articleId: string;
    source: string;
    status: SubmittedArticleStatus;
    tags: string[];
    title: string;
  } | null) => void;
  imageAssets: WorkspaceImageAsset[];
  onImageUploaded: (imageAsset: WorkspaceImageAsset) => void;
  onImageDeleted: (imageAsset: WorkspaceImageAsset) => void | Promise<void>;
  onEditorSelectionChange?: (selection: { articleId: string; end: number; start: number }) => void;
  language: AppLanguage;
  authAccessToken?: string | null;
  workspaceId?: string | null;
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
  const storagePath = imageAsset.storagePath ?? imageAsset.storedName;

  return `/api/images/${encodeURIComponent(imageAsset.storedName)}?path=${encodeURIComponent(storagePath)}`;
}

function isPdfAsset(imageAsset: WorkspaceImageAsset) {
  return imageAsset.mimeType === "application/pdf" || imageAsset.storedName.toLowerCase().endsWith(".pdf");
}

function getAssetKindLabel(imageAsset: WorkspaceImageAsset) {
  return isPdfAsset(imageAsset) ? "PDF" : "IMG";
}

function normalizeKeywordTags(value: string) {
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

function getCollaboratorColor(value: string) {
  const colors = ["#8ee7ff", "#6ee7b7", "#fbbf24", "#fda4af", "#c4b5fd", "#93c5fd"];
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return colors[Math.abs(hash) % colors.length];
}

export function EditorPane({
  article,
  articleCollaborators = [],
  collaborationClientId,
  collaborationUserName,
  onSaveArticle,
  onSubmitArticle,
  isSubmissionRunning = false,
  submissionIssue,
  onSubmissionIssueClear,
  onPendingResubmissionChange,
  imageAssets,
  onImageUploaded,
  onImageDeleted,
  onEditorSelectionChange,
  language,
  authAccessToken,
  workspaceId,
}: EditorPaneProps) {
  const [title, setTitle] = useState(article.title);
  const [source, setSource] = useState(article.source);
  const [keywordInput, setKeywordInput] = useState(article.tags.join(", "));
  const [submissionStatus, setSubmissionStatus] = useState<SubmittedArticleStatus>(
    article.status === "Published" ? "Published" : "Review",
  );
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
  const [pdfZoom, setPdfZoom] = useState(100);
  const [compiledPreviewSignature, setCompiledPreviewSignature] = useState<string | null>(null);
  const didMountRef = useRef(false);
  const autoCompileStartedRef = useRef(false);
  const onSaveArticleRef = useRef(onSaveArticle);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<CollaborativeLatexEditorHandle | null>(null);
  const lastTextSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const previewScrollerRef = useRef<HTMLDivElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const isEnglish = language === "en";
  const isSubmittedArticle = article.status !== "Draft";
  const keywordTags = useMemo(() => normalizeKeywordTags(keywordInput), [keywordInput]);
  const keywordSignature = keywordTags.join("\u0001");
  const articleTagSignature = article.tags.join("\u0001");
  const hasPendingResubmission =
    isSubmittedArticle &&
    (title !== article.title ||
      source !== article.source ||
      submissionStatus !== article.status ||
      keywordSignature !== articleTagSignature);
  const currentPreviewSignature = `${title}\n${source}`;
  const isPreviewStale = compileState === "ready" && compiledPreviewSignature !== currentPreviewSignature;
  const editingCollaborators = articleCollaborators.filter((collaborator) => collaborator.mode === "editing");
  const collaboratorNames = articleCollaborators.map((collaborator) => collaborator.userName).join(", ");
  const remoteCursors = editingCollaborators
    .filter((collaborator) => typeof collaborator.selectionStart === "number")
    .map((collaborator) => {
      const cursorId = collaborator.clientId ?? collaborator.userId;

      return {
        clientId: cursorId,
        color: getCollaboratorColor(cursorId),
        selectionEnd: collaborator.selectionEnd ?? collaborator.selectionStart ?? 0,
        selectionStart: collaborator.selectionStart ?? 0,
        userName: collaborator.userName,
      };
    });

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
      onSaveArticleRef.current({ source, tags: keywordTags, title });
      setSaveState("saved");
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [hasPendingResubmission, isSubmittedArticle, keywordTags, source, title]);

  useEffect(() => {
    if (!isSubmittedArticle || !hasPendingResubmission) {
      onPendingResubmissionChange(null);
      return;
    }

    onPendingResubmissionChange({ articleId: article.id, source, status: submissionStatus, tags: keywordTags, title });
  }, [
    article.id,
    hasPendingResubmission,
    isSubmittedArticle,
    keywordTags,
    onPendingResubmissionChange,
    source,
    submissionStatus,
    title,
  ]);

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
          ...(authAccessToken ? { Authorization: `Bearer ${authAccessToken}` } : {}),
        },
        body: JSON.stringify({
          articleId: article.id,
          imageAssets,
          title: documentTitle,
          source: documentSource,
        }),
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
      setCompiledPreviewSignature(`${documentTitle}\n${documentSource}`);
    } catch (error) {
      setCompileState("error");
      setCompileError((error as Error).message);
    }
  }, [article.id, authAccessToken, imageAssets, isEnglish]);

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
        const fitScale = getPdfFitScale(previewScroller, unscaledViewport);
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
  }, [isEnglish, pdfBuffer, pdfZoom]);

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

  function handleKeywordInputChange(value: string) {
    onSubmissionIssueClear();

    if (!isSubmittedArticle) {
      setSaveState("saving");
    }

    setKeywordInput(value);
  }

  function handleSubmissionStatusChange(value: SubmittedArticleStatus) {
    onSubmissionIssueClear();
    setSubmissionStatus(value);
  }

  function updateLastTextSelection(selection?: { end: number; start: number }) {
    const nextSelection = selection ?? editorRef.current?.getSelection();

    if (!nextSelection) {
      return;
    }

    lastTextSelectionRef.current = nextSelection;
    onEditorSelectionChange?.({ articleId: article.id, end: nextSelection.end, start: nextSelection.start });
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
      editorRef.current?.setSelection(nextCursorPosition, nextCursorPosition);
      editorRef.current?.focus();
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

      let imageAsset = (await response.json()) as WorkspaceImageAsset;

      if (authAccessToken && workspaceId) {
        const supabase = getSupabaseBrowserClient();
        const { data: sessionData, error: sessionError } = supabase
          ? await supabase.auth.getSession()
          : { data: { session: null }, error: null };
        const userId = sessionData.session?.user.id;

        if (sessionError || !supabase || !userId) {
          throw new Error(sessionError?.message ?? (isEnglish ? "Could not validate the session." : "Não foi possível validar a sessão."));
        }

        imageAsset = await uploadWorkspaceAssetToSupabase(supabase, workspaceId, imageAsset, uploadedFile);
      }

      onImageUploaded(imageAsset);
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

  async function handleSubmitClick() {
    setCompileState("rendering");
    setCompileError(null);

    const result = await onSubmitArticle({ articleId: article.id, source, status: submissionStatus, tags: keywordTags, title });

    if (result.submitted) {
      if (result.pdfBuffer) {
        setPdfBuffer(result.pdfBuffer);
      }

      setCompiledPreviewSignature(currentPreviewSignature);
      setSaveState("saved");
      return;
    }

    if (!result.cancelled) {
      setCompileState("error");
      setCompileError(result.issue ?? (isEnglish ? "Submission failed." : "A submissão falhou."));
      return;
    }

    setCompileState(pdfBuffer ? "ready" : "idle");
  }

  const submitButtonLabel =
    article.status === "Draft"
      ? submissionStatus === "Published"
        ? isEnglish
          ? "Publish article"
          : "Publicar artigo"
        : isEnglish
          ? "Submit for review"
          : "Submeter para revisão"
      : isEnglish
        ? "Resubmit article"
        : "Resubmeter artigo";
  const saveStatusLabel = isSubmittedArticle
    ? hasPendingResubmission
      ? isEnglish
        ? "resubmission pending"
        : "resubmissão pendente"
      : isEnglish
        ? "submitted version"
        : "versão submetida"
    : `${saveState === "saving" ? (isEnglish ? "saving" : "a guardar") : isEnglish ? "saved" : "guardado"} • ${
        isEnglish ? "autosave enabled" : "autosave ativo"
      }`;
  const previewStatusLabel =
    compileState === "rendering"
      ? isEnglish
        ? "updating"
        : "a atualizar"
      : compileState === "error"
        ? isEnglish
          ? "error"
          : "erro"
        : isPreviewStale
          ? isEnglish
            ? "outdated"
            : "desatualizada"
          : isEnglish
            ? "ready"
            : "pronto";

  return (
    <section className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      {articleCollaborators.length > 0 ? (
        <div className="mt-4 rounded-[18px] border border-[rgba(142,231,255,0.26)] bg-[rgba(142,231,255,0.08)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">
          <p className="font-semibold text-white">
            {editingCollaborators.length > 0
              ? isEnglish
                ? "Someone else is editing this article"
                : "Mais alguém está a editar este artigo"
              : isEnglish
                ? "Someone else is viewing this article"
                : "Mais alguém está a visualizar este artigo"}
          </p>
          <p className="mt-1">
            {collaboratorNames}
            {editingCollaborators.length > 0
              ? isEnglish
                ? " is editing this article too."
                : " também está a editar este artigo."
              : isEnglish
                ? " is here too."
                : " também está aqui."}
          </p>
        </div>
      ) : null}

      {submissionIssue ? (
        <div className="mt-4 rounded-[18px] border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100">
          <p className="font-semibold text-red-50">
            {isEnglish ? "Submission blocked" : "Submissão bloqueada"}
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

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="min-w-0">
              <span className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                {isEnglish ? "Keywords" : "Palavras-chave"}
              </span>
              <input
                value={keywordInput}
                onChange={(event) => handleKeywordInputChange(event.target.value)}
                className="mt-2 w-full rounded-[18px] border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
                placeholder={isEnglish ? "e.g. NLP, graph, methods" : "ex. NLP, grafo, metodologia"}
              />
            </label>

            <fieldset className="min-w-[15rem]">
              <legend className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                {isSubmittedArticle
                  ? isEnglish
                    ? "Resubmit as"
                    : "Resubmeter como"
                  : isEnglish
                    ? "Submit as"
                    : "Submeter como"}
              </legend>
              <div className="mt-2 inline-grid w-full grid-cols-2 rounded-full border border-[var(--border)] bg-black/20 p-1">
                {(["Review", "Published"] as const).map((statusOption) => {
                  const isSelectedStatus = submissionStatus === statusOption;

                  return (
                    <button
                      key={statusOption}
                      type="button"
                      aria-pressed={isSelectedStatus}
                      onClick={() => handleSubmissionStatusChange(statusOption)}
                      className={`rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                        isSelectedStatus
                          ? "bg-[var(--accent)] text-[#041016]"
                          : "text-[var(--muted)] hover:bg-white/8 hover:text-white"
                      }`}
                    >
                      {statusOption === "Review"
                        ? isEnglish
                          ? "Review"
                          : "Revisão"
                        : isEnglish
                          ? "Published"
                          : "Publicado"}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <label className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <span>article.tex</span>
              <span>
                {getArticleStatusLabel(article.status, language).toLowerCase()} • {saveStatusLabel}
              </span>
            </div>
            <CollaborativeLatexEditor
              ref={editorRef}
              articleId={article.id}
              className="min-h-[18rem] w-full flex-1 overflow-hidden rounded-[24px] border border-[var(--border)] bg-[#f7fbff] shadow-inner xl:min-h-0"
              collaborationClientId={collaborationClientId}
              collaborationUserName={collaborationUserName}
              language={language}
              onChange={handleSourceChange}
              onSelectionChange={updateLastTextSelection}
              remoteCursors={remoteCursors}
              value={source}
              workspaceId={workspaceId}
            />
          </label>
        </div>

        <div className="flex min-h-[24rem] flex-col gap-4 overflow-hidden xl:min-h-0 xl:pl-4">
          <div className="papergraph-pdf-preview-shell relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-[var(--border)] shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
            <div className="papergraph-pdf-preview-toolbar relative z-30 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div className="flex min-h-9 items-center">
                {pdfBuffer ? (
                  <PdfZoomControls
                    className="shadow-none"
                    language={language}
                    onChange={setPdfZoom}
                    value={pdfZoom}
                  />
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf,.pdf"
                  className="hidden"
                  onChange={handleImageUploadChange}
                />

                <div className="papergraph-pdf-preview-status rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.3em] backdrop-blur-xl">
                  {previewStatusLabel}
                </div>

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
                    className={`border-l border-[var(--border)] px-3 py-2 text-base font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                      imagePanelOpen ? "bg-[rgba(142,231,255,0.16)] text-[var(--accent)]" : "text-white hover:bg-white/10"
                    }`}
                  >
                    ›
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleSubmitClick}
                  disabled={compileState === "rendering" || isSubmissionRunning || (isSubmittedArticle && !hasPendingResubmission)}
                  className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmissionRunning
                    ? isEnglish
                      ? "Compiling..."
                      : "A compilar..."
                    : submitButtonLabel}
                </button>

                <button
                  type="button"
                  onClick={handleCompileClick}
                  disabled={compileState === "rendering" || isSubmissionRunning}
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
              <aside className="papergraph-file-panel absolute right-4 top-[4.75rem] z-40 flex w-[min(24rem,calc(100%_-_2rem))] max-h-[calc(100%_-_5.75rem)] flex-col overflow-hidden rounded-[14px] border border-[var(--border)] shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--file-panel-divider)] px-3 py-2">
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
                    <div className="m-2 rounded-[10px] border border-[var(--file-panel-divider)] bg-[var(--file-panel-muted-surface)] p-3 text-sm leading-6 text-[var(--muted)]">
                      {isEnglish ? "There are no uploaded files yet." : "Ainda não há ficheiros carregados."}
                    </div>
                  ) : null}

                  {imageAssets.map((imageAsset) => (
                    <article
                      key={imageAsset.id}
                      className="group flex min-h-11 items-center gap-2 px-2 py-1 text-white transition-colors hover:bg-[var(--file-panel-row-hover)]"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <div
                          role="img"
                          aria-label={imageAsset.originalName}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border border-[var(--file-panel-file-border)] bg-cover bg-center bg-no-repeat text-[8px] font-bold leading-none text-white"
                          style={isPdfAsset(imageAsset) ? undefined : { backgroundImage: `url(${getImageUrl(imageAsset)})` }}
                        >
                          {getAssetKindLabel(imageAsset)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-medium leading-5 text-white">{imageAsset.originalName}</p>
                          <p className="truncate text-[11px] leading-4 text-[var(--file-panel-meta)]">
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
                            className="papergraph-delete-icon-dark absolute left-1/2 top-1/2 h-[3.2rem] w-[4.8rem] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain"
                          />
                          <Image
                            src={deleteButtonImageInverted}
                            alt=""
                            aria-hidden
                            className="papergraph-delete-icon-light absolute left-1/2 top-1/2 h-[3.2rem] w-[4.8rem] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain"
                          />
                        </span>
                      </button>
                    </article>
                  ))}
                </div>
              </aside>
            ) : null}

            <div className="papergraph-pdf-preview-stage relative flex min-h-0 flex-1 flex-col">
              {pdfBuffer ? (
                <div ref={previewScrollerRef} className="min-h-0 flex-1 overflow-auto overscroll-contain p-6">
                  <div ref={previewContainerRef} className="flex w-max min-w-full flex-col items-center" />
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
