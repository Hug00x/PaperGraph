"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask, TextLayer } from "pdfjs-dist";
import { PdfZoomControls } from "@/components/pdf-zoom-controls";
import { getSupabaseBrowserClient } from "@/lib/supabase-client";
import { createBrowserUuid } from "@/lib/browser-uuid";
import { highlightColors, isPdfHighlight, normalizeHighlightRects, pdfDocumentKey, type HighlightColor, type PdfHighlight } from "@/lib/pdf-highlights";
import type { AppLanguage } from "@/lib/portuguese-labels";

type Props = {
  buffer: ArrayBuffer;
  workspaceId?: string;
  articleId: string;
  canEdit: boolean;
  language: AppLanguage;
  // Compiled documents have volatile PDF metadata; their source identifies revisions.
  sourceIdentity?: string;
};

export function AnnotatedPdfViewer(props: Props) {
  const [loaded, setLoaded] = useState<{ buffer: ArrayBuffer; document: PDFDocumentProxy; key: string } | null>(null);
  const [failed, setFailed] = useState<ArrayBuffer | null>(null);
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
    async function load() {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
      task = pdfjs.getDocument({ data: new Uint8Array(props.buffer.slice(0)) });
      const [document, key] = await Promise.all([
        task.promise,
        pdfDocumentKey(props.sourceIdentity === undefined ? props.buffer : new TextEncoder().encode(props.sourceIdentity).buffer),
      ]);
      if (!cancelled) setLoaded({ buffer: props.buffer, document, key });
    }
    void load().catch(() => { if (!cancelled) setFailed(props.buffer); });
    return () => { cancelled = true; void task?.destroy(); };
  }, [props.buffer, props.sourceIdentity]);

  if (failed === props.buffer) return <p role="alert" className="p-6">{props.language === "en" ? "Could not open this PDF." : "Não foi possível abrir este PDF."}</p>;
  if (!loaded || loaded.buffer !== props.buffer) return <p role="status" className="p-6">{props.language === "en" ? "Loading PDF…" : "A carregar PDF…"}</p>;
  return <PdfDocumentView key={`${props.workspaceId}:${props.articleId}:${loaded.key}`} {...props} document={loaded.document} documentKey={loaded.key} />;
}

