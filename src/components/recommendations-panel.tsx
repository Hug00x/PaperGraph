"use client";

import { useEffect, useRef, useState } from "react";
import type { RecommendedPaper, RecommendationReason, RecommendationResult } from "@/lib/academic/discovery/types";
import { articleIdentity, samePaper, safePublicationUrl } from "@/lib/academic/discovery/identity";
import type { WorkspaceArticle } from "@/lib/workspace-data";

type Props = { article: WorkspaceArticle; workspaceId: string; accessToken: string; language: "en" | "pt";
  articles: WorkspaceArticle[]; canEdit: boolean; onAdd: (paper: RecommendedPaper, signal: AbortSignal) => Promise<void> };
function reasonText(reason: RecommendationReason, en: boolean) {
  const n = reason.count ?? 0;
  switch (reason.type) {
    case "semantic": return en ? "Semantically related" : "Semanticamente relacionado";
    case "high-semantic": return en ? "High semantic similarity" : "Alta similaridade semântica";
    case "cites-seed": return en ? "Cites this article" : "Cita este artigo";
    case "seed-cites": return en ? "Cited by this article" : "Citado por este artigo";
    case "shared-references": return en ? `${n} shared references` : `${n} referências em comum`;
    case "authors": return en ? `${n} shared authors` : `${n} autores em comum`;
    case "topics": return en ? `${n} shared topics` : `${n} tópicos em comum`;
    case "title-only": return en ? "Abstract unavailable" : "Sem abstract disponível";
    default: return en ? "Related literature found" : "Literatura relacionada encontrada";
  }
}
function errorText(code: string, en: boolean) {
  if (code === "insufficient-metadata") return en ? "This article needs scientific metadata before searching. Complete its metadata or reimport the PDF." : "Este artigo ainda não tem metadata científica suficiente. Completa a metadata ou reimporta o PDF.";
  if (code === "rate-limit") return en ? "The discovery service is busy. Try again later." : "O serviço de descoberta está temporariamente ocupado. Tenta novamente mais tarde.";
  if (code === "provider-access") return en ? "The discovery service is currently restricting access. Try again later." : "O serviço de descoberta está a restringir o acesso. Tenta novamente mais tarde.";
  if (code === "session") return en ? "Sign in again to search for articles." : "Inicia sessão novamente para procurar artigos.";
  if (code === "read-only") return en ? "This workspace is read-only." : "Esta workspace é só de leitura.";
  return en ? "Could not search for related articles. Check your Internet connection and try again." : "Não foi possível procurar artigos relacionados. Verifica a ligação à Internet e tenta novamente.";
}
export function RecommendationsPanel({ article, workspaceId, accessToken, language, articles, canEdit, onAdd }: Props) {
  const en = language === "en";
  const [phase, setPhase] = useState<"idle" | "discovering" | "reranking" | "ready" | "empty" | "error">("idle");
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const request = useRef<AbortController | null>(null);
  const addRequest = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; request.current?.abort(); addRequest.current?.abort(); }, []);
  const busy = phase === "discovering" || phase === "reranking";
  const visible = result?.papers.filter((paper) => !added.includes(paper.externalId) && !articles.some((existing) => samePaper(paper, articleIdentity(existing)))) ?? [];
  async function discover(refresh = false) {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const id = ++generation.current;
    setPhase("discovering"); setError("");
    let received = false;
    try {
      const response = await fetch("/api/recommendations", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ workspaceId, articleId: article.id, refresh }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "network");
      if (!response.body) throw new Error("network");
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "";
      const accept = (line: string) => {
        if (!line.trim() || id !== generation.current) return;
        const message = JSON.parse(line) as { error?: string; stage?: "discovering" | "reranking"; result?: RecommendationResult };
        if (message.error) throw new Error(message.error);
        if (message.stage) setPhase(message.stage);
        if (message.result) { received = true; setResult(message.result); setPhase(message.result.papers.length ? "ready" : "empty"); }
      };
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; lines.forEach(accept);
        }
        accept(buffer + decoder.decode());
      } finally { await reader.cancel().catch(() => {}); }
      if (!received) throw new Error("network");
    } catch (cause) {
      if (!controller.signal.aborted && id === generation.current) { setError(cause instanceof Error ? cause.message : "network"); setPhase("error"); }
    }
  }
  async function add(paper: RecommendedPaper) {
    const controller = new AbortController(); addRequest.current = controller;
    setAdding(paper.externalId); setError("");
    try { await onAdd(paper, controller.signal); if (!controller.signal.aborted) setAdded((ids) => [...ids, paper.externalId]); }
    catch { if (!controller.signal.aborted) setError("add-failed"); }
    finally { if (!controller.signal.aborted) setAdding(null); }
  }
  return <section className="recommendations-panel" aria-label={en ? "Related articles" : "Artigos relacionados"}>
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{en ? "Related articles" : "Artigos relacionados"}</h3>
      <button type="button" disabled={busy || !accessToken || !workspaceId} className="recommendations-action" onClick={() => void discover(phase !== "idle")}>
        {phase === "idle" ? (en ? "Discover" : "Descobrir") : (en ? "Refresh" : "Atualizar")}
      </button>
    </div>
    {phase === "idle" && <p className="mt-2 text-xs text-[var(--muted)]">{en ? "Search related literature using the article’s scientific title and abstract." : "Procura literatura relacionada usando o título e abstract científicos do artigo."}</p>}
    {busy && <p role="status" className="mt-3 text-xs text-[var(--muted)]">{phase === "reranking" ? (en ? "Analysing results…" : "A analisar os resultados…") : (en ? "Searching for related articles…" : "A procurar artigos relacionados…")}</p>}
    {error && <p role="alert" className="mt-3 text-xs text-[var(--muted)]">{error === "add-failed" ? (en ? "Could not add this article. Try again." : "Não foi possível adicionar este artigo. Tenta novamente.") : errorText(error, en)}</p>}
    {!busy && ["ready", "empty"].includes(phase) && !visible.length && <p role="status" className="mt-3 text-xs text-[var(--muted)]">{added.length ? (en ? "Articles added to the map." : "Artigos adicionados ao mapa.") : (en ? "No new related articles were found." : "Não encontrámos novos artigos relacionados.")}</p>}
    {!busy && phase !== "error" && visible.map((paper) => <article key={paper.externalId} className="recommendation-item">
      <h4 className="text-sm font-semibold leading-5">{paper.title}</h4>
      <p className="mt-1 text-xs text-[var(--muted)]">{[paper.authors.slice(0, 2).map((a) => a.name).join(", ") + (paper.authors.length > 2 ? " et al." : ""), paper.year, paper.venue].filter(Boolean).join(" · ")}</p>
      <ul className="mt-2 space-y-1 text-xs text-[var(--muted)]">{paper.reasons.map((reason) => <li key={reason.type}>{reasonText(reason, en)}</li>)}</ul>
      {paper.abstract && <details className="mt-2 text-xs text-[var(--muted)]"><summary>{en ? "Abstract" : "Resumo"}</summary><p className="mt-2 leading-5">{paper.abstract}</p></details>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={!canEdit || adding !== null} className="recommendations-action" onClick={() => void add(paper)}>{adding === paper.externalId ? (en ? "Adding…" : "A adicionar…") : (en ? "Add to map" : "Adicionar ao mapa")}</button>
        {safePublicationUrl(paper.url) && <a href={safePublicationUrl(paper.url)} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--muted)] underline">{en ? "Open publication" : "Abrir publicação"}</a>}
      </div>
    </article>)}
  </section>;
}