function PdfPage({ document, number, width, zoom, highlights, language }: {
  document: PDFDocumentProxy; number: number; width: number; zoom: number; highlights: PdfHighlight[]; language: AppLanguage;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    let render: RenderTask | undefined;
    let text: TextLayer | undefined;
    let page: PDFPageProxy | undefined;
    const textContainer = textRef.current;
    async function draw() {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      page = await document.getPage(number);
      if (cancelled || !canvasRef.current || !textContainer) return;
      setStatus("loading");
      const base = page.getViewport({ scale: 1 });
      const scale = Math.max(0.25, Math.min(width, 880) / base.width) * zoom / 100;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      setSize({ width: viewport.width, height: viewport.height });
      textContainer.replaceChildren();
      const textScale = scale * page.userUnit;
      textContainer.style.setProperty("--total-scale-factor", String(textScale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      render = page.render({ canvas, canvasContext: context, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
      const content = await page.getTextContent();
      if (cancelled) return;
      text = new pdfjs.TextLayer({ textContentSource: content, container: textContainer, viewport });
      const raw = viewport.rawDims as { pageWidth: number; pageHeight: number };
      textContainer.style.width = `${raw.pageWidth * textScale}px`;
      textContainer.style.height = `${raw.pageHeight * textScale}px`;
      await text.render();
      if (!cancelled) setStatus(content.items.some((item) => "str" in item && item.str.trim()) ? "ready" : "empty");
    }
    void draw().catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; render?.cancel(); text?.cancel(); };
  }, [document, number, width, zoom]);
  return <div className="shrink-0" data-pdf-page={number}>
    <div className="papergraph-annotated-page relative bg-white shadow-lg" style={{ width: size.width || 300, height: size.height || 400 }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label={`${language === "en" ? "Page" : "Página"} ${number}`} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1] mix-blend-multiply">
        {highlights.flatMap((highlight) => highlight.rects.map((rect, index) => <span key={`${highlight.id}:${index}`} data-highlight-id={highlight.id} data-highlight-color={highlight.color ?? "yellow"} className="absolute opacity-55" style={{ backgroundColor: highlightColors[highlight.color ?? "yellow"].hex, left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />))}
      </div>
      <div ref={textRef} className="papergraph-pdf-text-layer" data-pdf-text={number} />
    </div>
    {status === "empty" || status === "error" ? <p role="status" className="max-w-xl py-2 text-sm text-[var(--muted)]">{status === "empty" ? (language === "en" ? "This page has no selectable text." : "Esta página não tem texto selecionável.") : (language === "en" ? "Could not render this page. Reopen the article to retry." : "Não foi possível apresentar esta página. Reabre o artigo para tentar novamente.")}</p> : null}
  </div>;
}

function PdfDocumentView({ document, documentKey, workspaceId, articleId, canEdit, language }: Props & { document: PDFDocumentProxy; documentKey: string }) {
  const en = language === "en";
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [zoom, setZoom] = useState(100);
  const [highlights, setHighlights] = useState<PdfHighlight[]>([]);
  const [selection, setSelection] = useState<Omit<PdfHighlight, "id">[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [showHighlights, setShowHighlights] = useState(false);
  const [markerColor, setMarkerColor] = useState<HighlightColor>("yellow");
  const localKey = `papergraph-pdf-highlights:${articleId}:${documentKey}`;
  const mutation = useRef(false);

  useEffect(() => {
    if (!scroller.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(scroller.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (workspaceId) {
        const client = getSupabaseBrowserClient();
        if (!client) throw new Error("Unavailable");
        const { data, error } = await client.from("pdf_highlights").select("id,page_number,selected_text,rects,color")
          .eq("workspace_id", workspaceId).eq("article_id", articleId).eq("document_key", documentKey).order("created_at");
        if (error) throw error;
        if (!data.every(isPdfHighlight)) throw new Error("Invalid highlights");
        if (!cancelled) setHighlights(data);
      } else {
        const saved = JSON.parse(localStorage.getItem(localKey) ?? "[]");
        if (!Array.isArray(saved) || !saved.every(isPdfHighlight)) throw new Error("Invalid highlights");
        if (!cancelled) setHighlights(saved);
      }
      if (!cancelled) { setReady(true); setError(false); }
    }
    void load().catch(() => { if (!cancelled) { setReady(false); setError(true); } });
    return () => { cancelled = true; };
  }, [workspaceId, articleId, documentKey, localKey, attempt]);

  const captureSelection = useCallback(() => {
    const current = window.getSelection();
    if (!current || current.isCollapsed || !current.rangeCount || !scroller.current) { setSelection([]); return; }
    const range = current.getRangeAt(0);
    if (!scroller.current.contains(range.startContainer) || !scroller.current.contains(range.endContainer)) { setSelection([]); return; }
    const selected: Omit<PdfHighlight, "id">[] = [];
    for (const layer of scroller.current.querySelectorAll<HTMLElement>("[data-pdf-text]")) {
      if (!range.intersectsNode(layer)) continue;
      const part = documentOwnerRange(layer);
      if (layer.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset);
      if (layer.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset);
      const text = part.toString().trim();
      // Measure individual text runs, avoiding parent rectangles spanning unselected text.
      const rects: DOMRect[] = [];
      for (const span of layer.querySelectorAll("span")) {
        if (!span.firstChild || span.firstChild.nodeType !== Node.TEXT_NODE || !part.intersectsNode(span)) continue;
        const run = documentOwnerRange(span);
        if (span.contains(part.startContainer)) run.setStart(part.startContainer, part.startOffset);
        if (span.contains(part.endContainer)) run.setEnd(part.endContainer, part.endOffset);
        rects.push(...run.getClientRects());
      }
      const normalized = normalizeHighlightRects(rects, layer.getBoundingClientRect());
      if (text && text.length <= 20000 && normalized.length && normalized.length <= 500) selected.push({ page_number: Number(layer.dataset.pdfText), selected_text: text, rects: normalized });
    }
    setSelection(selected);
  }, []);

  useEffect(() => {
    window.document.addEventListener("selectionchange", captureSelection);
    return () => window.document.removeEventListener("selectionchange", captureSelection);
  }, [captureSelection]);

  async function saveHighlights(action: { type: "add" } | { type: "delete"; id: string } | { type: "color"; id: string; color: HighlightColor } = { type: "add" }) {
    if (!canEdit || !ready || mutation.current || (action.type === "add" && !selection.length)) return;
    mutation.current = true;
    setBusy(true);
    setError(false);
    try {
      const additions = action.type === "add" ? selection.map((item) => ({ ...item, id: createBrowserUuid(), color: markerColor })) : [];
      const next = action.type === "delete" ? highlights.filter((item) => item.id !== action.id)
        : action.type === "color" ? highlights.map((item) => item.id === action.id ? { ...item, color: action.color } : item)
          : [...highlights, ...additions];
      if (workspaceId) {
        const client = getSupabaseBrowserClient();
        if (!client) throw new Error("Unavailable");
        if (action.type === "delete") {
          const { data, error } = await client.from("pdf_highlights").delete().eq("id", action.id).eq("workspace_id", workspaceId).select("id");
          if (error || !data?.length) throw error ?? new Error("Permission denied");
        } else if (action.type === "color") {
          const { data, error } = await client.from("pdf_highlights").update({ color: action.color }).eq("id", action.id).eq("workspace_id", workspaceId).select("id");
          if (error || !data?.length) throw error ?? new Error("Permission denied");
        } else {
          const { error } = await client.from("pdf_highlights").insert(additions.map((item) => ({ ...item, workspace_id: workspaceId, article_id: articleId, document_key: documentKey })));
          if (error) throw error;
        }
      } else localStorage.setItem(localKey, JSON.stringify(next));
      setHighlights(next);
      window.getSelection()?.removeAllRanges();
      setSelection([]);
    } catch { setError(true); }
    finally { mutation.current = false; setBusy(false); }
  }

  return <div className="papergraph-pdf-preview-shell flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)]">
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] p-3">
      <PdfZoomControls language={language} value={zoom} onChange={(value) => { window.getSelection()?.removeAllRanges(); setSelection([]); setZoom(value); }} />
      {canEdit ? <>
        <HighlightColorPicker value={markerColor} language={language} onChange={setMarkerColor} disabled={busy} />
        <button type="button" disabled={!selection.length || !ready || busy} onPointerDown={(event) => event.preventDefault()} onClick={() => void saveHighlights()} style={{ backgroundColor: highlightColors[markerColor].hex }} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-40">{busy ? (en ? "Saving…" : "A guardar…") : (en ? "Highlight selection" : "Destacar seleção")}</button>
      </> : null}
      <button type="button" disabled={!highlights.length} aria-expanded={showHighlights && highlights.length > 0} onClick={() => setShowHighlights((value) => !value)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-40">{en ? "Highlights" : "Destaques"} ({highlights.length})</button>
    </div>
    {error ? <div role="alert" className="px-3 py-2 text-sm text-red-400">{en ? "Could not load or save highlights. Your change has not been saved." : "Não foi possível carregar ou guardar os destaques. A alteração não foi guardada."} {!ready ? <button type="button" onClick={() => setAttempt((value) => value + 1)} className="ml-2 underline">{en ? "Retry" : "Tentar novamente"}</button> : null}</div> : null}
    {showHighlights && highlights.length > 0 ? <div className="max-h-64 shrink-0 space-y-2 overflow-auto border-b border-[var(--border)] p-3" aria-label={en ? "Saved highlights" : "Destaques guardados"}>
      {highlights.map((item) => <details key={item.id} data-highlight-entry={item.id} className="group rounded-lg border border-[var(--border)]">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: highlightColors[item.color ?? "yellow"].hex }} />
          <span className="shrink-0 font-semibold">{en ? "Page" : "Página"} {item.page_number}</span>
          <span className="min-w-0 flex-1 truncate">{item.selected_text}</span>
          <svg aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 7.5 5 5 5-5" /></svg>
        </summary>
        <div className="border-t border-[var(--border)] px-3 py-3">
          <p className="whitespace-pre-wrap break-words text-sm leading-6">{item.selected_text}</p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <button type="button" className="text-sm text-[var(--accent)] hover:underline" onClick={() => {
              const page = scroller.current?.querySelector<HTMLElement>(`[data-pdf-page="${item.page_number}"]`);
              if (page && scroller.current) scroller.current.scrollTo({ top: page.getBoundingClientRect().top - scroller.current.getBoundingClientRect().top + scroller.current.scrollTop + item.rects[0].y * page.clientHeight - 24, behavior: "smooth" });
            }}>{en ? "Go to passage" : "Ir para a passagem"}</button>
            {canEdit ? <>
              <HighlightColorPicker value={item.color ?? "yellow"} language={language} disabled={busy} onChange={(color) => void saveHighlights({ type: "color", id: item.id, color })} />
              <button type="button" disabled={busy} onClick={() => void saveHighlights({ type: "delete", id: item.id })} aria-label={`${en ? "Delete highlight" : "Apagar destaque"}: ${item.selected_text.slice(0, 60)}`} className="ml-auto text-sm text-[var(--muted)] hover:underline">{en ? "Delete" : "Apagar"}</button>
            </> : null}
          </div>
        </div>
      </details>)}
    </div> : null}
    <div ref={scroller} className="papergraph-pdf-preview-stage min-h-0 flex-1 overflow-auto overscroll-contain p-5">
      <div className="flex w-max min-w-full flex-col items-center gap-8">
        {Array.from({ length: document.numPages }, (_, index) => <PdfPage key={index + 1} document={document} number={index + 1} width={width} zoom={zoom} highlights={highlights.filter((item) => item.page_number === index + 1)} language={language} />)}
      </div>
    </div>
  </div>;
}

function HighlightColorPicker({ value, language, onChange, disabled }: {
  value: HighlightColor; language: AppLanguage; onChange: (color: HighlightColor) => void; disabled?: boolean;
}) {
  return <div role="group" aria-label={language === "en" ? "Highlight color" : "Cor do marcador"} className="flex items-center gap-1">
    {(Object.keys(highlightColors) as HighlightColor[]).map((color) => <button key={color} type="button" aria-label={highlightColors[color][language]} title={highlightColors[color][language]} aria-pressed={value === color} disabled={disabled} onPointerDown={(event) => event.preventDefault()} onClick={() => onChange(color)} className="flex h-8 w-8 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-40">
      <span className={`flex h-5 w-5 items-center justify-center rounded-full ${value === color ? "ring-2 ring-[var(--foreground)] ring-offset-2 ring-offset-[var(--surface)]" : ""}`} style={{ backgroundColor: highlightColors[color].hex }}>
        {value === color ? <svg aria-hidden="true" className="h-3 w-3 text-slate-900" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="m3 8 3 3 7-7" /></svg> : null}
      </span>
    </button>)}
  </div>;
}

function documentOwnerRange(element: Element) {
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  return range;
}
